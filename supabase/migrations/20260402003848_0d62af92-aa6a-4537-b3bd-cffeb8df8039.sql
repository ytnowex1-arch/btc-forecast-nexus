DROP POLICY IF EXISTS "No direct client access to bot_logs" ON public.bot_logs;

CREATE POLICY "Public can read bot_logs"
ON public.bot_logs
FOR SELECT
TO public
USING (true);

CREATE POLICY "No public writes to bot_logs"
ON public.bot_logs
AS RESTRICTIVE
FOR INSERT
TO public
WITH CHECK (false);

CREATE POLICY "No public updates to bot_logs"
ON public.bot_logs
AS RESTRICTIVE
FOR UPDATE
TO public
USING (false)
WITH CHECK (false);

CREATE POLICY "No public deletes to bot_logs"
ON public.bot_logs
AS RESTRICTIVE
FOR DELETE
TO public
USING (false);