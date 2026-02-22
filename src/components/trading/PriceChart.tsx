import { useEffect, useRef, useMemo } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries, type IChartApi } from 'lightweight-charts';
import type { Kline } from '@/lib/binance';
import type { Projection } from '@/lib/forecast';

interface PriceChartProps {
  klines: Kline[];
  projection: Projection;
}

export default function PriceChart({ klines, projection }: PriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  const candleData = useMemo(() =>
    klines.map(k => ({
      time: k.time as any,
      open: k.open,
      high: k.high,
      low: k.low,
      close: k.close,
    })), [klines]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0e14' },
        textColor: '#6b7280',
        fontFamily: 'JetBrains Mono, monospace',
      },
      grid: {
        vertLines: { color: 'rgba(31,41,55,0.5)' },
        horzLines: { color: 'rgba(31,41,55,0.5)' },
      },
      width: chartContainerRef.current.clientWidth,
      height: 500,
      timeScale: { timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: 'rgba(59,130,246,0.3)' },
        horzLine: { color: 'rgba(59,130,246,0.3)' },
      },
      rightPriceScale: { borderColor: '#1f2937' },
    });
    chartRef.current = chart;

    // Candlestick only
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candle.setData(candleData);

    // Projections
    const bull = chart.addSeries(LineSeries, { color: 'rgba(34,197,94,0.6)', lineWidth: 2, lineStyle: 2, title: 'Bull' });
    bull.setData(projection.bullCase.map(p => ({ time: p.time as any, value: p.value })));

    const base = chart.addSeries(LineSeries, { color: 'rgba(156,163,175,0.6)', lineWidth: 2, lineStyle: 2, title: 'Base' });
    base.setData(projection.baseCase.map(p => ({ time: p.time as any, value: p.value })));

    const bear = chart.addSeries(LineSeries, { color: 'rgba(239,68,68,0.6)', lineWidth: 2, lineStyle: 2, title: 'Bear' });
    bear.setData(projection.bearCase.map(p => ({ time: p.time as any, value: p.value })));

    chart.timeScale().fitContent();

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({ width: chartContainerRef.current.clientWidth });
      }
    };
    window.addEventListener('resize', handleResize);
    return () => { window.removeEventListener('resize', handleResize); chart.remove(); };
  }, [candleData, projection]);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-end px-4 py-2 border-b border-border">
        <div className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
          <span className="text-bullish">--- Bull</span>
          <span className="text-neutral">--- Base</span>
          <span className="text-bearish">--- Bear</span>
        </div>
      </div>
      <div ref={chartContainerRef} />
    </div>
  );
}
