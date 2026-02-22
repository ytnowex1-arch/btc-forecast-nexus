import type { Kline } from './binance';
import type { IndicatorResults } from './indicators';
import { calculateEMA } from './indicators';

export interface ProjectionPoint {
  time: number;
  value: number;
}

export interface Projection {
  baseCase: ProjectionPoint[];
  bullCase: ProjectionPoint[];
  bearCase: ProjectionPoint[];
}

/* ── Seeded PRNG for deterministic wiggles ── */
function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/* ── Support / Resistance detection ── */
function findSRLevels(klines: Kline[], bucketSize = 0.005): number[] {
  const prices = klines.flatMap(k => [k.high, k.low]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const bucketWidth = max * bucketSize;
  const buckets = new Map<number, number>();

  for (const p of prices) {
    const key = Math.round(p / bucketWidth);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  const threshold = klines.length * 0.06;
  const levels: number[] = [];
  for (const [key, count] of buckets) {
    if (count >= threshold) levels.push(key * bucketWidth);
  }
  return levels.sort((a, b) => a - b);
}

/* ── Timeframe sentiment ── */
interface TimeframeSentiment {
  weight: number;
  bias: number; // -1 bearish … +1 bullish
}

function getTimeframeBias(closes: number[]): number {
  if (closes.length < 200) return 0;
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const last = closes.length - 1;
  const price = closes[last];
  const e50 = ema50[last];
  const e200 = ema200[last];

  let bias = 0;
  if (price > e200) bias += 0.4;
  else bias -= 0.4;
  if (e50 > e200) bias += 0.4;
  else bias -= 0.4;
  if (price > e50) bias += 0.2;
  else bias -= 0.2;
  return Math.max(-1, Math.min(1, bias));
}

export function calculateProjection(
  klines: Kline[],
  periods = 72,
  multiTFData?: { m15?: Kline[]; h1?: Kline[]; h4?: Kline[]; d1?: Kline[] }
): Projection {
  const closes = klines.map(k => k.close);
  const lastPrice = closes[closes.length - 1];
  const lastTime = klines[klines.length - 1].time;
  const interval = klines.length > 1
    ? klines[klines.length - 1].time - klines[klines.length - 2].time
    : 3600;

  // ── Multi-timeframe weighted sentiment ──
  const sentiments: TimeframeSentiment[] = [];
  if (multiTFData?.m15 && multiTFData.m15.length >= 200)
    sentiments.push({ weight: 0.1, bias: getTimeframeBias(multiTFData.m15.map(k => k.close)) });
  if (multiTFData?.h1 && multiTFData.h1.length >= 200)
    sentiments.push({ weight: 0.3, bias: getTimeframeBias(multiTFData.h1.map(k => k.close)) });
  if (multiTFData?.h4 && multiTFData.h4.length >= 200)
    sentiments.push({ weight: 0.35, bias: getTimeframeBias(multiTFData.h4.map(k => k.close)) });
  if (multiTFData?.d1 && multiTFData.d1.length >= 200)
    sentiments.push({ weight: 0.25, bias: getTimeframeBias(multiTFData.d1.map(k => k.close)) });

  let weightedBias = 0;
  if (sentiments.length > 0) {
    const totalW = sentiments.reduce((s, v) => s + v.weight, 0);
    weightedBias = sentiments.reduce((s, v) => s + v.bias * v.weight, 0) / totalW;
  } else {
    // fallback: use current klines
    if (closes.length >= 200) weightedBias = getTimeframeBias(closes);
  }

  // ── Linear regression slope on last 50 candles ──
  const n = Math.min(50, closes.length);
  const recent = closes.slice(-n);
  const xMean = (n - 1) / 2;
  const yMean = recent.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (recent[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den !== 0 ? num / den : 0;

  // ── Volatility ──
  const std = Math.sqrt(recent.reduce((s, v) => s + (v - yMean) ** 2, 0) / n);

  // ── Support / Resistance levels ──
  const srLevels = findSRLevels(klines);

  // ── Magnetic pull toward S/R ──
  const magnetPull = (price: number, strength = 0.03): number => {
    let closest = Infinity;
    let closestLevel = price;
    for (const level of srLevels) {
      const dist = Math.abs(price - level);
      if (dist < closest) { closest = dist; closestLevel = level; }
    }
    const relDist = closest / price;
    if (relDist < 0.05) {
      return (closestLevel - price) * strength;
    }
    return 0;
  };

  // ── Build wiggly paths ──
  const rng = seededRandom(Math.round(lastTime));
  const baseCase: ProjectionPoint[] = [];
  const bullCase: ProjectionPoint[] = [];
  const bearCase: ProjectionPoint[] = [];

  let baseVal = lastPrice;
  let bullVal = lastPrice;
  let bearVal = lastPrice;

  // Bias-adjusted slopes
  const baseSlopePerStep = slope * (1 + weightedBias * 0.5);
  const bullSlopePerStep = slope + Math.abs(slope) * 0.3 + std * 0.01;
  const bearSlopePerStep = slope - Math.abs(slope) * 0.3 - std * 0.01;

  const LOG_FLOOR = lastPrice * 0.05; // absolute minimum (5% of current price)

  for (let i = 1; i <= periods; i++) {
    const time = lastTime + i * interval;
    const t = i / periods; // 0→1 progress

    // Time-decay volatility cone
    const volScale = std * 0.15 * Math.sqrt(i);

    // Wiggles (deterministic noise)
    const wiggle1 = (rng() - 0.5) * volScale * 0.6;
    const wiggle2 = (rng() - 0.5) * volScale * 0.6;
    const wiggle3 = (rng() - 0.5) * volScale * 0.6;

    // Step values
    baseVal += baseSlopePerStep + wiggle1 + magnetPull(baseVal, 0.02);
    bullVal += bullSlopePerStep + volScale * 0.12 + wiggle2 + magnetPull(bullVal, 0.015);
    bearVal += bearSlopePerStep - volScale * 0.12 + wiggle3 + magnetPull(bearVal, 0.025);

    // Ensure cone widens: bull >= base >= bear
    bullVal = Math.max(bullVal, baseVal + volScale * 0.3);
    bearVal = Math.min(bearVal, baseVal - volScale * 0.3);

    // Logarithmic floor — never go below LOG_FLOOR
    const applyFloor = (v: number) => Math.max(v, LOG_FLOOR * (1 + Math.log(1 + t)));

    baseCase.push({ time, value: applyFloor(baseVal) });
    bullCase.push({ time, value: applyFloor(bullVal) });
    bearCase.push({ time, value: applyFloor(bearVal) });
  }

  return { baseCase, bullCase, bearCase };
}

/* ────────────────────────────────────────────
   Signal analysis — unchanged from before
   ──────────────────────────────────────────── */

export interface Signal {
  name: string;
  signal: 'buy' | 'sell' | 'neutral';
  value: string;
  description: string;
}

export function analyzeSignals(ind: IndicatorResults, closes: number[]): {
  signals: Signal[];
  confidence: number;
  bias: 'Bullish' | 'Bearish' | 'Neutral';
} {
  const signals: Signal[] = [];
  let bullish = 0, bearish = 0, total = 0;
  const last = closes.length - 1;

  const addSignal = (name: string, value: string, isBull: boolean | null, desc: string) => {
    total++;
    if (isBull === true) bullish++;
    else if (isBull === false) bearish++;
    signals.push({
      name,
      signal: isBull === true ? 'buy' : isBull === false ? 'sell' : 'neutral',
      value,
      description: desc,
    });
  };

  // RSI
  const rsi = ind.rsi[last];
  if (!isNaN(rsi)) {
    addSignal('RSI', rsi.toFixed(1),
      rsi < 30 ? true : rsi > 70 ? false : null,
      rsi < 30 ? 'Wyprzedany (<30)' : rsi > 70 ? 'Wykupiony (>70)' : 'Neutralny');
  }

  // MACD
  const macdVal = ind.macd.macdLine[last];
  const macdSig = ind.macd.signalLine[last];
  const prevMacd = ind.macd.macdLine[last - 1];
  const prevSig = ind.macd.signalLine[last - 1];
  if (!isNaN(macdVal)) {
    const cross = prevMacd <= prevSig && macdVal > macdSig;
    const crossDown = prevMacd >= prevSig && macdVal < macdSig;
    addSignal('MACD', macdVal.toFixed(2),
      cross ? true : crossDown ? false : macdVal > macdSig ? true : false,
      cross ? 'Bullish Cross ↑' : crossDown ? 'Bearish Cross ↓' : macdVal > macdSig ? 'Powyżej sygnału' : 'Poniżej sygnału');
  }

  // EMA Cross
  const ema50 = ind.ema50[last];
  const ema200 = ind.ema200[last];
  if (!isNaN(ema50) && !isNaN(ema200)) {
    addSignal('EMA 50/200', `${ema50.toFixed(0)}/${ema200.toFixed(0)}`,
      ema50 > ema200,
      ema50 > ema200 ? 'Golden Cross' : 'Death Cross');
  }

  // Bollinger
  const bbUp = ind.bollingerBands.upper[last];
  const bbLow = ind.bollingerBands.lower[last];
  const price = closes[last];
  if (!isNaN(bbUp) && !isNaN(bbLow)) {
    const bbPos = (price - bbLow) / (bbUp - bbLow);
    addSignal('Bollinger', (bbPos * 100).toFixed(0) + '%',
      bbPos < 0.2 ? true : bbPos > 0.8 ? false : null,
      bbPos < 0.2 ? 'Blisko dolnej' : bbPos > 0.8 ? 'Blisko górnej' : 'Środek pasma');
  }

  // Stochastic
  const stochK = ind.stochastic.k[last];
  if (!isNaN(stochK)) {
    addSignal('Stochastic', stochK.toFixed(1),
      stochK < 20 ? true : stochK > 80 ? false : null,
      stochK < 20 ? 'Wyprzedany' : stochK > 80 ? 'Wykupiony' : 'Neutralny');
  }

  // ADX
  const adx = ind.adx.adx[last];
  const pdi = ind.adx.plusDI[last];
  const mdi = ind.adx.minusDI[last];
  if (!isNaN(adx)) {
    addSignal('ADX', adx.toFixed(1),
      adx > 25 ? (pdi > mdi ? true : false) : null,
      adx > 25 ? (pdi > mdi ? 'Silny trend ↑' : 'Silny trend ↓') : 'Brak trendu');
  }

  // Williams %R
  const wr = ind.williamsR[last];
  if (!isNaN(wr)) {
    addSignal('Williams %R', wr.toFixed(1),
      wr < -80 ? true : wr > -20 ? false : null,
      wr < -80 ? 'Wyprzedany' : wr > -20 ? 'Wykupiony' : 'Neutralny');
  }

  // CMF
  const cmf = ind.cmf[last];
  if (!isNaN(cmf)) {
    addSignal('CMF', cmf.toFixed(3),
      cmf > 0.05 ? true : cmf < -0.05 ? false : null,
      cmf > 0.05 ? 'Napływ kapitału' : cmf < -0.05 ? 'Odpływ kapitału' : 'Neutralny');
  }

  // Parabolic SAR
  const sar = ind.parabolicSAR[last];
  if (!isNaN(sar)) {
    addSignal('Parabolic SAR', sar.toFixed(0),
      price > sar,
      price > sar ? 'Cena powyżej SAR ↑' : 'Cena poniżej SAR ↓');
  }

  // Volume trend
  const obv = ind.obv;
  const obvTrend = obv[last] > obv[last - 10];
  addSignal('OBV', (obv[last] / 1e6).toFixed(1) + 'M',
    obvTrend,
    obvTrend ? 'Wolumen rośnie' : 'Wolumen spada');

  // ATR (informational)
  const atr = ind.atr[last];
  if (!isNaN(atr)) {
    addSignal('ATR', atr.toFixed(0), null, `Zmienność: $${atr.toFixed(0)}`);
  }

  const confidence = total > 0
    ? Math.round((Math.max(bullish, bearish) / total) * 100)
    : 50;
  const bias = bullish > bearish ? 'Bullish' : bearish > bullish ? 'Bearish' : 'Neutral';

  return { signals, confidence, bias };
}

export function getMarketBiasScore(ind: IndicatorResults, closes: number[]): number {
  const { confidence, bias } = analyzeSignals(ind, closes);
  return bias === 'Bullish' ? confidence : bias === 'Bearish' ? -confidence : 0;
}
