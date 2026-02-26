import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  calculateEMA,
  calculateSMA,
  calculateRSI,
  calculateMACD,
  calculateBollingerBands,
  calculateATR,
  calculateAllIndicators,
  type IndicatorResults,
} from "../_shared/indicators.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BINANCE_URL = 'https://data-api.binance.vision/api/v3';

interface Kline {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}

async function fetchKlines(symbol: string, interval: string, limit = 500): Promise<Kline[]> {
  const res = await fetch(`${BINANCE_URL}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const data = await res.json();
  return data.map((k: any[]) => ({
    time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

async function fetchCurrentPrice(symbol: string): Promise<number> {
  const res = await fetch(`${BINANCE_URL}/ticker/price?symbol=${symbol}`);
  const data = await res.json();
  return parseFloat(data.price);
}

// ========== CONTEXT FILTER: Support/Resistance ==========
function findSupportResistance(highs: number[], lows: number[], closes: number[], lookback = 50) {
  const last = closes.length - 1;
  const price = closes[last];
  const recentLows = lows.slice(Math.max(0, last - lookback), last + 1);
  const recentHighs = highs.slice(Math.max(0, last - lookback), last + 1);

  const supports: number[] = [];
  for (let i = 2; i < recentLows.length - 2; i++) {
    if (recentLows[i] < recentLows[i-1] && recentLows[i] < recentLows[i-2] &&
        recentLows[i] < recentLows[i+1] && recentLows[i] < recentLows[i+2]) {
      supports.push(recentLows[i]);
    }
  }

  const resistances: number[] = [];
  for (let i = 2; i < recentHighs.length - 2; i++) {
    if (recentHighs[i] > recentHighs[i-1] && recentHighs[i] > recentHighs[i-2] &&
        recentHighs[i] > recentHighs[i+1] && recentHighs[i] > recentHighs[i+2]) {
      resistances.push(recentHighs[i]);
    }
  }

  let doubleBottom = false;
  const tolerance = price * 0.005;
  for (let i = 0; i < supports.length - 1; i++) {
    if (Math.abs(supports[i] - supports[i+1]) < tolerance && price > supports[i]) {
      doubleBottom = true;
      break;
    }
  }

  let failedBreakout = false;
  if (resistances.length > 0) {
    const nearestResistance = resistances.reduce((a, b) =>
      Math.abs(a - price) < Math.abs(b - price) ? a : b);
    const recentHigh = Math.max(...highs.slice(Math.max(0, last - 5), last + 1));
    if (recentHigh >= nearestResistance * 0.997 && price < nearestResistance) {
      failedBreakout = true;
    }
  }

  const nearSupport = supports.some(s => price >= s * 0.995 && price <= s * 1.01);
  const nearResistance = resistances.some(r => price >= r * 0.99 && price <= r * 1.005);

  return { supports, resistances, doubleBottom, failedBreakout, nearSupport, nearResistance };
}

// ========== THREE-KEY ENTRY CONDITIONS ==========

function detectRSIDivergence(closes: number[], rsiVals: number[], lookback = 20): { bullish: boolean; bearish: boolean } {
  const last = closes.length - 1;
  const start = Math.max(0, last - lookback);
  let bullishDiv = false, bearishDiv = false;
  for (let i = start + 2; i < last - 1; i++) {
    if (closes[last] < closes[i] && rsiVals[last] > rsiVals[i] && rsiVals[i] < 40) bullishDiv = true;
    if (closes[last] > closes[i] && rsiVals[last] < rsiVals[i] && rsiVals[i] > 60) bearishDiv = true;
  }
  return { bullish: bullishDiv, bearish: bearishDiv };
}

function detectCandlestickPatterns(klines: Kline[]): { bullish: boolean; bearish: boolean; pattern: string } {
  const last = klines.length - 1;
  const c = klines[last], p = klines[last - 1], pp = klines[last - 2];
  const bodyC = Math.abs(c.close - c.open);
  const rangeC = c.high - c.low;
  const bodyP = Math.abs(p.close - p.open);
  let bullish = false, bearish = false, pattern = '';

  if (rangeC > 0) {
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    if (lowerWick > bodyC * 2 && upperWick < bodyC * 0.5) { bullish = true; pattern = 'Hammer'; }
    if (upperWick > bodyC * 2 && lowerWick < bodyC * 0.5) { bearish = true; pattern = 'Shooting Star'; }
  }

  if (!bullish && !bearish && bodyP > 0) {
    if (p.close < p.open && c.close > c.open && c.close > p.open && c.open < p.close) { bullish = true; pattern = 'Bullish Engulfing'; }
    if (p.close > p.open && c.close < c.open && c.close < p.open && c.open > p.close) { bearish = true; pattern = 'Bearish Engulfing'; }
  }

  if (!bullish && !bearish) {
    const bodyPP = Math.abs(pp.close - pp.open);
    if (pp.close < pp.open && bodyP < bodyPP * 0.3 && c.close > c.open && bodyC > bodyPP * 0.5) { bullish = true; pattern = 'Morning Star'; }
    if (pp.close > pp.open && bodyP < bodyPP * 0.3 && c.close < c.open && bodyC > bodyPP * 0.5) { bearish = true; pattern = 'Evening Star'; }
  }

  return { bullish, bearish, pattern };
}

function detectVolumeSpike(volumes: number[], lookback = 20): boolean {
  const last = volumes.length - 1;
  const avgVol = volumes.slice(Math.max(0, last - lookback), last).reduce((a, b) => a + b, 0) / lookback;
  return volumes[last] > avgVol * 1.5;
}

function priceOutsideBB2(price: number, bbUpper: number, bbLower: number): { outside: boolean; side: 'above' | 'below' | 'inside' } {
  if (price > bbUpper) return { outside: true, side: 'above' };
  if (price < bbLower) return { outside: true, side: 'below' };
  return { outside: false, side: 'inside' };
}

// ========== NO-TRADE ZONE CHECKS ==========
function isChopZone(price: number, ema50Val: number, ema200Val: number): boolean {
  const midpoint = (ema50Val + ema200Val) / 2;
  const range = Math.abs(ema50Val - ema200Val);
  return range > 0 && Math.abs(price - midpoint) < range * 0.2;
}

function isLowVolumeEnvironment(volumes: number[], lookback = 50): boolean {
  const last = volumes.length - 1;
  const avgVol = volumes.slice(Math.max(0, last - lookback), last).reduce((a, b) => a + b, 0) / lookback;
  return volumes[last] < avgVol * 0.4;
}

// ========== MAIN ANALYSIS (uses shared indicators) ==========
function analyzeMarket(klines: Kline[]) {
  const closes = klines.map(k => k.close);
  const highs = klines.map(k => k.high);
  const lows = klines.map(k => k.low);
  const volumes = klines.map(k => k.volume);
  const last = closes.length - 1;
  const price = closes[last];

  // Use the shared dashboard indicators
  const ind = calculateAllIndicators(closes, highs, lows, volumes);

  const lastRsi = ind.rsi[last];
  const lastAtr = ind.atr[last];
  const reasoning: string[] = [];

  // ===== STEP 1: NO-TRADE ZONES =====
  const chopZone = isChopZone(price, ind.ema50[last], ind.ema200[last]);
  const lowVolume = isLowVolumeEnvironment(volumes);

  if (chopZone) reasoning.push('🚫 CHOP ZONE: price between EMA50/200 midpoint');
  if (lowVolume) reasoning.push('🚫 LOW VOLUME: below 40% of average');

  if (chopZone || lowVolume) {
    return {
      bias: 'neutral' as const,
      score: 0,
      bullKeys: 0,
      bearKeys: 0,
      rsi: lastRsi,
      macdHist: ind.macd.histogram[last],
      ema50: ind.ema50[last],
      ema200: ind.ema200[last],
      bbPosition: 0.5,
      price,
      atr: lastAtr,
      reasoning: reasoning.join(' | '),
      entryAllowed: false,
      skipReason: chopZone ? 'Chop Zone — no trend' : 'Low volume — dead market',
      indicators: ind,
    };
  }

  // ===== STEP 2: CONTEXT FILTER (Support/Resistance) =====
  const sr = findSupportResistance(highs, lows, closes);
  let longContext = false, shortContext = false;
  const contextReasons: string[] = [];

  if (sr.nearSupport || sr.doubleBottom) {
    longContext = true;
    contextReasons.push(sr.doubleBottom ? 'Double Bottom detected ↑' : 'Price near Support Zone ↑');
  }
  if (sr.nearResistance || sr.failedBreakout) {
    shortContext = true;
    contextReasons.push(sr.failedBreakout ? 'Failed breakout at Resistance ↓' : 'Price near Resistance Zone ↓');
  }
  if (price > ind.ema200[last] && ind.ema50[last] > ind.ema200[last]) {
    longContext = true;
    contextReasons.push('Above EMA200 + bullish structure ↑');
  }
  if (price < ind.ema200[last] && ind.ema50[last] < ind.ema200[last]) {
    shortContext = true;
    contextReasons.push('Below EMA200 + bearish structure ↓');
  }

  reasoning.push(`Context: ${contextReasons.join(', ') || 'No context'}`);

  // ===== STEP 3: THREE-KEY ENTRY SYSTEM (need 3/5) =====
  const rsiDiv = detectRSIDivergence(closes, ind.rsi);
  const candles = detectCandlestickPatterns(klines);
  const volumeSpike = detectVolumeSpike(volumes);
  const prevMacdAbove = ind.macd.macdLine[last-1] > ind.macd.signalLine[last-1];
  const currMacdAbove = ind.macd.macdLine[last] > ind.macd.signalLine[last];
  const macdCrossoverBull = !prevMacdAbove && currMacdAbove;
  const macdCrossoverBear = prevMacdAbove && !currMacdAbove;
  const bbCheck = priceOutsideBB2(price, ind.bollingerBands.upper[last], ind.bollingerBands.lower[last]);

  let bullKeys = 0, bearKeys = 0;
  const bullConditions: string[] = [], bearConditions: string[] = [];

  if (rsiDiv.bullish) { bullKeys++; bullConditions.push('RSI Divergence ↑'); }
  if (rsiDiv.bearish) { bearKeys++; bearConditions.push('RSI Divergence ↓'); }

  if (candles.bullish) { bullKeys++; bullConditions.push(`${candles.pattern} ↑`); }
  if (candles.bearish) { bearKeys++; bearConditions.push(`${candles.pattern} ↓`); }

  if (volumeSpike) {
    const lastCandle = klines[last];
    if (lastCandle.close > lastCandle.open) { bullKeys++; bullConditions.push('Volume Spike (bullish) ↑'); }
    else { bearKeys++; bearConditions.push('Volume Spike (bearish) ↓'); }
  }

  if (macdCrossoverBull) { bullKeys++; bullConditions.push('MACD Bullish Cross ↑'); }
  if (macdCrossoverBear) { bearKeys++; bearConditions.push('MACD Bearish Cross ↓'); }

  if (bbCheck.outside) {
    if (bbCheck.side === 'below') { bullKeys++; bullConditions.push('Below BB Lower (mean reversion) ↑'); }
    if (bbCheck.side === 'above') { bearKeys++; bearConditions.push('Above BB Upper (mean reversion) ↓'); }
  }

  reasoning.push(`Bull keys: ${bullKeys}/5 [${bullConditions.join(', ') || 'none'}]`);
  reasoning.push(`Bear keys: ${bearKeys}/5 [${bearConditions.join(', ') || 'none'}]`);

  const REQUIRED_KEYS = 3;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let entryAllowed = false;
  let skipReason = '';

  if (bullKeys >= REQUIRED_KEYS && longContext) {
    bias = 'bullish';
    entryAllowed = true;
  } else if (bearKeys >= REQUIRED_KEYS && shortContext) {
    bias = 'bearish';
    entryAllowed = true;
  } else {
    if (bullKeys >= REQUIRED_KEYS && !longContext) {
      skipReason = `Trade skipped: ${bullKeys}/5 bullish keys met BUT no long context (no support/double bottom)`;
    } else if (bearKeys >= REQUIRED_KEYS && !shortContext) {
      skipReason = `Trade skipped: ${bearKeys}/5 bearish keys met BUT no short context (no resistance/failed breakout)`;
    } else {
      const maxKeys = Math.max(bullKeys, bearKeys);
      const direction = bullKeys > bearKeys ? 'bullish' : 'bearish';
      skipReason = `Trade skipped: Only ${maxKeys}/5 ${direction} conditions met (need ${REQUIRED_KEYS})`;
    }
  }

  if (bias === 'bullish' && lastRsi > 75) {
    bias = 'neutral'; entryAllowed = false;
    skipReason = '⚠ RSI guardrail: RSI > 75, blocking long';
  }
  if (bias === 'bearish' && lastRsi < 25) {
    bias = 'neutral'; entryAllowed = false;
    skipReason = '⚠ RSI guardrail: RSI < 25, blocking short';
  }

  if (skipReason) reasoning.push(skipReason);
  if (entryAllowed) reasoning.push(`✅ ENTRY ALLOWED: ${bias.toUpperCase()} — ${bias === 'bullish' ? bullConditions.join(' + ') : bearConditions.join(' + ')}`);

  const score = bias === 'bullish' ? 0.5 : bias === 'bearish' ? -0.5 : 0;

  return {
    bias,
    score,
    bullKeys,
    bearKeys,
    rsi: lastRsi,
    macdHist: ind.macd.histogram[last],
    ema50: ind.ema50[last],
    ema200: ind.ema200[last],
    bbPosition: ind.bollingerBands.upper[last] && ind.bollingerBands.lower[last]
      ? (price - ind.bollingerBands.lower[last]) / (ind.bollingerBands.upper[last] - ind.bollingerBands.lower[last])
      : 0.5,
    price,
    atr: lastAtr,
    reasoning: reasoning.join(' | '),
    entryAllowed,
    skipReason,
    context: { longContext, shortContext, ...sr },
    conditions: { rsiDiv, candles, volumeSpike, macdCrossoverBull, macdCrossoverBear, bbCheck },
    indicators: ind,
  };
}

// ========== RISK-REWARD VALIDATION ==========
function validateRiskReward(
  side: string, entryPrice: number, stopLoss: number, takeProfit: number, minRatio = 2
): { valid: boolean; ratio: number; reason: string } {
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);
  if (risk === 0) return { valid: false, ratio: 0, reason: 'Risk is zero — invalid SL' };
  const ratio = reward / risk;
  const valid = ratio >= minRatio;
  return {
    valid, ratio,
    reason: valid
      ? `R:R ${ratio.toFixed(2)}:1 ✅ (min ${minRatio}:1)`
      : `R:R ${ratio.toFixed(2)}:1 ❌ — below ${minRatio}:1 minimum, trade discarded`,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: configs } = await supabase.from('bot_config').select('*').limit(1);
    if (!configs || configs.length === 0) {
      return new Response(JSON.stringify({ message: 'No bot config found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404,
      });
    }
    const config = configs[0];

    // Handle manual actions
    let action = null;
    if (req.method === 'POST') {
      const body = await req.json();
      action = body.action;

      if (action === 'toggle') {
        await supabase.from('bot_config').update({ is_active: !config.is_active }).eq('id', config.id);
        return new Response(JSON.stringify({ is_active: !config.is_active }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'reset') {
        const price = await fetchCurrentPrice(config.symbol);
        const { data: openPositions } = await supabase.from('bot_positions')
          .select('*').eq('bot_config_id', config.id).eq('status', 'open');
        for (const pos of openPositions || []) {
          const pnl = pos.side === 'long'
            ? (price - pos.entry_price) * pos.quantity
            : (pos.entry_price - price) * pos.quantity;
          await supabase.from('bot_positions').update({
            status: 'closed', exit_price: price, pnl, pnl_pct: (pnl / pos.margin_used) * 100,
            closed_at: new Date().toISOString(), exit_reason: 'Bot reset',
          }).eq('id', pos.id);
        }
        await supabase.from('bot_config').update({
          is_active: false, current_balance: config.initial_balance,
        }).eq('id', config.id);
        return new Response(JSON.stringify({ message: 'Bot reset' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'reset_balance') {
        const newBalance = body.new_balance || config.initial_balance;
        await supabase.from('bot_positions').delete().eq('bot_config_id', config.id).eq('status', 'open');
        await supabase.from('bot_trades').delete().eq('bot_config_id', config.id);
        await supabase.from('bot_logs').delete().eq('bot_config_id', config.id);
        await supabase.from('bot_config').update({
          is_active: false, current_balance: newBalance, initial_balance: newBalance,
        }).eq('id', config.id);
        await logBot(supabase, config.id, 'info', `💰 Saldo zresetowane do $${newBalance}`);
        return new Response(JSON.stringify({ message: `Balance reset to ${newBalance}` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'update_config') {
        const { leverage, position_size_pct, stop_loss_pct, take_profit_pct, interval } = body;
        await supabase.from('bot_config').update({
          ...(leverage !== undefined && { leverage }),
          ...(position_size_pct !== undefined && { position_size_pct }),
          ...(stop_loss_pct !== undefined && { stop_loss_pct }),
          ...(take_profit_pct !== undefined && { take_profit_pct }),
          ...(interval !== undefined && { interval }),
        }).eq('id', config.id);
        return new Response(JSON.stringify({ message: 'Config updated' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (!config.is_active && action !== 'run') {
      const { data: positions } = await supabase.from('bot_positions')
        .select('*').eq('bot_config_id', config.id).order('opened_at', { ascending: false }).limit(20);
      const { data: trades } = await supabase.from('bot_trades')
        .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(50);
      const { data: logs } = await supabase.from('bot_logs')
        .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(30);
      return new Response(JSON.stringify({ config, positions, trades, logs, executed: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === TRADING LOGIC ===
    const klines = await fetchKlines(config.symbol, config.interval, 300);
    const closes = klines.map(k => k.close);
    const currentPrice = closes[closes.length - 1];

    const analysis = analyzeMarket(klines);

    const { data: openPositions } = await supabase.from('bot_positions')
      .select('*').eq('bot_config_id', config.id).eq('status', 'open');

    let balance = Number(config.current_balance);

    for (const pos of openPositions || []) {
      const entryPrice = Number(pos.entry_price);
      const qty = Number(pos.quantity);
      const leverage = Number(pos.leverage);
      const margin = Number(pos.margin_used);
      const currentSL = Number(pos.stop_loss);
      const currentTP = Number(pos.take_profit);

      const pnl = pos.side === 'long'
        ? (currentPrice - entryPrice) * qty
        : (entryPrice - currentPrice) * qty;
      const pnlPct = (pnl / margin) * 100;

      // 1. Liquidation
      if (pnlPct <= -90) {
        balance -= margin;
        await supabase.from('bot_positions').update({
          status: 'liquidated', exit_price: currentPrice, pnl: -margin, pnl_pct: -100,
          closed_at: new Date().toISOString(), exit_reason: 'Liquidation',
        }).eq('id', pos.id);
        await supabase.from('bot_trades').insert({
          bot_config_id: config.id, position_id: pos.id, action: 'liquidation',
          price: currentPrice, quantity: qty, pnl: -margin, balance_after: balance,
          reason: `Liquidated at $${currentPrice.toFixed(2)}`,
        });
        await logBot(supabase, config.id, 'error', `⚠️ LIQUIDATION: ${pos.side} | PnL: -$${margin.toFixed(2)}`);
        continue;
      }

      // 2. Stop Loss
      if (currentSL && (
        (pos.side === 'long' && currentPrice <= currentSL) ||
        (pos.side === 'short' && currentPrice >= currentSL)
      )) {
        balance += margin + pnl;
        await supabase.from('bot_positions').update({
          status: 'closed', exit_price: currentPrice, pnl, pnl_pct: pnlPct,
          closed_at: new Date().toISOString(), exit_reason: 'Stop Loss',
        }).eq('id', pos.id);
        await supabase.from('bot_trades').insert({
          bot_config_id: config.id, position_id: pos.id, action: 'stop_loss',
          price: currentPrice, quantity: qty, pnl, balance_after: balance,
          reason: `Stop Loss hit at $${currentPrice.toFixed(2)}`,
        });
        await logBot(supabase, config.id, 'trade', `🛑 STOP LOSS: ${pos.side} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        continue;
      }

      // 3. Take Profit
      if (currentTP && (
        (pos.side === 'long' && currentPrice >= currentTP) ||
        (pos.side === 'short' && currentPrice <= currentTP)
      )) {
        balance += margin + pnl;
        await supabase.from('bot_positions').update({
          status: 'closed', exit_price: currentPrice, pnl, pnl_pct: pnlPct,
          closed_at: new Date().toISOString(), exit_reason: 'Take Profit',
        }).eq('id', pos.id);
        await supabase.from('bot_trades').insert({
          bot_config_id: config.id, position_id: pos.id, action: 'take_profit',
          price: currentPrice, quantity: qty, pnl, balance_after: balance,
          reason: `Take Profit at $${currentPrice.toFixed(2)}`,
        });
        await logBot(supabase, config.id, 'trade', `🎯 TAKE PROFIT: ${pos.side} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        continue;
      }

      // 4. ATR-based Trailing Stop Loss
      const currentAtr = analysis.atr || 0;
      let newSL = currentSL;
      const profitPctRaw = pnlPct;

      if (profitPctRaw >= 1) {
        if (pos.side === 'long') {
          const breakEvenSL = entryPrice;
          const trailingSteps = Math.floor((profitPctRaw - 1) / 0.5);
          const atrTrailSL = trailingSteps > 0
            ? currentPrice - (1.5 * currentAtr)
            : breakEvenSL;
          newSL = Math.max(currentSL, breakEvenSL, atrTrailSL);
        } else {
          const breakEvenSL = entryPrice;
          const trailingSteps = Math.floor((profitPctRaw - 1) / 0.5);
          const atrTrailSL = trailingSteps > 0
            ? currentPrice + (1.5 * currentAtr)
            : breakEvenSL;
          newSL = Math.min(currentSL, breakEvenSL, atrTrailSL);
        }
      }

      if (newSL !== currentSL) {
        await supabase.from('bot_positions').update({ stop_loss: newSL }).eq('id', pos.id);
        const trailType = Math.abs(newSL - entryPrice) < 1 ? 'BREAK-EVEN' : 'ATR TRAIL';
        await logBot(supabase, config.id, 'info',
          `🔒 ${trailType}: ${pos.side} SL $${currentSL.toFixed(0)} → $${newSL.toFixed(0)} (profit: ${pnlPct.toFixed(1)}% | ATR: ${currentAtr.toFixed(0)})`);
      }

      // 5. Smart Early Exit
      if (pnlPct >= 15) {
        let shouldExitEarly = false, exitReason = '';
        if (pos.side === 'long' && analysis.rsi > 75) { shouldExitEarly = true; exitReason = `RSI overbought (${analysis.rsi.toFixed(1)})`; }
        else if (pos.side === 'short' && analysis.rsi < 25) { shouldExitEarly = true; exitReason = `RSI oversold (${analysis.rsi.toFixed(1)})`; }
        if (!shouldExitEarly && pnlPct >= 20) {
          if (pos.side === 'long' && analysis.macdHist < 0 && analysis.score < 0) { shouldExitEarly = true; exitReason = 'MACD bearish momentum'; }
          else if (pos.side === 'short' && analysis.macdHist > 0 && analysis.score > 0) { shouldExitEarly = true; exitReason = 'MACD bullish momentum'; }
        }
        if (shouldExitEarly) {
          balance += margin + pnl;
          await supabase.from('bot_positions').update({
            status: 'closed', exit_price: currentPrice, pnl, pnl_pct: pnlPct,
            closed_at: new Date().toISOString(), exit_reason: exitReason,
          }).eq('id', pos.id);
          await supabase.from('bot_trades').insert({
            bot_config_id: config.id, position_id: pos.id,
            action: pos.side === 'long' ? 'close_long' : 'close_short',
            price: currentPrice, quantity: qty, pnl, balance_after: balance,
            reason: `Smart exit: ${exitReason} | PnL: ${pnlPct.toFixed(1)}%`,
            indicators_snapshot: analysis,
          });
          await logBot(supabase, config.id, 'trade', `🧠 SMART EXIT: ${pos.side} | ${exitReason} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
          continue;
        }
      }

      // 6. Signal reversal exit
      if ((pos.side === 'long' && analysis.bias === 'bearish') ||
          (pos.side === 'short' && analysis.bias === 'bullish')) {
        balance += margin + pnl;
        await supabase.from('bot_positions').update({
          status: 'closed', exit_price: currentPrice, pnl, pnl_pct: pnlPct,
          closed_at: new Date().toISOString(), exit_reason: 'Signal reversal',
        }).eq('id', pos.id);
        await supabase.from('bot_trades').insert({
          bot_config_id: config.id, position_id: pos.id,
          action: pos.side === 'long' ? 'close_long' : 'close_short',
          price: currentPrice, quantity: qty, pnl, balance_after: balance,
          reason: `Signal reversal → ${analysis.bias}`,
          indicators_snapshot: analysis,
        });
        await logBot(supabase, config.id, 'trade', `🔄 REVERSAL EXIT: ${pos.side} → ${analysis.bias} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
      }
    }

    // ===== OPEN NEW POSITION =====
    const { data: remainingOpen } = await supabase.from('bot_positions')
      .select('id').eq('bot_config_id', config.id).eq('status', 'open');

    if ((!remainingOpen || remainingOpen.length === 0) && analysis.entryAllowed) {
      const positionSizePct = Number(config.position_size_pct) / 100;
      const margin = balance * positionSizePct;

      if (margin > 10 && balance > margin) {
        const leverage = Number(config.leverage);
        const notional = margin * leverage;
        const quantity = notional / currentPrice;
        const side = analysis.bias === 'bullish' ? 'long' : 'short';

        const slPct = Number(config.stop_loss_pct) / 100;
        const tpPct = Number(config.take_profit_pct) / 100;

        const stopLoss = side === 'long'
          ? currentPrice * (1 - slPct / leverage)
          : currentPrice * (1 + slPct / leverage);
        const takeProfit = side === 'long'
          ? currentPrice * (1 + tpPct / leverage)
          : currentPrice * (1 - tpPct / leverage);

        const rr = validateRiskReward(side, currentPrice, stopLoss, takeProfit);

        if (!rr.valid) {
          await logBot(supabase, config.id, 'info',
            `❌ TRADE DISCARDED: ${side.toUpperCase()} @ $${currentPrice.toFixed(2)} | ${rr.reason} | ${analysis.reasoning}`);
        } else {
          balance -= margin;

          const entryReason = [
            `${side.toUpperCase()} — Triple Confirmation`,
            rr.reason,
            `Keys: ${side === 'long' ? analysis.bullKeys : analysis.bearKeys}/5`,
            analysis.reasoning,
          ].join(' | ');

          const { data: newPos } = await supabase.from('bot_positions').insert({
            bot_config_id: config.id, side, entry_price: currentPrice, quantity,
            leverage, margin_used: margin, stop_loss: stopLoss, take_profit: takeProfit,
            entry_reason: entryReason.slice(0, 500),
          }).select().single();

          await supabase.from('bot_trades').insert({
            bot_config_id: config.id, position_id: newPos?.id,
            action: side === 'long' ? 'open_long' : 'open_short',
            price: currentPrice, quantity, balance_after: balance,
            reason: `${side.toUpperCase()} @ $${currentPrice.toFixed(2)} | Margin: $${margin.toFixed(2)} | ${leverage}x | ${rr.reason}`,
            indicators_snapshot: analysis,
          });

          await logBot(supabase, config.id, 'trade',
            `📈 ${side.toUpperCase()} OPEN @ $${currentPrice.toFixed(2)} | Qty: ${quantity.toFixed(6)} BTC | SL: $${stopLoss.toFixed(2)} | TP: $${takeProfit.toFixed(2)} | ${rr.reason}`);
          await logBot(supabase, config.id, 'info', `🧠 Reasoning: ${analysis.reasoning}`);
        }
      }
    } else if (!analysis.entryAllowed && (!remainingOpen || remainingOpen.length === 0)) {
      await logBot(supabase, config.id, 'info',
        `⏸ NO TRADE: ${analysis.skipReason || 'Conditions not met'}`);
    }

    await supabase.from('bot_config').update({ current_balance: balance }).eq('id', config.id);

    await logBot(supabase, config.id, 'info',
      `Tick: $${currentPrice.toFixed(2)} | Bias: ${analysis.bias} | BullKeys: ${analysis.bullKeys}/5 BearKeys: ${analysis.bearKeys}/5 | RSI: ${analysis.rsi.toFixed(1)} | Bal: $${balance.toFixed(2)}`,
      { reasoning: analysis.reasoning });

    const { data: positions } = await supabase.from('bot_positions')
      .select('*').eq('bot_config_id', config.id).order('opened_at', { ascending: false }).limit(20);
    const { data: trades } = await supabase.from('bot_trades')
      .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(50);
    const { data: logs } = await supabase.from('bot_logs')
      .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(30);

    const updatedConfig = { ...config, current_balance: balance };

    return new Response(JSON.stringify({
      config: updatedConfig, positions, trades, logs, analysis, executed: true,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Trading bot error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function logBot(supabase: any, configId: string, level: string, message: string, data?: any) {
  await supabase.from('bot_logs').insert({
    bot_config_id: configId, level, message, data,
  });
}
