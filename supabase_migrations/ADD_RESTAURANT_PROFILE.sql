-- =============================================================================
-- GASTRO MANAGER — Profil restauracji (dane kontaktowe dla dostawców)
-- Wklej i uruchom w Supabase SQL Editor.
-- Dopóki tej tabeli nie ma, backend zapisuje dane w pliku fallback — po
-- uruchomieniu tego skryptu dane będą trzymane w Supabase (zalecane).
-- =============================================================================

CREATE TABLE IF NOT EXISTS restaurant_profile (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_email varchar     DEFAULT '',
  contact_phone varchar     DEFAULT '',
  created_at    timestamptz DEFAULT now(),
  updated_at    timestamptz DEFAULT now()
);

ALTER TABLE restaurant_profile ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='restaurant_profile' AND policyname='anon_select_restaurant_profile') THEN
    CREATE POLICY "anon_select_restaurant_profile" ON restaurant_profile FOR SELECT TO anon, authenticated USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='restaurant_profile' AND policyname='anon_insert_restaurant_profile') THEN
    CREATE POLICY "anon_insert_restaurant_profile" ON restaurant_profile FOR INSERT TO anon, authenticated WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename='restaurant_profile' AND policyname='anon_update_restaurant_profile') THEN
    CREATE POLICY "anon_update_restaurant_profile" ON restaurant_profile FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
