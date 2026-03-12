import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Konfiguracja etykiet dla symboli
const SYMBOL_LABELS = {
  BTCUSDT: 'BTC',
  ETHUSDT: 'ETH',
};

export default function App() {
  const [configs, setConfigs] = useState([]);
  const [activeSymbol, setActiveSymbol] = useState('BTCUSDT');
  const [positions, setPositions] = useState([]);
  const [trades, setTrades] = useState([]);
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState('positions');
  const [showConfig, setShowConfig] = useState(false);
  const [editConfig, setEditConfig] = useState({ leverage: 5, position_size_pct: 10, stop_loss_pct: 3, take_profit_pct: 6 });
  const [prices, setPrices] = useState({});

  const config = configs.find(c => c.symbol === activeSymbol) || null;
  const currentPrice = prices[activeSymbol] || null;

  // Pobieranie cen z Binance
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const symbols = ['BTCUSDT', 'ETHUSDT'];
        const results = await Promise.all(
          symbols.map(s => fetch(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${s}`).then(r => r.json()))
        );
        const newPrices = {};
        symbols.forEach((s, i) => { newPrices[s] = parseFloat(results[i].price); });
        setPrices(newPrices);
      } catch (e) { /* ignore */ }
    };
    fetchPrices();
    const iv = setInterval(fetchPrices, 2000);
    return () => clearInterval(iv);
  }, []);

  const callBot = useCallback(async (body) => {
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/trading-bot`,
      {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${anonKey}`,
          'apikey': anonKey,
        },
        ...(body && { body: JSON.stringify(body) }),
      }
    );
    return res.json();
  }, []);

  const fetchConfigs = useCallback(async () => {
    try {
      const data = await callBot({ action: 'list_configs' });
      if (data.configs) setConfigs(data.configs);
    } catch (e) { console.error(e); }
  }, [callBot]);

  const fetchStatus = useCallback(async () => {
    if (!config) return;
    try {
      const data = await callBot({ action: 'status', config_id: config.id });
      if (data.config) setConfigs(prev => prev.map(c => c.id === data.config.id ? data.config : c));
      if (data.positions) setPositions(data.positions);
      if (data.trades) setTrades(data.trades);
      if (data.logs) setLogs(data.logs);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, [callBot, config]);

  useEffect(() => {
    fetchConfigs().then(() => setLoading(false));
  }, [fetchConfigs]);

  useEffect(() => {
    if (!config) return;
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus, config]);

  const toggleBot = async () => {
    if (!config) return;
    setExecuting(true);
    await callBot({ action: 'toggle', config_id: config.id });
    await fetchStatus();
    setExecuting(false);
  };

  const runOnce = async () => {
    if (!config) return;
    setExecuting(true);
    const data = await callBot({ action: 'run', config_id: config.id });
    if (data.positions) setPositions(data.positions);
    if (data.logs) setLogs(data.logs);
    setExecuting(false);
  };

  const saveConfig = async () => {
    if (!config) return;
    setExecuting(true);
    await callBot({ action: 'update_config', config_id: config.id, ...editConfig });
    await fetchStatus();
    setExecuting(false);
    setShowConfig(false);
  };

  if (loading) return <div className="p-8 text-center font-mono">Ładowanie...</div>;

  const openPositions = positions.filter(p => p.status === 'open');

  return (
    <div className="max-w-4xl mx-auto p-4 space-y-6 font-mono">
      {/* Przełącznik symboli */}
      <div className="flex gap-2">
        {configs.map(c => (
          <button key={c.id} onClick={() => setActiveSymbol(c.symbol)} className={`px-4 py-2 text-xs border ${activeSymbol === c.symbol ? 'bg-primary text-white' : 'bg-card'}`}>
            {SYMBOL_LABELS[c.symbol] || c.symbol}
          </button>
        ))}
      </div>

      {/* Kontrolki bota */}
      <div className="p-4 border bg-card rounded-lg flex justify-between items-center">
        <div>
          <h2 className="font-bold">{SYMBOL_LABELS[activeSymbol]} Bot</h2>
          <p className="text-[10px] text-muted-foreground uppercase">{config?.is_active ? '● Aktywny' : '○ Zatrzymany'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={runOnce} disabled={executing} className="px-3 py-1.5 text-xs bg-blue-500/20 text-blue-500 rounded">
            {executing ? '...' : 'Wykonaj raz'}
          </button>
          <button onClick={toggleBot} className={`px-3 py-1.5 text-xs rounded ${config?.is_active ? 'bg-red-500/20 text-red-500' : 'bg-green-500/20 text-green-500'}`}>
            {config?.is_active ? 'Stop' : 'Start'}
          </button>
        </div>
      </div>

      {/* Pozycje */}
      {openPositions.map(pos => {
        const entry = Number(pos.entry_price);
        const sl = Number(pos.stop_loss);
        const qty = Number(pos.quantity);
        const margin = Number(pos.margin_used);
        const uPnl = currentPrice ? (pos.side === 'long' ? (currentPrice - entry) * qty : (entry - currentPrice) * qty) : 0;
        const roiPct = (uPnl / margin) * 100;

        // Logika Trailingu: Napis pojawia się, gdy SL jest powyżej wejścia (dla Longa)
        const slMoved = pos.side === 'long' ? (sl > entry) : (sl < entry);

        return (
          <div key={pos.id} className="p-4 border-2 border-primary/50 rounded-lg space-y-4 bg-card">
            <div className="flex justify-between items-center">
              <span className="font-bold">{activeSymbol} {pos.side.toUpperCase()}</span>
              <div className="text-right">
                <div className={`text-lg font-bold ${uPnl >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                  {uPnl >= 0 ? '+' : ''}{uPnl.toFixed(2)} USDT
                </div>
                <div className="text-xs font-bold">ROI: {roiPct.toFixed(2)}%</div>
              </div>
            </div>

            <div className="flex justify-between text-[10px] text-muted-foreground border-t pt-2">
              <span>Entry: ${entry.toFixed(2)}</span>
              <span>Mark: ${currentPrice?.toFixed(2)}</span>
              {slMoved && <span className="text-orange-500 font-bold animate-pulse">🔒 TRAILING</span>}
            </div>
            
            <div className="text-[10px] flex justify-between">
              <span className="text-red-400">SL: ${sl.toFixed(2)}</span>
              <span className="text-green-400">TP: ${Number(pos.take_profit).toFixed(2)}</span>
            </div>
          </div>
        );
      })}

      {/* Tabela logów */}
      <div className="border rounded-lg overflow-hidden">
        <div className="bg-muted p-2 text-[10px] font-bold border-b">LOGI SYSTEMOWE</div>
        <div className="max-h-40 overflow-y-auto p-2 space-y-1 bg-black/5">
          {logs.slice(0, 10).map(l => (
            <div key={l.id} className="text-[10px] flex gap-2">
              <span className="text-muted-foreground">[{new Date(l.created_at).toLocaleTimeString()}]</span>
              <span className={l.message.includes('TRAIL') ? 'text-orange-500' : ''}>{l.message}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

         <button onClick={runOnce} disabled={executing} className="px-3 py-1.5 text-xs font-mono rounded-md bg-primary/20 text-primary">▶ Wykonaj raz</button>
          <button onClick={toggleBot} disabled={executing} className={`px-3 py-1.5 text-xs font-mono rounded-md ${config?.is_active ? 'bg-bearish/20 text-bearish' : 'bg-bullish/20 text-bullish'}`}>{config?.is_active ? '⏸ Stop' : '▶ Start'}</button>
          <button onClick={() => setShowConfig(!showConfig)} className="px-3 py-1.5 text-xs font-mono rounded-md bg-muted text-muted-foreground">⚙ Config</button>
        </div>
      </div>

      <AnimatePresence>
        {showConfig && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden bg-card border border-border rounded-lg p-4 space-y-3">
             <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <ConfigInput label="Leverage" value={editConfig.leverage} suffix="x" onChange={v => setEditConfig(p => ({ ...p, leverage: v }))} />
                <ConfigInput label="Stop Loss" value={editConfig.stop_loss_pct} suffix="%" onChange={v => setEditConfig(p => ({ ...p, stop_loss_pct: v }))} />
             </div>
             <button onClick={saveConfig} className="w-full py-2 bg-primary/20 text-primary rounded text-xs font-mono">Zapisz</button>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Equity" value={`$${equity.toFixed(2)}`} />
        <StatCard label="P&L (total)" value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`} sub={`${totalPnlPct.toFixed(2)}%`} color={totalPnl >= 0 ? 'bullish' : 'bearish'} />
        <StatCard label="Otwarte" value={String(openPositions.length)} />
        <StatCard label="Transakcje" value={String(trades.length)} />
      </div>

      {openPositions.map(pos => {
        const entry = Number(pos.entry_price);
        const sl = Number(pos.stop_loss);
        const tp = Number(pos.take_profit);
        const qty = Number(pos.quantity);
        const margin = Number(pos.margin_used);
        
        // JEDYNA ZMIANA: Logika wykrywania przesunięcia Trailingu 
        // Napis pojawi się, gdy SL jest lepszy niż cena wejścia (dla Longa wyższy, dla Shorta niższy)
        const slMoved = pos.side === 'long' ? (sl > entry) : (sl < entry);

        const uPnl = currentPrice ? (pos.side === 'long' ? (currentPrice - entry) * qty : (entry - currentPrice) * qty) : 0;
        const roiPct = margin > 0 ? (uPnl / margin) * 100 : 0;

        return (
          <div key={pos.id} className="rounded-lg border border-primary/30 bg-card p-4 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-sm">{activeSymbol}</span>
                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${pos.side === 'long' ? 'bg-bullish/20 text-bullish' : 'bg-bearish/20 text-bearish'}`}>{pos.side.toUpperCase()}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground">{pos.leverage}X</span>
              </div>
              <div className="text-right">
                <div className={`text-lg font-mono font-bold ${uPnl >= 0 ? 'text-bullish' : 'text-bearish'}`}>{uPnl >= 0 ? '+' : ''}{uPnl.toFixed(4)}</div>
                <div className={`text-xs font-mono font-bold ${roiPct >= 0 ? 'text-bullish' : 'text-bearish'}`}>({roiPct.toFixed(2)}%)</div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 text-xs font-mono">
              <div><div className="text-muted-foreground text-[10px]">Entry Price</div><div className="font-semibold">{entry.toLocaleString()}</div></div>
              <div><div className="text-muted-foreground text-[10px]">Mark Price</div><div className="font-semibold">{currentPrice?.toLocaleString() || '—'}</div></div>
              <div className="text-right"><div className="text-muted-foreground text-[10px]">Margin (USDT)</div><div className="font-semibold">{margin.toFixed(2)}</div></div>
            </div>

            <div className="space-y-1">
              <div className="relative h-6 rounded-md bg-muted/30 border border-border overflow-hidden">
                {(() => {
                  const barMin = Math.min(sl, entry, tp);
                  const barMax = Math.max(sl, entry, tp);
                  const barRange = barMax - barMin || 1;
                  const getPos = (v) => ((v - barMin) / barRange) * 100;
                  return (
                    <>
                      <div className="absolute top-0 h-full w-0.5 bg-bearish" style={{ left: `${getPos(sl)}%` }} />
                      <div className="absolute top-0 h-full w-0.5 bg-foreground/50" style={{ left: `${getPos(entry)}%` }} />
                      <div className="absolute top-0 h-full w-0.5 bg-bullish" style={{ left: `${getPos(tp)}%` }} />
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center justify-between text-[10px] font-mono">
                <span className="text-bearish">SL: ${sl.toFixed(0)}</span>
                <div className="flex items-center gap-1">
                  <span className="text-muted-foreground">Entry: ${entry.toFixed(0)}</span>
                  {slMoved && <span className="text-warning animate-pulse">🔒 Trailing</span>}
                </div>
                <span className="text-bullish">TP: ${tp.toFixed(0)}</span>
              </div>
            </div>
          </div>
        );
      })}

      <div className="flex border-b border-border">
        {['positions', 'trades', 'logs'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab as any)}
            className={`px-4 py-2 text-xs font-mono font-semibold transition-colors border-b-2 ${activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground'}`}>
            {tab === 'positions' ? 'Pozycje' : tab === 'trades' ? 'Historia' : 'Logi'}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <div className="max-h-[300px] overflow-y-auto">
          {activeTab === 'logs' ? (
            <div className="p-3 space-y-1">
              {logs.map(log => (
                <div key={log.id} className="text-xs font-mono flex gap-2">
                  <span className="text-muted-foreground">{new Date(log.created_at).toLocaleTimeString()}</span>
                  <span className={log.message.includes('TRAIL') ? 'text-warning font-bold' : 'text-muted-foreground'}>{log.message}</span>
                </div>
              ))}
            </div>
          ) : (
            <table className="w-full text-xs font-mono">
               <tbody className="divide-y divide-border">
                  {activeTab === 'positions' && positions.map(pos => (
                    <tr key={pos.id} className="hover:bg-muted/20">
                      <td className={`p-2 font-bold ${pos.side === 'long' ? 'text-bullish' : 'text-bearish'}`}>{pos.side.toUpperCase()}</td>
                      <td className="text-right p-2">${Number(pos.entry_price).toFixed(2)}</td>
                      <td className={`text-right p-2 font-bold ${pos.pnl && pos.pnl > 0 ? 'text-bullish' : 'text-bearish'}`}>{pos.pnl ? `$${pos.pnl.toFixed(2)}` : '—'}</td>
                      <td className="text-right p-2 text-muted-foreground">{new Date(pos.opened_at).toLocaleDateString()}</td>
                    </tr>
                  ))}
               </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] font-mono text-muted-foreground uppercase">{label}</div>
      <div className={`text-lg font-mono font-bold mt-1 ${color === 'bullish' ? 'text-bullish' : color === 'bearish' ? 'text-bearish' : ''}`}>{value}</div>
      {sub && <div className={`text-xs font-mono ${color === 'bullish' ? 'text-bullish' : 'text-bearish'}`}>{sub}</div>}
    </div>
  );
}

function ConfigInput({ label, value, suffix, onChange }: { label: string; value: number; suffix: string; onChange: (v: number) => void; }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-mono text-muted-foreground uppercase">{label}</label>
      <div className="flex items-center gap-1">
        <input type="number" value={value} onChange={e => onChange(Number(e.target.value))} className="w-full bg-muted/50 border border-border rounded px-2 py-1 text-sm font-mono focus:outline-none" />
        <span className="text-xs font-mono text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}

