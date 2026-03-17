/**
 * Wielointerwałowa strategia trendu i zmienności z ROI Trailing Stop
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

export function calculateADR(dailyKlines: Kline[], period = 14): ADRAnalysis {
  const ranges = dailyKlines.map(k => k.high - k.low);
  const adr = ranges.slice(-period).reduce((a, b) => a + b, 0) / period;
  const lastDaily = dailyKlines[dailyKlines.length - 1];
  const currentDailyMove = lastDaily.high - lastDaily.low;
  const adrUsedPct = (currentDailyMove / adr) * 100;

  let status: ADRAnalysis['status'] = 'Normal';
  let statusLabel = 'Zmienność OK';
  if (adrUsedPct > 110) {
    status = 'Warning';
    statusLabel = 'ADR Przekroczony — Ryzyko odwrócenia';
  } else if (adrUsedPct > 85) {
    status = 'Extended';
    statusLabel = 'Trend dojrzały';
  }

  return { adr, currentDailyMove, adrUsedPct, status, statusLabel };
}

export function getDailyATR(dailyKlines: Kline[]): number {
  const atr = calculateATR(
    dailyKlines.map(k => k.high),
    dailyKlines.map(k => k.low),
    dailyKlines.map(k => k.close),
    14
  );
  return atr[atr.length - 1];
}

export function detectPullback(
  m5Klines: Kline[],
  h1Trend: H1TrendResult,
  dailyATR: number
): PullbackSignal {
  const last = m5Klines[m5Klines.length - 1];
  const prev = m5Klines[m5Klines.length - 2];
  const threshold = dailyATR * 0.15;

  if (h1Trend.trend === 'Bullish') {
    const drop = prev.high - last.close;
    return {
      active: drop >= threshold,
      type: 'pullback_long',
      label: drop >= threshold ? 'Korekta znaleziona' : 'Cena zbyt wysoko',
      dropAmount: drop,
      threshold
    };
  } else {
    const pump = last.close - prev.low;
    return {
      active: pump >= threshold,
      type: 'pullback_short',
      label: pump >= threshold ? 'Odbicie znalezione' : 'Cena zbyt nisko',
      dropAmount: pump,
      threshold
    };
  }
}

/**
 * Zaktualizowany kalkulator wielkości pozycji z obsługą SHORT
 */
export function calculatePositionSize(
  accountBalance: number,
  riskPct: number,
  currentPrice: number,
  dailyATR: number,
  side: 'LONG' | 'SHORT' = 'LONG'
) {
  const slDistance = dailyATR * 1.5;
  const slPrice = side === 'LONG' ? currentPrice - slDistance : currentPrice + slDistance;
  const riskAmount = accountBalance * (riskPct / 100);
  const positionSize = riskAmount / slDistance;
  
  // Dodatkowe pola dla UI, aby zapobiec błędowi toFixed
  const risk30pips = positionSize * 30;
  const risk100pips = positionSize * 100;

  return { slPrice, slDistance, riskAmount, positionSize, risk30pips, risk100pips };
}

/**
 * Oblicza nowy Trailing Stop na podstawie ROI %
 */
export function calculateRoiTrailingStop(
  entryPrice: number,
  currentPrice: number,
  currentSL: number,
  side: 'LONG' | 'SHORT',
  roiStep: number = 1.0
): number {
  const isLong = side === 'LONG';
  const profitPct = isLong 
    ? ((currentPrice - entryPrice) / entryPrice) * 100 
    : ((entryPrice - currentPrice) / entryPrice) * 100;

  if (profitPct < roiStep) return currentSL;

  const steps = Math.floor(profitPct / roiStep);
  const movePct = (steps - 1) * (roiStep / 100);
  const newSL = isLong 
    ? entryPrice * (1 + movePct) 
    : entryPrice * (1 - movePct);

  return isLong ? Math.max(currentSL, newSL) : Math.min(currentSL, newSL);
}

export function runStrategy(
  h1Klines: Kline[],
  m5Klines: Kline[],
  dailyKlines: Kline[]
): StrategyResult {
  const h1Trend = analyzeH1Trend(h1Klines);
  const adrAnalysis = calculateADR(dailyKlines);
  const dailyATR = getDailyATR(dailyKlines);
  const pullback = detectPullback(m5Klines, h1Trend, dailyATR);

  let m5Signal: StrategyResult['m5Signal'] = 'WAIT';
  if (pullback.active) {
    m5Signal = h1Trend.trend === 'Bullish' ? 'BUY' : 'SELL';
  }

  if (adrAnalysis.status === 'Warning') m5Signal = 'WAIT';

  let overallLabel = 'Czekaj na ustawienie';
  if (m5Signal === 'BUY') overallLabel = '🟢 Wysoka szansa — wejście LONG';
  if (m5Signal === 'SELL') overallLabel = '🔴 Wysoka szansa — wejście SHORT';

  return { h1Trend, adrAnalysis, pullback, m5Signal, overallLabel };
}
