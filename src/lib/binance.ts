const BASE_URL = 'https://data-api.binance.vision/api/v3';

export interface Kline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export async function fetchKlines(
  symbol = 'BTCUSDT',
  interval = '1h',
  limit = 500
): Promise<Kline[]> {
  const res = await fetch(
    `${BASE_URL}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  );
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const data = await res.json();
  return data.map((k: any[]) => ({
    time: Math.floor(k[0] / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

export async function fetchCurrentPrice(symbol = 'BTCUSDT'): Promise<number> {
  const res = await fetch(`${BASE_URL}/ticker/price?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  const data = await res.json();
  return parseFloat(data.price);
}

export async function fetch24hStats(symbol = 'BTCUSDT') {
  const res = await fetch(`${BASE_URL}/ticker/24hr?symbol=${symbol}`);
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`);
  return res.json();
}
