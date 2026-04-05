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
 * Formatuje symbol na standard MEXC Futures (np. BTC_USDT)
 */
function formatSymbol(symbol: string): string {
  if (!symbol) return 'BTC_USDT';
  const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (clean.includes('_')) return clean;
  if (clean.endsWith('USDT')) {
    return `${clean.slice(0, -4)}_USDT`;
  }
  return `${clean}_USDT`;
}

async function mexcFetch(endpoint: string, params: Record<string, string> = {}): Promise<any> {
  try {
    const qs = new URLSearchParams({ endpoint, ...params });
    const res = await fetch(`${PROXY_URL}?${qs.toString()}`);
    
    if (!res.ok) return { success: false, error: `HTTP ${res.status}` };
    
    const json = await res.json();
    return json;
  } catch (err) {
    return { success: false, error: 'Network error' };
  }
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

  // Endpoint kline wymaga symbolu w ścieżce, co proxy przekazuje dalej
  const json = await mexcFetch(`kline/${formattedSymbol}`, {
    interval: mexcInterval,
    start: String(start),
    end: String(end),
  });

  // Bezpieczne sprawdzanie danych
  if (!json || !json.success || !json.data || !Array.isArray(json.data.time)) {
    console.warn("MEXC Klines data invalid or missing:", json);
    return [];
  }

  const data = json.data;
  const klines: Kline[] = [];
  
  try {
    for (let i = 0; i < data.time.length; i++) {
      klines.push({
        time: Number(data.time[i]),
        open: Number(data.open[i] || 0),
        high: Number(data.high[i] || 0),
        low: Number(data.low[i] || 0),
        close: Number(data.close[i] || 0),
        volume: Number(data.vol[i] || 0),
      });
    }
  } catch (e) {
    console.error("Error parsing klines loop:", e);
  }
  
  return klines;
}

export async function fetchCurrentPrice(symbol = 'BTC_USDT'): Promise<number> {
  const formattedSymbol = formatSymbol(symbol);
  const json = await mexcFetch('ticker', { symbol: formattedSymbol });
  
  // MEXC API V1 dla /ticker zwraca obiekt w data, gdzie jest lastPrice
  if (json && json.success && json.data && json.data.lastPrice !== undefined) {
    return Number(json.data.lastPrice);
  }

  console.warn(`Could not fetch price for ${formattedSymbol}`, json);
  return 0; // Zwracamy 0 zamiast błędu, żeby nie "wywalić" UI
}
