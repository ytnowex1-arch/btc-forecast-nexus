
-- Paper Trading Bot Schema

-- Bot configuration table
CREATE TABLE public.bot_config (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'BTC Futures Bot',
  is_active BOOLEAN NOT NULL DEFAULT false,
  symbol TEXT NOT NULL DEFAULT 'BTCUSDT',
  leverage INTEGER NOT NULL DEFAULT 5,
  interval TEXT NOT NULL DEFAULT '1h',
  initial_balance NUMERIC NOT NULL DEFAULT 10000,
  current_balance NUMERIC NOT NULL DEFAULT 10000,
  position_size_pct NUMERIC NOT NULL DEFAULT 10,
  stop_loss_pct NUMERIC NOT NULL DEFAULT 3,
  take_profit_pct NUMERIC NOT NULL DEFAULT 6,
  strategy TEXT NOT NULL DEFAULT 'multi_indicator',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Active and historical positions
CREATE TABLE public.bot_positions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_config_id UUID REFERENCES public.bot_config(id) ON DELETE CASCADE,
  side TEXT NOT NULL CHECK (side IN ('long', 'short')),
  entry_price NUMERIC NOT NULL,
  exit_price NUMERIC,
  quantity NUMERIC NOT NULL,
  leverage INTEGER NOT NULL DEFAULT 5,
  margin_used NUMERIC NOT NULL,
  pnl NUMERIC,
  pnl_pct NUMERIC,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'liquidated')),
  stop_loss NUMERIC,
  take_profit NUMERIC,
  entry_reason TEXT,
  exit_reason TEXT,
  opened_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  closed_at TIMESTAMP WITH TIME ZONE
);

-- Trade log for detailed history
CREATE TABLE public.bot_trades (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_config_id UUID REFERENCES public.bot_config(id) ON DELETE CASCADE,
  position_id UUID REFERENCES public.bot_positions(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('open_long', 'open_short', 'close_long', 'close_short', 'stop_loss', 'take_profit', 'liquidation')),
  price NUMERIC NOT NULL,
  quantity NUMERIC NOT NULL,
  pnl NUMERIC,
  balance_after NUMERIC,
  reason TEXT,
  indicators_snapshot JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Bot execution log
CREATE TABLE public.bot_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  bot_config_id UUID REFERENCES public.bot_config(id) ON DELETE CASCADE,
  level TEXT NOT NULL DEFAULT 'info' CHECK (level IN ('info', 'warn', 'error', 'trade')),
  message TEXT NOT NULL,
  data JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Disable RLS for all tables (paper trading, no user auth needed)
ALTER TABLE public.bot_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bot_logs ENABLE ROW LEVEL SECURITY;

-- Public access policies (paper trading - no auth required)
CREATE POLICY "Public access to bot_config" ON public.bot_config FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to bot_positions" ON public.bot_positions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to bot_trades" ON public.bot_trades FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public access to bot_logs" ON public.bot_logs FOR ALL USING (true) WITH CHECK (true);

-- Enable realtime for positions
ALTER PUBLICATION supabase_realtime ADD TABLE public.bot_positions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.bot_config;

-- Insert default bot config
INSERT INTO public.bot_config (name, initial_balance, current_balance, leverage, position_size_pct, stop_loss_pct, take_profit_pct)
VALUES ('BTC Paper Trading Bot', 10000, 10000, 5, 10, 3, 6);

-- Trigger for updated_at
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_bot_config_updated_at
BEFORE UPDATE ON public.bot_config
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
