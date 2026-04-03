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
    PERFORM net.http_post(
      url := base_url || '/functions/v1/trading-bot',
      body := jsonb_build_object('action', 'trail', 'config_id', cfg.id),
      params := '{}'::jsonb,
      headers := headers,
      timeout_milliseconds := 9000
    );

    PERFORM net.http_post(
      url := base_url || '/functions/v1/trading-bot',
      body := jsonb_build_object('action', 'run', 'config_id', cfg.id),
      params := '{}'::jsonb,
      headers := headers,
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
  PERFORM net.http_post(
    url := base_url || '/functions/v1/telegram-poll',
    body := '{}'::jsonb,
    params := '{}'::jsonb,
    headers := headers,
    timeout_milliseconds := 9000
  );
END;
$body$;

DO $body$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'run-active-trading-bots-every-10-seconds') THEN
    PERFORM cron.unschedule('run-active-trading-bots-every-10-seconds');
  END IF;

  PERFORM cron.schedule(
    'run-active-trading-bots-every-10-seconds',
    '10 seconds',
    $job$SELECT public.run_active_trading_bots();$job$
  );
END;
$body$;

DO $body$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'poll-telegram-mini-app-updates-every-minute') THEN
    PERFORM cron.unschedule('poll-telegram-mini-app-updates-every-minute');
  END IF;

  PERFORM cron.schedule(
    'poll-telegram-mini-app-updates-every-minute',
    '* * * * *',
    $job$SELECT public.poll_telegram_mini_app_updates();$job$
  );
END;
$body$;