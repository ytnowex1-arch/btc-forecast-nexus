CREATE POLICY "Service role can manage users_profile"
ON public.users_profile
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can manage telegram_user_links"
ON public.telegram_user_links
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

CREATE POLICY "Service role can manage telegram_bot_state"
ON public.telegram_bot_state
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);