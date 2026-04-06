import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { supabase } from '@/integrations/supabase/client';

import { fetchCurrentPrice } from '@/lib/binance';

interface BotConfig {
  id: string;
  name: string;
  symbol: string;
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

const SYMBOL_LABELS: Record<string, string> = {
  BTC_USDT: 'BTC',
  ETH_USDT: 'ETH',
  SOL_USDT: 'SOL',
  XRP_USDT: 'XRP',
  BNB_USDT: 'BNB',
};

export default function BotDashboard({ onSymbolChange }: { onSymbolChange?: (symbol: string) => void }) {
  const [configs, setConfigs] = useState<BotConfig[]>([]);
  const [activeSymbol, setActiveSymbolInternal] = useState<string>('BTC_USDT');

  const setActiveSymbol = (s: string) => {
    setActiveSymbolInternal(s);
    onSymbolChange?.(s);
  };
  const [positions, setPositions] = useState<Position[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);
  const [activeTab, setActiveTab] = useState<'positions' | 'trades' | 'logs'>('positions');
  const [showConfig, setShowConfig] = useState(false);
  const [editConfig, setEditConfig] = useState({ leverage: 5, position_size_pct: 10, stop_loss_pct: 3, take_profit_pct: 6 });
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [backtestResult, setBacktestResult] = useState<any>(null);
  const [backtesting, setBacktesting] = useState(false);

  const config = configs.find(c => c.symbol === activeSymbol) || null;
  const currentPrice = prices[activeSymbol] || null;

  // Fetch prices for all symbols
  useEffect(() => {
    const fetchPrices = async () => {
      try {
        const symbols = ['BTC_USDT', 'ETH_USDT', 'SOL_USDT', 'XRP_USDT', 'BNB_USDT'];
        const results = await Promise.allSettled(symbols.map(s => fetchCurrentPrice(s)));
        const newPrices: Record<string, number> = {};
        results.forEach((r, i) => {
          if (r.status === 'fulfilled') newPrices[symbols[i]] = r.value;
        });
        setPrices(newPrices);
      } catch (e) { /* ignore */ }
    };
    fetchPrices();
    const iv = setInterval(fetchPrices, 2000);
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

  const fetchConfigs = useCallback(async () => {
    try {
      const data = await callBot({ action: 'list_configs' });
      if (data.configs) setConfigs(data.configs);
    } catch (e) {
      console.error('Failed to fetch configs:', e);
    }
  }, [callBot]);

  const fetchStatus = useCallback(async () => {
    if (!config) return;
    try {
      const data = await callBot({ action: 'status', config_id: config.id });
      if (data.config) {
        setConfigs(prev => prev.map(c => c.id === data.config.id ? data.config : c));
        // Only update editConfig if config panel is closed
        if (!showConfig) {
          setEditConfig({
            leverage: data.config.leverage,
            position_size_pct: data.config.position_size_pct,
            stop_loss_pct: data.config.stop_loss_pct,
            take_profit_pct: data.config.take_profit_pct,
          });
        }
      }
      if (data.positions) setPositions(data.positions);
      if (data.trades) setTrades(data.trades);
      if (data.logs) setLogs(data.logs);
    } catch (e) {
      console.error('Failed to fetch bot status:', e);
    } finally {
      setLoading(false);
    }
  }, [callBot, config, showConfig]);

  // Trail poll: lightweight SL/TP/trailing check every 5 seconds
  const trailPoll = useCallback(async () => {
    if (!config) return;
    try {
      const data = await callBot({ action: 'trail', config_id: config.id });
      if (data.config) {
        setConfigs(prev => prev.map(c => c.id === data.config.id ? data.config : c));
      }
      if (data.positions) setPositions(data.positions);
      if (data.trades) setTrades(data.trades);
      if (data.logs) setLogs(data.logs);
    } catch (e) { /* ignore trail errors */ }
  }, [callBot, config]);

  useEffect(() => {
    fetchConfigs().then(() => setLoading(false));
  }, [fetchConfigs]);

  // Realtime logs subscription
  useEffect(() => {
    if (!config) return;
    const channel = supabase
      .channel(`bot_logs_${config.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'bot_logs',
          filter: `bot_config_id=eq.${config.id}`,
        },
        (payload) => {
          const newLog = payload.new as LogEntry;
          setLogs(prev => [newLog, ...prev].slice(0, 100));
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [config?.id]);

  useEffect(() => {
    if (!config) return;
    fetchStatus();
    const statusIv = setInterval(fetchStatus, 30000);
    // Fast trail SL polling every 5 seconds when bot has open positions or is active
    const trailIv = setInterval(trailPoll, 5000);
    return () => { clearInterval(statusIv); clearInterval(trailIv); };
  }, [fetchStatus, trailPoll, config]);

  // When active symbol changes, update editConfig from DB values
  useEffect(() => {
    const c = configs.find(c => c.symbol === activeSymbol);
    if (c) {
      setEditConfig({
        leverage: c.leverage,
        position_size_pct: c.position_size_pct,
        stop_loss_pct: c.stop_loss_pct,
        take_profit_pct: c.take_profit_pct,
      });
      setBacktestResult(null);
    }
  }, [activeSymbol]); // only on symbol change, not on config updates

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
    if (data.config) setConfigs(prev => prev.map(c => c.id === data.config.id ? data.config : c));
    if (data.positions) setPositions(data.positions);
    if (data.trades) setTrades(data.trades);
    if (data.logs) setLogs(data.logs);
    setExecuting(false);
  };

  const resetBot = async () => {
    if (!config) return;
    if (!confirm(`Resetować bota ${SYMBOL_LABELS[config.symbol]}? Wszystkie otwarte pozycje zostaną zamknięte.`)) return;
    setBacktestResult(null);
    setExecuting(true);
    await callBot({ action: 'reset', config_id: config.id });
    await fetchStatus();
    setExecuting(false);
  };

  const resetBalance = async () => {
    if (!config) return;
    const newBalance = prompt('Podaj nowe saldo startowe (np. 10000):', '10000');
    if (!newBalance) return;
    const amount = parseFloat(newBalance);
    if (isNaN(amount) || amount <= 0) { alert('Nieprawidłowa kwota'); return; }
    if (!confirm(`Resetować saldo ${SYMBOL_LABELS[config.symbol]} do $${amount}?`)) return;
    setExecuting(true);
    await callBot({ action: 'reset_balance', config_id: config.id, new_balance: amount });
    await fetchStatus();
    setBacktestResult(null);
    setExecuting(false);
  };

  const saveConfig = async () => {
    if (!config) return;
    const leverage = Math.max(1, Math.min(125, Math.round(editConfig.leverage)));
    const position_size_pct = Math.max(1, Math.min(100, editConfig.position_size_pct));
    const stop_loss_pct = Math.max(0.5, Math.min(50, editConfig.stop_loss_pct));
    const take_profit_pct = Math.max(0.5, Math.min(100, editConfig.take_profit_pct));
    setExecuting(true);
    await callBot({ action: 'update_config', config_id: config.id, leverage, position_size_pct, stop_loss_pct, take_profit_pct });
    await fetchStatus();
    setExecuting(false);
    setShowConfig(false);
  };

  const runBacktest = async () => {
    if (!config) return;
    setBacktesting(true);
    try {
      const data = await callBot({ action: 'backtest', config_id: config.id, risk_pct: 1, balance: config.initial_balance || 10000, leverage: config.leverage || 5 });
      if (data.backtest) setBacktestResult(data.backtest);
    } catch (e) {
      console.error('Backtest error:', e);
    }
    setBacktesting(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const openPositions = positions.filter(p => p.status === 'open');
  const symbolLabel = SYMBOL_LABELS[activeSymbol] || activeSymbol;
  const baseAsset = symbolLabel;

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

  // Margin locked in open positions must be added back to get true realized P&L
  const lockedMargin = openPositions.reduce((sum, pos) => sum + Number(pos.margin_used), 0);
  const realizedPnl = config ? (config.current_balance + lockedMargin) - config.initial_balance : 0;
  const totalPnl = realizedPnl + unrealizedPnl;
  const totalPnlPct = config ? ((totalPnl / config.initial_balance) * 100) : 0;
  const equity = config ? config.current_balance + unrealizedPnl + lockedMargin : 0;

  return (
    <div className="space-y-4">
      {/* Symbol Tabs */}
      <div className="flex rounded-md border border-border overflow-hidden w-fit">
        {configs.map(c => (
          <button
            key={c.id}
            onClick={() => setActiveSymbol(c.symbol)}
            className={`px-4 py-2 text-xs font-mono font-semibold transition-colors flex items-center gap-2 ${
              activeSymbol === c.symbol
                ? 'bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:text-foreground'
            }`}
          >
            {SYMBOL_LABELS[c.symbol] || c.symbol}
            {c.is_active && (
              <span className="w-1.5 h-1.5 rounded-full bg-bullish animate-pulse-glow" />
            )}
          </button>
        ))}
      </div>

      {/* Bot Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
        <div>
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-mono font-bold">🤖 {symbolLabel} Paper Bot</h2>
            <span className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded-full ${
              config?.is_active ? 'bg-bullish/15 text-bullish animate-pulse-glow' : 'bg-muted text-muted-foreground'
            }`}>
              {config?.is_active ? 'AKTYWNY' : 'ZATRZYMANY'}
            </span>
            {currentPrice && (
              <span className="text-sm font-mono text-muted-foreground">
                ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            )}
          </div>
          <div className="text-xs font-mono text-muted-foreground mt-1">
            Pullback EMA Strategy | 15m + 1H filter | x{config?.leverage} | Risk: 1% | R:R 1:2
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={runOnce} disabled={executing}
            className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 transition-colors">
            ▶ Wykonaj raz
          </button>
          <button onClick={toggleBot} disabled={executing}
            className={`px-3 py-1.5 text-xs font-mono font-semibold rounded-md transition-colors disabled:opacity-50 ${
              config?.is_active ? 'bg-bearish/20 text-bearish hover:bg-bearish/30' : 'bg-bullish/20 text-bullish hover:bg-bullish/30'
            }`}>
            {config?.is_active ? '⏸ Stop' : '▶ Start'}
          </button>
          <button onClick={resetBot} disabled={executing}
            className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors">
            ↻ Reset
          </button>
          <button onClick={resetBalance} disabled={executing}
            className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-warning/20 text-warning hover:bg-warning/30 disabled:opacity-50 transition-colors">
            💰 Reset salda
          </button>
          <button onClick={() => setShowConfig(!showConfig)}
            className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-muted text-muted-foreground hover:text-foreground transition-colors">
            ⚙ Config
          </button>
          <button onClick={runBacktest} disabled={backtesting}
            className="px-3 py-1.5 text-xs font-mono font-semibold rounded-md bg-primary/20 text-primary hover:bg-primary/30 disabled:opacity-50 transition-colors">
            {backtesting ? '⏳ Backtest...' : '📊 Backtest'}
          </button>
        </div>
      </div>

      {/* Config Panel */}
      <AnimatePresence>
        {showConfig && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="rounded-lg border border-border bg-card p-4 space-y-3">
              <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">Konfiguracja {symbolLabel}</h3>
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

      {/* Backtest Results */}
      <AnimatePresence>
        {backtestResult && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="rounded-lg border border-primary/30 bg-card p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-mono text-muted-foreground uppercase tracking-wider">📊 Backtest {symbolLabel}</h3>
                <button onClick={() => setBacktestResult(null)} className="text-xs text-muted-foreground hover:text-foreground">✕</button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                <StatCard label="Winrate" value={`${backtestResult.winrate.toFixed(1)}%`}
                  color={backtestResult.winrate >= 40 ? 'bullish' : 'bearish'} />
                <StatCard label="Profit Factor" value={backtestResult.profitFactor === Infinity ? '∞' : backtestResult.profitFactor.toFixed(2)}
                  color={backtestResult.profitFactor >= 1.5 ? 'bullish' : backtestResult.profitFactor >= 1 ? undefined : 'bearish'} />
                <StatCard label="Max Drawdown" value={`${backtestResult.maxDrawdownPct.toFixed(1)}%`}
                  sub={`$${backtestResult.maxDrawdown.toFixed(2)}`}
                  color={backtestResult.maxDrawdownPct <= 20 ? 'bullish' : 'bearish'} />
                <StatCard label="Expectancy" value={`$${backtestResult.expectancy.toFixed(2)}`}
                  color={backtestResult.expectancy > 0 ? 'bullish' : 'bearish'} />
                <StatCard label="Sharpe Ratio" value={backtestResult.sharpeRatio.toFixed(2)}
                  color={backtestResult.sharpeRatio >= 1 ? 'bullish' : backtestResult.sharpeRatio >= 0 ? undefined : 'bearish'} />
                <StatCard label="Return" value={`${backtestResult.totalReturnPct >= 0 ? '+' : ''}${backtestResult.totalReturnPct.toFixed(1)}%`}
                  sub={`$${backtestResult.totalReturn.toFixed(2)}`}
                  color={backtestResult.totalReturnPct >= 0 ? 'bullish' : 'bearish'} />
              </div>
              <div className="grid grid-cols-3 gap-3 text-xs font-mono">
                <div className="text-muted-foreground">Trades: <span className="text-foreground">{backtestResult.totalTrades}</span></div>
                <div className="text-muted-foreground">Wins: <span className="text-bullish">{backtestResult.wins}</span> | Losses: <span className="text-bearish">{backtestResult.losses}</span></div>
                <div className="text-muted-foreground">Avg Win: <span className="text-bullish">${backtestResult.avgWin.toFixed(2)}</span> | Avg Loss: <span className="text-bearish">${backtestResult.avgLoss.toFixed(2)}</span></div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Open Position — Binance-style card */}
      {openPositions.length > 0 && (
        <div className="space-y-3">
          {openPositions.map(pos => {
            const entry = Number(pos.entry_price);
            const sl = Number(pos.stop_loss);
            const tp = Number(pos.take_profit);
            const qty = Number(pos.quantity);
            const margin = Number(pos.margin_used);
            const notional = entry * qty;
            // Trailing detected: SL moved past entry (break-even or better)
            const slMoved = pos.side === 'long'
              ? sl > entry * 1.0005
              : sl < entry * 0.9995;

            // Unrealized P&L
            const uPnl = currentPrice
              ? pos.side === 'long'
                ? (currentPrice - entry) * qty
                : (entry - currentPrice) * qty
              : 0;
            // ROI % based on margin (like Binance shows)
            const roiPct = margin > 0 ? (uPnl / margin) * 100 : 0;
            // Risk = margin / equity
            const riskPct = equity > 0 ? (margin / equity) * 100 : 0;
            // Est. liquidation price (simplified)
            const liqPrice = pos.side === 'long'
              ? entry * (1 - 1 / Number(pos.leverage) * 0.9)
              : entry * (1 + 1 / Number(pos.leverage) * 0.9);

            return (
              <div key={pos.id} className="rounded-lg border border-primary/30 glow-primary bg-card p-4 space-y-4">
                {/* Row 1: Symbol + Side + Unrealized PnL */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-sm text-foreground">{activeSymbol}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                      pos.side === 'long' ? 'bg-bullish/20 text-bullish' : 'bg-bearish/20 text-bearish'
                    }`}>{pos.side === 'long' ? 'Long' : 'Short'}</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground">Isolated</span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-muted text-muted-foreground">{pos.leverage}X</span>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-mono text-muted-foreground">Unrealized PnL (USDT)</div>
                    <div className={`text-lg font-mono font-bold ${uPnl >= 0 ? 'text-bullish' : 'text-bearish'}`}>
                      {uPnl >= 0 ? '+' : ''}{uPnl.toFixed(4)}
                    </div>
                    <div className={`text-xs font-mono font-bold ${roiPct >= 0 ? 'text-bullish' : 'text-bearish'}`}>
                      ({roiPct >= 0 ? '+' : ''}{roiPct.toFixed(2)}%)
                    </div>
                  </div>
                </div>

                {/* Row 2: Position / Margin / Risk */}
                <div className="grid grid-cols-3 gap-4 text-xs font-mono">
                  <div>
                    <div className="text-muted-foreground text-[10px]">Position (USDT)</div>
                    <div className="text-foreground font-semibold">{notional.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[10px]">Margin (USDT)</div>
                    <div className="text-foreground font-semibold">{margin.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-muted-foreground text-[10px]">Risk</div>
                    <div className="text-foreground font-semibold">{riskPct.toFixed(2)}%</div>
                  </div>
                </div>

                {/* Row 3: Entry / Mark / Liq */}
                <div className="grid grid-cols-3 gap-4 text-xs font-mono">
                  <div>
                    <div className="text-muted-foreground text-[10px]">Entry Price</div>
                    <div className="text-foreground font-semibold">{entry.toLocaleString('en-US', { maximumFractionDigits: 2 })}</div>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-[10px]">Mark Price</div>
                    <div className="text-foreground font-semibold">{currentPrice ? currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 }) : '—'}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-muted-foreground text-[10px]">Est. Liq. Price</div>
                    <div className="text-foreground font-semibold">{liqPrice.toLocaleString('en-US', { maximumFractionDigits: 1 })}</div>
                  </div>
                </div>

                {/* Row 4: SL / TP bar */}
                <div className="space-y-1">
                  <div className="relative h-6 rounded-md bg-muted/30 border border-border overflow-hidden">
                    {(() => {
                      const barMin = Math.min(sl, entry, tp);
                      const barMax = Math.max(sl, entry, tp);
                      const barRange = barMax - barMin || 1;
                      const entryPos = ((entry - barMin) / barRange) * 100;
                      const slPos = ((sl - barMin) / barRange) * 100;
                      const tpPos = ((tp - barMin) / barRange) * 100;
                      return (
                        <>
                          <div className="absolute top-0 h-full bg-bearish/15" style={{ left: `${Math.min(slPos, entryPos)}%`, width: `${Math.abs(entryPos - slPos)}%` }} />
                          <div className="absolute top-0 h-full bg-bullish/15" style={{ left: `${Math.min(entryPos, tpPos)}%`, width: `${Math.abs(tpPos - entryPos)}%` }} />
                          <div className="absolute top-0 h-full w-0.5 bg-bearish" style={{ left: `${slPos}%` }} />
                          <div className="absolute top-0 h-full w-0.5 bg-foreground/50" style={{ left: `${entryPos}%` }} />
                          <div className="absolute top-0 h-full w-0.5 bg-bullish" style={{ left: `${tpPos}%` }} />
                          <span className="absolute text-[9px] font-mono text-bearish font-bold" style={{ left: `${slPos}%`, top: '1px', transform: 'translateX(-50%)' }}>SL</span>
                          <span className="absolute text-[9px] font-mono text-muted-foreground" style={{ left: `${entryPos}%`, bottom: '1px', transform: 'translateX(-50%)' }}>ENTRY</span>
                          <span className="absolute text-[9px] font-mono text-bullish font-bold" style={{ left: `${tpPos}%`, top: '1px', transform: 'translateX(-50%)' }}>TP</span>
                        </>
                      );
                    })()}
                  </div>
                  <div className="flex items-center justify-between text-[10px] font-mono">
                    <div className="flex items-center gap-1">
                      <span className="text-bearish">SL: ${sl.toFixed(0)}</span>
                      {slMoved && <span className="text-warning animate-pulse">🔒 Trailing</span>}
                    </div>
                    <span className="text-muted-foreground">Entry: ${entry.toFixed(0)}</span>
                    <span className="text-bullish">TP: ${tp.toFixed(0)}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(['positions', 'trades', 'logs'] as const).map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-xs font-mono font-semibold transition-colors border-b-2 ${
              activeTab === tab ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}>
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
