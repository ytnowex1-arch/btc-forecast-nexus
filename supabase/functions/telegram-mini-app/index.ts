import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const encoder = new TextEncoder();

async function signHmac(keyBytes: Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(value));
  return new Uint8Array(signature);
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function verifyTelegramInitData(initData: string, botToken: string) {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');

  if (!hash) {
    throw new Error('Missing Telegram hash');
  }

  const dataCheckString = Array.from(params.entries())
    .filter(([key]) => key !== 'hash')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = await signHmac(encoder.encode('WebAppData'), botToken);
  const calculatedHash = toHex(await signHmac(secretKey, dataCheckString));

  if (calculatedHash !== hash) {
    throw new Error('Invalid Telegram signature');
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    throw new Error('Missing Telegram user payload');
  }

  const user = JSON.parse(userRaw);
  if (!user?.id) {
    throw new Error('Missing Telegram user id');
  }

  return {
    telegramId: String(user.id),
    username: user.username ?? null,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { initData } = await req.json();
    if (!initData || typeof initData !== 'string') {
      return new Response(JSON.stringify({ error: 'Missing initData' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!botToken || !supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error('Telegram Mini App environment is not configured');
    }

    const telegramUser = await verifyTelegramInitData(initData, botToken);

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey);
    const now = new Date().toISOString();

    const { data: existingProfile, error: profileReadError } = await supabase
      .from('users_profile')
      .select('*')
      .eq('telegram_id', telegramUser.telegramId)
      .maybeSingle();

    if (profileReadError) {
      throw profileReadError;
    }

    let profile;
    let isNew = false;

    if (existingProfile) {
      const { data, error } = await supabase
        .from('users_profile')
        .update({
          username: telegramUser.username,
          last_seen_at: now,
        })
        .eq('telegram_id', telegramUser.telegramId)
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      profile = data;
    } else {
      isNew = true;
      const { data, error } = await supabase
        .from('users_profile')
        .insert({
          telegram_id: telegramUser.telegramId,
          username: telegramUser.username,
          last_seen_at: now,
          user_settings: {
            preferences: {},
            forecast_history: [],
          },
        })
        .select('*')
        .single();

      if (error) {
        throw error;
      }

      profile = data;
    }

    const { data: link } = await supabase
      .from('telegram_user_links')
      .select('chat_id, is_active')
      .eq('telegram_id', telegramUser.telegramId)
      .maybeSingle();

    return new Response(JSON.stringify({
      ok: true,
      isNew,
      telegramUser,
      profile,
      linkedChat: Boolean(link?.chat_id && link?.is_active),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });
  } catch (error) {
    console.error('telegram-mini-app error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});