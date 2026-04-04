// MEXC Futures API client (replaces Binance)
const BASE_URL = 'https://contract.mexc.com/api/v1/contract';

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Map our internal interval codes to MEXC kline interval names
const MEXC_INTERVALS: Record<string, string> = {
  '5m': 'Min5',
  '15m': 'Min15',
  '1h': 'Min60',
  '4h': 'Hour4',
  '1d': 'Day1',
  '1w': 'Week1',
};

export async function fetchKlines(
  symbol = 'BTC_USDT',
  interval = '1h',
  limit = 500
): Promise<Kline[]> {
  const mexcInterval = MEXC_INTERVALS[interval] || 'Min60';
  // Calculate start time to get enough bars
  const intervalSeconds: Record<string, number> = {
    '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800,
  };
  const seconds = intervalSeconds[interval] || 3600;
  const end = Math.floor(Date.now() / 1000);
  const start = end - (limit * seconds);

  const res = await fetch(
    `${BASE_URL}/kline/${symbol}?interval=${mexcInterval}&start=${start}&end=${end}`
  );
  if (!res.ok) throw new Error(`MEXC API error: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(`MEXC API error: ${json.code}`);

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
    klines.push({
      time: times[i],
      open: opens[i],
      high: highs[i],
      low: lows[i],
      close: closes[i],
      volume: vols[i],
    });
  }
  return klines;
}

export async function fetchCurrentPrice(symbol = 'BTC_USDT'): Promise<number> {
  const res = await fetch(`${BASE_URL}/ticker?symbol=${symbol}`);
  if (!res.ok) throw new Error(`MEXC API error: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(`MEXC API error: ${json.code}`);
  return json.data.lastPrice;
}

export async function fetch24hStats(symbol = 'BTC_USDT') {
  const res = await fetch(`${BASE_URL}/ticker?symbol=${symbol}`);
  if (!res.ok) throw new Error(`MEXC API error: ${res.status}`);
  const json = await res.json();
  if (!json.success) throw new Error(`MEXC API error: ${json.code}`);
  const d = json.data;
  return {
    priceChangePercent: String((d.riseFallRate || 0) * 100),
    volume: String(d.amount24 || 0),
    highPrice: String(d.high24Price || 0),
    lowPrice: String(d.lower24Price || 0),
    lastPrice: String(d.lastPrice || 0),
  };
}
