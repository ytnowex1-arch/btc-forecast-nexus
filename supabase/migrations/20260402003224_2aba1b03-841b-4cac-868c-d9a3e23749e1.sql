CREATE TABLE IF NOT EXISTS public.users_profile (
  telegram_id text PRIMARY KEY,
  username text,
  user_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.users_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public access to users_profile" ON public.users_profile;
CREATE POLICY "Service role manages users_profile"
ON public.users_profile
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS update_users_profile_updated_at ON public.users_profile;
CREATE TRIGGER update_users_profile_updated_at
BEFORE UPDATE ON public.users_profile
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.telegram_bot_state (
  id integer PRIMARY KEY,
  update_offset bigint NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT telegram_bot_state_singleton CHECK (id = 1)
);

ALTER TABLE public.telegram_bot_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages telegram_bot_state" ON public.telegram_bot_state;
CREATE POLICY "Service role manages telegram_bot_state"
ON public.telegram_bot_state
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

INSERT INTO public.telegram_bot_state (id, update_offset)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.telegram_user_links (
  telegram_id text PRIMARY KEY,
  chat_id bigint NOT NULL,
  username text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.telegram_user_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages telegram_user_links" ON public.telegram_user_links;
CREATE POLICY "Service role manages telegram_user_links"
ON public.telegram_user_links
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

DROP TRIGGER IF EXISTS update_telegram_user_links_updated_at ON public.telegram_user_links;
CREATE TRIGGER update_telegram_user_links_updated_at
BEFORE UPDATE ON public.telegram_user_links
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_telegram_user_links_chat_id ON public.telegram_user_links (chat_id);
CREATE INDEX IF NOT EXISTS idx_users_profile_username ON public.users_profile (username);