import type { Kline } from './binance';
import type { IndicatorResults } from './indicators';

export interface ProjectionPoint {
  time: number;
  value: number;
}

export interface Projection {
  baseCase: ProjectionPoint[];
  bullCase: ProjectionPoint[];
  bearCase: ProjectionPoint[];
}

export function calculateProjection(klines: Kline[], periods = 72): Projection {
  const closes = klines.map(k => k.close);
  const lastTime = klines[klines.length - 1].time;
  const interval = klines.length > 1
    ? klines[klines.length - 1].time - klines[klines.length - 2].time
    : 3600;

  // Linear regression on last 50 candles
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
  const intercept = yMean - slope * xMean;

  // Volatility from recent std dev
  const std = Math.sqrt(recent.reduce((s, v) => s + (v - yMean) ** 2, 0) / n);

  const baseCase: ProjectionPoint[] = [];
  const bullCase: ProjectionPoint[] = [];
  const bearCase: ProjectionPoint[] = [];

  for (let i = 0; i <= periods; i++) {
    const time = lastTime + (i + 1) * interval;
    const baseValue = intercept + slope * (n - 1 + i);
    const spread = std * (1 + i * 0.015);
    baseCase.push({ time, value: baseValue });
    bullCase.push({ time, value: baseValue + spread });
    bearCase.push({ time, value: Math.max(baseValue - spread, 0) });
  }

  return { baseCase, bullCase, bearCase };
}

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
