import { motion } from 'framer-motion';
import type { Signal } from '@/lib/forecast';

interface Props {
  signals: Signal[];
  confidence: number;
  bias: 'Bullish' | 'Bearish' | 'Neutral';
}

function SignalCard({ signal, index }: { signal: Signal; index: number }) {
  const colorClass =
    signal.signal === 'buy' ? 'border-bullish/30 glow-bullish' :
    signal.signal === 'sell' ? 'border-bearish/30 glow-bearish' :
    'border-border';

  const labelClass =
    signal.signal === 'buy' ? 'text-bullish' :
    signal.signal === 'sell' ? 'text-bearish' :
    'text-muted-foreground';

  const badgeClass =
    signal.signal === 'buy' ? 'bg-bullish/15 text-bullish' :
    signal.signal === 'sell' ? 'bg-bearish/15 text-bearish' :
    'bg-muted text-muted-foreground';

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className={`rounded-lg border bg-card p-3 ${colorClass}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-mono font-semibold text-foreground">{signal.name}</span>
        <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full ${badgeClass}`}>
          {signal.signal === 'buy' ? 'KUP' : signal.signal === 'sell' ? 'SPRZEDAJ' : 'NEUTRALNY'}
        </span>
      </div>
      <div className={`text-lg font-mono font-bold ${labelClass}`}>{signal.value}</div>
      <div className="text-[10px] font-mono text-muted-foreground mt-1">{signal.description}</div>
    </motion.div>
  );
}

function ConfidenceGauge({ confidence, bias }: { confidence: number; bias: string }) {
  const gaugeColor =
    bias === 'Bullish' ? 'hsl(142,71%,45%)' :
    bias === 'Bearish' ? 'hsl(0,84%,60%)' :
    'hsl(220,9%,55%)';

  const rotation = (confidence / 100) * 180 - 90;

  return (
    <div className="flex flex-col items-center justify-center">
      <svg width="160" height="90" viewBox="0 0 160 90">
        {/* Background arc */}
        <path
          d="M 10 80 A 70 70 0 0 1 150 80"
          fill="none"
          stroke="hsl(220,20%,18%)"
          strokeWidth="8"
          strokeLinecap="round"
        />
        {/* Colored arc */}
        <path
          d="M 10 80 A 70 70 0 0 1 150 80"
          fill="none"
          stroke={gaugeColor}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${(confidence / 100) * 220} 220`}
          style={{ filter: `drop-shadow(0 0 6px ${gaugeColor})` }}
        />
        {/* Needle */}
        <line
          x1="80" y1="80"
          x2={80 + 50 * Math.cos((rotation * Math.PI) / 180)}
          y2={80 - 50 * Math.sin((rotation * Math.PI) / 180)}
          stroke={gaugeColor}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="80" cy="80" r="4" fill={gaugeColor} />
        <text x="10" y="88" fill="#6b7280" fontSize="8" fontFamily="JetBrains Mono">0%</text>
        <text x="138" y="88" fill="#6b7280" fontSize="8" fontFamily="JetBrains Mono">100%</text>
      </svg>
      <div className="text-center mt-2">
        <div className="text-2xl font-mono font-bold" style={{ color: gaugeColor }}>
          {confidence}%
        </div>
        <div className="text-xs font-mono text-muted-foreground">Pewność trendu</div>
      </div>
    </div>
  );
}

export default function SignalDashboard({ signals, confidence, bias }: Props) {
  const biasColor =
    bias === 'Bullish' ? 'text-bullish' :
    bias === 'Bearish' ? 'text-bearish' :
    'text-muted-foreground';

  return (
    <div className="space-y-4">
      {/* Market Bias Header */}
      <div className="flex items-center gap-6 rounded-lg border border-border bg-card p-4">
        <div className="flex-1">
          <div className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-1">
            Market Bias Score
          </div>
          <div className={`text-3xl font-mono font-bold ${biasColor}`}>
            {bias === 'Bullish' ? '↑' : bias === 'Bearish' ? '↓' : '→'} {bias}
          </div>
          <div className="text-xs font-mono text-muted-foreground mt-1">
            Na podstawie {signals.length} wskaźników
          </div>
          <div className="flex gap-3 mt-3">
            <div className="text-xs font-mono">
              <span className="text-bullish font-bold">{signals.filter(s => s.signal === 'buy').length}</span>
              <span className="text-muted-foreground"> kupuj</span>
            </div>
            <div className="text-xs font-mono">
              <span className="text-bearish font-bold">{signals.filter(s => s.signal === 'sell').length}</span>
              <span className="text-muted-foreground"> sprzedaj</span>
            </div>
            <div className="text-xs font-mono">
              <span className="text-neutral font-bold">{signals.filter(s => s.signal === 'neutral').length}</span>
              <span className="text-muted-foreground"> neutralny</span>
            </div>
          </div>
        </div>
        <ConfidenceGauge confidence={confidence} bias={bias} />
      </div>

      {/* Signal Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 gap-2">
        {signals.map((signal, i) => (
          <SignalCard key={signal.name} signal={signal} index={i} />
        ))}
      </div>
    </div>
  );
}
