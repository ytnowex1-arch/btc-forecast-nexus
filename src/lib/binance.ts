// MEXC Futures API client via Supabase proxy (avoids CORS)

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const PROXY_URL = `${SUPABASE_URL}/functions/v1/mexc-proxy`;

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const MEXC_INTERVALS: Record<string, string> = {
  '5m': 'Min5',
  '15m': 'Min15',
  '1h': 'Min60',
  '4h': 'Hour4',
  '1d': 'Day1',
  '1w': 'Week1',
};

async function mexcFetch(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams({ endpoint, ...params });
  const res = await fetch(`${PROXY_URL}?${qs.toString()}`);
  if (!res.ok) throw new Error(`MEXC proxy error: ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error);
  if (!json.success) throw new Error(`MEXC API error: ${json.code}`);
  return json;
}

export async function fetchKlines(
  symbol = 'BTC_USDT',
  interval = '1h',
  limit = 500
): Promise<Kline[]> {
  const mexcInterval = MEXC_INTERVALS[interval] || 'Min60';
  const intervalSeconds: Record<string, number> = {
    '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800,
  };
  const seconds = intervalSeconds[interval] || 3600;
  const end = Math.floor(Date.now() / 1000);
  const start = end - (limit * seconds);

  const json = await mexcFetch(`kline/${symbol}`, {
    interval: mexcInterval,
    start: String(start),
    end: String(end),
  });

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
  const json = await mexcFetch('ticker', { symbol });
  return json.data.lastPrice;
}

export async function fetch24hStats(symbol = 'BTC_USDT') {
  const json = await mexcFetch('ticker', { symbol });
  const d = json.data;
  return {
    priceChangePercent: String((d.riseFallRate || 0) * 100),
    volume: String(d.amount24 || 0),
    highPrice: String(d.high24Price || 0),
    lowPrice: String(d.lower24Price || 0),
    lastPrice: String(d.lastPrice || 0),
  };
}
