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

// ========== KLONY FUNKCJI Z indicators.ts ==========

function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { sma.push(NaN); continue; }
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  return sma;
}

function calculateRSI(closes: number[], period = 14): number[] {
  const rsi: number[] = new Array(period).fill(NaN);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change; else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

// ========== ANALIZA RYNKU (KLON analyzeSignals Z forecast.ts) ==========

function analyzeMarket(klines: Kline[]) {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const last = closes.length - 1;
  const price = closes[last];

  let bullish = 0;
  let bearish = 0;
  const reports: string[] = [];

  // 1. RSI
  const rsiVals = calculateRSI(closes);
  const r = rsiVals[last];
  if (!isNaN(r)) {
    if (r < 30) { bullish++; reports.push("RSI Buy"); }
    else if (r > 70) { bearish++; reports.push("RSI Sell"); }
  }

  // 2. MACD
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calculateEMA(macdLine, 9);
  if (macdLine[last] > signalLine[last]) { bullish++; reports.push("MACD Buy"); }
  else { bearish++; reports.push("MACD Sell"); }

  // 3. EMA 50/200
  const e50 = calculateEMA(closes, 50)[last];
  const e200 = calculateEMA(closes, 200)[last];
  if (e50 > e200) { bullish++; reports.push("EMA Cross Buy"); }
  else { bearish++; reports.push("EMA Cross Sell"); }

  // 4. Bollinger
  const bbMid = calculateSMA(closes, 20);
  const bbSlice = closes.slice(last - 19, last + 1);
  const std = Math.sqrt(bbSlice.reduce((s, v) => s + (v - bbMid[last]) ** 2, 0) / 20);
  const bbUpper = bbMid[last] + 2 * std;
  const bbLower = bbMid[last] - 2 * std;
  const bbPos = (price - bbLower) / (bbUpper - bbLower);
  if (bbPos < 0.2) { bullish++; reports.push("BB Buy"); }
  else if (bbPos > 0.8) { bearish++; reports.push("BB Sell"); }

  // 5. Stochastic
  const hh = Math.max(...highs.slice(last - 13, last + 1));
  const ll = Math.min(...lows.slice(last - 13, last + 1));
  const stochK = hh === ll ? 50 : ((price - ll) / (hh - ll)) * 100;
  if (stochK < 20) { bullish++; reports.push("Stoch Buy"); }
  else if (stochK > 80) { bearish++; reports.push("Stoch Sell"); }

  // 6. Volume Trend (OBV Proxy)
  if (volumes[last] > volumes[last - 1] && closes[last] > closes[last - 1]) { bullish++; reports.push("Vol Buy"); }
  else if (volumes[last] > volumes[last - 1] && closes[last] < closes[last - 1]) { bearish++; reports.push("Vol Sell"); }

  // LOGIKA DECYZYJNA (Zasada 3/6 - sprawdzamy najważniejsze 6 wskaźników z UI)
  const REQUIRED = 3;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let entryAllowed = false;

  if (bullish >= REQUIRED && r < 80) {
    bias = 'bullish';
    entryAllowed = true;
  } else if (bearish >= REQUIRED && r > 20) {
    bias = 'bearish';
    entryAllowed = true;
  }

  return {
    bias,
    bullKeys: bullish,
    bearKeys: bearish,
    price,
    rsi: r,
    entryAllowed,
    reasoning: reports.join(", ")
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

    if (!config.is_active) return new Response(JSON.stringify({ message: "Bot OFF" }), { headers: corsHeaders });

    // Pobieramy 500 świec dla stabilności EMA200
    const res = await fetch(`${BINANCE_URL}/klines?symbol=${config.symbol}&interval=${config.interval}&limit=500`);
    const data = await res.json();
    const klines: Kline[] = data.map((k: any[]) => ({
      time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]
    }));

    const analysis = analyzeMarket(klines);

    const { data: openPos } = await supabase.from('bot_positions').select('*').eq('bot_config_id', config.id).eq('status', 'open');

    // OTWIERANIE POZYCJI
    if ((!openPos || openPos.length === 0) && analysis.entryAllowed) {
      const balance = Number(config.current_balance);
      const margin = balance * (config.position_size_pct / 100);
      
      if (margin >= 10) {
        const side = analysis.bias === 'bullish' ? 'long' : 'short';
        const sl = side === 'long' ? analysis.price * 0.98 : analysis.price * 1.02;
        const tp = side === 'long' ? analysis.price * 1.05 : analysis.price * 0.95;
        const qty = (margin * config.leverage) / analysis.price;

        await supabase.from('bot_positions').insert({
          bot_config_id: config.id, side, entry_price: analysis.price, quantity: qty,
          leverage: config.leverage, margin_used: margin, stop_loss: sl, take_profit: tp, status: 'open',
          entry_reason: analysis.reasoning
        });
        
        await supabase.from('bot_config').update({ current_balance: balance - margin }).eq('id', config.id);
        await supabase.from('bot_logs').insert({ bot_config_id: config.id, level: 'trade', message: `🚀 BOT OPEN ${side.toUpperCase()} @ ${analysis.price}` });
      }
    }

    // LOGOWANIE (Fix 0/5)
    await supabase.from('bot_logs').insert({
      bot_config_id: config.id,
      level: 'info',
      message: `Tick: $${analysis.price.toFixed(0)} | Bias: ${analysis.bias} | Klucze: B:${analysis.bullKeys} S:${analysis.bearKeys} | RSI: ${analysis.rsi.toFixed(1)}`,
      data: { reasoning: analysis.reasoning }
    });

    return new Response(JSON.stringify({ analysis, executed: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

async function logBot(supabase: any, configId: string, level: string, message: string, data?: any) {
  await supabase.from('bot_logs').insert({ bot_config_id: configId, level, message, data });
}
