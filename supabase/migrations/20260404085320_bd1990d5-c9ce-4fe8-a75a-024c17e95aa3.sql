-- Update existing symbols to MEXC format
UPDATE public.bot_config SET symbol = 'BTC_USDT' WHERE symbol = 'BTCUSDT';
UPDATE public.bot_config SET symbol = 'ETH_USDT' WHERE symbol = 'ETHUSDT';

-- Insert new configs for SOL, XRP, BNB (only if not existing)
INSERT INTO public.bot_config (name, symbol, is_active, initial_balance, current_balance, leverage, position_size_pct, stop_loss_pct, take_profit_pct, interval, strategy)
SELECT 'SOL Futures Bot', 'SOL_USDT', false, 10000, 10000, 5, 10, 3, 6, '1h', 'multi_indicator'
WHERE NOT EXISTS (SELECT 1 FROM public.bot_config WHERE symbol = 'SOL_USDT');

INSERT INTO public.bot_config (name, symbol, is_active, initial_balance, current_balance, leverage, position_size_pct, stop_loss_pct, take_profit_pct, interval, strategy)
SELECT 'XRP Futures Bot', 'XRP_USDT', false, 10000, 10000, 5, 10, 3, 6, '1h', 'multi_indicator'
WHERE NOT EXISTS (SELECT 1 FROM public.bot_config WHERE symbol = 'XRP_USDT');

INSERT INTO public.bot_config (name, symbol, is_active, initial_balance, current_balance, leverage, position_size_pct, stop_loss_pct, take_profit_pct, interval, strategy)
SELECT 'BNB Futures Bot', 'BNB_USDT', false, 10000, 10000, 5, 10, 3, 6, '1h', 'multi_indicator'
WHERE NOT EXISTS (SELECT 1 FROM public.bot_config WHERE symbol = 'BNB_USDT');