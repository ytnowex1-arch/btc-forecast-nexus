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

async function fetchKlines(symbol: string, interval: string, limit = 500): Promise<Kline[]> {
  const res = await fetch(`${BINANCE_URL}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const data = await res.json();
  return data.map((k: any[]) => ({
    time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

// ========== ANALIZA TECHNICZNA (FUNKCJE MATEMATYCZNE) ==========
function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i-1] * (1-k));
  return result;
}

function rsi(closes: number[], period = 14): number[] {
  const r: number[] = new Array(period).fill(50);
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const c = closes[i] - closes[i-1];
    if (c > 0) ag += c; else al += Math.abs(c);
  }
  ag /= period; al /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const c = closes[i] - closes[i-1];
    ag = (ag * (period - 1) + Math.max(c, 0)) / period;
    al = (al * (period - 1) + Math.max(-c, 0)) / period;
    r.push(al === 0 ? 100 : 100 - 100 / (1 + ag / al));
  }
  return r;
}

function macd(closes: number[]) {
  const f = ema(closes, 12), s = ema(closes, 26);
  const line = f.map((v,i) => v - s[i]);
  const sig = ema(line, 9);
  return { hist: line.map((v,i) => v - sig[i]) };
}

// ========== GŁÓWNA LOGIKA ANALIZY (SYNCHRONIZACJA Z UI) ==========
function analyzeMarket(klines: Kline[]) {
  const closes = klines.map(k => k.close);
  const volumes = klines.map(k => k.volume);
  const last = closes.length - 1;
  const price = closes[last];
  
  const rsiVals = rsi(closes);
  const macdData = macd(closes);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  
  const currentRsi = rsiVals[rsiVals.length - 1];
  const avgVol = volumes.slice(last - 20, last).reduce((a, b) => a + b, 0) / 20;

  // 1. FILTR WOLUMENU (Poluzowany do 10% średniej)
  if (volumes[last] < avgVol * 0.1) {
    return { bias: 'neutral', bullKeys: 0, bearKeys: 0, price, rsi: currentRsi, entryAllowed: false, skipReason: "Low volume" };
  }

  let bullKeys = 0;
  let bearKeys = 0;
  const reasons: string[] = [];

  // --- LICZENIE KLUCZY (Synchronizacja z Twoim UI) ---
  
  // RSI
  if (currentRsi < 40) bullKeys++; else if (currentRsi > 60) bearKeys++;
  
  // MACD Momentum
  if (macdData.hist[last] > macdData.hist[last-1]) bullKeys++; else bearKeys++;
  
  // EMA 20 (Short term trend)
  if (price > ema20[last]) bullKeys++; else bearKeys++;
  
  // EMA 50/200 (Long term structure)
  if (ema50[last] > ema200[last]) bullKeys++; else bearKeys++;
  
  // Candle Color & Body
  const isGreen = closes[last] > klines[last].open;
  if (isGreen) bullKeys++; else bearKeys++;

  // --- LOGIKA KONTEKSTU (BREAKOUT / MOMENTUM) ---
  let contextLong = false;
  let contextShort = false;

  // Sprawdzanie przebicia szczytu (Breakout)
  const recentHigh = Math.max(...klines.slice(last - 20, last).map(k => k.high));
  if (price > recentHigh || (price > ema50[last] && isGreen)) contextLong = true;
  
  const recentLow = Math.min(...klines.slice(last - 20, last).map(k => k.low));
  if (price < recentLow || (price < ema50[last] && !isGreen)) contextShort = true;

  // DECYZJA
  const MIN_KEYS = 3;
  let bias: 'bullish' | 'bearish' | 'neutral' = 'neutral';
  let entryAllowed = false;
  let skipReason = "";

  if (bullKeys >= MIN_KEYS && contextLong) {
    if (currentRsi > 82) skipReason = "RSI too high (>82)";
    else { bias = 'bullish'; entryAllowed = true; }
  } else if (bearKeys >= MIN_KEYS && contextShort) {
    if (currentRsi < 18) skipReason = "RSI too low (<18)";
    else { bias = 'bearish'; entryAllowed = true; }
  } else {
    skipReason = `Need ${MIN_KEYS} keys + Context. Got B:${bullKeys} S:${bearKeys}`;
  }

  return {
    bias, bullKeys, bearKeys, price, rsi: currentRsi, entryAllowed, skipReason,
    reasoning: `B:${bullKeys} S:${bearKeys} | RSI:${currentRsi.toFixed(1)} | Context:${contextLong?'L':'S'}`
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: configs } = await supabase.from('bot_config').select('*').limit(1);
    const config = configs[0];

    if (!config.is_active) return new Response(JSON.stringify({ message: "Bot OFF" }), { headers: corsHeaders });

    const klines = await fetchKlines(config.symbol, config.interval, 300);
    const analysis = analyzeMarket(klines);
    
    const { data: openPos } = await supabase.from('bot_positions').select('*').eq('bot_config_id', config.id).eq('status', 'open');

    // OTWARCIE POZYCJI
    if ((!openPos || openPos.length === 0) && analysis.entryAllowed) {
      const balance = Number(config.current_balance);
      const margin = balance * (config.position_size_pct / 100);
      
      if (margin >= 10) {
        const side = analysis.bias === 'bullish' ? 'long' : 'short';
        const sl = side === 'long' ? analysis.price * 0.97 : analysis.price * 1.03;
        const tp = side === 'long' ? analysis.price * 1.06 : analysis.price * 0.94;
        const qty = (margin * config.leverage) / analysis.price;

        await supabase.from('bot_positions').insert({
          bot_config_id: config.id, side, entry_price: analysis.price, quantity: qty,
          leverage: config.leverage, margin_used: margin, stop_loss: sl, take_profit: tp, status: 'open',
          entry_reason: analysis.reasoning
        });
        
        await supabase.from('bot_config').update({ current_balance: balance - margin }).eq('id', config.id);
        await logBot(supabase, config.id, 'trade', `🚀 OPEN ${side.toUpperCase()} @ ${analysis.price}`);
      }
    }

    // LOGOWANIE (Fix Undefined)
    await logBot(supabase, config.id, 'info', 
      `Tick: $${analysis.price.toFixed(0)} | Bias: ${analysis.bias} | Keys: B:${analysis.bullKeys}/5 S:${analysis.bearKeys}/5 | RSI: ${analysis.rsi.toFixed(1)}`,
      { skipReason: analysis.skipReason }
    );

    return new Response(JSON.stringify({ analysis, executed: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }});

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});

async function logBot(supabase: any, configId: string, level: string, message: string, data?: any) {
  await supabase.from('bot_logs').insert({ bot_config_id: configId, level, message, data });
}nst bbCheck = priceOutsideBB2(price, bb.upper[last], bb.lower[last]);

  // Count bullish conditions
  let bullKeys = 0, bearKeys = 0;
  const bullConditions: string[] = [], bearConditions: string[] = [];

  // A: RSI Divergence
  if (rsiDiv.bullish) { bullKeys++; bullConditions.push('RSI Divergence ↑'); }
  if (rsiDiv.bearish) { bearKeys++; bearConditions.push('RSI Divergence ↓'); }

  // B: Candlestick Pattern
  if (candles.bullish) { bullKeys++; bullConditions.push(`${candles.pattern} ↑`); }
  if (candles.bearish) { bearKeys++; bearConditions.push(`${candles.pattern} ↓`); }

  // C: Volume Spike
  if (volumeSpike) {
    // Volume spike confirms the direction of current candle
    const lastCandle = klines[last];
    if (lastCandle.close > lastCandle.open) { bullKeys++; bullConditions.push('Volume Spike (bullish) ↑'); }
    else { bearKeys++; bearConditions.push('Volume Spike (bearish) ↓'); }
  }

  // D: MACD Crossover
  if (macdCrossoverBull) { bullKeys++; bullConditions.push('MACD Bullish Cross ↑'); }
  if (macdCrossoverBear) { bearKeys++; bearConditions.push('MACD Bearish Cross ↓'); }

  // E: Price outside 2nd StdDev BB (mean reversion)
  if (bbCheck.outside) {
    if (bbCheck.side === 'below') { bullKeys++; bullConditions.push('Below BB Lower (mean reversion) ↑'); }
    if (bbCheck.side === 'above') { bearKeys++; bearConditions.push('Above BB Upper (mean reversion) ↓'); }
  }

  reasoning.push(`Bull keys: ${bullKeys}/5 [${bullConditions.join(', ') || 'none'}]`);
  reasoning.push(`Bear keys: ${bearKeys}/5 [${bearConditions.join(', ') || 'none'}]`);

  // Determine bias
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

  // RSI guardrails on top
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

  // Legacy score for compatibility
  const score = bias === 'bullish' ? 0.5 : bias === 'bearish' ? -0.5 : 0;

  return {
    bias,
    score,
    bullKeys,
    bearKeys,
    rsi: lastRsi,
    macdHist: macdData.hist[last],
    ema50: ema50[last],
    ema200: ema200[last],
    bbPosition: bb.upper[last] && bb.lower[last] ? (price - bb.lower[last]) / (bb.upper[last] - bb.lower[last]) : 0.5,
    price,
    atr: lastAtr,
    reasoning: reasoning.join(' | '),
    entryAllowed,
    skipReason,
    context: { longContext, shortContext, ...sr },
    conditions: { rsiDiv, candles, volumeSpike, macdCrossoverBull, macdCrossoverBear, bbCheck },
  };
}

// ========== RISK-REWARD VALIDATION ==========
function validateRiskReward(
  side: string,
  entryPrice: number,
  stopLoss: number,
  takeProfit: number,
  minRatio = 2
): { valid: boolean; ratio: number; reason: string } {
  const risk = Math.abs(entryPrice - stopLoss);
  const reward = Math.abs(takeProfit - entryPrice);
  if (risk === 0) return { valid: false, ratio: 0, reason: 'Risk is zero — invalid SL' };
  const ratio = reward / risk;
  const valid = ratio >= minRatio;
  return {
    valid,
    ratio,
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

    // If not active and no special action, return status
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
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = closes[closes.length - 1];

    const analysis = analyzeMarket(klines);

    // Check open positions — smart management
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
      // Stage 1: At 1% profit → move SL to break-even
      // Stage 2: Every further 0.5% gain → trail SL behind price by 1.5x ATR
      const currentAtr = analysis.atr || 0;
      let newSL = currentSL;
      const profitPctRaw = pnlPct; // already leverage-adjusted

      if (profitPctRaw >= 1) {
        if (pos.side === 'long') {
          // Break-even floor
          const breakEvenSL = entryPrice;
          // ATR trail: every 0.5% above 1%, tighten SL
          const trailingSteps = Math.floor((profitPctRaw - 1) / 0.5);
          const atrTrailSL = trailingSteps > 0
            ? currentPrice - (1.5 * currentAtr)
            : breakEvenSL;
          // SL = max of (current SL, break-even, ATR trail) — never move SL down
          newSL = Math.max(currentSL, breakEvenSL, atrTrailSL);
        } else {
          // Short: break-even floor
          const breakEvenSL = entryPrice;
          const trailingSteps = Math.floor((profitPctRaw - 1) / 0.5);
          const atrTrailSL = trailingSteps > 0
            ? currentPrice + (1.5 * currentAtr)
            : breakEvenSL;
          // SL = min of (current SL, break-even, ATR trail) — never move SL up (for short)
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

        // ===== STEP 4: RISK-REWARD VALIDATION =====
        const rr = validateRiskReward(side, currentPrice, stopLoss, takeProfit);
        reasoning_log: analysis.reasoning;

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
      // Log why we're not trading
      await logBot(supabase, config.id, 'info',
        `⏸ NO TRADE: ${analysis.skipReason || 'Conditions not met'}`);
    }

    // Update balance
    await supabase.from('bot_config').update({ current_balance: balance }).eq('id', config.id);

    await logBot(supabase, config.id, 'info',
      `Tick: $${currentPrice.toFixed(2)} | Bias: ${analysis.bias} | BullKeys: ${analysis.bullKeys}/5 BearKeys: ${analysis.bearKeys}/5 | RSI: ${analysis.rsi.toFixed(1)} | Bal: $${balance.toFixed(2)}`,
      { reasoning: analysis.reasoning });

    // Return state
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
