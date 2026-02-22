import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { fetchKlines, fetch24hStats } from '@/lib/binance';
import { calculateAllIndicators } from '@/lib/indicators';
import { calculateProjection, analyzeSignals } from '@/lib/forecast';
import PriceChart from '@/components/trading/PriceChart';
import IndicatorPanels from '@/components/trading/IndicatorPanels';
import SignalDashboard from '@/components/trading/SignalDashboard';

const INTERVALS = [
  { value: '15m', label: '15m', projPeriods: 96 },
  { value: '1h', label: '1H', projPeriods: 168 },
  { value: '4h', label: '4H', projPeriods: 180 },
  { value: '1d', label: '1D', projPeriods: 180 },
  { value: '1w', label: '1W', projPeriods: 52 },
];

export default function Index() {
  const [interval, setInterval] = useState('1h');
  const projPeriods = INTERVALS.find(i => i.value === interval)?.projPeriods ?? 72;

  const { data: klines, isLoading, error } = useQuery({
    queryKey: ['klines', interval],
    queryFn: () => fetchKlines('BTCUSDT', interval, 500),
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: () => fetch24hStats('BTCUSDT'),
    refetchInterval: 10000,
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
    return calculateProjection(klines, projPeriods);
  }, [klines, projPeriods]);

  const signalAnalysis = useMemo(() => {
    if (!indicators || !klines) return null;
    return analyzeSignals(indicators, klines.map(k => k.close));
  }, [indicators, klines]);

  const currentPrice = klines?.[klines.length - 1]?.close;
  const priceChange = stats ? parseFloat(stats.priceChangePercent) : 0;
  const volume24h = stats ? parseFloat(stats.volume) : 0;
  const high24h = stats ? parseFloat(stats.highPrice) : 0;
  const low24h = stats ? parseFloat(stats.lowPrice) : 0;

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-bearish font-mono text-center">
          <p className="text-xl font-bold">Błąd połączenia z Binance API</p>
          <p className="text-sm text-muted-foreground mt-2">{(error as Error).message}</p>
        </div>
      </div>
    );
  }

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
              <span className="text-primary">₿</span> BTC/USDT
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
              <span className="text-foreground">{(volume24h).toLocaleString('en-US', { maximumFractionDigits: 0 })} BTC</span>
            </div>
          </div>

          {/* Interval selector */}
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
        </div>
      </motion.header>

      {isLoading || !klines || !indicators || !projection || !signalAnalysis ? (
        <div className="flex items-center justify-center h-[400px]">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            <span className="text-sm font-mono text-muted-foreground">Ładowanie danych z Binance...</span>
          </div>
        </div>
      ) : (
        <>
          {/* Signal Dashboard */}
          <SignalDashboard
            signals={signalAnalysis.signals}
            confidence={signalAnalysis.confidence}
            bias={signalAnalysis.bias}
          />

          {/* Price Chart */}
          <PriceChart
            klines={klines}
            indicators={indicators}
            projection={projection}
          />

          {/* Indicator Panels */}
          <IndicatorPanels klines={klines} indicators={indicators} />

          {/* Footer */}
          <div className="text-center text-[10px] font-mono text-muted-foreground py-4 border-t border-border">
            Dane z Binance API • Odświeżanie co 30s • Projekcje oparte na regresji liniowej + Bollinger Bands •
            <span className="text-warning"> Nie stanowi porady inwestycyjnej</span>
          </div>
        </>
      )}
    </div>
  );
}
