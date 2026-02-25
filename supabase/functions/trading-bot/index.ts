import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BINANCE_URL = 'https://data-api.binance.vision/api/v3';

interface Kline {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}

// ========== NARZĘDZIA MATEMATYCZNE (ZGODNE Z indicators.ts) ==========
function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i-1] * (1-k));
  return result;
}

function sma(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(NaN); continue; }
    result.push(data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
  }
  return result;
}

function rsi(closes: number[], period = 14): number[] {
  const r: number[] = new Array(period).fill(NaN);
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const c = closes[i] - closes[i-1];
    if (c > 0) ag += c; else al += Math.abs(c);
  }
  ag /= period; al /= period;
  r.push(al === 0 ? 100 : 100 - 100/(1+ag/al));
  for (let i = period+1; i < closes.length; i++) {
    const c = closes[i] - closes[i-1];
    ag = (ag*(period-1) + Math.max(c,0))/period;
    al = (al*(period-1) + Math.max(-c,0))/period;
    r.push(al === 0 ? 100 : 100 - 100/(1+ag/al));
  }
  return r;
}

// ========== ANALIZA RYNKU (KLON LOGIKI Z forecast.ts) ==========
function analyzeMarket(klines: Kline[]) {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const last = closes.length - 1;
  const price = closes[last];

  // Obliczenia wskaźników
  const rsiVals = rsi(closes);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const ema20 = ema(closes, 20); // Dodatkowe momentum
  
  // MACD
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = ema(macdLine, 9);
  
  // Bollinger
  const midBB = sma(closes, 20);
  const stds = closes.map((v, i) => {
    if (i < 19) return NaN;
    const slice = closes.slice(i-19, i+1);
    const m = midBB[i];
    return Math.sqrt(slice.reduce((s, x) => s + (x-m)**2, 0)/20);
  });
  const bbUpper = midBB.map((v, i) => v + 2 * stds[i]);
  const bbLower = midBB.map((v, i) => v - 2 * stds[i]);

  let bullKeys = 0;
  let bearKeys = 0;
  const reasons: string[] = [];

  // 1. RSI (Zgodnie z UI)
  const curRsi = rsiVals[last];
  if (curRsi < 30) { bullKeys++; reasons.push("RSI Oversold"); }
  else if (curRsi > 70) { bearKeys++; reasons.push("RSI Overbought"); }

  // 2. MACD (Cross i pozycja)
  if (macdLine[last] > signalLine[last]) { bullKeys++; reasons.push("MACD Bullish"); }
  else { bearKeys++; reasons.push("MACD Bearish"); }

  // 3. EMA 50/200 (Struktura trendu)
  if (ema50[last] > ema200[last]) { bullKeys++; reasons.push("Golden Cross Structure"); }
  else { bearKeys++; reasons.push("Death Cross Structure"); }

  // 4. Bollinger Position
  const bbPos = (price - bbLower[last]) / (bbUpper[last] - bbLower[last]);
  if (bbPos < 0.2) { bullKeys++; reasons.push("BB Bottom"); }
  else if (bbPos > 0.8) { bearKeys++; reasons.push("BB Top"); }

  // 5. Momentum (Cena vs EMA20)
  if (price > ema20[last]) { bullKeys++; reasons.push("Above EMA20"); }
  else { bearKeys++; reasons.push("Below EMA20"); }

  // Logika wejścia (Kluczowa zmiana - Context)
  // Pozwalamy na wejście jeśli mamy trend (EMA) LUB wybicie (BB/RSI)
  const REQUIRED = 3;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let entryAllowed = false;
  let skipReason = "";

  if (bullKeys >= REQUIRED) {
    if (curRsi > 80) skipReason = "RSI Guardrail: Too high for Long";
    else { bias = 'bullish'; entryAllowed = true; }
  } else if (bearKeys >= REQUIRED) {
    if (curRsi < 20) skipReason = "RSI Guardrail: Too low for Short";
    else { bias = 'bearish'; entryAllowed = true; }
  } else {
    skipReason = `Not enough signals (${Math.max(bullKeys, bearKeys)}/${REQUIRED})`;
  }

  return {
    bias,
    bullKeys,
    bearKeys,
    price,
    rsi: curRsi,
    entryAllowed,
    skipReason,
    reasoning: reasons.join(", ")
  };
}

// ========== SERWER EDGE FUNCTION ==========
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: configs } = await supabase.from('bot_config').select('*').limit(1);
    const config = configs[0];

    // Pobierz dane z Binance
    const res = await fetch(`${BINANCE_URL}/klines?symbol=${config.symbol}&interval=${config.interval}&limit=300`);
    const rawData = await res.json();
    const klines: Kline[] = rawData.map((k: any[]) => ({
      time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]
    }));

    const analysis = analyzeMarket(klines);

    if (!config.is_active) {
       return new Response(JSON.stringify({ analysis, message: "Bot jest wyłączony" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Sprawdź otwarte pozycje
    const { data: openPositions } = await supabase.from('bot_positions').select('*').eq('bot_config_id', config.id).eq('status', 'open');

    // LOGIKA OTWARCIA
    if ((!openPositions || openPositions.length === 0) && analysis.entryAllowed) {
      const balance = Number(config.current_balance);
      const margin = balance * (config.position_size_pct / 100);
      
      if (margin >= 10) {
        const side = analysis.bias === 'bullish' ? 'long' : 'short';
        const sl = side === 'long' ? analysis.price * (1 - (config.stop_loss_pct / 100 / config.leverage)) : analysis.price * (1 + (config.stop_loss_pct / 100 / config.leverage));
        const tp = side === 'long' ? analysis.price * (1 + (config.take_profit_pct / 100 / config.leverage)) : analysis.price * (1 - (config.take_profit_pct / 100 / config.leverage));
        const qty = (margin * config.leverage) / analysis.price;

        await supabase.from('bot_positions').insert({
          bot_config_id: config.id,
          side,
          entry_price: analysis.price,
          quantity: qty,
          leverage: config.leverage,
          margin_used: margin,
          stop_loss: sl,
          take_profit: tp,
          status: 'open',
          entry_reason: analysis.reasoning
        });
        
        await supabase.from('bot_config').update({ current_balance: balance - margin }).eq('id', config.id);
        await supabase.from('bot_logs').insert({
          bot_config_id: config.id,
          level: 'trade',
          message: `🚀 OTWARTO ${side.toUpperCase()} po cenie ${analysis.price}`
        });
      }
    }

    // LOGI (Naprawione undefined)
    await supabase.from('bot_logs').insert({
      bot_config_id: config.id,
      level: 'info',
      message: `Tick: $${analysis.price.toFixed(0)} | Bias: ${analysis.bias} | Klucze: B:${analysis.bullKeys}/5 S:${analysis.bearKeys}/5 | RSI: ${analysis.rsi.toFixed(1)}`,
      data: { skipReason: analysis.skipReason }
    });

    return new Response(JSON.stringify({ analysis, executed: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
