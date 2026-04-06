import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { fetchKlines, fetch24hStats } from '@/lib/binance';
import { calculateAllIndicators } from '@/lib/indicators';
import { calculateProjection, analyzeSignals } from '@/lib/forecast';
import { runStrategy, getDailyATR } from '@/lib/strategy';
import PriceChart from '@/components/trading/PriceChart';
import IndicatorPanels from '@/components/trading/IndicatorPanels';
import SignalDashboard from '@/components/trading/SignalDashboard';
import StrategyPanel from '@/components/trading/StrategyPanel';
import PositionSizeCalculator from '@/components/trading/PositionSizeCalculator';
import BotDashboard from '@/components/trading/BotDashboard';

const INTERVALS = [
  { value: '15m', label: '15m', projPeriods: 96 },
  { value: '1h', label: '1H', projPeriods: 168 },
  { value: '4h', label: '4H', projPeriods: 180 },
  { value: '1d', label: '1D', projPeriods: 180 },
  { value: '1w', label: '1W', projPeriods: 52 },
];

type View = 'analysis' | 'bot';

export default function Index() {
  const [interval, setInterval] = useState('1h');
  const [view, setView] = useState<View>('bot');
  const [activeSymbol, setActiveSymbol] = useState('BTC_USDT');
  const projPeriods = INTERVALS.find(i => i.value === interval)?.projPeriods ?? 72;

  const symbolLabel = activeSymbol.replace('_USDT', '');

  const { data: klines, isLoading, error } = useQuery({
    queryKey: ['klines', activeSymbol, interval],
    queryFn: () => fetchKlines(activeSymbol, interval, 500),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const { data: stats } = useQuery({
    queryKey: ['stats', activeSymbol],
    queryFn: () => fetch24hStats(activeSymbol),
    refetchInterval: 10000,
  });

  // Multi-timeframe data
  const { data: h1Klines } = useQuery({
    queryKey: ['klines', activeSymbol, '1h', 'strategy'],
    queryFn: () => fetchKlines(activeSymbol, '1h', 300),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const { data: m5Klines } = useQuery({
    queryKey: ['klines', activeSymbol, '5m', 'strategy'],
    queryFn: () => fetchKlines(activeSymbol, '5m', 300),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const { data: m15Klines } = useQuery({
    queryKey: ['klines', activeSymbol, '15m', 'projection'],
    queryFn: () => fetchKlines(activeSymbol, '15m', 300),
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const { data: h4Klines } = useQuery({
    queryKey: ['klines', activeSymbol, '4h', 'projection'],
    queryFn: () => fetchKlines(activeSymbol, '4h', 300),
    refetchInterval: 120000,
    staleTime: 60000,
  });

  const { data: dailyKlines } = useQuery({
    queryKey: ['klines', activeSymbol, '1d', 'strategy'],
    queryFn: () => fetchKlines(activeSymbol, '1d', 30),
    refetchInterval: 300000,
    staleTime: 60000,
  });

  const indicators = useMemo(() => {
    if (!klines || klines.length < 200) return null;
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const volumes = klines.map(k => k.volume);
    return calculateAllIndicators(closes, highs, lows, volumes);
  }, [klines]);

  const projection = useMemo(() => {
    if (!klines) return null;
    return calculateProjection(klines, projPeriods, {
      m15: m15Klines ?? undefined,
      h1: h1Klines ?? undefined,
      h4: h4Klines ?? undefined,
      d1: dailyKlines ?? undefined,
    });
  }, [klines, projPeriods, m15Klines, h1Klines, h4Klines, dailyKlines]);

  const signalAnalysis = useMemo(() => {
    if (!indicators || !klines) return null;
    return analyzeSignals(indicators, klines.map(k => k.close));
  }, [indicators, klines]);

  const strategyResult = useMemo(() => {
    if (!h1Klines || !m5Klines || !dailyKlines) return null;
    if (h1Klines.length < 200 || m5Klines.length < 60 || dailyKlines.length < 15) return null;
    return runStrategy(h1Klines, m5Klines, dailyKlines);
  }, [h1Klines, m5Klines, dailyKlines]);

  const dailyATR = useMemo(() => {
    if (!dailyKlines || dailyKlines.length < 15) return 0;
    return getDailyATR(dailyKlines);
  }, [dailyKlines]);

  const currentPrice = klines?.[klines.length - 1]?.close;
  const priceChange = stats ? parseFloat(stats.priceChangePercent) : 0;
  const volume24h = stats ? parseFloat(stats.volume) : 0;
  const high24h = stats ? parseFloat(stats.highPrice) : 0;
  const low24h = stats ? parseFloat(stats.lowPrice) : 0;

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-bearish font-mono text-center">
          <p className="text-xl font-bold">Błąd połączenia z MEXC API</p>
          <p className="text-sm text-muted-foreground mt-2">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

  const IntervalSelector = () => (
    <div className="flex rounded-md border border-border overflow-hidden">
      {INTERVALS.map(int => (
        <button
          key={int.value}
          onClick={() => setInterval(int.value)}
          className={`px-3 py-1.5 text-xs font-mono font-semibold transition-colors ${
            interval === int.value
              ? 'bg-primary text-primary-foreground'
              : 'bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          {int.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen p-3 md:p-4 max-w-[1800px] mx-auto space-y-4">
      {/* Header */}
      <motion.header
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-3 border-b border-border"
      >
        <div className="flex items-center gap-4">
          <div>
            <h1 className="text-xl font-bold font-mono tracking-tight flex items-center gap-2">
              <span className="text-primary">₿</span> {symbolLabel}/USDT
              {isLoading && (
                <span className="inline-block w-2 h-2 bg-warning rounded-full animate-pulse-glow" />
              )}
            </h1>
            <div className="flex items-center gap-3 mt-1">
              {currentPrice && (
                <span className="text-2xl font-mono font-bold text-foreground">
                  ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
              {priceChange !== 0 && (
                <span className={`text-sm font-mono font-bold ${priceChange >= 0 ? 'text-bullish' : 'text-bearish'}`}>
                  {priceChange >= 0 ? '+' : ''}{priceChange.toFixed(2)}%
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* 24h stats */}
          <div className="hidden md:flex items-center gap-4 text-xs font-mono text-muted-foreground">
            <div>
              <span className="block text-[10px] uppercase tracking-wider">24h High</span>
              <span className="text-foreground">${high24h.toLocaleString()}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider">24h Low</span>
              <span className="text-foreground">${low24h.toLocaleString()}</span>
            </div>
            <div>
              <span className="block text-[10px] uppercase tracking-wider">24h Vol</span>
              <span className="text-foreground">{volume24h.toLocaleString('en-US', { maximumFractionDigits: 0 })} BTC</span>
            </div>
          </div>
        </div>
      </motion.header>

      <BotDashboard onSymbolChange={setActiveSymbol} />

      <div className="text-center text-[10px] font-mono text-muted-foreground py-4 border-t border-border">
        Dane z MEXC Futures API • Odświeżanie co 30s • Multi-Timeframe Strategy (H1 + M15) •
        <span className="text-warning"> Nie stanowi porady inwestycyjnej • Paper Trading — bez prawdziwych pieniędzy</span>
      </div>
    </div>
  );
}
