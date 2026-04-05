import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MEXC_BASE = 'https://contract.mexc.com/api/v1/contract';
const TELEGRAM_API_BASE = 'https://api.telegram.org';
const TELEGRAM_WEBAPP_URL = 'https://btc-forecast-nexus.lovable.app';

const MEXC_INTERVALS: Record<string, string> = {
  '5m': 'Min5', '15m': 'Min15', '1h': 'Min60', '4h': 'Hour4', '1d': 'Day1', '1w': 'Week1',
};

interface Kline {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}

async function fetchKlines(symbol: string, interval: string, limit = 500): Promise<Kline[]> {
  const mexcInterval = MEXC_INTERVALS[interval] || 'Min60';
  const intervalSeconds: Record<string, number> = {
    '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800,
  };
  const seconds = intervalSeconds[interval] || 3600;
  const end = Math.floor(Date.now() / 1000);
  const start = end - (limit * seconds);

  const res = await fetch(`${MEXC_BASE}/kline/${symbol}?interval=${mexcInterval}&start=${start}&end=${end}`);
  const json = await res.json();
  if (!json.success) throw new Error(`MEXC kline error: ${json.code}`);

  const data = json.data;
  const times: number[] = data.time || [];
  const opens: number[] = data.open || [];
  const highs: number[] = data.high || [];
  const lows: number[] = data.low || [];
  const closes: number[] = data.close || [];
  const vols: number[] = data.vol || [];

  const klines: Kline[] = [];
  const count = Math.min(times.length, limit);
  const startIdx = Math.max(0, times.length - count);
  for (let i = startIdx; i < times.length; i++) {
    klines.push({ time: times[i], open: opens[i], high: highs[i], low: lows[i], close: closes[i], volume: vols[i] });
  }
  return klines;
}

async function fetchCurrentPrice(symbol: string): Promise<number> {
  const res = await fetch(`${MEXC_BASE}/ticker?symbol=${symbol}`);
  const json = await res.json();
  if (!json.success) throw new Error(`MEXC ticker error: ${json.code}`);
  return json.data.lastPrice;
}

async function callTelegram(method: string, payload: Record<string, unknown>) {
  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
  if (!botToken) return null;
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    console.error(`Telegram ${method} failed`, data);
    return null;
  }
  return data;
}

async function notifyLinkedTelegramUsers(supabase: any, symbol: string, text: string) {
  const { data: links, error } = await supabase
    .from('telegram_user_links')
    .select('chat_id')
    .eq('is_active', true);
  if (error || !links?.length) return;
  await Promise.allSettled(
    links.map((link: { chat_id: number }) =>
      callTelegram('sendMessage', {
        chat_id: link.chat_id,
        text,
        reply_markup: {
          inline_keyboard: [[{ text: '🚀 Otwórz Mini App', web_app: { url: TELEGRAM_WEBAPP_URL } }]],
        },
      })
    )
  );
}

// ========== INDICATORS ==========
function calcEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) ema.push(data[i] * k + ema[i - 1] * (1 - k));
  return ema;
}

function calcSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { sma.push(NaN); continue; }
    sma.push(data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
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

function calcBollingerBands(closes: number[], period = 20, stdDev = 2) {
  const sma = calcSMA(closes, period);
  const upper: number[] = [];
  const lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { upper.push(NaN); lower.push(NaN); continue; }
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = sma[i];
    const std = Math.sqrt(slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period);
    upper.push(mean + stdDev * std);
    lower.push(mean - stdDev * std);
  }
  return { upper, middle: sma, lower };
}

function calcStochRSI(closes: number[], rsiPeriod = 14, stochPeriod = 14, smoothK = 3, smoothD = 3) {
  const rsi = calcRSI(closes, rsiPeriod);
  const rawK: number[] = [];
  for (let i = 0; i < rsi.length; i++) {
    if (isNaN(rsi[i]) || i < rsiPeriod + stochPeriod - 1) { rawK.push(NaN); continue; }
    const slice = rsi.slice(i - stochPeriod + 1, i + 1).filter(v => !isNaN(v));
    if (slice.length < stochPeriod) { rawK.push(NaN); continue; }
    const hh = Math.max(...slice);
    const ll = Math.min(...slice);
    rawK.push(hh === ll ? 50 : ((rsi[i] - ll) / (hh - ll)) * 100);
  }
  const k = calcSMA(rawK, smoothK);
  const d = calcSMA(k, smoothD);
  return { k, d };
}

function calcADX(highs: number[], lows: number[], closes: number[], period = 14) {
  const plusDM: number[] = [0];
  const minusDM: number[] = [0];
  const tr: number[] = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  const atr = calcEMA(tr, period);
  const smoothPlusDM = calcEMA(plusDM, period);
  const smoothMinusDM = calcEMA(minusDM, period);
  const plusDI = smoothPlusDM.map((v, i) => atr[i] ? (v / atr[i]) * 100 : 0);
  const minusDI = smoothMinusDM.map((v, i) => atr[i] ? (v / atr[i]) * 100 : 0);
  const dx = plusDI.map((v, i) => {
    const sum = v + minusDI[i];
    return sum ? Math.abs(v - minusDI[i]) / sum * 100 : 0;
  });
  const adx = calcEMA(dx, period);
  return { adx, plusDI, minusDI };
}

function calcRVOL(volumes: number[], period = 20): number {
  const len = volumes.length;
  if (len < period + 1) return 1;
  const avgVol = volumes.slice(len - period - 1, len - 1).reduce((a, b) => a + b, 0) / period;
  return avgVol > 0 ? volumes[len - 1] / avgVol : 1;
}

function calcATR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const tr: number[] = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return calcEMA(tr, period);
}

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
  const h1Closes = h1Klines.map(k => k.close);
  const h1Ema200 = calcEMA(h1Closes, 200);
  const h1Last = h1Closes.length - 1;
  const h1Price = h1Closes[h1Last];
  const h1Ema200Val = h1Ema200[h1Last];
  const trendBias = h1Price > h1Ema200Val ? 'bullish' : 'bearish';
  reasoning.push(`1H: $${h1Price.toFixed(0)} ${trendBias === 'bullish' ? '>' : '<'} EMA200 $${h1Ema200Val.toFixed(0)} → ${trendBias.toUpperCase()}`);

  const closes = m15Klines.map(k => k.close);
  const highs = m15Klines.map(k => k.high);
  const lows = m15Klines.map(k => k.low);
  const last = closes.length - 1;
  const price = closes[last];

  const ema20 = calcEMA(closes, 20);
  const ema50 = calcEMA(closes, 50);
  const rsi = calcRSI(closes, 14);
  const atr14 = calcATR(highs, lows, closes, 14);
  const atr50 = calcATR(highs, lows, closes, 50);
  const macd = calcMACD(closes);
  const stoch = calcStochastic(highs, lows, closes);

  const ema20Val = ema20[last];
  const ema50Val = ema50[last];
  const rsiVal = rsi[last];
  const atr14Val = atr14[last];
  const atr50Val = atr50[last];
  const macdVal = macd.macdLine[last];
  const macdSig = macd.signalLine[last];
  const prevMacd = macd.macdLine[last - 1];
  const prevMacdSig = macd.signalLine[last - 1];
  const stochVal = stoch[last];

  const atrRatio = atr50Val > 0 ? atr14Val / atr50Val : 1;
  const atrBlocked = atrRatio > 2;
  if (atrBlocked) reasoning.push(`🚫 ATR BLOCK: ATR14/ATR50 = ${atrRatio.toFixed(2)} > 2`);

  const volumeOk = true;
  const emaLongSetup = ema20Val > ema50Val;
  const emaShortSetup = ema20Val < ema50Val;
  const ema20Slope = ema20[last] - ema20[last - 3];
  reasoning.push(`EMA20: $${ema20Val.toFixed(0)} | EMA50: $${ema50Val.toFixed(0)} | Slope: ${ema20Slope > 0 ? '↑' : '↓'} → ${emaLongSetup ? 'LONG' : emaShortSetup ? 'SHORT' : 'FLAT'}`);

  const pullbackToEma20 = Math.abs(price - ema20Val) / price < 0.0015;
  const pullbackBetween = emaLongSetup
    ? (price <= ema20Val * 1.0005 && price >= ema50Val * 0.999)
    : (price >= ema20Val * 0.9995 && price <= ema50Val * 1.001);
  const pullbackDetected = pullbackToEma20 || pullbackBetween;
  reasoning.push(`Pullback: ${pullbackDetected ? '✅' : '❌'} (EMA20: ${pullbackToEma20}, between: ${pullbackBetween})`);

  const macdBullCross = prevMacd <= prevMacdSig && macdVal > macdSig;
  const macdBearCross = prevMacd >= prevMacdSig && macdVal < macdSig;
  const macdBullish = macdVal > macdSig;
  reasoning.push(`MACD: ${macdVal.toFixed(1)} vs Sig: ${macdSig.toFixed(1)} → ${macdBullish ? 'BULL' : 'BEAR'}${macdBullCross ? ' (CROSS↑)' : macdBearCross ? ' (CROSS↓)' : ''}`);
  reasoning.push(`Stoch: ${stochVal?.toFixed(1) || 'N/A'}`);
  reasoning.push(`RSI(14): ${rsiVal.toFixed(1)}`);

  const noSignal: StrategySignal = {
    side: 'none', entryPrice: price, stopLoss: 0, takeProfit: 0, riskPerUnit: 0,
    reasoning, trendFilter: trendBias, atrBlocked, ema20: ema20Val, ema50: ema50Val,
    rsi: rsiVal, atr14: atr14Val, volumeOk, pullbackDetected,
  };

  if (atrBlocked) return noSignal;

  // LONG: H1 bullish + 15m dipped
  if (trendBias === 'bullish') {
    const longPullback = price <= ema20Val * 1.003 && price >= ema50Val * 0.997;
    const longRsiOk = rsiVal > 30 && rsiVal < 55;
    const longMacdOk = macdBullish || macdBullCross || (macdVal > macdSig * 0.95);

    if (longPullback && longRsiOk && longMacdOk) {
      const sl = findSwingLow(lows, 15) - atr14Val * 0.2;
      const riskPerUnit = price - sl;
      if (riskPerUnit <= 0 || riskPerUnit > price * 0.025) { reasoning.push('❌ Invalid SL'); return noSignal; }
      const tp = price + riskPerUnit * 2.5;
      reasoning.push(`✅ LONG ENTRY @ $${price.toFixed(0)} | SL: $${sl.toFixed(0)} | TP: $${tp.toFixed(0)} | R:R 1:2.5`);
      return { ...noSignal, side: 'long', entryPrice: price, stopLoss: sl, takeProfit: tp, riskPerUnit, pullbackDetected: true };
    }

    const missing: string[] = [];
    if (!longPullback) missing.push(`No pullback (price $${price.toFixed(0)} vs EMA20 $${ema20Val.toFixed(0)})`);
    if (!longRsiOk) missing.push(`RSI ${rsiVal.toFixed(1)} outside 30-55`);
    if (!longMacdOk) missing.push('MACD bearish');
    reasoning.push(`❌ NO ENTRY: ${missing.join(', ')}`);
    return noSignal;
  }

  // SHORT: H1 bearish + 15m bounced UP
  if (trendBias === 'bearish') {
    const shortPullback = price >= ema20Val * 0.997 || (price > ema50Val * 0.995 && price < ema50Val * 1.005);
    const shortRsiOk = rsiVal > 45;

    if (shortPullback && shortRsiOk) {
      const sl = findSwingHigh(highs, 15) + atr14Val * 0.2;
      const riskPerUnit = sl - price;
      if (riskPerUnit <= 0 || riskPerUnit > price * 0.025) { reasoning.push('❌ Invalid SL'); return noSignal; }
      const tp = price - riskPerUnit * 2.5;
      reasoning.push(`✅ SHORT ENTRY @ $${price.toFixed(0)} | SL: $${sl.toFixed(0)} | TP: $${tp.toFixed(0)} | R:R 1:2.5`);
      return { ...noSignal, side: 'short', entryPrice: price, stopLoss: sl, takeProfit: tp, riskPerUnit, pullbackDetected: true };
    }

    const missing: string[] = [];
    if (!shortPullback) missing.push(`No pullback UP (price $${price.toFixed(0)} below EMA20 $${ema20Val.toFixed(0)})`);
    if (!shortRsiOk) missing.push(`RSI ${rsiVal.toFixed(1)} < 45 (no bounce)`);
    reasoning.push(`❌ NO ENTRY: ${missing.join(', ')}`);
    return noSignal;
  }

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
  winrate: number; profitFactor: number; maxDrawdown: number; maxDrawdownPct: number;
  expectancy: number; sharpeRatio: number; totalReturn: number; totalReturnPct: number;
  totalTrades: number; wins: number; losses: number; avgWin: number; avgLoss: number;
  equityCurve: { time: number; equity: number }[];
}

// ========== ROI SL CONSTANTS ==========
const TRAIL_ACTIVATION_ROI = 20; // start trailing after +20% ROI
const TRAIL_GAP_ROI = 20; // keep SL 20% ROI behind
const INITIAL_SL_ROI = 20; // initial fixed SL at -20% ROI

function runBacktest(h1Klines: Kline[], m15Klines: Kline[], initialBalance: number, riskPct: number, leverage: number): BacktestResult {
  const trades: BacktestTrade[] = [];
  let balance = initialBalance;
  let peakBalance = initialBalance;
  let maxDrawdown = 0;
  let maxDrawdownPct = 0;
  const equityCurve: { time: number; equity: number }[] = [{ time: m15Klines[0]?.time || 0, equity: balance }];

  const warmup15m = 60;
  let consecutiveLosses = 0;
  let cooldownUntil = 0;

  let inPosition = false;
  let posSide: 'long' | 'short' = 'long';
  let posEntry = 0;
  let posSL = 0;
  let posTP = 0;
  let posQty = 0;
  let posMargin = 0;
  let posEntryTime = 0;

  for (let i = warmup15m; i < m15Klines.length; i++) {
    const bar = m15Klines[i];
    const price = bar.close;

    if (inPosition) {
      let exitPrice = 0;
      let exitReason = '';

      if (posSide === 'long') {
        if (bar.low <= posSL) { exitPrice = posSL; exitReason = 'Stop Loss'; }
        else if (bar.high >= posTP) { exitPrice = posTP; exitReason = 'Take Profit'; }
        else {
          // ROI-based Trailing SL: activate at +20% ROI, keep 20% ROI gap
          const btLeverage = leverage || 5;
          const activationMove = TRAIL_ACTIVATION_ROI / btLeverage / 100;
          const gapMove = TRAIL_GAP_ROI / btLeverage / 100;
          const profitMove = (price - posEntry) / posEntry;
          if (profitMove >= activationMove) {
            const candidate = price * (1 - gapMove);
            const locked = Math.max(posSL, candidate, posEntry * 1.001);
            if (locked > posSL) posSL = locked;
          }
        }
      } else {
        if (bar.high >= posSL) { exitPrice = posSL; exitReason = 'Stop Loss'; }
        else if (bar.low <= posTP) { exitPrice = posTP; exitReason = 'Take Profit'; }
        else {
          const btLeverage = leverage || 5;
          const activationMove = TRAIL_ACTIVATION_ROI / btLeverage / 100;
          const gapMove = TRAIL_GAP_ROI / btLeverage / 100;
          const profitMove = (posEntry - price) / posEntry;
          if (profitMove >= activationMove) {
            const candidate = price * (1 + gapMove);
            const locked = Math.min(posSL, candidate, posEntry * 0.999);
            if (locked < posSL) posSL = locked;
          }
        }
      }

      if (exitPrice > 0) {
        const pnl = posSide === 'long' ? (exitPrice - posEntry) * posQty : (posEntry - exitPrice) * posQty;
        const pnlPct = (pnl / posMargin) * 100;
        balance += posMargin + pnl;

        trades.push({ entryTime: posEntryTime, exitTime: bar.time, side: posSide, entryPrice: posEntry, exitPrice, sl: posSL, tp: posTP, pnl, pnlPct, exitReason });

        if (pnl < 0) consecutiveLosses++; else consecutiveLosses = 0;
        if (consecutiveLosses >= 3) cooldownUntil = bar.time + 4 * 3600;

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

    if (bar.time < cooldownUntil) continue;

    const relevantH1 = h1Klines.filter(k => k.time <= bar.time);
    if (relevantH1.length < 210) continue;

    const lookback = Math.min(i + 1, 300);
    const m15Window = m15Klines.slice(i - lookback + 1, i + 1);
    const signal = analyzeStrategy(relevantH1, m15Window);

    if (signal.side !== 'none' && signal.riskPerUnit > 0) {
      const margin = 1000;
      if (margin > balance) continue;
      const notional = margin * leverage;
      const qty = notional / price;

      balance -= margin;
      inPosition = true;
      posSide = signal.side;
      posEntry = price;

      // Fixed initial SL at 20% ROI
      const slMovePct = INITIAL_SL_ROI / leverage / 100;
      posSL = signal.side === 'long' ? price * (1 - slMovePct) : price * (1 + slMovePct);
      posTP = signal.takeProfit;
      posQty = qty;
      posMargin = margin;
      posEntryTime = bar.time;
    }
  }

  // Close any open position at last price
  if (inPosition) {
    const lastPrice = m15Klines[m15Klines.length - 1].close;
    const pnl = posSide === 'long' ? (lastPrice - posEntry) * posQty : (posEntry - lastPrice) * posQty;
    balance += posMargin + pnl;
    trades.push({ entryTime: posEntryTime, exitTime: m15Klines[m15Klines.length - 1].time, side: posSide, entryPrice: posEntry, exitPrice: lastPrice, sl: posSL, tp: posTP, pnl, pnlPct: (pnl / posMargin) * 100, exitReason: 'End of data' });
    equityCurve.push({ time: m15Klines[m15Klines.length - 1].time, equity: balance });
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const totalWins = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;
  const winrate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
  const expectancy = trades.length > 0 ? (winrate / 100) * avgWin - ((100 - winrate) / 100) * avgLoss : 0;
  const returns = trades.map(t => t.pnlPct / 100);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1 ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1)) : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0;

  return {
    trades: trades.slice(-100), winrate, profitFactor, maxDrawdown, maxDrawdownPct,
    expectancy, sharpeRatio, totalReturn: balance - initialBalance,
    totalReturnPct: ((balance - initialBalance) / initialBalance) * 100,
    totalTrades: trades.length, wins: wins.length, losses: losses.length, avgWin, avgLoss,
    equityCurve: equityCurve.filter((_, i) => i % Math.max(1, Math.floor(equityCurve.length / 200)) === 0),
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

    let action = null;
    let bodyData: any = {};
    if (req.method === 'POST') {
      bodyData = await req.json();
      action = bodyData.action;
    }

    const configId = bodyData.config_id || new URL(req.url).searchParams.get('config_id');

    if (action === 'list_configs') {
      const { data: allConfigs } = await supabase.from('bot_config').select('*').order('created_at');
      return new Response(JSON.stringify({ configs: allConfigs || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let config: any;
    if (configId) {
      const { data } = await supabase.from('bot_config').select('*').eq('id', configId).single();
      config = data;
    } else {
      const { data } = await supabase.from('bot_config').select('*').limit(1);
      config = data?.[0];
    }

    if (!config) {
      return new Response(JSON.stringify({ message: 'No bot config found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404,
      });
    }

    const symbolLabel = config.symbol.replace('_USDT', '');

    if (action) {
      const body = bodyData;

      if (action === 'status') {
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

      if (action === 'trail') {
        const currentPrice = await fetchCurrentPrice(config.symbol);
        const { data: openPositions } = await supabase.from('bot_positions')
          .select('*').eq('bot_config_id', config.id).eq('status', 'open');

        let balance = Number(config.current_balance);
        let changed = false;

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
            changed = true;
            await supabase.from('bot_positions').update({
              status: 'liquidated', exit_price: currentPrice, pnl: -margin, pnl_pct: -100,
              closed_at: new Date().toISOString(), exit_reason: 'Liquidation',
            }).eq('id', pos.id);
            await logBot(supabase, config.id, 'error', `⚠️ LIQUIDATION: ${pos.side} ${symbolLabel} | PnL: -$${margin.toFixed(2)}`);
            await notifyLinkedTelegramUsers(supabase, config.symbol,
              `⚠️ ${symbolLabel} LIQUIDATION\n${pos.side.toUpperCase()} zamknięta przy $${currentPrice.toFixed(2)}\nPnL: -$${margin.toFixed(2)}`);
            continue;
          }

          // Stop Loss
          if (currentSL && (
            (pos.side === 'long' && currentPrice <= currentSL) ||
            (pos.side === 'short' && currentPrice >= currentSL)
          )) {
            balance += margin + pnl;
            changed = true;
            await supabase.from('bot_positions').update({
              status: 'closed', exit_price: currentPrice, pnl, pnl_pct: pnlPct,
              closed_at: new Date().toISOString(), exit_reason: 'Stop Loss (trail)',
            }).eq('id', pos.id);
            await supabase.from('bot_trades').insert({
              bot_config_id: config.id, position_id: pos.id, action: 'stop_loss',
              price: currentPrice, quantity: qty, pnl, balance_after: balance,
              reason: `Trail SL hit at $${currentPrice.toFixed(2)}`,
            });
            await logBot(supabase, config.id, 'trade', `🛑 TRAIL SL HIT: ${pos.side} ${symbolLabel} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
            await notifyLinkedTelegramUsers(supabase, config.symbol,
              `🛑 ${symbolLabel} Trail SL\n${pos.side.toUpperCase()} zamknięta przy $${currentPrice.toFixed(2)}\nPnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
            continue;
          }

          // Take Profit
          if (currentTP && (
            (pos.side === 'long' && currentPrice >= currentTP) ||
            (pos.side === 'short' && currentPrice <= currentTP)
          )) {
            balance += margin + pnl;
            changed = true;
            await supabase.from('bot_positions').update({
              status: 'closed', exit_price: currentPrice, pnl, pnl_pct: pnlPct,
              closed_at: new Date().toISOString(), exit_reason: 'Take Profit',
            }).eq('id', pos.id);
            await supabase.from('bot_trades').insert({
              bot_config_id: config.id, position_id: pos.id, action: 'take_profit',
              price: currentPrice, quantity: qty, pnl, balance_after: balance,
              reason: `Take Profit at $${currentPrice.toFixed(2)}`,
            });
            await logBot(supabase, config.id, 'trade', `🎯 TP HIT: ${pos.side} ${symbolLabel} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
            await notifyLinkedTelegramUsers(supabase, config.symbol,
              `🎯 ${symbolLabel} Take Profit\n${pos.side.toUpperCase()} zamknięta przy $${currentPrice.toFixed(2)}\nPnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
            continue;
          }

          // ROI-based Trailing SL — 20% ROI activation, 20% ROI gap
          const leverage = Number(pos.leverage || config.leverage);
          const sideMul = pos.side === 'long' ? 1 : -1;
          const activationMovePct = TRAIL_ACTIVATION_ROI / leverage / 100;
          const gapMovePct = TRAIL_GAP_ROI / leverage / 100;
          const inProfitMovePct = ((currentPrice - entryPrice) / entryPrice) * sideMul;
          const currentROI = inProfitMovePct * leverage * 100;

          if (inProfitMovePct >= activationMovePct) {
            const candidateSl = pos.side === 'long'
              ? currentPrice * (1 - gapMovePct)
              : currentPrice * (1 + gapMovePct);

            const lockedSl = pos.side === 'long'
              ? Math.max(currentSL, candidateSl, entryPrice * 1.001)
              : Math.min(currentSL, candidateSl, entryPrice * 0.999);

            const shouldUpdate = pos.side === 'long' ? lockedSl > currentSL : lockedSl < currentSL;

            if (shouldUpdate) {
              await supabase.from('bot_positions').update({ stop_loss: lockedSl }).eq('id', pos.id);
              await logBot(supabase, config.id, 'info',
                `🔒 TRAIL SL: ${pos.side.toUpperCase()} ${symbolLabel} ROI ${currentROI.toFixed(1)}% | SL $${currentSL.toFixed(0)} → $${lockedSl.toFixed(0)} (${TRAIL_GAP_ROI}% ROI gap)`);
            }
          }
        }

        if (changed) {
          await supabase.from('bot_config').update({ current_balance: balance }).eq('id', config.id);
        }

        const { data: positions } = await supabase.from('bot_positions')
          .select('*').eq('bot_config_id', config.id).order('opened_at', { ascending: false }).limit(20);
        const { data: trades } = await supabase.from('bot_trades')
          .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(50);
        const { data: logs } = await supabase.from('bot_logs')
          .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(30);

        const updatedConfig = changed ? { ...config, current_balance: balance } : config;
        return new Response(JSON.stringify({ config: updatedConfig, positions, trades, logs, executed: false, trail: true }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

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

      if (action === 'backtest') {
        const riskPct = body.risk_pct || 1;
        const backtestBalance = body.balance || Number(config.initial_balance);
        const backtestLeverage = body.leverage || Number(config.leverage);

        await logBot(supabase, config.id, 'info', '📊 Starting backtest...');

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

    // === TRADING LOGIC ===
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

      if (pnlPct <= -90) {
        balance -= margin;
        await supabase.from('bot_positions').update({
          status: 'liquidated', exit_price: currentPrice, pnl: -margin, pnl_pct: -100,
          closed_at: new Date().toISOString(), exit_reason: 'Liquidation',
        }).eq('id', pos.id);
        await logBot(supabase, config.id, 'error', `⚠️ LIQUIDATION: ${pos.side} ${symbolLabel} | PnL: -$${margin.toFixed(2)}`);
        await notifyLinkedTelegramUsers(supabase, config.symbol,
          `⚠️ ${symbolLabel} LIQUIDATION\n${pos.side.toUpperCase()} zamknięta przy $${currentPrice.toFixed(2)}\nPnL: -$${margin.toFixed(2)}`);
        continue;
      }

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
        await logBot(supabase, config.id, 'trade', `🛑 SL HIT: ${pos.side} ${symbolLabel} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        await notifyLinkedTelegramUsers(supabase, config.symbol,
          `🛑 ${symbolLabel} Stop Loss\n${pos.side.toUpperCase()} zamknięta przy $${currentPrice.toFixed(2)}\nPnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        continue;
      }

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
        await logBot(supabase, config.id, 'trade', `🎯 TP HIT: ${pos.side} ${symbolLabel} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        await notifyLinkedTelegramUsers(supabase, config.symbol,
          `🎯 ${symbolLabel} Take Profit\n${pos.side.toUpperCase()} zamknięta przy $${currentPrice.toFixed(2)}\nPnL: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        continue;
      }

      // ROI-based Trailing SL — 20% ROI
      const leverage = Number(pos.leverage || config.leverage);
      const sideMul = pos.side === 'long' ? 1 : -1;
      const activationMovePct = TRAIL_ACTIVATION_ROI / leverage / 100;
      const gapMovePct = TRAIL_GAP_ROI / leverage / 100;
      const inProfitMovePct = ((currentPrice - entryPrice) / entryPrice) * sideMul;
      const currentROI = inProfitMovePct * leverage * 100;

      if (inProfitMovePct >= activationMovePct) {
        const candidateSl = pos.side === 'long'
          ? currentPrice * (1 - gapMovePct)
          : currentPrice * (1 + gapMovePct);

        const lockedSl = pos.side === 'long'
          ? Math.max(currentSL, candidateSl, entryPrice * 1.001)
          : Math.min(currentSL, candidateSl, entryPrice * 0.999);

        const shouldUpdate = pos.side === 'long' ? lockedSl > currentSL : lockedSl < currentSL;

        if (shouldUpdate) {
          await supabase.from('bot_positions').update({ stop_loss: lockedSl }).eq('id', pos.id);
          await logBot(supabase, config.id, 'info',
            `🔒 TRAIL SL: ${pos.side.toUpperCase()} ${symbolLabel} ROI ${currentROI.toFixed(1)}% | SL $${currentSL.toFixed(0)} → $${lockedSl.toFixed(0)} (${TRAIL_GAP_ROI}% ROI gap)`);
        }
      }
    }

    // === OPEN NEW POSITION ===
    const { data: remainingOpen } = await supabase.from('bot_positions')
      .select('id').eq('bot_config_id', config.id).eq('status', 'open');

    if ((!remainingOpen || remainingOpen.length === 0) && signal.side !== 'none') {
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
        const margin = 1000;
        if (margin <= balance) {
          const notional = margin * leverage;
          const qty = notional / currentPrice;

          // Fixed initial SL at 20% ROI
          const slMovePct = INITIAL_SL_ROI / leverage / 100;
          const initialSL = signal.side === 'long'
            ? currentPrice * (1 - slMovePct)
            : currentPrice * (1 + slMovePct);

          balance -= margin;

          const entryReason = signal.reasoning.join(' | ');
          const riskAmount = qty * signal.riskPerUnit;

          const { data: newPos } = await supabase.from('bot_positions').insert({
            bot_config_id: config.id, side: signal.side, entry_price: currentPrice, quantity: qty,
            leverage, margin_used: margin, stop_loss: initialSL, take_profit: signal.takeProfit,
            entry_reason: entryReason.slice(0, 500),
          }).select().single();

          await supabase.from('bot_trades').insert({
            bot_config_id: config.id, position_id: newPos?.id,
            action: signal.side === 'long' ? 'open_long' : 'open_short',
            price: currentPrice, quantity: qty, balance_after: balance,
            reason: `${signal.side.toUpperCase()} @ $${currentPrice.toFixed(2)} | SL: $${initialSL.toFixed(2)} (-${INITIAL_SL_ROI}% ROI) | TP: $${signal.takeProfit.toFixed(2)} | Risk: $${riskAmount.toFixed(2)}`,
          });

          await logBot(supabase, config.id, 'trade',
            `📈 ${signal.side.toUpperCase()} ${symbolLabel} @ $${currentPrice.toFixed(2)} | Qty: ${qty.toFixed(6)} | SL: $${initialSL.toFixed(0)} (-${INITIAL_SL_ROI}% ROI) | TP: $${signal.takeProfit.toFixed(0)} | Trail: ${TRAIL_ACTIVATION_ROI}%/${TRAIL_GAP_ROI}%`);
          await logBot(supabase, config.id, 'info', `🧠 ${entryReason}`);
          await notifyLinkedTelegramUsers(supabase, config.symbol,
            `📊 ${symbolLabel} analiza\nSygnał: ${signal.side.toUpperCase()}\nWejście: $${currentPrice.toFixed(2)}\nSL: $${initialSL.toFixed(2)} (-${INITIAL_SL_ROI}% ROI)\nTP: $${signal.takeProfit.toFixed(2)}`);
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
