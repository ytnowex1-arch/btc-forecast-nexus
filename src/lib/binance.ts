// MEXC Futures API client via Supabase proxy
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

/**
 * Konwertuje symbole typu BTCUSDT na format MEXC BTC_USDT
 */
function formatSymbol(symbol: string): string {
  if (symbol.includes('_')) return symbol.toUpperCase();
  // Zakładamy, że najpopularniejsze pary kończą się na USDT
  if (symbol.endsWith('USDT')) {
    return `${symbol.slice(0, -4)}_USDT`.toUpperCase();
  }
  return symbol.toUpperCase();
}

async function mexcFetch(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  const qs = new URLSearchParams({ endpoint, ...params });
  const res = await fetch(`${PROXY_URL}?${qs.toString()}`);
  
  if (!res.ok) throw new Error(`MEXC proxy error: ${res.status}`);
  
  const json = await res.json();
  
  // MEXC zwraca { success: boolean, code: number, data: any }
  if (json.error) throw new Error(json.error);
  if (json.success === false) throw new Error(`MEXC API error code: ${json.code}`);
  
  return json;
}

export async function fetchKlines(
  symbol = 'BTC_USDT',
  interval = '1h',
  limit = 500
): Promise<Kline[]> {
  const formattedSymbol = formatSymbol(symbol);
  const mexcInterval = MEXC_INTERVALS[interval] || 'Min60';
  
  const intervalSeconds: Record<string, number> = {
    '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400, '1w': 604800,
  };
  
  const seconds = intervalSeconds[interval] || 3600;
  const end = Math.floor(Date.now() / 1000);
  const start = end - (limit * seconds);

  // Endpoint dla klines w MEXC to /api/v1/contract/kline/{symbol}
  const json = await mexcFetch(`kline/${formattedSymbol}`, {
    interval: mexcInterval,
    start: String(start),
    end: String(end),
  });

  const data = json.data;
  if (!data || !data.time) return [];

  const klines: Kline[] = [];
  // MEXC zwraca dane w formie obiektów z tablicami: { time: [], open: [], ... }
  for (let i = 0; i < data.time.length; i++) {
    klines.push({
      time: data.time[i],
      open: Number(data.open[i]),
      high: Number(data.high[i]),
      low: Number(data.low[i]),
      close: Number(data.close[i]),
      volume: Number(data.vol[i]),
    });
  }
  
  return klines;
}

export async function fetchCurrentPrice(symbol = 'BTC_USDT'): Promise<number> {
  try {
    const formattedSymbol = formatSymbol(symbol);
    // Endpoint /ticker zwraca dane dla konkretnego symbolu
    const json = await mexcFetch('ticker', { symbol: formattedSymbol });
    
    // Weryfikacja czy lastPrice istnieje (MEXC API v1 returns lastPrice in data)
    if (json.data && json.data.lastPrice !== undefined) {
      return Number(json.data.lastPrice);
    }
    
    throw new Error("Price data missing in response");
  } catch (error) {
    console.error("Error fetching price from MEXC:", error);
    return 0;
  }
}
