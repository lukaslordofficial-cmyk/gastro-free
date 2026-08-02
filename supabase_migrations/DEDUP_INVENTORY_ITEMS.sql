-- =============================================================================
-- DEDUP inventory_items — soft-delete nadmiarowych kopii tej samej nazwy
-- =============================================================================
-- Problem: skan menu / onboard tworzy 3–4× „Ser kozi”, „Rukola” itd.
-- Autocomplete i Łowca wtedy pokazą po duplikatach.
--
-- Zasada: w obrębie account_key + znormalizowanej nazwy zostaje 1 aktywny rekord
-- (preferuj: większy stan, ma category_id, starszy created_at). Reszta → is_active=false.
--
-- IDEMPOTENTNY. Nie kasuje fizycznie (soft-delete).
-- Uruchom w Supabase → SQL Editor (najpierw podgląd SELECT, potem UPDATE).
-- =============================================================================

-- 0) Upewnij się, że jest kolumna soft-delete
ALTER TABLE public.inventory_items
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- 1) PODGLĄD — grupy z ≥2 aktywnymi kopiami
-- (odkomentuj / uruchom osobno przed UPDATE)
/*
WITH normed AS (
  SELECT
    id,
    account_key,
    name,
    quantity,
    category_id,
    created_at,
    is_active,
    lower(trim(regexp_replace(
      translate(name, 'ĄĆĘŁŃÓŚŹŻąćęłńóśźż', 'ACELNOSZZacelnoszz'),
      '\s+', ' ', 'g'
    ))) AS name_key
  FROM public.inventory_items
  WHERE coalesce(is_active, true) = true
    AND nullif(trim(name), '') IS NOT NULL
    AND position('(dup)' in lower(name)) = 0
)
SELECT
  account_key,
  name_key,
  count(*) AS copies,
  array_agg(name ORDER BY created_at) AS names,
  array_agg(id::text ORDER BY created_at) AS ids
FROM normed
GROUP BY account_key, name_key
HAVING count(*) >= 2
ORDER BY copies DESC, name_key
LIMIT 200;
*/

-- 2) Soft-delete aktywnych nadmiarów + twarde usunięcie już nieaktywnych kopii
--    (to właśnie zaśmieca autocomplete, gdy FE nie filtruje is_active).
WITH normed AS (
  SELECT
    id,
    account_key,
    name,
    coalesce(is_active, true) AS is_active,
    coalesce(quantity, 0) AS quantity,
    category_id,
    created_at,
    lower(trim(regexp_replace(
      translate(name, 'ĄĆĘŁŃÓŚŹŻąćęłńóśźż', 'ACELNOSZZacelnoszz'),
      '\s+', ' ', 'g'
    ))) AS name_key
  FROM public.inventory_items
  WHERE nullif(trim(name), '') IS NOT NULL
    AND position('(dup)' in lower(name)) = 0
),
ranked AS (
  SELECT
    id,
    is_active,
    row_number() OVER (
      PARTITION BY account_key, name_key
      ORDER BY
        is_active DESC,
        (category_id IS NOT NULL) DESC,
        quantity DESC,
        created_at ASC NULLS LAST,
        id ASC
    ) AS rn
  FROM normed
),
soft_losers AS (
  SELECT id FROM ranked WHERE rn > 1 AND is_active = true
),
hard_losers AS (
  SELECT id FROM ranked WHERE rn > 1 AND is_active = false
),
soft_upd AS (
  UPDATE public.inventory_items i
  SET is_active = false
  FROM soft_losers l
  WHERE i.id = l.id
  RETURNING i.id
)
DELETE FROM public.inventory_items i
USING hard_losers h
WHERE i.id = h.id;

-- 3) Szybki check po czyszczeniu
SELECT
  count(*) FILTER (WHERE coalesce(is_active, true)) AS active_items,
  count(*) FILTER (WHERE coalesce(is_active, true) = false) AS inactive_items
FROM public.inventory_items;
