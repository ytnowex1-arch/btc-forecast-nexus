DROP POLICY IF EXISTS "Public access to bot_config" ON public.bot_config;
DROP POLICY IF EXISTS "Public access to bot_logs" ON public.bot_logs;
DROP POLICY IF EXISTS "Public access to bot_positions" ON public.bot_positions;
DROP POLICY IF EXISTS "Public access to bot_trades" ON public.bot_trades;

CREATE POLICY "No direct client access to bot_config"
ON public.bot_config
AS RESTRICTIVE
FOR ALL
TO public
USING (false)
WITH CHECK (false);

CREATE POLICY "No direct client access to bot_logs"
ON public.bot_logs
AS RESTRICTIVE
FOR ALL
TO public
USING (false)
WITH CHECK (false);

CREATE POLICY "No direct client access to bot_positions"
ON public.bot_positions
AS RESTRICTIVE
FOR ALL
TO public
USING (false)
WITH CHECK (false);

CREATE POLICY "No direct client access to bot_trades"
ON public.bot_trades
AS RESTRICTIVE
FOR ALL
TO public
USING (false)
WITH CHECK (false);