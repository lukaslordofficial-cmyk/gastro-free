-- =============================================================================
-- GASTRO MANAGER — Izolacja danych per restauracja (account_key)
-- Uruchom w Supabase SQL Editor PO ADD_AUTH_PROFILES.sql
--
-- Istniejące wiersze → account_key = 'default' (stare demo / Twój lokal).
-- Nowi użytkownicy (ak_<uuid>) widzą PUSTY magazyn / menu / dostawców.
-- =============================================================================

DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'inventory_items',
    'inventory_categories',
    'menu_items',
    'suppliers',
    'waste_logs',
    'warehouse_inventory',
    'supplier_offers'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS account_key text NOT NULL DEFAULT %L',
        t, 'default'
      );
      EXECUTE format(
        'CREATE INDEX IF NOT EXISTS %I ON public.%I (account_key)',
        t || '_account_key_idx', t
      );
    END IF;
  END LOOP;
END $$;

-- Opcjonalnie: supplier_catalog dziedziczy przez supplier_id — bez osobnej kolumny.
-- recipe_ingredients → przez menu_item_id.

-- RLS: zalogowany user widzi/edytuje tylko swój account_key
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'inventory_items',
    'inventory_categories',
    'menu_items',
    'suppliers',
    'waste_logs'
  ];
  pol text;
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    pol := t || '_tenant_select';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = pol) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
         USING (account_key IN (SELECT p.account_key FROM public.profiles p WHERE p.id = auth.uid()))',
        pol, t
      );
    END IF;

    pol := t || '_tenant_insert';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = pol) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated
         WITH CHECK (account_key IN (SELECT p.account_key FROM public.profiles p WHERE p.id = auth.uid()))',
        pol, t
      );
    END IF;

    pol := t || '_tenant_update';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = pol) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated
         USING (account_key IN (SELECT p.account_key FROM public.profiles p WHERE p.id = auth.uid()))
         WITH CHECK (account_key IN (SELECT p.account_key FROM public.profiles p WHERE p.id = auth.uid()))',
        pol, t
      );
    END IF;

    pol := t || '_tenant_delete';
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = pol) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated
         USING (account_key IN (SELECT p.account_key FROM public.profiles p WHERE p.id = auth.uid()))',
        pol, t
      );
    END IF;
  END LOOP;
END $$;

-- Usuń stare „otwarte” polityki na tych tabelach (inaczej OR w RLS i tak pokaże wszystko).
-- Zachowujemy tylko polityki *_tenant_* oraz service_*.
DO $$
DECLARE
  t text;
  p text;
  tables text[] := ARRAY[
    'inventory_items',
    'inventory_categories',
    'menu_items',
    'suppliers',
    'waste_logs'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      CONTINUE;
    END IF;
    FOR p IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
        AND policyname NOT LIKE '%tenant%'
        AND policyname NOT LIKE 'service_%'
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p, t);
    END LOOP;
  END LOOP;
END $$;

-- Uwaga: service_role (backend) omija RLS — filtr account_key jest w kodzie API.
