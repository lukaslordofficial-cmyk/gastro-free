-- Poprawka dostępu REST do subscriptions (jeśli tabela istnieje, ale API/anon nie widzi wierszy).
-- Uruchom w Supabase SQL Editor po ADD_SUBSCRIPTIONS.sql.

GRANT ALL ON public.subscriptions TO anon, authenticated, service_role;

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'subscriptions' AND policyname = 'anon_all_subscriptions') THEN
    CREATE POLICY "anon_all_subscriptions" ON public.subscriptions
      FOR ALL TO anon, authenticated, service_role
      USING (true) WITH CHECK (true);
  END IF;
END $$;

INSERT INTO public.subscriptions (account_key, tier_level, credits_balance, status)
VALUES ('default', 0, 100, 'active')
ON CONFLICT (account_key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
