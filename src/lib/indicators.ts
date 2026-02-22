export function calculateEMA(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    ema.push(data[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

export function calculateSMA(data: number[], period: number): number[] {
  const sma: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { sma.push(NaN); continue; }
    const sum = data.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    sma.push(sum / period);
  }
  return sma;
}

export function calculateRSI(closes: number[], period = 14): number[] {
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

export function calculateMACD(closes: number[], fast = 12, slow = 26, signal = 9) {
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = calculateEMA(macdLine, signal);
  const histogram = macdLine.map((v, i) => v - signalLine[i]);
  return { macdLine, signalLine, histogram };
}

export function calculateBollingerBands(closes: number[], period = 20, stdDev = 2) {
  const sma = calculateSMA(closes, period);
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

export function calculateStochastic(highs: number[], lows: number[], closes: number[], period = 14, smoothK = 3, smoothD = 3) {
  const rawK: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { rawK.push(NaN); continue; }
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    rawK.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  const k = calculateSMA(rawK, smoothK);
  const d = calculateSMA(k, smoothD);
  return { k, d };
}

export function calculateATR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const tr: number[] = [highs[0] - lows[0]];
  for (let i = 1; i < closes.length; i++) {
    tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
  }
  return calculateEMA(tr, period);
}

export function calculateOBV(closes: number[], volumes: number[]): number[] {
  const obv: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) obv.push(obv[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) obv.push(obv[i - 1] - volumes[i]);
    else obv.push(obv[i - 1]);
  }
  return obv;
}

export function calculateWilliamsR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const wr: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { wr.push(NaN); continue; }
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    wr.push(hh === ll ? -50 : ((hh - closes[i]) / (hh - ll)) * -100);
  }
  return wr;
}

export function calculateADX(highs: number[], lows: number[], closes: number[], period = 14) {
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
  const atr = calculateEMA(tr, period);
  const smoothPlusDM = calculateEMA(plusDM, period);
  const smoothMinusDM = calculateEMA(minusDM, period);
  const plusDI = smoothPlusDM.map((v, i) => atr[i] ? (v / atr[i]) * 100 : 0);
  const minusDI = smoothMinusDM.map((v, i) => atr[i] ? (v / atr[i]) * 100 : 0);
  const dx = plusDI.map((v, i) => {
    const sum = v + minusDI[i];
    return sum ? Math.abs(v - minusDI[i]) / sum * 100 : 0;
  });
  const adx = calculateEMA(dx, period);
  return { adx, plusDI, minusDI };
}

export function calculateParabolicSAR(highs: number[], lows: number[], af = 0.02, maxAf = 0.2): number[] {
  const sar: number[] = [lows[0]];
  let isUpTrend = true;
  let ep = highs[0];
  let currentAf = af;
  for (let i = 1; i < highs.length; i++) {
    let newSar = sar[i - 1] + currentAf * (ep - sar[i - 1]);
    if (isUpTrend) {
      newSar = Math.min(newSar, lows[i - 1], i > 1 ? lows[i - 2] : lows[i - 1]);
      if (newSar > lows[i]) {
        isUpTrend = false; newSar = ep; ep = lows[i]; currentAf = af;
      } else if (highs[i] > ep) { ep = highs[i]; currentAf = Math.min(currentAf + af, maxAf); }
    } else {
      newSar = Math.max(newSar, highs[i - 1], i > 1 ? highs[i - 2] : highs[i - 1]);
      if (newSar < highs[i]) {
        isUpTrend = true; newSar = ep; ep = highs[i]; currentAf = af;
      } else if (lows[i] < ep) { ep = lows[i]; currentAf = Math.min(currentAf + af, maxAf); }
    }
    sar.push(newSar);
  }
  return sar;
}

export function calculateCMF(highs: number[], lows: number[], closes: number[], volumes: number[], period = 20): number[] {
  const mfv = closes.map((c, i) => {
    const range = highs[i] - lows[i];
    return range === 0 ? 0 : ((c - lows[i]) - (highs[i] - c)) / range * volumes[i];
  });
  const cmf: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) { cmf.push(NaN); continue; }
    const mfvSum = mfv.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const volSum = volumes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    cmf.push(volSum === 0 ? 0 : mfvSum / volSum);
  }
  return cmf;
}

export function calculateVWAP(highs: number[], lows: number[], closes: number[], volumes: number[]): number[] {
  let cumTPV = 0, cumVol = 0;
  return closes.map((c, i) => {
    const tp = (highs[i] + lows[i] + c) / 3;
    cumTPV += tp * volumes[i];
    cumVol += volumes[i];
    return cumVol === 0 ? c : cumTPV / cumVol;
  });
}

export interface IndicatorResults {
  ema50: number[];
  ema200: number[];
  sma20: number[];
  rsi: number[];
  macd: { macdLine: number[]; signalLine: number[]; histogram: number[] };
  bollingerBands: { upper: number[]; middle: number[]; lower: number[] };
  stochastic: { k: number[]; d: number[] };
  atr: number[];
  obv: number[];
  williamsR: number[];
  adx: { adx: number[]; plusDI: number[]; minusDI: number[] };
  parabolicSAR: number[];
  cmf: number[];
  vwap: number[];
}

export function calculateAllIndicators(
  closes: number[],
  highs: number[],
  lows: number[],
  volumes: number[]
): IndicatorResults {
  return {
    ema50: calculateEMA(closes, 50),
    ema200: calculateEMA(closes, 200),
    sma20: calculateSMA(closes, 20),
    rsi: calculateRSI(closes),
    macd: calculateMACD(closes),
    bollingerBands: calculateBollingerBands(closes),
    stochastic: calculateStochastic(highs, lows, closes),
    atr: calculateATR(highs, lows, closes),
    obv: calculateOBV(closes, volumes),
    williamsR: calculateWilliamsR(highs, lows, closes),
    adx: calculateADX(highs, lows, closes),
    parabolicSAR: calculateParabolicSAR(highs, lows),
    cmf: calculateCMF(highs, lows, closes, volumes),
    vwap: calculateVWAP(highs, lows, closes, volumes),
  };
}
