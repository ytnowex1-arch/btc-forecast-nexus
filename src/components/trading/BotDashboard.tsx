import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';

interface BotConfig {
  id: string;
  is_active: boolean;
  current_balance: number;
  initial_balance: number;
  leverage: number;
  position_size_pct: number;
  stop_loss_pct: number;
  take_profit_pct: number;
  interval: string;
}

interface Position {
  id: string;
  side: string;
  entry_price: number;
  exit_price: number | null;
  quantity: number;
  leverage: number;
  margin_used: number;
  pnl: number | null;
  pnl_pct: number | null;
  status: string;
  stop_loss: number | null;
  take_profit: number | null;
  entry_reason: string | null;
  exit_reason: string | null;
  opened_at: string;
  closed_at: string | null;
}

interface Trade {
  id: string;
  action: string;
  price: number;
  quantity: number;
  pnl: number | null;
  balance_after: number | null;
  reason: string | null;
  created_at: string;
}

interface LogEntry {
  id: string;
  level: string;
  message: string;
  created_at: string;
}

export default function BotDashboard() {
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState<'positions' | 'trades' | 'logs'>('positions');
  const [showConfig, setShowConfig] = useState(false);
  const [editConfig, setEditConfig] = useState({ leverage: 5, position_size_pct: 10, stop_loss_pct: 3, take_profit_pct: 6 });
  const [currentPrice, setCurrentPrice] = useState<number | null>(null);

  // Fetch current BTC price
  useEffect(() => {
    const fetchPrice = async () => {
      try {
        const res = await fetch('https://data-api.binance.vision/api/v3/ticker/price?symbol=BTCUSDT');
        const data = await res.json();
        setCurrentPrice(parseFloat(data.price));
      } catch (e) { /* ignore */ }
    };
    fetchPrice();
    const iv = setInterval(fetchPrice, 10000);
    return () => clearInterval(iv);
  }, []);

  const callBot = useCallback(async (body?: any) => {
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

  const fetchStatus = useCallback(async () => {
    try {
      const data = await callBot();
      if (data.config) {
        setConfig(data.config);
        setEditConfig({
          leverage: data.config.leverage,
          position_size_pct: data.config.position_size_pct,
          stop_loss_pct: data.config.stop_loss_pct,
          take_profit_pct: data.config.take_profit_pct,
        });
      }
      if (data.positions) setPositions(data.positions);
      if (data.trades) setTrades(data.trades);
      if (data.logs) setLogs(data.logs);
    } catch (e) {
      console.error('Failed to fetch bot status:', e);
    } finally {
      setLoading(false);
    }
  }, [callBot]);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const toggleBot = async () => {
    setExecuting(true);
    await callBot({ action: 'toggle' });
    await fetchStatus();
    setExecuting(false);
  };

  const runOnce = async () => {
    setExecuting(true);
    const data = await callBot({ action: 'run' });
    if (data.config) setConfig(data.config);
    if (data.positions) setPositions(data.positions);
    if (data.trades) setTrades(data.trades);
    if (data.logs) setLogs(data.logs);
    setExecuting(false);
  };

  const resetBot = async () => {
    if (!confirm('Resetować bota? Wszystkie otwarte pozycje zostaną zamknięte.')) return;
    setExecuting(true);
    await callBot({ action: 'reset' });
    await fetchStatus();
    setExecuting(false);
  };

  const saveConfig = async () => {
    const leverage = Math.max(1, Math.min(125, Math.round(editConfig.leverage)));
    const position_size_pct = Math.max(1, Math.min(100, editConfig.position_size_pct));
    const stop_loss_pct = Math.max(0.5, Math.min(50, editConfig.stop_loss_pct));
    const take_profit_pct = Math.max(0.5, Math.min(100, editConfig.take_profit_pct));
    setExecuting(true);
    await callBot({ action: 'update_config', leverage, position_size_pct, stop_loss_pct, take_profit_pct });
    await fetchStatus();
    setExecuting(false);
    setShowConfig(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const openPositions = positions.filter(p => p.status === 'open');

  // Calculate unrealized P&L for open positions
  const unrealizedPnl = openPositions.reduce((sum, pos) => {
    if (!currentPrice) return sum;
    const entry = Number(pos.entry_price);
    const qty = Number(pos.quantity);
    const uPnl = pos.side === 'long'
      ? (currentPrice - entry) * qty
      : (entry - currentPrice) * qty;
    return sum + uPnl;
  }, 0);

  const realizedPnl = config ? config.current_balance - config.initial_balance : 0;
  const totalPnl = realizedPnl + unrealizedPnl;
  const totalPnlPct = config ? ((totalPnl / config.initial_balance) * 100) : 0;
  const equity = config ? config.current_balance + unrealizedPnl : 0;

  return (
    <div className="space-y-4">
      {/* Bot Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-mono font-bold">🤖 Paper Trading Bot</h2>
            <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full ${
              config?.is_active ? 'bg-bullish/15 text-bullish animate-pulse-glow' : 'bg-muted text-muted-foreground'
            }`}>
              {config?.is_active ? 'AKTYWNY' : 'ZATRZYMANY'}
            </span>
          </div>
          <div className="text-xs font-mono text-muted-foreground mt-1">
            Futures x{config?.leverage} | Interwał: {config?.interval} | Pozycja: {config?.position_size_pct}% | SL: {config?.stop_loss_pct}% | TP: {config?.take_profit_pct}%
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={runOnce}
            disabled={executing}
            className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 transition-colors"
          >
            ▶ Wykonaj raz
          </button>
          <button
            onClick={toggleBot}
            disabled={executing}
            className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors disabled:opacity-50 ${
              config?.is_active
                ? 'bg-bearish/20 text-bearish hover:bg-bearish/30'
                : 'bg-bullish/20 text-bullish hover:bg-bullish/30'
            }`}
          >
            {config?.is_active ? '⏸ Stop' : '▶ Start'}
          </button>
          <button
            onClick={resetBot}
            disabled={executing}
            className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
          >
            ↻ Reset
          </button>
          <button
            onClick={() => setShowConfig(!showConfig)}
            className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            ⚙ Config
          </button>
        </div>
      </div>

      {/* Config Panel */}
      <AnimatePresence>
        {showConfig && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Konfiguracja bota</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <ConfigInput label="Leverage" value={editConfig.leverage} suffix="x"
                  onChange={v => setEditConfig(p => ({ ...p, leverage: v }))} min={1} max={125} step={1} />
                <ConfigInput label="Pozycja" value={editConfig.position_size_pct} suffix="%"
                  onChange={v => setEditConfig(p => ({ ...p, position_size_pct: v }))} min={1} max={100} step={1} />
                <ConfigInput label="Stop Loss" value={editConfig.stop_loss_pct} suffix="%"
                  onChange={v => setEditConfig(p => ({ ...p, stop_loss_pct: v }))} min={0.5} max={50} step={0.5} />
                <ConfigInput label="Take Profit" value={editConfig.take_profit_pct} suffix="%"
                  onChange={v => setEditConfig(p => ({ ...p, take_profit_pct: v }))} min={0.5} max={100} step={0.5} />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowConfig(false)}
                  className="px-3 py-1.5 text-xs font-mono rounded-md bg-muted text-muted-foreground hover:text-foreground transition-colors">
                  Anuluj
                </button>
                <button onClick={saveConfig} disabled={executing}
                  className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 transition-colors">
                  💾 Zapisz
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Equity" value={`$${equity.toFixed(2)}`} />
        <StatCard
          label="P&L (total)"
          value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
          sub={`${totalPnlPct >= 0 ? '+' : ''}${totalPnlPct.toFixed(2)}%`}
          color={totalPnl >= 0 ? 'bullish' : 'bearish'}
        />
        <StatCard label="Otwarte pozycje" value={String(openPositions.length)} />
        <StatCard label="Łącznie transakcji" value={String(trades.length)} />
      </div>

      {/* Open Position with Trailing SL Visualization */}
      {openPositions.length > 0 && (
        <div className="rounded-lg border border-primary/30 glow-primary bg-card p-4 space-y-4">
          <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Otwarte pozycje</h3>
          {openPositions.map(pos => {
            const entry = Number(pos.entry_price);
            const sl = Number(pos.stop_loss);
            const tp = Number(pos.take_profit);
            const slMoved = pos.side === 'long' ? sl > entry * (1 - Number(config?.stop_loss_pct ?? 3) / 100 / Number(pos.leverage)) * 1.005 : sl < entry * (1 + Number(config?.stop_loss_pct ?? 3) / 100 / Number(pos.leverage)) * 0.995;
            const range = tp - (pos.side === 'long' ? entry - (entry - sl) * 2 : entry + (sl - entry) * 2);
            const slPct = pos.side === 'long'
              ? ((sl - (entry - Math.abs(tp - entry))) / range) * 100
              : (((entry + Math.abs(entry - tp)) - sl) / range) * 100;
            const entryPct = pos.side === 'long'
              ? ((entry - (entry - Math.abs(tp - entry))) / range) * 100
              : (((entry + Math.abs(entry - tp)) - entry) / range) * 100;

            // Simpler bar: SL on left, TP on right, entry marked
            const barMin = Math.min(sl, entry, tp);
            const barMax = Math.max(sl, entry, tp);
            const barRange = barMax - barMin || 1;
            const entryPos = ((entry - barMin) / barRange) * 100;
            const slPos = ((sl - barMin) / barRange) * 100;
            const tpPos = ((tp - barMin) / barRange) * 100;

            return (
              <div key={pos.id} className="space-y-2">
                <div className="flex items-center justify-between text-sm font-mono">
                  <div className="flex items-center gap-3">
                    <span className={`font-bold ${pos.side === 'long' ? 'text-bullish' : 'text-bearish'}`}>
                      {pos.side === 'long' ? '↑ LONG' : '↓ SHORT'}
                    </span>
                    <span className="text-foreground">${entry.toFixed(2)}</span>
                    <span className="text-muted-foreground">x{pos.leverage}</span>
                    <span className="text-muted-foreground">{Number(pos.quantity).toFixed(6)} BTC</span>
                  </div>
                  <span className="text-muted-foreground text-xs">Margin: ${Number(pos.margin_used).toFixed(2)}</span>
                </div>

                {/* SL / Entry / TP visual bar */}
                <div className="relative h-6 rounded-md bg-muted/30 border border-border overflow-hidden">
                  {/* SL→Entry zone (risk) */}
                  <div
                    className="absolute top-0 h-full bg-bearish/15"
                    style={{
                      left: `${Math.min(slPos, entryPos)}%`,
                      width: `${Math.abs(entryPos - slPos)}%`,
                    }}
                  />
                  {/* Entry→TP zone (reward) */}
                  <div
                    className="absolute top-0 h-full bg-bullish/15"
                    style={{
                      left: `${Math.min(entryPos, tpPos)}%`,
                      width: `${Math.abs(tpPos - entryPos)}%`,
                    }}
                  />
                  {/* SL marker */}
                  <div className="absolute top-0 h-full w-0.5 bg-bearish" style={{ left: `${slPos}%` }} />
                  {/* Entry marker */}
                  <div className="absolute top-0 h-full w-0.5 bg-foreground/50" style={{ left: `${entryPos}%` }} />
                  {/* TP marker */}
                  <div className="absolute top-0 h-full w-0.5 bg-bullish" style={{ left: `${tpPos}%` }} />

                  {/* Labels */}
                  <span className="absolute text-[9px] font-mono text-bearish font-bold" style={{ left: `${slPos}%`, top: '1px', transform: 'translateX(-50%)' }}>SL</span>
                  <span className="absolute text-[9px] font-mono text-muted-foreground" style={{ left: `${entryPos}%`, bottom: '1px', transform: 'translateX(-50%)' }}>ENTRY</span>
                  <span className="absolute text-[9px] font-mono text-bullish font-bold" style={{ left: `${tpPos}%`, top: '1px', transform: 'translateX(-50%)' }}>TP</span>
                </div>

                {/* Numeric details */}
                <div className="flex items-center justify-between text-[10px] font-mono">
                  <div className="flex items-center gap-1">
                    <span className="text-bearish">SL: ${sl.toFixed(0)}</span>
                    {slMoved && (
                      <span className="text-warning animate-pulse">🔒 Trailing</span>
                    )}
                  </div>
                  <span className="text-muted-foreground">Entry: ${entry.toFixed(0)}</span>
                  <span className="text-bullish">TP: ${tp.toFixed(0)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(['positions', 'trades', 'logs'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-mono font-semibold transition-colors border-b-2 ${
              activeTab === tab
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            {tab === 'positions' ? 'Pozycje' : tab === 'trades' ? 'Historia' : 'Logi'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <AnimatePresence mode="wait">
          {activeTab === 'positions' && (
            <motion.div key="positions" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="max-h-[300px] overflow-y-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-muted-foreground">
                      <th className="text-left p-2">Strona</th>
                      <th className="text-right p-2">Wejście</th>
                      <th className="text-right p-2">Wyjście</th>
                      <th className="text-right p-2">P&L</th>
                      <th className="text-right p-2">Status</th>
                      <th className="text-right p-2">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map(pos => (
                      <tr key={pos.id} className="border-t border-border hover:bg-muted/20">
                        <td className={`p-2 font-bold ${pos.side === 'long' ? 'text-bullish' : 'text-bearish'}`}>
                          {pos.side.toUpperCase()}
                        </td>
                        <td className="text-right p-2">${Number(pos.entry_price).toFixed(2)}</td>
                        <td className="text-right p-2">{pos.exit_price ? `$${Number(pos.exit_price).toFixed(2)}` : '—'}</td>
                        <td className={`text-right p-2 font-bold ${
                          (() => {
                            if (pos.status === 'open' && currentPrice) {
                              const uPnl = pos.side === 'long'
                                ? (currentPrice - Number(pos.entry_price)) * Number(pos.quantity)
                                : (Number(pos.entry_price) - currentPrice) * Number(pos.quantity);
                              return uPnl >= 0 ? 'text-bullish' : 'text-bearish';
                            }
                            return pos.pnl && pos.pnl > 0 ? 'text-bullish' : pos.pnl && pos.pnl < 0 ? 'text-bearish' : '';
                          })()
                        }`}>
                          {(() => {
                            if (pos.status === 'open' && currentPrice) {
                              const uPnl = pos.side === 'long'
                                ? (currentPrice - Number(pos.entry_price)) * Number(pos.quantity)
                                : (Number(pos.entry_price) - currentPrice) * Number(pos.quantity);
                              const uPnlPct = (uPnl / Number(pos.margin_used)) * 100;
                              return `${uPnl >= 0 ? '+' : ''}$${uPnl.toFixed(2)} (${uPnlPct.toFixed(1)}%)`;
                            }
                            return pos.pnl != null ? `${pos.pnl > 0 ? '+' : ''}$${Number(pos.pnl).toFixed(2)}` : '—';
                          })()}
                        </td>
                        <td className="text-right p-2">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                            pos.status === 'open' ? 'bg-primary/20 text-primary' :
                            pos.status === 'liquidated' ? 'bg-bearish/20 text-bearish' :
                            'bg-muted text-muted-foreground'
                          }`}>{pos.status}</span>
                        </td>
                        <td className="text-right p-2 text-muted-foreground">
                          {new Date(pos.opened_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                    {positions.length === 0 && (
                      <tr><td colSpan={6} className="text-center p-4 text-muted-foreground">Brak pozycji</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
          {activeTab === 'trades' && (
            <motion.div key="trades" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="max-h-[300px] overflow-y-auto">
                <table className="w-full text-xs font-mono">
                  <thead className="bg-muted/50 sticky top-0">
                    <tr className="text-muted-foreground">
                      <th className="text-left p-2">Akcja</th>
                      <th className="text-right p-2">Cena</th>
                      <th className="text-right p-2">P&L</th>
                      <th className="text-right p-2">Saldo po</th>
                      <th className="text-left p-2">Powód</th>
                      <th className="text-right p-2">Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trades.map(t => (
                      <tr key={t.id} className="border-t border-border hover:bg-muted/20">
                        <td className={`p-2 font-bold ${
                          t.action.includes('long') || t.action === 'take_profit' ? 'text-bullish' :
                          t.action.includes('short') || t.action === 'stop_loss' || t.action === 'liquidation' ? 'text-bearish' : ''
                        }`}>
                          {t.action.replace('_', ' ').toUpperCase()}
                        </td>
                        <td className="text-right p-2">${Number(t.price).toFixed(2)}</td>
                        <td className={`text-right p-2 font-bold ${
                          t.pnl && t.pnl > 0 ? 'text-bullish' : t.pnl && t.pnl < 0 ? 'text-bearish' : ''
                        }`}>
                          {t.pnl != null ? `${t.pnl > 0 ? '+' : ''}$${Number(t.pnl).toFixed(2)}` : '—'}
                        </td>
                        <td className="text-right p-2">{t.balance_after != null ? `$${Number(t.balance_after).toFixed(2)}` : '—'}</td>
                        <td className="text-left p-2 text-muted-foreground max-w-[200px] truncate">{t.reason}</td>
                        <td className="text-right p-2 text-muted-foreground">
                          {new Date(t.created_at).toLocaleString('pl-PL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                        </td>
                      </tr>
                    ))}
                    {trades.length === 0 && (
                      <tr><td colSpan={6} className="text-center p-4 text-muted-foreground">Brak transakcji</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </motion.div>
          )}
          {activeTab === 'logs' && (
            <motion.div key="logs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="max-h-[300px] overflow-y-auto p-3 space-y-1">
                {logs.map(log => (
                  <div key={log.id} className="flex items-start gap-2 text-xs font-mono">
                    <span className="text-muted-foreground shrink-0">
                      {new Date(log.created_at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <span className={`shrink-0 w-5 text-center ${
                      log.level === 'error' ? 'text-bearish' :
                      log.level === 'trade' ? 'text-warning' :
                      log.level === 'warn' ? 'text-warning' : 'text-muted-foreground'
                    }`}>
                      {log.level === 'error' ? '⚠' : log.level === 'trade' ? '📊' : log.level === 'warn' ? '⚡' : '·'}
                    </span>
                    <span className={`${log.level === 'trade' ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {log.message}
                    </span>
                  </div>
                ))}
                {logs.length === 0 && (
                  <div className="text-center text-muted-foreground py-4">Brak logów</div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-mono font-bold mt-1 ${
        color === 'bullish' ? 'text-bullish' : color === 'bearish' ? 'text-bearish' : 'text-foreground'
      }`}>
        {value}
      </div>
      {sub && <div className={`text-xs font-mono ${
        color === 'bullish' ? 'text-bullish' : color === 'bearish' ? 'text-bearish' : 'text-muted-foreground'
      }`}>{sub}</div>}
    </div>
  );
}

function ConfigInput({ label, value, suffix, onChange, min, max, step }: {
  label: string; value: number; suffix: string;
  onChange: (v: number) => void; min: number; max: number; step: number;
}) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          min={min} max={max} step={step}
          className="w-full bg-muted/50 border border-border rounded px-2 py-1.5 text-sm font-mono text-foreground focus:outline-none focus:border-primary"
        />
        <span className="text-xs font-mono text-muted-foreground">{suffix}</span>
      </div>
    </div>
  );
}
