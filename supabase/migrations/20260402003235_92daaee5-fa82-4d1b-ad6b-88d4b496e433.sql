DROP POLICY IF EXISTS "Service role manages users_profile" ON public.users_profile;
DROP POLICY IF EXISTS "Service role manages telegram_bot_state" ON public.telegram_bot_state;
DROP POLICY IF EXISTS "Service role manages telegram_user_links" ON public.telegram_user_links;

CREATE POLICY "No direct client access to users_profile"
ON public.users_profile
AS RESTRICTIVE
FOR ALL
TO public
USING (false)
WITH CHECK (false);

CREATE POLICY "No direct client access to telegram_bot_state"
ON public.telegram_bot_state
AS RESTRICTIVE
FOR ALL
TO public
USING (false)
WITH CHECK (false);

CREATE POLICY "No direct client access to telegram_user_links"
ON public.telegram_user_links
AS RESTRICTIVE
FOR ALL
TO public
USING (false)
WITH CHECK (false);