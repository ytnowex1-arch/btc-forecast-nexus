// Shared signal analysis — mirrors src/lib/forecast.ts analyzeSignals
// Edge functions import from here so the bot uses the SAME indicator logic as the dashboard

import type { IndicatorResults } from "./indicators.ts";

export interface Signal {
  name: string;
  signal: 'buy' | 'sell' | 'neutral';
  value: string;
  description: string;
}

export interface SignalAnalysis {
  signals: Signal[];
  confidence: number;
  bias: 'Bullish' | 'Bearish' | 'Neutral';
  bullish: number;
  bearish: number;
  total: number;
}

export function analyzeSignals(ind: IndicatorResults, closes: number[]): SignalAnalysis {
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
      rsi < 30 ? 'Oversold (<30)' : rsi > 70 ? 'Overbought (>70)' : 'Neutral');
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
      cross ? 'Bullish Cross ↑' : crossDown ? 'Bearish Cross ↓' : macdVal > macdSig ? 'Above signal' : 'Below signal');
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
      bbPos < 0.2 ? 'Near lower band' : bbPos > 0.8 ? 'Near upper band' : 'Mid band');
  }

  // Stochastic
  const stochK = ind.stochastic.k[last];
  if (!isNaN(stochK)) {
    addSignal('Stochastic', stochK.toFixed(1),
      stochK < 20 ? true : stochK > 80 ? false : null,
      stochK < 20 ? 'Oversold' : stochK > 80 ? 'Overbought' : 'Neutral');
  }

  // ADX
  const adx = ind.adx.adx[last];
  const pdi = ind.adx.plusDI[last];
  const mdi = ind.adx.minusDI[last];
  if (!isNaN(adx)) {
    addSignal('ADX', adx.toFixed(1),
      adx > 25 ? (pdi > mdi ? true : false) : null,
      adx > 25 ? (pdi > mdi ? 'Strong trend ↑' : 'Strong trend ↓') : 'No trend');
  }

  // Williams %R
  const wr = ind.williamsR[last];
  if (!isNaN(wr)) {
    addSignal('Williams %R', wr.toFixed(1),
      wr < -80 ? true : wr > -20 ? false : null,
      wr < -80 ? 'Oversold' : wr > -20 ? 'Overbought' : 'Neutral');
  }

  // CMF
  const cmf = ind.cmf[last];
  if (!isNaN(cmf)) {
    addSignal('CMF', cmf.toFixed(3),
      cmf > 0.05 ? true : cmf < -0.05 ? false : null,
      cmf > 0.05 ? 'Capital inflow' : cmf < -0.05 ? 'Capital outflow' : 'Neutral');
  }

  // Parabolic SAR
  const sar = ind.parabolicSAR[last];
  if (!isNaN(sar)) {
    addSignal('Parabolic SAR', sar.toFixed(0),
      price > sar,
      price > sar ? 'Price above SAR ↑' : 'Price below SAR ↓');
  }

  // OBV
  const obv = ind.obv;
  const obvTrend = obv[last] > obv[last - 10];
  addSignal('OBV', (obv[last] / 1e6).toFixed(1) + 'M',
    obvTrend,
    obvTrend ? 'Volume rising' : 'Volume falling');

  // ATR (informational)
  const atr = ind.atr[last];
  if (!isNaN(atr)) {
    addSignal('ATR', atr.toFixed(0), null, `Volatility: $${atr.toFixed(0)}`);
  }

  const confidence = total > 0
    ? Math.round((Math.max(bullish, bearish) / total) * 100)
    : 50;
  const bias = bullish > bearish ? 'Bullish' : bearish > bullish ? 'Bearish' : 'Neutral';

  return { signals, confidence, bias, bullish, bearish, total };
}
