import { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { calculatePositionSize } from '@/lib/strategy';

interface Props {
  currentPrice: number;
  dailyATR: number;
}

export default function PositionSizeCalculator({ currentPrice, dailyATR }: Props) {
  const [balance, setBalance] = useState(10000);
  const [riskPct, setRiskPct] = useState(1);

  const result = useMemo(
    () => calculatePositionSize(balance, riskPct, currentPrice, dailyATR),
    [balance, riskPct, currentPrice, dailyATR]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
        🧮 Kalkulator Pozycji
      </h3>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">
            Saldo konta ($)
          </label>
          <input
            type="number"
            value={balance}
            onChange={e => setBalance(Number(e.target.value))}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
        <div>
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">
            Ryzyko (%)
          </label>
          <input
            type="number"
            step="0.1"
            value={riskPct}
            onChange={e => setRiskPct(Number(e.target.value))}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <ResultCard label="Stop Loss (1.5x ATR)" value={`$${result.slDistance.toFixed(0)}`} sub={`SL: $${result.slPrice.toFixed(0)}`} />
        <ResultCard label="Kwota ryzyka" value={`$${result.riskAmount.toFixed(2)}`} sub={`${riskPct}% z $${balance.toLocaleString()}`} />
        <ResultCard label="Rozmiar pozycji" value={`${result.positionSize.toFixed(6)} BTC`} />
        <ResultCard label="ATR dzienny" value={`$${dailyATR.toFixed(0)}`} />
      </div>

      {/* Capital at risk comparison */}
      <div className="rounded-md border border-border p-3">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">
          Kapitał zagrożony przy różnych odległościach SL
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md bg-muted/30 p-2">
            <div className="text-xs font-mono text-muted-foreground">SL = 30 pips</div>
            <div className="text-sm font-mono font-bold text-warning">${result.risk30pips.toFixed(2)}</div>
            <div className="text-[10px] font-mono text-muted-foreground">
              {((result.risk30pips / balance) * 100).toFixed(2)}% konta
            </div>
          </div>
          <div className="rounded-md bg-muted/30 p-2">
            <div className="text-xs font-mono text-muted-foreground">SL = 100 pips</div>
            <div className="text-sm font-mono font-bold text-bearish">${result.risk100pips.toFixed(2)}</div>
            <div className="text-[10px] font-mono text-muted-foreground">
              {((result.risk100pips / balance) * 100).toFixed(2)}% konta
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ResultCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border p-2">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className="text-sm font-mono font-bold text-foreground mt-0.5">{value}</div>
      {sub && <div className="text-[10px] font-mono text-muted-foreground">{sub}</div>}
    </div>
  );
}
