import { useMemo } from 'react';
import {
  ResponsiveContainer, ComposedChart, Line, Bar, Area,
  XAxis, YAxis, Tooltip, ReferenceLine, CartesianGrid,
} from 'recharts';
import type { Kline } from '@/lib/binance';
import type { IndicatorResults } from '@/lib/indicators';

interface Props {
  klines: Kline[];
  indicators: IndicatorResults;
}

const chartCommon = {
  margin: { top: 5, right: 5, bottom: 5, left: 5 },
};

const axisProps = {
  tick: { fontSize: 10, fill: '#6b7280' },
  axisLine: { stroke: '#1f2937' },
  tickLine: false,
};

function formatTime(time: number) {
  const d = new Date(time * 1000);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:00`;
}

function PanelWrapper({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <h3 className="text-xs font-mono text-muted-foreground mb-2 uppercase tracking-wider">{title}</h3>
      <div className="h-[120px]">{children}</div>
    </div>
  );
}

export default function IndicatorPanels({ klines, indicators }: Props) {
  const last100 = useMemo(() => {
    const start = Math.max(0, klines.length - 100);
    return klines.slice(start).map((k, i) => {
      const idx = start + i;
      return {
        time: k.time,
        timeLabel: formatTime(k.time),
        rsi: indicators.rsi[idx],
        macd: indicators.macd.macdLine[idx],
        macdSignal: indicators.macd.signalLine[idx],
        macdHist: indicators.macd.histogram[idx],
        stochK: indicators.stochastic.k[idx],
        stochD: indicators.stochastic.d[idx],
        volume: k.volume,
        close: k.close,
        obv: indicators.obv[idx],
        adx: indicators.adx.adx[idx],
        plusDI: indicators.adx.plusDI[idx],
        minusDI: indicators.adx.minusDI[idx],
        williamsR: indicators.williamsR[idx],
        cmf: indicators.cmf[idx],
        atr: indicators.atr[idx],
      };
    }).filter(d => !isNaN(d.rsi));
  }, [klines, indicators]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
      {/* RSI */}
      <PanelWrapper title="RSI (14)">
        <ResponsiveContainer>
          <ComposedChart data={last100} {...chartCommon}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="timeLabel" {...axisProps} interval={20} hide />
            <YAxis domain={[0, 100]} {...axisProps} width={30} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', fontSize: 11 }} />
            <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" />
            <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="3 3" />
            <Area type="monotone" dataKey="rsi" stroke="#3b82f6" fill="rgba(59,130,246,0.1)" strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </PanelWrapper>

      {/* MACD */}
      <PanelWrapper title="MACD (12,26,9)">
        <ResponsiveContainer>
          <ComposedChart data={last100} {...chartCommon}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="timeLabel" {...axisProps} hide />
            <YAxis {...axisProps} width={40} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#374151" />
            <Bar dataKey="macdHist" fill="#3b82f6" opacity={0.4} />
            <Line type="monotone" dataKey="macd" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="macdSignal" stroke="#f59e0b" strokeWidth={1} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </PanelWrapper>

      {/* Stochastic */}
      <PanelWrapper title="Stochastic (14,3,3)">
        <ResponsiveContainer>
          <ComposedChart data={last100} {...chartCommon}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="timeLabel" {...axisProps} hide />
            <YAxis domain={[0, 100]} {...axisProps} width={30} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', fontSize: 11 }} />
            <ReferenceLine y={80} stroke="#ef4444" strokeDasharray="3 3" />
            <ReferenceLine y={20} stroke="#22c55e" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="stochK" stroke="#3b82f6" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="stochD" stroke="#f59e0b" strokeWidth={1} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </PanelWrapper>

      {/* Volume */}
      <PanelWrapper title="Volume">
        <ResponsiveContainer>
          <ComposedChart data={last100} {...chartCommon}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="timeLabel" {...axisProps} hide />
            <YAxis {...axisProps} width={40} tickFormatter={(v) => `${(v / 1e3).toFixed(0)}k`} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', fontSize: 11 }} />
            <Bar dataKey="volume" fill="rgba(59,130,246,0.4)" />
          </ComposedChart>
        </ResponsiveContainer>
      </PanelWrapper>

      {/* ADX */}
      <PanelWrapper title="ADX (14)">
        <ResponsiveContainer>
          <ComposedChart data={last100} {...chartCommon}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="timeLabel" {...axisProps} hide />
            <YAxis domain={[0, 60]} {...axisProps} width={30} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', fontSize: 11 }} />
            <ReferenceLine y={25} stroke="#374151" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="adx" stroke="#f59e0b" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="plusDI" stroke="#22c55e" strokeWidth={1} dot={false} />
            <Line type="monotone" dataKey="minusDI" stroke="#ef4444" strokeWidth={1} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </PanelWrapper>

      {/* Williams %R */}
      <PanelWrapper title="Williams %R (14)">
        <ResponsiveContainer>
          <ComposedChart data={last100} {...chartCommon}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="timeLabel" {...axisProps} hide />
            <YAxis domain={[-100, 0]} {...axisProps} width={35} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', fontSize: 11 }} />
            <ReferenceLine y={-20} stroke="#ef4444" strokeDasharray="3 3" />
            <ReferenceLine y={-80} stroke="#22c55e" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="williamsR" stroke="#8b5cf6" strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </PanelWrapper>

      {/* CMF */}
      <PanelWrapper title="CMF (20)">
        <ResponsiveContainer>
          <ComposedChart data={last100} {...chartCommon}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="timeLabel" {...axisProps} hide />
            <YAxis {...axisProps} width={40} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', fontSize: 11 }} />
            <ReferenceLine y={0} stroke="#374151" />
            <Area type="monotone" dataKey="cmf" stroke="#ec4899" fill="rgba(236,72,153,0.1)" strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </PanelWrapper>

      {/* ATR */}
      <PanelWrapper title="ATR (14)">
        <ResponsiveContainer>
          <ComposedChart data={last100} {...chartCommon}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="timeLabel" {...axisProps} hide />
            <YAxis {...axisProps} width={40} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', fontSize: 11 }} />
            <Line type="monotone" dataKey="atr" stroke="#14b8a6" strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </PanelWrapper>

      {/* OBV */}
      <PanelWrapper title="OBV">
        <ResponsiveContainer>
          <ComposedChart data={last100} {...chartCommon}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
            <XAxis dataKey="timeLabel" {...axisProps} hide />
            <YAxis {...axisProps} width={50} tickFormatter={(v) => `${(v / 1e6).toFixed(0)}M`} />
            <Tooltip contentStyle={{ background: '#111827', border: '1px solid #1f2937', fontSize: 11 }} />
            <Line type="monotone" dataKey="obv" stroke="#a855f7" strokeWidth={1.5} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </PanelWrapper>
    </div>
  );
}
