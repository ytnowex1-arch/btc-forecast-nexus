import { useEffect, useRef, useMemo } from 'react';
import { createChart, ColorType, CandlestickSeries, LineSeries, type IChartApi } from 'lightweight-charts';
import type { Kline } from '@/lib/binance';
import type { IndicatorResults } from '@/lib/indicators';
import type { Projection } from '@/lib/forecast';

interface PriceChartProps {
  klines: Kline[];
  indicators: IndicatorResults;
  projection: Projection;
}

export default function PriceChart({ klines, indicators, projection }: PriceChartProps) {
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

  const makeLineData = (values: number[]) =>
    values.map((v, i) => ({ time: klines[i].time as any, value: v }))
      .filter(d => !isNaN(d.value));

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

    // Candlestick
    const candle = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    });
    candle.setData(candleData);

    // EMA 50
    const ema50 = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, title: 'EMA50' });
    ema50.setData(makeLineData(indicators.ema50));

    // EMA 200
    const ema200 = chart.addSeries(LineSeries, { color: '#8b5cf6', lineWidth: 1, title: 'EMA200' });
    ema200.setData(makeLineData(indicators.ema200));

    // Bollinger upper
    const bbUp = chart.addSeries(LineSeries, { color: 'rgba(59,130,246,0.4)', lineWidth: 1, lineStyle: 2 });
    bbUp.setData(makeLineData(indicators.bollingerBands.upper));

    // Bollinger lower
    const bbLow = chart.addSeries(LineSeries, { color: 'rgba(59,130,246,0.4)', lineWidth: 1, lineStyle: 2 });
    bbLow.setData(makeLineData(indicators.bollingerBands.lower));

    // VWAP
    const vwap = chart.addSeries(LineSeries, { color: 'rgba(236,72,153,0.5)', lineWidth: 1, title: 'VWAP' });
    vwap.setData(makeLineData(indicators.vwap));

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candleData, projection, indicators]);

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border">
        <div className="flex items-center gap-4">
          <span className="text-xs font-mono text-muted-foreground">
            <span className="inline-block w-3 h-0.5 bg-[#f59e0b] mr-1 align-middle" />EMA50
            <span className="inline-block w-3 h-0.5 bg-[#8b5cf6] mr-1 ml-3 align-middle" />EMA200
            <span className="inline-block w-3 h-0.5 bg-primary/40 mr-1 ml-3 align-middle" />BB
            <span className="inline-block w-3 h-0.5 bg-[#ec4899]/50 mr-1 ml-3 align-middle" />VWAP
          </span>
        </div>
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
