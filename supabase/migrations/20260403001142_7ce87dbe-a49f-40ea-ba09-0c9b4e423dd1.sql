CREATE OR REPLACE FUNCTION public.run_active_trading_bots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  base_url text := 'https://maxeahbntaoedqnrjfyu.supabase.co';
  cfg record;
  headers jsonb := jsonb_build_object('Content-Type', 'application/json');
BEGIN
  FOR cfg IN
    SELECT id
    FROM public.bot_config
    WHERE is_active = true
  LOOP
    PERFORM extensions.http_post(
      url := base_url || '/functions/v1/trading-bot',
      headers := headers,
      body := jsonb_build_object('action', 'trail', 'config_id', cfg.id),
      timeout_milliseconds := 9000
    );

    PERFORM extensions.http_post(
      url := base_url || '/functions/v1/trading-bot',
      headers := headers,
      body := jsonb_build_object('action', 'run', 'config_id', cfg.id),
      timeout_milliseconds := 9000
    );
  END LOOP;
END;
$body$;

CREATE OR REPLACE FUNCTION public.poll_telegram_mini_app_updates()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  base_url text := 'https://maxeahbntaoedqnrjfyu.supabase.co';
  headers jsonb := jsonb_build_object('Content-Type', 'application/json');
BEGIN
  PERFORM extensions.http_post(
    url := base_url || '/functions/v1/telegram-poll',
    headers := headers,
    body := '{}'::jsonb,
    timeout_milliseconds := 9000
  );
END;
$body$;