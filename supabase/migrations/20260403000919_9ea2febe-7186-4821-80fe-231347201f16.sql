CREATE OR REPLACE FUNCTION public.run_active_trading_bots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  project_url text := current_setting('app.settings.supabase_url', true);
  service_role_key text := current_setting('app.settings.service_role_key', true);
  cfg record;
  headers jsonb;
BEGIN
  IF project_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING 'Missing backend settings for trading bot scheduler';
    RETURN;
  END IF;

  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || service_role_key,
    'apikey', service_role_key
  );

  FOR cfg IN
    SELECT id
    FROM public.bot_config
    WHERE is_active = true
  LOOP
    PERFORM extensions.http_post(
      url := project_url || '/functions/v1/trading-bot',
      headers := headers,
      body := jsonb_build_object('action', 'trail', 'config_id', cfg.id),
      timeout_milliseconds := 9000
    );

    PERFORM extensions.http_post(
      url := project_url || '/functions/v1/trading-bot',
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
  project_url text := current_setting('app.settings.supabase_url', true);
  service_role_key text := current_setting('app.settings.service_role_key', true);
  headers jsonb;
BEGIN
  IF project_url IS NULL OR service_role_key IS NULL THEN
    RAISE WARNING 'Missing backend settings for telegram polling scheduler';
    RETURN;
  END IF;

  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || service_role_key,
    'apikey', service_role_key
  );

  PERFORM extensions.http_post(
    url := project_url || '/functions/v1/telegram-poll',
    headers := headers,
    body := '{}'::jsonb,
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