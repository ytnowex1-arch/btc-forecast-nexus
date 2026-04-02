import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const WEBAPP_URL = 'https://btc-forecast-nexus.lovable.app';
const MAX_RUNTIME_MS = 55_000;
const MIN_REMAINING_MS = 5_000;

async function callTelegram(method: string, payload: Record<string, unknown>) {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');

  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(data)}`);
  }

  return data;
}

function isStartCommand(text: string | undefined) {
  return typeof text === 'string' && /^\/start(?:@\w+)?(?:\s|$)/i.test(text.trim());
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Backend environment is not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const startTime = Date.now();

    const { data: state, error: stateError } = await supabase
      .from('telegram_bot_state')
      .select('update_offset')
      .eq('id', 1)
      .maybeSingle();

    if (stateError) {
      throw stateError;
    }

    let currentOffset = Number(state?.update_offset ?? 0);
    let processed = 0;
    let startReplies = 0;

    while (true) {
      const remainingMs = MAX_RUNTIME_MS - (Date.now() - startTime);
      if (remainingMs < MIN_REMAINING_MS) {
        break;
      }

      const timeout = Math.min(50, Math.floor(remainingMs / 1000) - 4);
      if (timeout < 1) {
        break;
      }

      const telegramData = await callTelegram('getUpdates', {
        offset: currentOffset,
        timeout,
        allowed_updates: ['message'],
      });

      const updates = telegramData.result ?? [];
      if (updates.length === 0) {
        continue;
      }

      for (const update of updates) {
        const message = update.message;
        const from = message?.from;
        const chatId = message?.chat?.id;

        if (!from?.id) {
          continue;
        }

        const telegramId = String(from.id);
        const username = from.username ?? null;
        const now = new Date().toISOString();

        const { error: profileError } = await supabase
          .from('users_profile')
          .upsert({
            telegram_id: telegramId,
            username,
            last_seen_at: now,
          }, { onConflict: 'telegram_id' });

        if (profileError) {
          throw profileError;
        }

        if (chatId) {
          const { error: linkError } = await supabase
            .from('telegram_user_links')
            .upsert({
              telegram_id: telegramId,
              chat_id: chatId,
              username,
              is_active: true,
            }, { onConflict: 'telegram_id' });

          if (linkError) {
            throw linkError;
          }
        }

        if (chatId && isStartCommand(message?.text)) {
          await callTelegram('sendMessage', {
            chat_id: chatId,
            text: 'Otwórz panel bota bezpośrednio w Telegramie.',
            reply_markup: {
              inline_keyboard: [[
                {
                  text: '🚀 Otwórz Mini App',
                  web_app: {
                    url: WEBAPP_URL,
                  },
                },
              ]],
            },
          });
          startReplies += 1;
        }

        processed += 1;
      }

      currentOffset = Math.max(...updates.map((update: { update_id: number }) => update.update_id)) + 1;

      const { error: offsetError } = await supabase
        .from('telegram_bot_state')
        .upsert({
          id: 1,
          update_offset: currentOffset,
          updated_at: new Date().toISOString(),
        });

      if (offsetError) {
        throw offsetError;
      }
    }

    return new Response(JSON.stringify({ ok: true, processed, startReplies, currentOffset }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('telegram-poll error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});