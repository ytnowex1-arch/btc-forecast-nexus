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

// ========== NARZĘDZIA ANALITYCZNE (ZSYNCHRONIZOWANE Z indicators.ts) ==========
function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema = [data[0]];
  for (let i = 1; i < data.length; i++) ema.push(data[i] * k + ema[i - 1] * (1 - k));
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
  avgGain /= period; avgLoss /= period;
  rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(change, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-change, 0)) / period;
    rsi.push(avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss));
  }
  return rsi;
}

// ========== LOGIKA STRATEGII (ZGODNA Z forecast.ts) ==========
function analyzeMarket(klines: Kline[]) {
  const closes = klines.map(k => k.close);
  const last = closes.length - 1;
  const price = closes[last];
  
  const rsiVals = calculateRSI(closes);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const ema20 = calculateEMA(closes, 20);
  
  const curRsi = rsiVals[last];
  
  let bullKeys = 0;
  let bearKeys = 0;
  const bullDetails: string[] = [];
  const bearDetails: string[] = [];

  // 1. RSI (Ustawione progi jak w Twoim UI)
  if (curRsi < 40) { bullKeys++; bullDetails.push("RSI Low"); }
  else if (curRsi > 60) { bearKeys++; bearDetails.push("RSI High"); }

  // 2. Trend (Cena vs EMA20)
  if (price > ema20[last]) { bullKeys++; bullDetails.push("Above EMA20"); }
  else { bearKeys++; bearDetails.push("Below EMA20"); }

  // 3. Struktura (EMA 50 vs 200)
  if (ema50[last] > ema200[last]) { bullKeys++; bullDetails.push("Golden Structure"); }
  else { bearKeys++; bearDetails.push("Death Structure"); }

  // 4. Momentum (MACD Proxy)
  const ema12 = calculateEMA(closes, 12);
  const ema26 = calculateEMA(closes, 26);
  const macd = ema12[last] - ema26[last];
  const prevMacd = ema12[last-1] - ema26[last-1];
  if (macd > prevMacd) { bullKeys++; bullDetails.push("MACD Rising"); }
  else { bearKeys++; bearDetails.push("MACD Falling"); }

  // 5. Candlestick
  const isGreen = closes[last] > klines[last].open;
  if (isGreen) { bullKeys++; bullDetails.push("Green Candle"); }
  else { bearKeys++; bearDetails.push("Red Candle"); }

  const REQUIRED = 3;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let entryAllowed = false;
  let skipReason = "";

  if (bullKeys >= REQUIRED) {
    if (curRsi > 80) skipReason = "RSI OVERBOUGHT (Guardrail)";
    else { bias = 'bullish'; entryAllowed = true; }
  } else if (bearKeys >= REQUIRED) {
    if (curRsi < 20) skipReason = "RSI OVERSOLD (Guardrail)";
    else { bias = 'bearish'; entryAllowed = true; }
  } else {
    skipReason = `Not enough signals (${Math.max(bullKeys, bearKeys)}/${REQUIRED})`;
  }

  return {
    bias, price, rsi: curRsi, bullKeys, bearKeys, entryAllowed, skipReason,
    reasoning: `B: ${bullDetails.join(", ")} | S: ${bearDetails.join(", ")}`
  };
}

// ========== GŁÓWNA FUNKCJA SERWERA ==========
serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: configs } = await supabase.from('bot_config').select('*').limit(1);
    if (!configs || configs.length === 0) throw new Error("Brak konfiguracji bota");
    const config = configs[0];

    // Pobieranie danych (zwiększony limit dla stabilności EMA200)
    const binanceRes = await fetch(`${BINANCE_URL}/klines?symbol=${config.symbol}&interval=${config.interval}&limit=500`);
    const binanceData = await binanceRes.json();
    const klines: Kline[] = binanceData.map((k: any[]) => ({
      time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5]
    }));

    const analysis = analyzeMarket(klines);

    if (!config.is_active) {
      return new Response(JSON.stringify({ analysis, status: "Bot wyłączony" }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { data: openPos } = await supabase.from('bot_positions').select('*').eq('bot_config_id', config.id).eq('status', 'open');

    // OTWIERANIE POZYCJI
    if ((!openPos || openPos.length === 0) && analysis.entryAllowed) {
      const balance = Number(config.current_balance);
      const margin = balance * (config.position_size_pct / 100);
      
      if (margin >= 10) { // Minimalna wartość Binance
        const side = analysis.bias === 'bullish' ? 'long' : 'short';
        const sl = side === 'long' ? analysis.price * (1 - (config.stop_loss_pct / 100 / config.leverage)) : analysis.price * (1 + (config.stop_loss_pct / 100 / config.leverage));
        const tp = side === 'long' ? analysis.price * (1 + (config.take_profit_pct / 100 / config.leverage)) : analysis.price * (1 - (config.take_profit_pct / 100 / config.leverage));
        const qty = (margin * config.leverage) / analysis.price;

        await supabase.from('bot_positions').insert({
          bot_config_id: config.id, side, entry_price: analysis.price, quantity: qty,
          leverage: config.leverage, margin_used: margin, stop_loss: sl, take_profit: tp, status: 'open',
          entry_reason: analysis.reasoning
        });
        
        await supabase.from('bot_config').update({ current_balance: balance - margin }).eq('id', config.id);
        await supabase.from('bot_logs').insert({ bot_config_id: config.id, level: 'trade', message: `🚀 OTWARTY ${side.toUpperCase()} @ ${analysis.price}` });
      }
    }

    // LOGOWANIE DLA UŻYTKOWNIKA (Zawsze pokazuje stan kluczy)
    await supabase.from('bot_logs').insert({
      bot_config_id: config.id,
      level: 'info',
      message: `Tick: $${analysis.price.toFixed(0)} | Klucze: B:${analysis.bullKeys}/5 S:${analysis.bearKeys}/5 | RSI: ${analysis.rsi.toFixed(1)}`,
      data: { skipReason: analysis.skipReason, detail: analysis.reasoning }
    });

    return new Response(JSON.stringify({ analysis, executed: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
