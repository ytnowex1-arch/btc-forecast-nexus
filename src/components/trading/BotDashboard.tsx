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
      if (data.config) setConfig(data.config);
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const pnl = config ? config.current_balance - config.initial_balance : 0;
  const pnlPct = config ? ((pnl / config.initial_balance) * 100) : 0;
  const openPositions = positions.filter(p => p.status === 'open');

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
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Saldo" value={`$${config?.current_balance?.toFixed(2) ?? '0'}`} />
        <StatCard
          label="P&L"
          value={`${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`}
          sub={`${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`}
          color={pnl >= 0 ? 'bullish' : 'bearish'}
        />
        <StatCard label="Otwarte pozycje" value={String(openPositions.length)} />
        <StatCard label="Łącznie transakcji" value={String(trades.length)} />
      </div>

      {/* Open Position */}
      {openPositions.length > 0 && (
        <div className="rounded-lg border border-primary/30 glow-primary bg-card p-4">
          <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider mb-3">Otwarte pozycje</h3>
          {openPositions.map(pos => {
            const currentPnl = pos.pnl ?? 0;
            return (
              <div key={pos.id} className="flex items-center justify-between text-sm font-mono">
                <div className="flex items-center gap-3">
                  <span className={`font-bold ${pos.side === 'long' ? 'text-bullish' : 'text-bearish'}`}>
                    {pos.side === 'long' ? '↑ LONG' : '↓ SHORT'}
                  </span>
                  <span className="text-foreground">${Number(pos.entry_price).toFixed(2)}</span>
                  <span className="text-muted-foreground">x{pos.leverage}</span>
                  <span className="text-muted-foreground">{Number(pos.quantity).toFixed(6)} BTC</span>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-muted-foreground">SL: ${Number(pos.stop_loss).toFixed(0)}</span>
                  <span className="text-muted-foreground">TP: ${Number(pos.take_profit).toFixed(0)}</span>
                  <span className="text-muted-foreground">Margin: ${Number(pos.margin_used).toFixed(2)}</span>
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
                          pos.pnl && pos.pnl > 0 ? 'text-bullish' : pos.pnl && pos.pnl < 0 ? 'text-bearish' : ''
                        }`}>
                          {pos.pnl != null ? `${pos.pnl > 0 ? '+' : ''}$${Number(pos.pnl).toFixed(2)}` : '—'}
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
