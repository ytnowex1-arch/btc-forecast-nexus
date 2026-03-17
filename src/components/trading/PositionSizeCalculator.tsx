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
  const [side, setSide] = useState<'LONG' | 'SHORT'>('LONG');

  const result = useMemo(
    () => calculatePositionSize(balance, riskPct, currentPrice, dailyATR, side),
    [balance, riskPct, currentPrice, dailyATR, side]
  );

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-lg border border-border bg-card p-4 space-y-3"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-muted-foreground">
          🧮 Kalkulator Pozycji
        </h3>
        <div className="flex gap-1 bg-muted p-0.5 rounded-md">
           <button 
             onClick={() => setSide('LONG')}
             className={`px-2 py-0.5 text-[10px] rounded ${side === 'LONG' ? 'bg-bullish text-white' : ''}`}
           >LONG</button>
           <button 
             onClick={() => setSide('SHORT')}
             className={`px-2 py-0.5 text-[10px] rounded ${side === 'SHORT' ? 'bg-bearish text-white' : ''}`}
           >SHORT</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider block mb-1">
            Saldo ($)
          </label>
          <input
            type="number"
            value={balance}
            onChange={e => setBalance(Number(e.target.value))}
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono"
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
            className="w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm font-mono"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <ResultCard 
          label="Rozmiar pozycji" 
          value={result?.positionSize?.toFixed(4) || "0.0000"} 
          sub="Units" 
        />
        <ResultCard 
          label="Stop Loss Price" 
          value={result?.slPrice?.toFixed(2) || "0.00"} 
          sub={`Dystans: ${result?.slDistance?.toFixed(2)}`} 
        />
        <ResultCard 
          label="Zagrożona kwota" 
          value={`$${result?.riskAmount?.toFixed(2) || "0.00"}`} 
          sub={`${riskPct}% salda`} 
        />
        <ResultCard 
          label="R:R 1:2 Cel" 
          value={side === 'LONG' 
            ? (currentPrice + (result?.slDistance * 2)).toFixed(2) 
            : (currentPrice - (result?.slDistance * 2)).toFixed(2)
          } 
          sub="Take Profit" 
        />
      </div>

      <div className="pt-2 border-t border-border">
        <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider mb-2">
          Szacowane ryzyko pips
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-md bg-muted/30 p-2">
            <div className="text-xs font-mono text-muted-foreground">SL = 30 pips</div>
            <div className="text-sm font-mono font-bold text-warning">
              ${result?.risk30pips?.toFixed(2) || "0.00"}
            </div>
          </div>
          <div className="rounded-md bg-muted/30 p-2">
            <div className="text-xs font-mono text-muted-foreground">SL = 100 pips</div>
            <div className="text-sm font-mono font-bold text-bearish">
              ${result?.risk100pips?.toFixed(2) || "0.00"}
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
      <div className="text-[10px] font-mono text-muted-foreground uppercase">{label}</div>
      <div className="text-sm font-mono font-bold truncate">{value}</div>
      {sub && <div className="text-[10px] font-mono text-muted-foreground">{sub}</div>}
    </div>
  );
}

