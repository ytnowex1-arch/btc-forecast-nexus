import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BINANCE_URL = 'https://data-api.binance.vision/api/v3';

interface Kline {
  time: number; open: number; high: number; low: number; close: number; volume: number;
}

async function fetchKlines(symbol: string, interval: string, limit = 500): Promise<Kline[]> {
  const res = await fetch(`${BINANCE_URL}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  const data = await res.json();
  return data.map((k: any[]) => ({
    time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5],
  }));
}

async function fetchCurrentPrice(symbol: string): Promise<number> {
  const res = await fetch(`${BINANCE_URL}/ticker/price?symbol=${symbol}`);
  const data = await res.json();
  return parseFloat(data.price);
}

// Indicators
function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) result.push(data[i] * k + result[i-1] * (1-k));
  return result;
}

function rsi(closes: number[], period = 14): number[] {
  const r: number[] = new Array(period).fill(50);
  let ag = 0, al = 0;
  for (let i = 1; i <= period; i++) {
    const c = closes[i] - closes[i-1];
    if (c > 0) ag += c; else al += Math.abs(c);
  }
  ag /= period; al /= period;
  r.push(al === 0 ? 100 : 100 - 100/(1+ag/al));
  for (let i = period+1; i < closes.length; i++) {
    const c = closes[i] - closes[i-1];
    ag = (ag*(period-1) + Math.max(c,0))/period;
    al = (al*(period-1) + Math.max(-c,0))/period;
    r.push(al === 0 ? 100 : 100 - 100/(1+ag/al));
  }
  return r;
}

function macd(closes: number[]) {
  const f = ema(closes, 12), s = ema(closes, 26);
  const line = f.map((v,i) => v - s[i]);
  const sig = ema(line, 9);
  return { line, signal: sig, hist: line.map((v,i) => v - sig[i]) };
}

function bollingerBands(closes: number[], period = 20) {
  const sma: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period-1) { sma.push(closes[i]); continue; }
    sma.push(closes.slice(i-period+1, i+1).reduce((a,b) => a+b, 0) / period);
  }
  const upper: number[] = [], lower: number[] = [];
  for (let i = 0; i < closes.length; i++) {
    if (i < period-1) { upper.push(sma[i]+1000); lower.push(sma[i]-1000); continue; }
    const slice = closes.slice(i-period+1, i+1);
    const std = Math.sqrt(slice.reduce((s,v) => s + (v-sma[i])**2, 0)/period);
    upper.push(sma[i] + 2*std);
    lower.push(sma[i] - 2*std);
  }
  return { upper, middle: sma, lower };
}

function analyzeMarket(closes: number[], highs: number[], lows: number[]) {
  const last = closes.length - 1;
  const price = closes[last];
  
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const rsiVals = rsi(closes);
  const macdData = macd(closes);
  const bb = bollingerBands(closes);
  
  let bullish = 0, bearish = 0, total = 0;
  
  // EMA cross
  total++;
  if (ema50[last] > ema200[last]) bullish++; else bearish++;
  
  // RSI
  total++;
  const lastRsi = rsiVals[last];
  if (lastRsi < 30) bullish++;
  else if (lastRsi > 70) bearish++;
  
  // MACD
  total++;
  if (macdData.line[last] > macdData.signal[last]) bullish++;
  else bearish++;
  
  // MACD crossover
  total++;
  const prevMacdAbove = macdData.line[last-1] > macdData.signal[last-1];
  const currMacdAbove = macdData.line[last] > macdData.signal[last];
  if (!prevMacdAbove && currMacdAbove) bullish++;
  else if (prevMacdAbove && !currMacdAbove) bearish++;
  
  // Bollinger position
  total++;
  const bbPos = (price - bb.lower[last]) / (bb.upper[last] - bb.lower[last]);
  if (bbPos < 0.2) bullish++;
  else if (bbPos > 0.8) bearish++;
  
  // Price vs EMA50
  total++;
  if (price > ema50[last]) bullish++; else bearish++;
  
  const score = total > 0 ? (bullish - bearish) / total : 0; // -1 to 1
  const bias = score > 0.3 ? 'bullish' : score < -0.3 ? 'bearish' : 'neutral';
  
  return {
    bias,
    score,
    bullish,
    bearish,
    total,
    rsi: lastRsi,
    macdHist: macdData.hist[last],
    ema50: ema50[last],
    ema200: ema200[last],
    bbPosition: bbPos,
    price,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get bot config
    const { data: configs } = await supabase.from('bot_config').select('*').limit(1);
    if (!configs || configs.length === 0) {
      return new Response(JSON.stringify({ message: 'No bot config found' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404,
      });
    }
    const config = configs[0];

    // Handle manual actions from request body
    let action = null;
    if (req.method === 'POST') {
      const body = await req.json();
      action = body.action;

      if (action === 'toggle') {
        await supabase.from('bot_config').update({ is_active: !config.is_active }).eq('id', config.id);
        return new Response(JSON.stringify({ is_active: !config.is_active }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      if (action === 'reset') {
        // Close all open positions at current price
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
    }

    // If not active and no special action, just return status
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

    // === TRADING LOGIC ===
    const klines = await fetchKlines(config.symbol, config.interval, 300);
    const closes = klines.map(k => k.close);
    const highs = klines.map(k => k.high);
    const lows = klines.map(k => k.low);
    const currentPrice = closes[closes.length - 1];
    
    const analysis = analyzeMarket(closes, highs, lows);

    // Check open positions for SL/TP/Liquidation
    const { data: openPositions } = await supabase.from('bot_positions')
      .select('*').eq('bot_config_id', config.id).eq('status', 'open');

    let balance = Number(config.current_balance);

    for (const pos of openPositions || []) {
      const entryPrice = Number(pos.entry_price);
      const qty = Number(pos.quantity);
      const leverage = Number(pos.leverage);
      const margin = Number(pos.margin_used);
      
      const pnl = pos.side === 'long'
        ? (currentPrice - entryPrice) * qty
        : (entryPrice - currentPrice) * qty;
      const pnlPct = (pnl / margin) * 100;

      // Liquidation check (lose all margin)
      const liqThreshold = -90; // -90% of margin = liquidated
      if (pnlPct <= liqThreshold) {
        balance -= margin;
        await supabase.from('bot_positions').update({
          status: 'liquidated', exit_price: currentPrice, pnl: -margin, pnl_pct: -100,
          closed_at: new Date().toISOString(), exit_reason: 'Liquidation',
        }).eq('id', pos.id);
        await supabase.from('bot_trades').insert({
          bot_config_id: config.id, position_id: pos.id, action: 'liquidation',
          price: currentPrice, quantity: qty, pnl: -margin, balance_after: balance,
          reason: `Liquidated at $${currentPrice.toFixed(2)}`,
        });
        await logBot(supabase, config.id, 'error', `⚠️ LIQUIDATION: ${pos.side} pozycja zlikwidowana! PnL: -$${margin.toFixed(2)}`);
        continue;
      }

      // Stop loss
      if (pos.stop_loss && (
        (pos.side === 'long' && currentPrice <= Number(pos.stop_loss)) ||
        (pos.side === 'short' && currentPrice >= Number(pos.stop_loss))
      )) {
        balance += margin + pnl;
        await supabase.from('bot_positions').update({
          status: 'closed', exit_price: currentPrice, pnl, pnl_pct: pnlPct,
          closed_at: new Date().toISOString(), exit_reason: 'Stop Loss',
        }).eq('id', pos.id);
        await supabase.from('bot_trades').insert({
          bot_config_id: config.id, position_id: pos.id, action: 'stop_loss',
          price: currentPrice, quantity: qty, pnl, balance_after: balance,
          reason: `Stop Loss hit at $${currentPrice.toFixed(2)}`,
        });
        await logBot(supabase, config.id, 'trade', `🛑 STOP LOSS: ${pos.side} zamknięta. PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        continue;
      }

      // Take profit
      if (pos.take_profit && (
        (pos.side === 'long' && currentPrice >= Number(pos.take_profit)) ||
        (pos.side === 'short' && currentPrice <= Number(pos.take_profit))
      )) {
        balance += margin + pnl;
        await supabase.from('bot_positions').update({
          status: 'closed', exit_price: currentPrice, pnl, pnl_pct: pnlPct,
          closed_at: new Date().toISOString(), exit_reason: 'Take Profit',
        }).eq('id', pos.id);
        await supabase.from('bot_trades').insert({
          bot_config_id: config.id, position_id: pos.id, action: 'take_profit',
          price: currentPrice, quantity: qty, pnl, balance_after: balance,
          reason: `Take Profit hit at $${currentPrice.toFixed(2)}`,
        });
        await logBot(supabase, config.id, 'trade', `🎯 TAKE PROFIT: ${pos.side} zamknięta. PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
        continue;
      }

      // Close position if signal reverses
      if ((pos.side === 'long' && analysis.bias === 'bearish' && analysis.score < -0.5) ||
          (pos.side === 'short' && analysis.bias === 'bullish' && analysis.score > 0.5)) {
        balance += margin + pnl;
        await supabase.from('bot_positions').update({
          status: 'closed', exit_price: currentPrice, pnl, pnl_pct: pnlPct,
          closed_at: new Date().toISOString(), exit_reason: 'Signal reversal',
        }).eq('id', pos.id);
        const closeAction = pos.side === 'long' ? 'close_long' : 'close_short';
        await supabase.from('bot_trades').insert({
          bot_config_id: config.id, position_id: pos.id, action: closeAction,
          price: currentPrice, quantity: qty, pnl, balance_after: balance,
          reason: `Signal reversal (${analysis.bias}, score: ${analysis.score.toFixed(2)})`,
          indicators_snapshot: analysis,
        });
        await logBot(supabase, config.id, 'trade', `🔄 ZAMKNIĘCIE: ${pos.side} → ${analysis.bias}. PnL: $${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)`);
      }
    }

    // Open new position if no open positions and strong signal
    const { data: remainingOpen } = await supabase.from('bot_positions')
      .select('id').eq('bot_config_id', config.id).eq('status', 'open');

    if ((!remainingOpen || remainingOpen.length === 0) && Math.abs(analysis.score) > 0.3) {
      const positionSizePct = Number(config.position_size_pct) / 100;
      const margin = balance * positionSizePct;
      
      if (margin > 10 && balance > margin) {
        const leverage = Number(config.leverage);
        const notional = margin * leverage;
        const quantity = notional / currentPrice;
        const side = analysis.bias === 'bullish' ? 'long' : 'short';
        
        const slPct = Number(config.stop_loss_pct) / 100;
        const tpPct = Number(config.take_profit_pct) / 100;
        
        const stopLoss = side === 'long'
          ? currentPrice * (1 - slPct / leverage)
          : currentPrice * (1 + slPct / leverage);
        const takeProfit = side === 'long'
          ? currentPrice * (1 + tpPct / leverage)
          : currentPrice * (1 - tpPct / leverage);

        balance -= margin;

        const { data: newPos } = await supabase.from('bot_positions').insert({
          bot_config_id: config.id, side, entry_price: currentPrice, quantity,
          leverage, margin_used: margin, stop_loss: stopLoss, take_profit: takeProfit,
          entry_reason: `${analysis.bias} signal (score: ${analysis.score.toFixed(2)}, RSI: ${analysis.rsi.toFixed(1)})`,
        }).select().single();

        const openAction = side === 'long' ? 'open_long' : 'open_short';
        await supabase.from('bot_trades').insert({
          bot_config_id: config.id, position_id: newPos?.id, action: openAction,
          price: currentPrice, quantity, balance_after: balance,
          reason: `${side.toUpperCase()} @ $${currentPrice.toFixed(2)} | Margin: $${margin.toFixed(2)} | Leverage: ${leverage}x`,
          indicators_snapshot: analysis,
        });

        await logBot(supabase, config.id, 'trade',
          `📈 ${side.toUpperCase()} OPEN @ $${currentPrice.toFixed(2)} | Qty: ${quantity.toFixed(6)} BTC | SL: $${stopLoss.toFixed(2)} | TP: $${takeProfit.toFixed(2)}`);
      }
    }

    // Update balance
    await supabase.from('bot_config').update({ current_balance: balance }).eq('id', config.id);
    
    await logBot(supabase, config.id, 'info',
      `Tick: $${currentPrice.toFixed(2)} | Bias: ${analysis.bias} (${analysis.score.toFixed(2)}) | RSI: ${analysis.rsi.toFixed(1)} | Balance: $${balance.toFixed(2)}`);

    // Return current state
    const { data: positions } = await supabase.from('bot_positions')
      .select('*').eq('bot_config_id', config.id).order('opened_at', { ascending: false }).limit(20);
    const { data: trades } = await supabase.from('bot_trades')
      .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(50);
    const { data: logs } = await supabase.from('bot_logs')
      .select('*').eq('bot_config_id', config.id).order('created_at', { ascending: false }).limit(30);

    const updatedConfig = { ...config, current_balance: balance };

    return new Response(JSON.stringify({
      config: updatedConfig, positions, trades, logs, analysis, executed: true,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Trading bot error:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function logBot(supabase: any, configId: string, level: string, message: string, data?: any) {
  await supabase.from('bot_logs').insert({
    bot_config_id: configId, level, message, data,
  });
}
