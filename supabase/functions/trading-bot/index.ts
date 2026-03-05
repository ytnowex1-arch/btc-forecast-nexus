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

async function fetchCurrentPrice(symbol: string): Promise<number> {
  const res = await fetch(`${BINANCE_URL}/ticker/price?symbol=${symbol}`);
  const data = await res.json();
  return parseFloat(data.price);
}

// ========== INDICATORS ==========
function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

function calcSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { sma.push(NaN); continue; }
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  return sma;
}

function calcRSI(closes: number[], period = 14): number[] {
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

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const tr: number[] = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return calcEMA(tr, period);
}

// ========== SWING HIGH/LOW ==========
function findSwingLow(lows: number[], lookback = 10): number {
  const start = Math.max(0, lows.length - lookback);
  return Math.min(...lows.slice(start, lows.length));
}

function findSwingHigh(highs: number[], lookback = 10): number {
  const start = Math.max(0, highs.length - lookback);
  return Math.max(...highs.slice(start, highs.length));
}

// ========== STRATEGY ANALYSIS ==========
interface StrategySignal {
  side: 'long' | 'short' | 'none';
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskPerUnit: number;
  reasoning: string[];
  trendFilter: string;
  atrBlocked: boolean;
  ema20: number;
  ema50: number;
  rsi: number;
  atr14: number;
  volumeOk: boolean;
  pullbackDetected: boolean;
}

function analyzeStrategy(h1Klines: Kline[], m15Klines: Kline[]): StrategySignal {
  const reasoning: string[] = [];

  // === 1H TREND FILTER: EMA 200 ===
  const h1Closes = h1Klines.map(k => k.close);
  const h1Ema200 = calcEMA(h1Closes, 200);
  const h1Last = h1Closes.length - 1;
  const h1Price = h1Closes[h1Last];
  const h1Ema200Val = h1Ema200[h1Last];
  const trendBias = h1Price > h1Ema200Val ? 'bullish' : 'bearish';
  reasoning.push(`1H: cena $${h1Price.toFixed(0)} ${trendBias === 'bullish' ? '>' : '<'} EMA200 $${h1Ema200Val.toFixed(0)} → ${trendBias.toUpperCase()}`);

  // === 15M INDICATORS ===
  const closes = m15Klines.map(k => k.close);
  const highs = m15Klines.map(k => k.high);
  const lows = m15Klines.map(k => k.low);
  const volumes = m15Klines.map(k => k.volume);
  const last = closes.length - 1;
  const price = closes[last];

  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const rsi = calcRSI(closes, 14);
  const atr14 = calcATR(highs, lows, closes, 14);
  const atr50 = calcATR(highs, lows, closes, 50);
  const volSMA20 = calcSMA(volumes, 20);

  const ema20Val = ema20[last];
  const ema50Val = ema50[last];
  const rsiVal = rsi[last];
  const atr14Val = atr14[last];
  const atr50Val = atr50[last];
  const volCurrent = volumes[last];
  const volAvg = volSMA20[last];

  // === ATR VOLATILITY FILTER ===
  const atrRatio = atr50Val > 0 ? atr14Val / atr50Val : 1;
  const atrBlocked = atrRatio > 2;
  if (atrBlocked) {
    reasoning.push(`🚫 ATR BLOCK: ATR14 ($${atr14Val.toFixed(0)}) > 2x ATR50 avg ($${atr50Val.toFixed(0)}) — ratio ${atrRatio.toFixed(2)}`);
  }

  // === VOLUME CHECK (disabled) ===
  const volumeOk = true; // volume filter disabled per user request

  // === EMA STRUCTURE ===
  const emaLongSetup = ema20Val > ema50Val;
  const emaShortSetup = ema20Val < ema50Val;
  reasoning.push(`EMA20: $${ema20Val.toFixed(0)} | EMA50: $${ema50Val.toFixed(0)} → ${emaLongSetup ? 'LONG setup' : emaShortSetup ? 'SHORT setup' : 'FLAT'}`);

  // === PULLBACK DETECTION ===
  // Price within 0.3% of EMA20 or between EMA20 and EMA50
  const pullbackToEma20 = Math.abs(price - ema20Val) / price < 0.003;
  const pullbackBetween = emaLongSetup
    ? (price <= ema20Val * 1.001 && price >= ema50Val * 0.999)
    : (price >= ema20Val * 0.999 && price <= ema50Val * 1.001);
  const pullbackDetected = pullbackToEma20 || pullbackBetween;
  reasoning.push(`Pullback: ${pullbackDetected ? '✅' : '❌'} (to EMA20: ${pullbackToEma20}, between EMAs: ${pullbackBetween})`);

  // === RSI CHECK ===
  reasoning.push(`RSI(14): ${rsiVal.toFixed(1)}`);

  // === DETERMINE SIGNAL ===
  const noSignal: StrategySignal = {
    side: 'none', entryPrice: price, stopLoss: 0, takeProfit: 0, riskPerUnit: 0,
    reasoning, trendFilter: trendBias, atrBlocked, ema20: ema20Val, ema50: ema50Val,
    rsi: rsiVal, atr14: atr14Val, volumeOk, pullbackDetected,
  };

  if (atrBlocked) return noSignal;

  // LONG conditions
  if (trendBias === 'bullish' && emaLongSetup && pullbackDetected && rsiVal > 50 && volumeOk) {
    const sl = findSwingLow(lows, 10) - atr14Val * 0.1; // slight buffer
    const riskPerUnit = price - sl;
    if (riskPerUnit <= 0) { reasoning.push('❌ Invalid SL — swing low above price'); return noSignal; }
    const tp = price + riskPerUnit * 2; // 1:2 RR
    reasoning.push(`✅ LONG ENTRY @ $${price.toFixed(0)} | SL: $${sl.toFixed(0)} | TP: $${tp.toFixed(0)} | R:R 1:2`);
    return { ...noSignal, side: 'long', entryPrice: price, stopLoss: sl, takeProfit: tp, riskPerUnit };
  }

  // SHORT conditions
  if (trendBias === 'bearish' && emaShortSetup && pullbackDetected && rsiVal < 50 && volumeOk) {
    const sl = findSwingHigh(highs, 10) + atr14Val * 0.1;
    const riskPerUnit = sl - price;
    if (riskPerUnit <= 0) { reasoning.push('❌ Invalid SL — swing high below price'); return noSignal; }
    const tp = price - riskPerUnit * 2;
    reasoning.push(`✅ SHORT ENTRY @ $${price.toFixed(0)} | SL: $${sl.toFixed(0)} | TP: $${tp.toFixed(0)} | R:R 1:2`);
    return { ...noSignal, side: 'short', entryPrice: price, stopLoss: sl, takeProfit: tp, riskPerUnit };
  }

  // No signal — explain why
  const missing: string[] = [];
  if (trendBias === 'bullish') {
    if (!emaLongSetup) missing.push('EMA20 < EMA50');
    if (!pullbackDetected) missing.push('No pullback');
    if (rsiVal <= 50) missing.push(`RSI ${rsiVal.toFixed(1)} ≤ 50`);
  } else {
    if (!emaShortSetup) missing.push('EMA20 > EMA50');
    if (!pullbackDetected) missing.push('No pullback');
    if (rsiVal >= 50) missing.push(`RSI ${rsiVal.toFixed(1)} ≥ 50`);
  }
  reasoning.push(`❌ NO ENTRY: ${missing.join(', ')}`);
  return noSignal;
}

// ========== BACKTEST ENGINE ==========
interface BacktestTrade {
  entryTime: number; exitTime: number; side: 'long' | 'short';
  entryPrice: number; exitPrice: number; sl: number; tp: number;
  pnl: number; pnlPct: number; exitReason: string;
}

interface BacktestResult {
  trades: BacktestTrade[];
  winrate: number;
  profitFactor: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  expectancy: number;
  sharpeRatio: number;
  totalReturn: number;
  totalReturnPct: number;
  totalTrades: number;
  wins: number;
  losses: number;
  avgWin: number;
  avgLoss: number;
  equityCurve: { time: number; equity: number }[];
}

function runBacktest(h1Klines: Kline[], m15Klines: Kline[], initialBalance: number, riskPct: number, leverage: number): BacktestResult {
  const trades: BacktestTrade[] = [];
  let balance = initialBalance;
  let peakBalance = initialBalance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  const equityCurve: { time: number; equity: number }[] = [{ time: m15Klines[0]?.time || 0, equity: balance }];

  // We need at least 200 bars of 1H + 50 bars of 15m for indicators to warm up
  const warmup15m = 60; // 60 bars warmup
  let consecutiveLosses = 0;
  let cooldownUntil = 0;

  // Current position tracking
  let inPosition = false;
  let posSide: 'long' | 'short' = 'long';
  let posEntry = 0;
  let posSL = 0;
  let posTP = 0;
  let posQty = 0;
  let posMargin = 0;
  let posEntryTime = 0;
  let posRiskPerUnit = 0;
  let slMovedToBE = false;

  for (let i = warmup15m; i < m15Klines.length; i++) {
    const bar = m15Klines[i];
    const price = bar.close;

    // If in position, check SL/TP on this bar's high/low
    if (inPosition) {
      let exitPrice = 0;
      let exitReason = '';

      // Check SL hit
      if (posSide === 'long') {
        if (bar.low <= posSL) { exitPrice = posSL; exitReason = 'Stop Loss'; }
        else if (bar.high >= posTP) { exitPrice = posTP; exitReason = 'Take Profit'; }
        else {
          // Move SL to BE at 1R profit
          const unrealizedR = (price - posEntry) / posRiskPerUnit;
          if (!slMovedToBE && unrealizedR >= 1) {
            posSL = posEntry;
            slMovedToBE = true;
          }
        }
      } else {
        if (bar.high >= posSL) { exitPrice = posSL; exitReason = 'Stop Loss'; }
        else if (bar.low <= posTP) { exitPrice = posTP; exitReason = 'Take Profit'; }
        else {
          const unrealizedR = (posEntry - price) / posRiskPerUnit;
          if (!slMovedToBE && unrealizedR >= 1) {
            posSL = posEntry;
            slMovedToBE = true;
          }
        }
      }

      if (exitPrice > 0) {
        const pnl = posSide === 'long'
          ? (exitPrice - posEntry) * posQty
          : (posEntry - exitPrice) * posQty;
        const pnlPct = (pnl / posMargin) * 100;
        balance += posMargin + pnl;

        trades.push({
          entryTime: posEntryTime, exitTime: bar.time, side: posSide,
          entryPrice: posEntry, exitPrice, sl: posSL, tp: posTP,
          pnl, pnlPct, exitReason,
        });

        if (pnl < 0) { consecutiveLosses++; } else { consecutiveLosses = 0; }
        if (consecutiveLosses >= 3) { cooldownUntil = bar.time + 4 * 3600; }

        peakBalance = Math.max(peakBalance, balance);
        const dd = peakBalance - balance;
        const ddPct = peakBalance > 0 ? (dd / peakBalance) * 100 : 0;
        if (dd > maxDrawdown) maxDrawdown = dd;
        if (ddPct > maxDrawdownPct) maxDrawdownPct = ddPct;

        equityCurve.push({ time: bar.time, equity: balance });
        inPosition = false;
      }
      continue;
    }

    // Cooldown check
    if (bar.time < cooldownUntil) continue;

    // Find corresponding 1H data up to this 15m bar's time
    const relevantH1 = h1Klines.filter(k => k.time <= bar.time);
    if (relevantH1.length < 210) continue; // need 200+ for EMA200

    // Get last N 15m bars for analysis
    const lookback = Math.min(i + 1, 300);
    const m15Window = m15Klines.slice(i - lookback + 1, i + 1);

    const signal = analyzeStrategy(relevantH1, m15Window);

    if (signal.side !== 'none' && signal.riskPerUnit > 0) {
      // Position sizing: risk 1% of balance
      const riskAmount = balance * (riskPct / 100);
      const qty = riskAmount / signal.riskPerUnit; // leverage only reduces margin
      const margin = (qty * price) / leverage;

      if (margin > balance * 0.9) continue; // don't risk more than 90% as margin
      if (margin < 10) continue;

      balance -= margin;
      inPosition = true;
      posSide = signal.side;
      posEntry = price;
      posSL = signal.stopLoss;
      posTP = signal.takeProfit;
      posQty = qty;
      posMargin = margin;
      posEntryTime = bar.time;
      posRiskPerUnit = signal.riskPerUnit;
      slMovedToBE = false;
    }
  }

  // Close any open position at last price
  if (inPosition) {
    const lastPrice = m15Klines[m15Klines.length - 1].close;
    const pnl = posSide === 'long'
      ? (lastPrice - posEntry) * posQty
      : (posEntry - lastPrice) * posQty;
    balance += posMargin + pnl;
    trades.push({
      entryTime: posEntryTime, exitTime: m15Klines[m15Klines.length - 1].time,
      side: posSide, entryPrice: posEntry, exitPrice: lastPrice,
      sl: posSL, tp: posTP, pnl, pnlPct: (pnl / posMargin) * 100,
      exitReason: 'End of data',
    });
    equityCurve.push({ time: m15Klines[m15Klines.length - 1].time, equity: balance });
  }

  // Compute stats
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const totalWins = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

  const winrate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
  const expectancy = trades.length > 0
    ? (winrate / 100) * avgWin - ((100 - winrate) / 100) * avgLoss
    : 0;

  // Sharpe ratio (using trade returns)
  const returns = trades.map(t => t.pnlPct / 100);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1))
    : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0; // annualized

  return {
    trades: trades.slice(-100), // last 100 for response size
    winrate, profitFactor, maxDrawdown, maxDrawdownPct,
    expectancy, sharpeRatio,
    totalReturn: balance - initialBalance,
    totalReturnPct: ((balance - initialBalance) / initialBalance) * 100,
    totalTrades: trades.length,
    wins: wins.length, losses: losses.length,
    avgWin, avgLoss,
    equityCurve: equityCurve.filter((_, i) => i % Math.max(1, Math.floor(equityCurve.length / 200)) === 0), // downsample
  };
}

// ========== MAIN SERVER ==========
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
        await supabase.from('bot_positions').delete().eq('bot_config_id', config.id);
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

      // ========== BACKTEST ACTION ==========
      if (action === 'backtest') {
        const riskPct = body.risk_pct || 1;
        const backtestBalance = body.balance || Number(config.initial_balance);
        const backtestLeverage = body.leverage || Number(config.leverage);

        await logBot(supabase, config.id, 'info', '📊 Starting backtest...');

        // Fetch max available data (1000 bars each)
        const [h1Data, m15Data] = await Promise.all([
          fetchKlines(config.symbol, '1h', 1000),
          fetchKlines(config.symbol, '15m', 1000),
        ]);

        const result = runBacktest(h1Data, m15Data, backtestBalance, riskPct, backtestLeverage);

        await logBot(supabase, config.id, 'info',
          `📊 Backtest done: ${result.totalTrades} trades | WR: ${result.winrate.toFixed(1)}% | PF: ${result.profitFactor.toFixed(2)} | DD: ${result.maxDrawdownPct.toFixed(1)}% | Exp: $${result.expectancy.toFixed(2)} | Sharpe: ${result.sharpeRatio.toFixed(2)} | Return: ${result.totalReturnPct.toFixed(1)}%`);

        return new Response(JSON.stringify({ backtest: result }), {
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

    // === TRADING LOGIC (Pullback EMA Strategy) ===
    const [h1Klines, m15Klines] = await Promise.all([
      fetchKlines(config.symbol, '1h', 300),
      fetchKlines(config.symbol, '15m', 300),
    ]);

    const currentPrice = m15Klines[m15Klines.length - 1].close;
    const signal = analyzeStrategy(h1Klines, m15Klines);

    const { data: openPositions } = await supabase.from('bot_positions')
      .select('*').eq('bot_config_id', config.id).eq('status', 'open');

    let balance = Number(config.current_balance);

    // === MANAGE OPEN POSITIONS ===
    for (const pos of openPositions || []) {
      const entryPrice = Number(pos.entry_price);
      const qty = Number(pos.quantity);
      const margin = Number(pos.margin_used);
      const currentSL = Number(pos.stop_loss);
      const currentTP = Number(pos.take_profit);

      const pnl = pos.side === 'long'
        ? (currentPrice - entryPrice) * qty
        : (entryPrice - currentPrice) * qty;
      const pnlPct = (pnl / margin) * 100;

      // Liquidation check
      if (pnlPct <= -90) {
        balance -= margin;
        await supabase.from('bot_positions').update({
          status: 'liquidated', exit_price: currentPrice, pnl: -margin, pnl_pct: -100,
          closed_at: new Date().toISOString(), exit_reason: 'Liquidation',
        }).eq('id', pos.id);
        await logBot(supabase, config.id, 'error', `⚠️ LIQUIDATION: ${pos.side} | PnL: -$${margin.toFixed(2)}`);
        continue;
      }

      // Stop Loss
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
          reason: `Stop Loss at $${currentPrice.toFixed(2)}`,
        });
        await logBot(supabase, config.id, 'trade', `🛑 SL HIT: ${pos.side} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        continue;
      }

      // Take Profit
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
        await logBot(supabase, config.id, 'trade', `🎯 TP HIT: ${pos.side} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        continue;
      }

      // Move SL to Break-Even at 1R profit
      const riskPerUnit = pos.side === 'long'
        ? entryPrice - currentSL
        : currentSL - entryPrice;
      const unrealizedR = pos.side === 'long'
        ? (currentPrice - entryPrice) / riskPerUnit
        : (entryPrice - currentPrice) / riskPerUnit;

      if (riskPerUnit > 0 && unrealizedR >= 1 && (
        (pos.side === 'long' && currentSL < entryPrice) ||
        (pos.side === 'short' && currentSL > entryPrice)
      )) {
        await supabase.from('bot_positions').update({ stop_loss: entryPrice }).eq('id', pos.id);
        await logBot(supabase, config.id, 'info',
          `🔒 BE MOVE: ${pos.side} SL → $${entryPrice.toFixed(0)} (1R reached, unrealized: ${unrealizedR.toFixed(1)}R)`);
      }
    }

    // === OPEN NEW POSITION ===
    const { data: remainingOpen } = await supabase.from('bot_positions')
      .select('id').eq('bot_config_id', config.id).eq('status', 'open');

    if ((!remainingOpen || remainingOpen.length === 0) && signal.side !== 'none') {
      // 3 consecutive losses → 4h cooldown
      const { data: recentClosed } = await supabase.from('bot_positions')
        .select('closed_at, exit_reason, pnl')
        .eq('bot_config_id', config.id)
        .in('status', ['closed'])
        .order('closed_at', { ascending: false })
        .limit(3);

      let cooldownActive = false;
      if (recentClosed && recentClosed.length >= 3) {
        const allLosses = recentClosed.every(p => Number(p.pnl) < 0);
        if (allLosses && recentClosed[0].closed_at) {
          const timeSince = Date.now() - new Date(recentClosed[0].closed_at).getTime();
          if (timeSince < 4 * 3600 * 1000) {
            cooldownActive = true;
            const remaining = Math.round((4 * 3600 * 1000 - timeSince) / 60000);
            await logBot(supabase, config.id, 'info',
              `⏳ COOLDOWN: 3 straty z rzędu — wstrzymanie na ${remaining} min`);
          }
        }
      }

      if (!cooldownActive && signal.riskPerUnit > 0) {
        const leverage = Number(config.leverage);
        // Fixed margin of $1000 per trade
        const margin = 1000;
        if (margin <= balance) {
          const notional = margin * leverage;
          const qty = notional / currentPrice;
          const riskAmount = qty * signal.riskPerUnit; // actual $ risk

          balance -= margin;

          const entryReason = signal.reasoning.join(' | ');

          const { data: newPos } = await supabase.from('bot_positions').insert({
            bot_config_id: config.id, side: signal.side, entry_price: currentPrice, quantity: qty,
            leverage, margin_used: margin, stop_loss: signal.stopLoss, take_profit: signal.takeProfit,
            entry_reason: entryReason.slice(0, 500),
          }).select().single();

          await supabase.from('bot_trades').insert({
            bot_config_id: config.id, position_id: newPos?.id,
            action: signal.side === 'long' ? 'open_long' : 'open_short',
            price: currentPrice, quantity: qty, balance_after: balance,
            reason: `${signal.side.toUpperCase()} @ $${currentPrice.toFixed(2)} | SL: $${signal.stopLoss.toFixed(2)} | TP: $${signal.takeProfit.toFixed(2)} | Risk: $${riskAmount.toFixed(2)} (1%)`,
          });

          await logBot(supabase, config.id, 'trade',
            `📈 ${signal.side.toUpperCase()} @ $${currentPrice.toFixed(2)} | Qty: ${qty.toFixed(6)} | SL: $${signal.stopLoss.toFixed(0)} | TP: $${signal.takeProfit.toFixed(0)} | R:R 1:2 | Risk: $${riskAmount.toFixed(2)}`);
          await logBot(supabase, config.id, 'info', `🧠 ${entryReason}`);
        }
      }
    } else if (signal.side === 'none' && (!remainingOpen || remainingOpen.length === 0)) {
      await logBot(supabase, config.id, 'info',
        `⏸ NO TRADE: ${signal.reasoning[signal.reasoning.length - 1] || 'Warunki nie spełnione'}`);
    }

    await supabase.from('bot_config').update({ current_balance: balance }).eq('id', config.id);

    await logBot(supabase, config.id, 'info',
      `Tick: $${currentPrice.toFixed(2)} | Trend: ${signal.trendFilter} | EMA20: $${signal.ema20.toFixed(0)} | EMA50: $${signal.ema50.toFixed(0)} | RSI: ${signal.rsi.toFixed(1)} | Pullback: ${signal.pullbackDetected ? '✅' : '❌'} | Bal: $${balance.toFixed(2)}`);

    const { data: positions } = await supabase.from('bot_positions')
      .select('*').eq('bot_config_id', config.id).order('opened_at', { ascending: false }).limit(20);
    const { data: trades } = await supabase.from('bot_trades')
      .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(50);
    const { data: logs } = await supabase.from('bot_logs')
      .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(30);

    const updatedConfig = { ...config, current_balance: balance };

    return new Response(JSON.stringify({
      config: updatedConfig, positions, trades, logs, signal, executed: true,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Trading bot error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function logBot(supabase: any, configId: string, level: string, message: string, data?: any) {
  await supabase.from('bot_logs').insert({
    bot_config_id: configId, level, message, data,
  });
}
