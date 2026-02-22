import { motion } from 'framer-motion';
import type { StrategyResult } from '@/lib/strategy';

interface Props {
  strategy: StrategyResult;
}

export default function StrategyPanel({ strategy }: Props) {
  const { h1Trend, adrAnalysis, pullback, m5Signal, overallLabel } = strategy;

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
        📡 Status Strategii — Multi-Timeframe
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* H1 Trend */}
        <div className="rounded-md border border-border p-3 space-y-1">
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Trend H1</div>
          <div className={`text-lg font-mono font-bold ${
            h1Trend.trend === 'Bullish' ? 'text-bullish' : 'text-bearish'
          }`}>
            {h1Trend.trend === 'Bullish' ? '↑ UP' : '↓ DOWN'}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">
            EMA50: ${h1Trend.ema50.toFixed(0)} | EMA200: ${h1Trend.ema200.toFixed(0)}
          </div>
        </div>

        {/* ADR Usage */}
        <div className="rounded-md border border-border p-3 space-y-1">
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Zakres Dzienny</div>
          <div className={`text-lg font-mono font-bold ${
            adrAnalysis.status === 'Warning' ? 'text-bearish' :
            adrAnalysis.status === 'Extended' ? 'text-warning' : 'text-foreground'
          }`}>
            {adrAnalysis.adrUsedPct.toFixed(0)}% ADR
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">
            Ruch: ${adrAnalysis.currentDailyMove.toFixed(0)} / ADR: ${adrAnalysis.adr.toFixed(0)}
          </div>
          {adrAnalysis.status !== 'Normal' && (
            <div className={`text-[10px] font-mono font-semibold mt-1 ${
              adrAnalysis.status === 'Warning' ? 'text-bearish' : 'text-warning'
            }`}>
              ⚠ {adrAnalysis.statusLabel}
            </div>
          )}
        </div>

        {/* Signal */}
        <div className="rounded-md border border-border p-3 space-y-1">
          <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Sygnał</div>
          <div className={`text-lg font-mono font-bold ${
            m5Signal === 'BUY' ? 'text-bullish' :
            m5Signal === 'SELL' ? 'text-bearish' : 'text-muted-foreground'
          }`}>
            {m5Signal === 'BUY' ? '🟢 BUY' : m5Signal === 'SELL' ? '🔴 SELL' : '⏳ WAIT'}
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">
            {pullback.active ? pullback.label : 'Czekaj na pullback'}
          </div>
        </div>
      </div>

      {/* Overall */}
      <div className={`text-center text-sm font-mono font-bold py-2 rounded-md ${
        m5Signal === 'BUY' ? 'bg-bullish/10 text-bullish' :
        m5Signal === 'SELL' ? 'bg-bearish/10 text-bearish' :
        'bg-muted text-muted-foreground'
      }`}>
        {overallLabel}
      </div>
    </motion.div>
  );
}
