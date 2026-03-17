/**
 * Multi-Timeframe Trend & Volatility Strategy with ROI Trailing Stop
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
 * Analiza trendu H1 przy użyciu EMA 50/200
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
 * Oblicza ADR (Average Daily Range)
 */
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

/**
 * Pobiera ATR z interwału dziennego
 */
export function getDailyATR(dailyKlines: Kline[]): number {
  const atr = calculateATR(
    dailyKlines.map(k => k.high),
    dailyKlines.map(k => k.low),
    dailyKlines.map(k => k.close),
    14
  );
  return atr[atr.length - 1];
}

/**
 * Detekcja pullbacku na M5
 */
export function detectPullback(
  m5Klines: Kline[],
  h1Trend: H1TrendResult,
  dailyATR: number
): PullbackSignal {
  const last = m5Klines[m5Klines.length - 1];
  const prev = m5Klines[m5Klines.length - 2];
  const threshold = dailyATR * 0.15; // 15% dziennego ATR jako próg pullbacku

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
 * Kalkulator rozmiaru pozycji i poziomów SL/TP
 */
export function calculatePositionSize(
  accountBalance: number,
  riskPct: number,
  currentPrice: number,
  dailyATR: number
) {
  const slDistance = dailyATR * 1.5;
  const slPrice = currentPrice - slDistance; // dla long; odwróć dla short
  const riskAmount = accountBalance * (riskPct / 100);
  const positionSize = riskAmount / slDistance;
  
  return { slPrice, slDistance, riskAmount, positionSize };
}

/**
 * NOWA FUNKCJA: Trailing Stop oparty na ROI %
 * Przesuwa SL co określony krok ROI (np. 1%)
 */
export function calculateRoiTrailingStop(
  entryPrice: number,
  currentPrice: number,
  currentSL: number,
  isLong: boolean,
  roiStep: number = 1.0 // krok w procentach
): number {
  const profitPct = isLong 
    ? ((currentPrice - entryPrice) / entryPrice) * 100 
    : ((entryPrice - currentPrice) / entryPrice) * 100;

  if (profitPct < roiStep) return currentSL;

  const steps = Math.floor(profitPct / roiStep);
  
  // Nowy SL to cena wejścia + (krok - 1) * roiStep
  // Przy 1% ROI -> SL ląduje na entryPrice (Break Even)
  // Przy 2% ROI -> SL ląduje na entryPrice + 1% zysku
  const movePct = (steps - 1) * (roiStep / 100);
  const newSL = isLong 
    ? entryPrice * (1 + movePct) 
    : entryPrice * (1 - movePct);

  // Zwracamy nowy SL tylko jeśli jest "lepszy" (wyższy dla long, niższy dla short)
  if (isLong) {
    return Math.max(currentSL, newSL);
  } else {
    return currentSL === 0 ? newSL : Math.min(currentSL, newSL);
  }
}

/**
 * Pełna analiza strategii
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

  let m5Signal: StrategyResult['m5Signal'] = 'WAIT';
  if (pullback.active) {
    m5Signal = h1Trend.trend === 'Bullish' ? 'BUY' : 'SELL';
  }

  if (adrAnalysis.status === 'Warning') {
    m5Signal = 'WAIT';
  }

  let overallLabel = 'Czekaj na ustawienie';
  if (m5Signal === 'BUY') overallLabel = '🟢 Wysoka szansa — wejście LONG';
  if (m5Signal === 'SELL') overallLabel = '🔴 Wysoka szansa — wejście SHORT';

  return { h1Trend, adrAnalysis, pullback, m5Signal, overallLabel };
}
