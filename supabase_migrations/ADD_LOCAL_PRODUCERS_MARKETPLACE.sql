-- =============================================================================
-- GASTRO MANAGER — ETAP 2: Marketplace B2B „Lokalni Przetwórcy”
-- Uruchom w Supabase SQL Editor (ten sam projekt co apka restauratorów).
-- Idempotentne. NIE modyfikuje istniejących tabel (suppliers, inventory, …).
--
-- Po uruchomieniu:
--  1) Dashboard → Database → Replication: upewnij się, że realtime jest ON
--     (skrypt dodaje tabele do publication supabase_realtime).
--  2) Auth producentów: osobne konta auth.users; local_producers.auth_user_id.
--  3) Admin LP: ustaw w Auth user → App Metadata:
--       { "lp_admin": true }  LUB  { "role": "admin" }
-- =============================================================================

-- ── Helpers ──────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_lp_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'lp_admin')::boolean,
    false
  )
  OR coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

REVOKE ALL ON FUNCTION public.is_lp_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_lp_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_lp_admin() TO service_role;

-- current_account_key() może już istnieć (FIX_TENANT_RLS) — nie nadpisujemy agresywnie
CREATE OR REPLACE FUNCTION public.current_account_key()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT p.account_key INTO k
  FROM public.profiles p
  WHERE p.id = auth.uid()
  LIMIT 1;
  IF k IS NOT NULL AND length(trim(k)) > 0 THEN
    RETURN k;
  END IF;
  RETURN 'ak_' || replace(auth.uid()::text, '-', '');
END;
$$;

REVOKE ALL ON FUNCTION public.current_account_key() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.current_account_key() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_account_key() TO service_role;

-- ── 1. local_producers ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.local_producers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id      uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  company_name      text NOT NULL,
  owner_name        text,
  email             text,
  phone             text,
  description       text,
  voivodeship       text,
  county            text,
  city              text,
  address           text,
  postal_code       text,
  latitude          double precision,
  longitude         double precision,
  logo_url          text,
  banner_url        text,
  verified          boolean NOT NULL DEFAULT false,
  active            boolean NOT NULL DEFAULT true,
  min_order_value   numeric(12, 2) NOT NULL DEFAULT 0,
  pickup_available  boolean NOT NULL DEFAULT true,
  courier_available boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS local_producers_auth_user_id_idx
  ON public.local_producers (auth_user_id);
CREATE INDEX IF NOT EXISTS local_producers_active_verified_idx
  ON public.local_producers (active, verified)
  WHERE active = true AND verified = true;
CREATE INDEX IF NOT EXISTS local_producers_voivodeship_idx
  ON public.local_producers (voivodeship);
CREATE INDEX IF NOT EXISTS local_producers_city_idx
  ON public.local_producers (city);

DROP TRIGGER IF EXISTS local_producers_set_updated_at ON public.local_producers;
CREATE TRIGGER local_producers_set_updated_at
  BEFORE UPDATE ON public.local_producers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Helper zależny od tabeli local_producers
CREATE OR REPLACE FUNCTION public.is_producer_owner(p_producer_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.local_producers lp
    WHERE lp.id = p_producer_id
      AND lp.auth_user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_producer_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_producer_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_producer_owner(uuid) TO service_role;

-- ── 2. producer_categories ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.producer_categories (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL UNIQUE,
  slug       text NOT NULL UNIQUE,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.producer_categories (name, slug, sort_order) VALUES
  ('Miody', 'miody', 10),
  ('Dżemy', 'dzemy', 20),
  ('Syropy', 'syropy', 30),
  ('Oleje', 'oleje', 40),
  ('Mąki', 'maki', 50),
  ('Kasze', 'kasze', 60),
  ('Kiszonki', 'kiszonki', 70),
  ('Warzywa', 'warzywa', 80),
  ('Owoce', 'owoce', 90),
  ('Przyprawy', 'przyprawy', 100),
  ('Zioła', 'ziola', 110),
  ('Grzyby', 'grzyby', 120),
  ('Inne', 'inne', 999)
ON CONFLICT (slug) DO NOTHING;

-- ── 3. producer_products ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.producer_products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id uuid NOT NULL REFERENCES public.local_producers (id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.producer_categories (id) ON DELETE SET NULL,
  title       text NOT NULL,
  description text,
  price       numeric(12, 2) NOT NULL CHECK (price >= 0),
  unit        text NOT NULL DEFAULT 'szt',
  stock       numeric(12, 3) NOT NULL DEFAULT 0 CHECK (stock >= 0),
  image_url   text,
  weight_g    numeric(12, 2),
  available   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS producer_products_producer_id_idx
  ON public.producer_products (producer_id);
CREATE INDEX IF NOT EXISTS producer_products_category_id_idx
  ON public.producer_products (category_id);
CREATE INDEX IF NOT EXISTS producer_products_available_idx
  ON public.producer_products (available)
  WHERE available = true;

DROP TRIGGER IF EXISTS producer_products_set_updated_at ON public.producer_products;
CREATE TRIGGER producer_products_set_updated_at
  BEFORE UPDATE ON public.producer_products
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 4. producer_product_gallery ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.producer_product_gallery (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.producer_products (id) ON DELETE CASCADE,
  image_url  text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS producer_product_gallery_product_id_idx
  ON public.producer_product_gallery (product_id);

-- ── 5. producer_orders ───────────────────────────────────────────────────────
-- restaurant_id = auth.users / profiles.id restauratora
-- restaurant_account_key = profiles.account_key (izolacja tenantowa jak w reszcie apki)
-- Płatności / kurier: tylko statusy tekstowe — bez Stripe / InPost na tym etapie.

CREATE TABLE IF NOT EXISTS public.producer_orders (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id            uuid NOT NULL REFERENCES public.local_producers (id) ON DELETE RESTRICT,
  restaurant_id          uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
  restaurant_account_key text NOT NULL,
  total_price            numeric(12, 2) NOT NULL DEFAULT 0 CHECK (total_price >= 0),
  shipping_cost          numeric(12, 2) NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  platform_fee           numeric(12, 2) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
  payment_status         text NOT NULL DEFAULT 'pending'
                           CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded', 'cancelled')),
  shipment_status        text NOT NULL DEFAULT 'draft'
                           CHECK (shipment_status IN ('draft', 'confirmed', 'preparing', 'shipped', 'delivered', 'cancelled')),
  notes                  text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS producer_orders_producer_id_idx
  ON public.producer_orders (producer_id);
CREATE INDEX IF NOT EXISTS producer_orders_restaurant_id_idx
  ON public.producer_orders (restaurant_id);
CREATE INDEX IF NOT EXISTS producer_orders_restaurant_account_key_idx
  ON public.producer_orders (restaurant_account_key);

DROP TRIGGER IF EXISTS producer_orders_set_updated_at ON public.producer_orders;
CREATE TRIGGER producer_orders_set_updated_at
  BEFORE UPDATE ON public.producer_orders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── 6. producer_order_items ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.producer_order_items (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id   uuid NOT NULL REFERENCES public.producer_orders (id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.producer_products (id) ON DELETE RESTRICT,
  quantity   numeric(12, 3) NOT NULL CHECK (quantity > 0),
  unit_price numeric(12, 2) NOT NULL CHECK (unit_price >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS producer_order_items_order_id_idx
  ON public.producer_order_items (order_id);
CREATE INDEX IF NOT EXISTS producer_order_items_product_id_idx
  ON public.producer_order_items (product_id);

-- ── 7. producer_reviews ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.producer_reviews (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id    uuid NOT NULL REFERENCES public.local_producers (id) ON DELETE CASCADE,
  restaurant_id  uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  restaurant_account_key text NOT NULL,
  quality        smallint NOT NULL CHECK (quality BETWEEN 1 AND 5),
  delivery       smallint NOT NULL CHECK (delivery BETWEEN 1 AND 5),
  communication  smallint NOT NULL CHECK (communication BETWEEN 1 AND 5),
  comment        text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (producer_id, restaurant_account_key)
);

CREATE INDEX IF NOT EXISTS producer_reviews_producer_id_idx
  ON public.producer_reviews (producer_id);

-- ── 8. producer_documents ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.producer_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id   uuid NOT NULL REFERENCES public.local_producers (id) ON DELETE CASCADE,
  document_type text NOT NULL,
  file_url      text NOT NULL,
  verified      boolean NOT NULL DEFAULT false,
  uploaded_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS producer_documents_producer_id_idx
  ON public.producer_documents (producer_id);

-- ── 9. producer_notifications ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.producer_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id uuid NOT NULL REFERENCES public.local_producers (id) ON DELETE CASCADE,
  title       text NOT NULL,
  message     text NOT NULL,
  read        boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS producer_notifications_producer_id_idx
  ON public.producer_notifications (producer_id, read);

-- =============================================================================
-- RLS
-- =============================================================================

ALTER TABLE public.local_producers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producer_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producer_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producer_product_gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producer_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producer_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producer_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producer_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.producer_notifications ENABLE ROW LEVEL SECURITY;

-- Drop old LP policies (idempotent re-run)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename IN (
        'local_producers', 'producer_categories', 'producer_products',
        'producer_product_gallery', 'producer_orders', 'producer_order_items',
        'producer_reviews', 'producer_documents', 'producer_notifications'
      )
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, r.tablename);
  END LOOP;
END $$;

-- ── local_producers ──────────────────────────────────────────────────────────
-- Restaurator: tylko aktywni + zweryfikowani
CREATE POLICY lp_producers_restaurant_select ON public.local_producers
  FOR SELECT TO authenticated
  USING (
    public.is_lp_admin()
    OR auth_user_id = auth.uid()
    OR (active = true AND verified = true)
  );

CREATE POLICY lp_producers_owner_insert ON public.local_producers
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_lp_admin()
    OR auth_user_id = auth.uid()
  );

CREATE POLICY lp_producers_owner_update ON public.local_producers
  FOR UPDATE TO authenticated
  USING (public.is_lp_admin() OR auth_user_id = auth.uid())
  WITH CHECK (public.is_lp_admin() OR auth_user_id = auth.uid());

CREATE POLICY lp_producers_owner_delete ON public.local_producers
  FOR DELETE TO authenticated
  USING (public.is_lp_admin() OR auth_user_id = auth.uid());

CREATE POLICY lp_producers_service_all ON public.local_producers
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── producer_categories (odczyt dla wszystkich zalogowanych) ─────────────────
CREATE POLICY lp_categories_select ON public.producer_categories
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY lp_categories_admin_write ON public.producer_categories
  FOR ALL TO authenticated
  USING (public.is_lp_admin())
  WITH CHECK (public.is_lp_admin());

CREATE POLICY lp_categories_service_all ON public.producer_categories
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── producer_products ────────────────────────────────────────────────────────
CREATE POLICY lp_products_select ON public.producer_products
  FOR SELECT TO authenticated
  USING (
    public.is_lp_admin()
    OR public.is_producer_owner(producer_id)
    OR (
      available = true
      AND EXISTS (
        SELECT 1 FROM public.local_producers lp
        WHERE lp.id = producer_id
          AND lp.active = true
          AND lp.verified = true
      )
    )
  );

CREATE POLICY lp_products_owner_insert ON public.producer_products
  FOR INSERT TO authenticated
  WITH CHECK (public.is_lp_admin() OR public.is_producer_owner(producer_id));

CREATE POLICY lp_products_owner_update ON public.producer_products
  FOR UPDATE TO authenticated
  USING (public.is_lp_admin() OR public.is_producer_owner(producer_id))
  WITH CHECK (public.is_lp_admin() OR public.is_producer_owner(producer_id));

CREATE POLICY lp_products_owner_delete ON public.producer_products
  FOR DELETE TO authenticated
  USING (public.is_lp_admin() OR public.is_producer_owner(producer_id));

CREATE POLICY lp_products_service_all ON public.producer_products
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── gallery ──────────────────────────────────────────────────────────────────
CREATE POLICY lp_gallery_select ON public.producer_product_gallery
  FOR SELECT TO authenticated
  USING (
    public.is_lp_admin()
    OR EXISTS (
      SELECT 1 FROM public.producer_products pp
      WHERE pp.id = product_id
        AND (
          public.is_producer_owner(pp.producer_id)
          OR (
            pp.available = true
            AND EXISTS (
              SELECT 1 FROM public.local_producers lp
              WHERE lp.id = pp.producer_id AND lp.active AND lp.verified
            )
          )
        )
    )
  );

CREATE POLICY lp_gallery_owner_write ON public.producer_product_gallery
  FOR ALL TO authenticated
  USING (
    public.is_lp_admin()
    OR EXISTS (
      SELECT 1 FROM public.producer_products pp
      WHERE pp.id = product_id AND public.is_producer_owner(pp.producer_id)
    )
  )
  WITH CHECK (
    public.is_lp_admin()
    OR EXISTS (
      SELECT 1 FROM public.producer_products pp
      WHERE pp.id = product_id AND public.is_producer_owner(pp.producer_id)
    )
  );

CREATE POLICY lp_gallery_service_all ON public.producer_product_gallery
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── orders ───────────────────────────────────────────────────────────────────
CREATE POLICY lp_orders_select ON public.producer_orders
  FOR SELECT TO authenticated
  USING (
    public.is_lp_admin()
    OR public.is_producer_owner(producer_id)
    OR restaurant_id = auth.uid()
    OR restaurant_account_key = public.current_account_key()
  );

CREATE POLICY lp_orders_restaurant_insert ON public.producer_orders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_lp_admin()
    OR (
      restaurant_id = auth.uid()
      AND restaurant_account_key = public.current_account_key()
    )
  );

CREATE POLICY lp_orders_update ON public.producer_orders
  FOR UPDATE TO authenticated
  USING (
    public.is_lp_admin()
    OR public.is_producer_owner(producer_id)
    OR restaurant_id = auth.uid()
  )
  WITH CHECK (
    public.is_lp_admin()
    OR public.is_producer_owner(producer_id)
    OR restaurant_id = auth.uid()
  );

CREATE POLICY lp_orders_service_all ON public.producer_orders
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── order items ──────────────────────────────────────────────────────────────
CREATE POLICY lp_order_items_select ON public.producer_order_items
  FOR SELECT TO authenticated
  USING (
    public.is_lp_admin()
    OR EXISTS (
      SELECT 1 FROM public.producer_orders o
      WHERE o.id = order_id
        AND (
          public.is_producer_owner(o.producer_id)
          OR o.restaurant_id = auth.uid()
          OR o.restaurant_account_key = public.current_account_key()
        )
    )
  );

CREATE POLICY lp_order_items_insert ON public.producer_order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_lp_admin()
    OR EXISTS (
      SELECT 1 FROM public.producer_orders o
      WHERE o.id = order_id
        AND o.restaurant_id = auth.uid()
        AND o.restaurant_account_key = public.current_account_key()
    )
  );

CREATE POLICY lp_order_items_service_all ON public.producer_order_items
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── reviews ──────────────────────────────────────────────────────────────────
CREATE POLICY lp_reviews_select ON public.producer_reviews
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY lp_reviews_restaurant_insert ON public.producer_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_lp_admin()
    OR (
      restaurant_id = auth.uid()
      AND restaurant_account_key = public.current_account_key()
    )
  );

CREATE POLICY lp_reviews_restaurant_update ON public.producer_reviews
  FOR UPDATE TO authenticated
  USING (
    public.is_lp_admin()
    OR (
      restaurant_id = auth.uid()
      AND restaurant_account_key = public.current_account_key()
    )
  )
  WITH CHECK (
    public.is_lp_admin()
    OR (
      restaurant_id = auth.uid()
      AND restaurant_account_key = public.current_account_key()
    )
  );

CREATE POLICY lp_reviews_service_all ON public.producer_reviews
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── documents (właściciel + admin; restaurator NIE widzi plików wrażliwych) ──
CREATE POLICY lp_documents_owner_select ON public.producer_documents
  FOR SELECT TO authenticated
  USING (public.is_lp_admin() OR public.is_producer_owner(producer_id));

CREATE POLICY lp_documents_owner_write ON public.producer_documents
  FOR ALL TO authenticated
  USING (public.is_lp_admin() OR public.is_producer_owner(producer_id))
  WITH CHECK (public.is_lp_admin() OR public.is_producer_owner(producer_id));

CREATE POLICY lp_documents_service_all ON public.producer_documents
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ── notifications ────────────────────────────────────────────────────────────
CREATE POLICY lp_notifications_owner ON public.producer_notifications
  FOR ALL TO authenticated
  USING (public.is_lp_admin() OR public.is_producer_owner(producer_id))
  WITH CHECK (public.is_lp_admin() OR public.is_producer_owner(producer_id));

CREATE POLICY lp_notifications_service_all ON public.producer_notifications
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.local_producers TO authenticated;
GRANT SELECT ON public.producer_categories TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.producer_products TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.producer_product_gallery TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.producer_orders TO authenticated;
GRANT SELECT, INSERT ON public.producer_order_items TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.producer_reviews TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.producer_documents TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.producer_notifications TO authenticated;

GRANT ALL ON public.local_producers TO service_role;
GRANT ALL ON public.producer_categories TO service_role;
GRANT ALL ON public.producer_products TO service_role;
GRANT ALL ON public.producer_product_gallery TO service_role;
GRANT ALL ON public.producer_orders TO service_role;
GRANT ALL ON public.producer_order_items TO service_role;
GRANT ALL ON public.producer_reviews TO service_role;
GRANT ALL ON public.producer_documents TO service_role;
GRANT ALL ON public.producer_notifications TO service_role;

-- =============================================================================
-- Storage buckets
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES
  ('producer-logos', 'producer-logos', true, 5242880,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('producer-banners', 'producer-banners', true, 10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('producer-products', 'producer-products', true, 10485760,
    ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
  ('producer-documents', 'producer-documents', false, 20971520,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Storage policies (ścieżka: {auth_user_id}/... lub {producer_id}/...)
DO $$
BEGIN
  -- public read for public buckets
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'lp_public_read_logos'
  ) THEN
    CREATE POLICY lp_public_read_logos ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'producer-logos');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'lp_public_read_banners'
  ) THEN
    CREATE POLICY lp_public_read_banners ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'producer-banners');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'lp_public_read_products'
  ) THEN
    CREATE POLICY lp_public_read_products ON storage.objects
      FOR SELECT TO public
      USING (bucket_id = 'producer-products');
  END IF;

  -- authenticated upload/update/delete own folder (first path segment = auth.uid())
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'lp_owner_write_media'
  ) THEN
    CREATE POLICY lp_owner_write_media ON storage.objects
      FOR ALL TO authenticated
      USING (
        bucket_id IN ('producer-logos', 'producer-banners', 'producer-products', 'producer-documents')
        AND (
          public.is_lp_admin()
          OR (storage.foldername(name))[1] = auth.uid()::text
        )
      )
      WITH CHECK (
        bucket_id IN ('producer-logos', 'producer-banners', 'producer-products', 'producer-documents')
        AND (
          public.is_lp_admin()
          OR (storage.foldername(name))[1] = auth.uid()::text
        )
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND policyname = 'lp_owner_read_documents'
  ) THEN
    CREATE POLICY lp_owner_read_documents ON storage.objects
      FOR SELECT TO authenticated
      USING (
        bucket_id = 'producer-documents'
        AND (
          public.is_lp_admin()
          OR (storage.foldername(name))[1] = auth.uid()::text
        )
      );
  END IF;
END $$;

-- =============================================================================
-- Realtime — zmiany produktów / producentów / opinii → apka restauratora
-- =============================================================================

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.local_producers;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.producer_products;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.producer_reviews;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- Odśwież cache PostgREST
NOTIFY pgrst, 'reload schema';
