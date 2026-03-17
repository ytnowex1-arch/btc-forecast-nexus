/**
 * Multi-Timeframe Trend & Volatility Strategy
 */
import type { Kline } from './binance';
import { calculateEMA, calculateATR } from './indicators';

export interface H1TrendResult {
  trend: 'Bullish' | 'Bearish';
  price: number;
  ema50: number;
  ema200: number;
}

export interface ADRAnalysis {
  adr: number;
  currentDailyMove: number;
  adrUsedPct: number;
  status: 'Normal' | 'Extended' | 'Warning';
  statusLabel: string;
}

export interface PullbackSignal {
  active: boolean;
  type: 'pullback_long' | 'pullback_short' | 'none';
  label: string;
  dropAmount: number;
  threshold: number;
}

export interface StrategyResult {
  h1Trend: H1TrendResult;
  adrAnalysis: ADRAnalysis;
  pullback: PullbackSignal;
  m5Signal: 'BUY' | 'SELL' | 'WAIT';
  overallLabel: string;
}

/**
 * Analyze H1 trend using EMA 50/200
 */
export function analyzeH1Trend(h1Klines: Kline[]): H1TrendResult {
  const closes = h1Klines.map(k => k.close);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const last = closes.length - 1;
  const price = closes[last];
  return {
    trend: price > ema200[last] ? 'Bullish' : 'Bearish',
    price,
    ema50: ema50[last],
    ema200: ema200[last],
  };
}

/**
 * Calculate Average Daily Range over last N days
 */
export function calculateADR(dailyKlines: Kline[], period = 14): ADRAnalysis {
  const len = dailyKlines.length;
  const lookback = Math.min(period, len - 1);
  
  // ADR = average of (high - low) for last N daily candles (excluding current)
  let sumRange = 0;
  for (let i = len - 1 - lookback; i < len - 1; i++) {
    sumRange += dailyKlines[i].high - dailyKlines[i].low;
  }
  const adr = lookback > 0 ? sumRange / lookback : 0;

  // Current day's move
  const today = dailyKlines[len - 1];
  const currentDailyMove = today.high - today.low;
  const adrUsedPct = adr > 0 ? (currentDailyMove / adr) * 100 : 0;

  let status: ADRAnalysis['status'] = 'Normal';
  let statusLabel = 'Normalny zakres';
  if (adrUsedPct >= 100) {
    status = 'Warning';
    statusLabel = 'Rozszerzony ruch — oczekuj korekty/konsolidacji';
  } else if (adrUsedPct >= 80) {
    status = 'Extended';
    statusLabel = 'Zbliżanie do ADR — ostrożnie';
  }

  return { adr, currentDailyMove, adrUsedPct, status, statusLabel };
}

/**
 * Detect pullback entry on M5 relative to H1 trend + daily ATR
 */
export function detectPullback(
  m5Klines: Kline[],
  h1Trend: H1TrendResult,
  dailyATR: number,
  atrFraction = 0.3
): PullbackSignal {
  const closes = m5Klines.map(k => k.close);
  const last = closes.length - 1;
  
  // Look back ~60 bars (5 hours on M5) to find swing high/low
  const lookback = Math.min(60, last);
  const recentSlice = closes.slice(last - lookback, last + 1);
  const threshold = dailyATR * atrFraction;

  if (h1Trend.trend === 'Bullish') {
    const recentHigh = Math.max(...recentSlice);
    const drop = recentHigh - closes[last];
    if (drop >= threshold) {
      return {
        active: true,
        type: 'pullback_long',
        label: `Pullback Entry LONG — spadek $${drop.toFixed(0)} ≥ próg $${threshold.toFixed(0)}`,
        dropAmount: drop,
        threshold,
      };
    }
  } else {
    const recentLow = Math.min(...recentSlice);
    const rise = closes[last] - recentLow;
    if (rise >= threshold) {
      return {
        active: true,
        type: 'pullback_short',
        label: `Pullback Entry SHORT — wzrost $${rise.toFixed(0)} ≥ próg $${threshold.toFixed(0)}`,
        dropAmount: rise,
        threshold,
      };
    }
  }

  return {
    active: false,
    type: 'none',
    label: 'Czekaj na pullback',
    dropAmount: 0,
    threshold,
  };
}

/**
 * Calculate daily ATR from daily klines
 */
export function getDailyATR(dailyKlines: Kline[], period = 14): number {
  const highs = dailyKlines.map(k => k.high);
  const lows = dailyKlines.map(k => k.low);
  const closes = dailyKlines.map(k => k.close);
  const atr = calculateATR(highs, lows, closes, period);
  return atr[atr.length - 1];
}

/**
 * Position size calculator
 */
export interface PositionSizeResult {
  slPrice: number;
  slDistance: number;
  riskAmount: number;
  positionSize: number;
  risk30pips: number;
  risk100pips: number;
}

export function calculatePositionSize(
  accountBalance: number,
  riskPct: number, // e.g. 1 for 1%
  entryPrice: number,
  atr: number,
  slMultiplier = 1.5
): PositionSizeResult {
  const slDistance = atr * slMultiplier;
  const slPrice = entryPrice - slDistance; // for long; invert for short
  const riskAmount = accountBalance * (riskPct / 100);
  const positionSize = riskAmount / slDistance;
  
  // Capital at risk at specific pip distances
  const risk30pips = positionSize * 30;
  const risk100pips = positionSize * 100;

  return { slPrice, slDistance, riskAmount, positionSize, risk30pips, risk100pips };
}

/**
 * Full strategy analysis combining all components
 */
export function runStrategy(
  h1Klines: Kline[],
  m5Klines: Kline[],
  dailyKlines: Kline[]
): StrategyResult {
  const h1Trend = analyzeH1Trend(h1Klines);
  const adrAnalysis = calculateADR(dailyKlines);
  const dailyATR = getDailyATR(dailyKlines);
  const pullback = detectPullback(m5Klines, h1Trend, dailyATR);

  // M5 signal: only BUY in bullish H1, only SELL in bearish H1
  let m5Signal: StrategyResult['m5Signal'] = 'WAIT';
  if (pullback.active) {
    m5Signal = h1Trend.trend === 'Bullish' ? 'BUY' : 'SELL';
  }

  // If ADR is extended, override to WAIT
  if (adrAnalysis.status === 'Warning') {
    m5Signal = 'WAIT';
  }

  let overallLabel = 'Czekaj na ustawienie';
  if (m5Signal === 'BUY') overallLabel = '🟢 Wysoka szansa — wejście LONG';
  else if (m5Signal === 'SELL') overallLabel = '🔴 Wysoka szansa — wejście SHORT';
  else if (adrAnalysis.status === 'Warning') overallLabel = '⚠️ ADR wyczerpany — czekaj';
  else if (pullback.active) overallLabel = '⏳ Pullback wykryty ale ADR ogranicza';

  return { h1Trend, adrAnalysis, pullback, m5Signal, overallLabel };
}
