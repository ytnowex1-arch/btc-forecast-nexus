import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function fetchCurrentPrice(symbol: string): Promise<number> {
  const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`);
  const data = await res.json();
  return parseFloat(data.price);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: config } = await supabase.from('bot_configs').select('*').single();
    if (!config || !config.is_active) return new Response('Bot inactive');

    const symbol = config.symbol || 'BTCUSDT';
    const currentPrice = await fetchCurrentPrice(symbol);

    // 1. ZARZĄDZANIE OTWARTYMI POZYCJAMI (ROI Trailing dla obu stron)
    const { data: openPositions } = await supabase.from('bot_positions').select('*').eq('status', 'open');

    if (openPositions) {
      for (const pos of openPositions) {
        const isLong = pos.side === 'LONG' || !pos.side;
        const profitPct = isLong 
          ? ((currentPrice - pos.entry_price) / pos.entry_price) * 100
          : ((pos.entry_price - currentPrice) / pos.entry_price) * 100;

        const roiStep = 1.0;
        if (profitPct >= roiStep) {
          const steps = Math.floor(profitPct / roiStep);
          const movePct = (steps - 1) * (roiStep / 100);
          const newSL = isLong ? pos.entry_price * (1 + movePct) : pos.entry_price * (1 - movePct);

          const isBetter = isLong ? newSL > pos.stop_loss : newSL < pos.stop_loss;
          if (isBetter) {
            await supabase.from('bot_positions').update({ stop_loss: newSL }).eq('id', pos.id);
            console.log(`[TRAILING] ${pos.side} ${symbol}: Nowy SL ${newSL.toFixed(2)}`);
          }
        }
      }
    }

    // 2. ANALIZA I OTWIERANIE POZYCJI (SHORT/LONG)
    // [Tutaj wywołaj runStrategy() z plików wejściowych]
    // Przykładowa akcja po otrzymaniu sygnału:
    const signal = 'SELL'; // Testowy sygnał SHORT
    if (signal === 'SELL' && (!openPositions || openPositions.length === 0)) {
        // Obliczenia dla Shorta... (jak w strategy.ts)
        const dailyATR = 1500; // Przykład
        const slDistance = dailyATR * 1.5;

        await supabase.from('bot_positions').insert({
            bot_config_id: config.id,
            symbol,
            side: 'SHORT',
            entry_price: currentPrice,
            stop_loss: currentPrice + slDistance,
            take_profit: currentPrice - (slDistance * 2),
            status: 'open'
        });
    }

    return new Response(JSON.stringify({ status: 'ok', price: currentPrice }), { headers: corsHeaders });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});, tp: posTP, pnl, pnlPct: (pnl / posMargin) * 100,
      exitReason: 'End of data',
    });
    equityCurve.push({ time: m15Klines[m15Klines.length - 1].time, equity: balance });
  }

  // Compute stats
  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);
  const totalWins = wins.reduce((s, t) => s + t.pnl, 0);
  const totalLosses = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
  const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;

  const winrate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
  const expectancy = trades.length > 0
    ? (winrate / 100) * avgWin - ((100 - winrate) / 100) * avgLoss
    : 0;

  // Sharpe ratio (using trade returns)
  const returns = trades.map(t => t.pnlPct / 100);
  const avgReturn = returns.length > 0 ? returns.reduce((a, b) => a + b, 0) / returns.length : 0;
  const stdReturn = returns.length > 1
    ? Math.sqrt(returns.reduce((s, r) => s + (r - avgReturn) ** 2, 0) / (returns.length - 1))
    : 0;
  const sharpeRatio = stdReturn > 0 ? (avgReturn / stdReturn) * Math.sqrt(252) : 0; // annualized

  return {
    trades: trades.slice(-100), // last 100 for response size
    winrate, profitFactor, maxDrawdown, maxDrawdownPct,
    expectancy, sharpeRatio,
    totalReturn: balance - initialBalance,
    totalReturnPct: ((balance - initialBalance) / initialBalance) * 100,
    totalTrades: trades.length,
    wins: wins.length, losses: losses.length,
    avgWin, avgLoss,
    equityCurve: equityCurve.filter((_, i) => i % Math.max(1, Math.floor(equityCurve.length / 200)) === 0), // downsample
  };
}

// ========== MAIN SERVER ==========
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Support config_id parameter or default to first config
    let action = null;
    let bodyData: any = {};
    if (req.method === 'POST') {
      bodyData = await req.json();
      action = bodyData.action;
    }

    const configId = bodyData.config_id || new URL(req.url).searchParams.get('config_id');

    // If action is 'list_configs', return all configs
    if (action === 'list_configs') {
      const { data: allConfigs } = await supabase.from('bot_config').select('*').order('created_at');
      return new Response(JSON.stringify({ configs: allConfigs || [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Get specific config or first one
    let config: any;
    if (configId) {
      const { data } = await supabase.from('bot_config').select('*').eq('id', configId).single();
      config = data;
    } else {
      const { data } = await supabase.from('bot_config').select('*').limit(1);
      config = data?.[0];
    }
    
    if (!config) {
      return new Response(JSON.stringify({ message: 'No bot config found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404,
      });
    }

    // Handle manual actions
    if (action) {
      const body = bodyData;

      // Status: return config + positions/trades/logs without running trading logic
      if (action === 'status') {
        const { data: positions } = await supabase.from('bot_positions')
          .select('*').eq('bot_config_id', config.id).order('opened_at', { ascending: false }).limit(20);
        const { data: trades } = await supabase.from('bot_trades')
          .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(50);
        const { data: logs } = await supabase.from('bot_logs')
          .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(30);
        return new Response(JSON.stringify({ config, positions, trades, logs, executed: false }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'toggle') {
        await supabase.from('bot_config').update({ is_active: !config.is_active }).eq('id', config.id);
        return new Response(JSON.stringify({ is_active: !config.is_active }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'reset') {
        const price = await fetchCurrentPrice(config.symbol);
        const { data: openPositions } = await supabase.from('bot_positions')
          .select('*').eq('bot_config_id', config.id).eq('status', 'open');
        for (const pos of openPositions || []) {
          const pnl = pos.side === 'long'
            ? (price - pos.entry_price) * pos.quantity
            : (pos.entry_price - price) * pos.quantity;
          await supabase.from('bot_positions').update({
            status: 'closed', exit_price: price, pnl, pnl_pct: (pnl / pos.margin_used) * 100,
            closed_at: new Date().toISOString(), exit_reason: 'Bot reset',
          }).eq('id', pos.id);
        }
        await supabase.from('bot_config').update({
          is_active: false, current_balance: config.initial_balance,
        }).eq('id', config.id);
        return new Response(JSON.stringify({ message: 'Bot reset' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'reset_balance') {
        const newBalance = body.new_balance || config.initial_balance;
        await supabase.from('bot_positions').delete().eq('bot_config_id', config.id);
        await supabase.from('bot_trades').delete().eq('bot_config_id', config.id);
        await supabase.from('bot_logs').delete().eq('bot_config_id', config.id);
        await supabase.from('bot_config').update({
          is_active: false, current_balance: newBalance, initial_balance: newBalance,
        }).eq('id', config.id);
        await logBot(supabase, config.id, 'info', `💰 Saldo zresetowane do $${newBalance}`);
        return new Response(JSON.stringify({ message: `Balance reset to ${newBalance}` }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'update_config') {
        const { leverage, position_size_pct, stop_loss_pct, take_profit_pct, interval } = body;
        await supabase.from('bot_config').update({
          ...(leverage !== undefined && { leverage }),
          ...(position_size_pct !== undefined && { position_size_pct }),
          ...(stop_loss_pct !== undefined && { stop_loss_pct }),
          ...(take_profit_pct !== undefined && { take_profit_pct }),
          ...(interval !== undefined && { interval }),
        }).eq('id', config.id);
        return new Response(JSON.stringify({ message: 'Config updated' }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      // ========== BACKTEST ACTION ==========
      if (action === 'backtest') {
        const riskPct = body.risk_pct || 1;
        const backtestBalance = body.balance || Number(config.initial_balance);
        const backtestLeverage = body.leverage || Number(config.leverage);

        await logBot(supabase, config.id, 'info', '📊 Starting backtest...');

        // Fetch max available data (1000 bars each)
        const [h1Data, m15Data] = await Promise.all([
          fetchKlines(config.symbol, '1h', 1000),
          fetchKlines(config.symbol, '15m', 1000),
        ]);

        const result = runBacktest(h1Data, m15Data, backtestBalance, riskPct, backtestLeverage);

        await logBot(supabase, config.id, 'info',
          `📊 Backtest done: ${result.totalTrades} trades | WR: ${result.winrate.toFixed(1)}% | PF: ${result.profitFactor.toFixed(2)} | DD: ${result.maxDrawdownPct.toFixed(1)}% | Exp: $${result.expectancy.toFixed(2)} | Sharpe: ${result.sharpeRatio.toFixed(2)} | Return: ${result.totalReturnPct.toFixed(1)}%`);

        return new Response(JSON.stringify({ backtest: result }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    if (!config.is_active && action !== 'run') {
      const { data: positions } = await supabase.from('bot_positions')
        .select('*').eq('bot_config_id', config.id).order('opened_at', { ascending: false }).limit(20);
      const { data: trades } = await supabase.from('bot_trades')
        .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(50);
      const { data: logs } = await supabase.from('bot_logs')
        .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(30);
      return new Response(JSON.stringify({ config, positions, trades, logs, executed: false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === TRADING LOGIC (Pullback EMA Strategy) ===
    const [h1Klines, m15Klines] = await Promise.all([
      fetchKlines(config.symbol, '1h', 300),
      fetchKlines(config.symbol, '15m', 300),
    ]);

    const currentPrice = m15Klines[m15Klines.length - 1].close;
    const signal = analyzeStrategy(h1Klines, m15Klines);

    const { data: openPositions } = await supabase.from('bot_positions')
      .select('*').eq('bot_config_id', config.id).eq('status', 'open');

    let balance = Number(config.current_balance);

    // === MANAGE OPEN POSITIONS ===
    for (const pos of openPositions || []) {
      const entryPrice = Number(pos.entry_price);
      const qty = Number(pos.quantity);
      const margin = Number(pos.margin_used);
      const currentSL = Number(pos.stop_loss);
      const currentTP = Number(pos.take_profit);

      const pnl = pos.side === 'long'
        ? (currentPrice - entryPrice) * qty
        : (entryPrice - currentPrice) * qty;
      const pnlPct = (pnl / margin) * 100;

      // Liquidation check
      if (pnlPct <= -90) {
        balance -= margin;
        await supabase.from('bot_positions').update({
          status: 'liquidated', exit_price: currentPrice, pnl: -margin, pnl_pct: -100,
          closed_at: new Date().toISOString(), exit_reason: 'Liquidation',
        }).eq('id', pos.id);
        await logBot(supabase, config.id, 'error', `⚠️ LIQUIDATION: ${pos.side} | PnL: -$${margin.toFixed(2)}`);
        continue;
      }

      // Stop Loss
      if (currentSL && (
        (pos.side === 'long' && currentPrice <= currentSL) ||
        (pos.side === 'short' && currentPrice >= currentSL)
      )) {
        balance += margin + pnl;
        await supabase.from('bot_positions').update({
          status: 'closed', exit_price: currentPrice, pnl, pnl_pct: pnlPct,
          closed_at: new Date().toISOString(), exit_reason: 'Stop Loss',
        }).eq('id', pos.id);
        await supabase.from('bot_trades').insert({
          bot_config_id: config.id, position_id: pos.id, action: 'stop_loss',
          price: currentPrice, quantity: qty, pnl, balance_after: balance,
          reason: `Stop Loss at $${currentPrice.toFixed(2)}`,
        });
        await logBot(supabase, config.id, 'trade', `🛑 SL HIT: ${pos.side} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        continue;
      }

      // Take Profit
      if (currentTP && (
        (pos.side === 'long' && currentPrice >= currentTP) ||
        (pos.side === 'short' && currentPrice <= currentTP)
      )) {
        balance += margin + pnl;
        await supabase.from('bot_positions').update({
          status: 'closed', exit_price: currentPrice, pnl, pnl_pct: pnlPct,
          closed_at: new Date().toISOString(), exit_reason: 'Take Profit',
        }).eq('id', pos.id);
        await supabase.from('bot_trades').insert({
          bot_config_id: config.id, position_id: pos.id, action: 'take_profit',
          price: currentPrice, quantity: qty, pnl, balance_after: balance,
          reason: `Take Profit at $${currentPrice.toFixed(2)}`,
        });
        await logBot(supabase, config.id, 'trade', `🎯 TP HIT: ${pos.side} | PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        continue;
      }

      // Trailing SL: always 1% from current price (only tighten, never loosen)
      if (pos.side === 'long') {
        const trailingSL = currentPrice * 0.99; // 1% below current price
        // Only trail if tighter than current SL (never loosen)
        if (trailingSL > currentSL) {
          await supabase.from('bot_positions').update({ stop_loss: trailingSL }).eq('id', pos.id);
          const label = trailingSL >= entryPrice ? '🔒 TRAIL SL (BE+)' : '🔒 TRAIL SL';
          await logBot(supabase, config.id, 'info',
            `${label}: LONG SL $${currentSL.toFixed(0)} → $${trailingSL.toFixed(0)} (1% below $${currentPrice.toFixed(0)})`);
        }
      } else {
        const trailingSL = currentPrice * 1.01; // 1% above current price
        // Only trail if tighter than current SL (never loosen)
        if (trailingSL < currentSL) {
          await supabase.from('bot_positions').update({ stop_loss: trailingSL }).eq('id', pos.id);
          const label = trailingSL <= entryPrice ? '🔒 TRAIL SL (BE+)' : '🔒 TRAIL SL';
          await logBot(supabase, config.id, 'info',
            `${label}: SHORT SL $${currentSL.toFixed(0)} → $${trailingSL.toFixed(0)} (1% above $${currentPrice.toFixed(0)})`);
        }
      }
    }

    // === OPEN NEW POSITION ===
    const { data: remainingOpen } = await supabase.from('bot_positions')
      .select('id').eq('bot_config_id', config.id).eq('status', 'open');

    if ((!remainingOpen || remainingOpen.length === 0) && signal.side !== 'none') {
      // 3 consecutive losses → 4h cooldown
      const { data: recentClosed } = await supabase.from('bot_positions')
        .select('closed_at, exit_reason, pnl')
        .eq('bot_config_id', config.id)
        .in('status', ['closed'])
        .order('closed_at', { ascending: false })
        .limit(3);

      let cooldownActive = false;
      if (recentClosed && recentClosed.length >= 3) {
        const allLosses = recentClosed.every(p => Number(p.pnl) < 0);
        if (allLosses && recentClosed[0].closed_at) {
          const timeSince = Date.now() - new Date(recentClosed[0].closed_at).getTime();
          if (timeSince < 4 * 3600 * 1000) {
            cooldownActive = true;
            const remaining = Math.round((4 * 3600 * 1000 - timeSince) / 60000);
            await logBot(supabase, config.id, 'info',
              `⏳ COOLDOWN: 3 straty z rzędu — wstrzymanie na ${remaining} min`);
          }
        }
      }

      if (!cooldownActive && signal.riskPerUnit > 0) {
        const leverage = Number(config.leverage);
        // Fixed margin of $1000 per trade
        const margin = 1000;
        if (margin <= balance) {
          const notional = margin * leverage;
          const qty = notional / currentPrice;
          const riskAmount = qty * signal.riskPerUnit; // actual $ risk

          balance -= margin;

          const entryReason = signal.reasoning.join(' | ');

          const { data: newPos } = await supabase.from('bot_positions').insert({
            bot_config_id: config.id, side: signal.side, entry_price: currentPrice, quantity: qty,
            leverage, margin_used: margin, stop_loss: signal.stopLoss, take_profit: signal.takeProfit,
            entry_reason: entryReason.slice(0, 500),
          }).select().single();

          await supabase.from('bot_trades').insert({
            bot_config_id: config.id, position_id: newPos?.id,
            action: signal.side === 'long' ? 'open_long' : 'open_short',
            price: currentPrice, quantity: qty, balance_after: balance,
            reason: `${signal.side.toUpperCase()} @ $${currentPrice.toFixed(2)} | SL: $${signal.stopLoss.toFixed(2)} | TP: $${signal.takeProfit.toFixed(2)} | Risk: $${riskAmount.toFixed(2)} (1%)`,
          });

          await logBot(supabase, config.id, 'trade',
            `📈 ${signal.side.toUpperCase()} @ $${currentPrice.toFixed(2)} | Qty: ${qty.toFixed(6)} | SL: $${signal.stopLoss.toFixed(0)} | TP: $${signal.takeProfit.toFixed(0)} | R:R 1:2 | Risk: $${riskAmount.toFixed(2)}`);
          await logBot(supabase, config.id, 'info', `🧠 ${entryReason}`);
        }
      }
    } else if (signal.side === 'none' && (!remainingOpen || remainingOpen.length === 0)) {
      await logBot(supabase, config.id, 'info',
        `⏸ NO TRADE: ${signal.reasoning[signal.reasoning.length - 1] || 'Warunki nie spełnione'}`);
    }

    await supabase.from('bot_config').update({ current_balance: balance }).eq('id', config.id);

    await logBot(supabase, config.id, 'info',
      `Tick: $${currentPrice.toFixed(2)} | Trend: ${signal.trendFilter} | EMA20: $${signal.ema20.toFixed(0)} | EMA50: $${signal.ema50.toFixed(0)} | RSI: ${signal.rsi.toFixed(1)} | Pullback: ${signal.pullbackDetected ? '✅' : '❌'} | Bal: $${balance.toFixed(2)}`);

    const { data: positions } = await supabase.from('bot_positions')
      .select('*').eq('bot_config_id', config.id).order('opened_at', { ascending: false }).limit(20);
    const { data: trades } = await supabase.from('bot_trades')
      .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(50);
    const { data: logs } = await supabase.from('bot_logs')
      .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(30);

    const updatedConfig = { ...config, current_balance: balance };

    return new Response(JSON.stringify({
      config: updatedConfig, positions, trades, logs, signal, executed: true,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Trading bot error:', error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function logBot(supabase: any, configId: string, level: string, message: string, data?: any) {
  await supabase.from('bot_logs').insert({
    bot_config_id: configId, level, message, data,
  });
}
