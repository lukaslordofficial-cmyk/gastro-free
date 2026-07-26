-- =============================================================================
-- Seed pustych kategorii magazynowych per account_key (upsert brakujących).
-- Nie usuwa / nie nadpisuje kategorii utworzonych przez użytkownika.
-- Uruchom w Supabase SQL Editor (project tucmmrcwwcltkqwyvzxa) lub via MCP.
-- =============================================================================

WITH seed(name, color, sort_order) AS (
  VALUES
    ('Mięso i wędliny',     '#DC2626', 10),
    ('Ryby i owoce morza',  '#0284C7', 20),
    ('Nabiał',              '#F59E0B', 30),
    ('Warzywa i owoce',     '#16A34A', 40),
    ('Pieczywo',            '#78716C', 50),
    ('Suchy magazyn',       '#B45309', 60),
    ('Oleje i tłuszcze',    '#CA8A04', 70),
    ('Przyprawy',           '#D97706', 80),
    ('Mrożonki',            '#0EA5E9', 90),
    ('Napoje',              '#0891B2', 100),
    ('Alkohole',            '#7C3AED', 110),
    ('Wywary i sosy',       '#EA580C', 120),
    ('Chemia i czystość',   '#6366F1', 130),
    ('Opakowania',          '#64748B', 140),
    ('Inne',                '#94A3B8', 150)
),
keys AS (
  SELECT DISTINCT account_key
  FROM (
    SELECT account_key FROM public.profiles
      WHERE account_key IS NOT NULL AND btrim(account_key) <> ''
    UNION
    SELECT account_key FROM public.inventory_categories
      WHERE account_key IS NOT NULL AND btrim(account_key) <> ''
    UNION
    SELECT account_key FROM public.inventory_items
      WHERE account_key IS NOT NULL AND btrim(account_key) <> ''
  ) s
),
missing AS (
  SELECT k.account_key, s.name, s.color, s.sort_order
  FROM keys k
  CROSS JOIN seed s
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.inventory_categories ic
    WHERE ic.account_key = k.account_key
      AND lower(translate(ic.name,
            'ĄĆĘŁŃÓŚŹŻąćęłńóśźż',
            'ACELNOSZZacelnoszz')) =
          lower(translate(s.name,
            'ĄĆĘŁŃÓŚŹŻąćęłńóśźż',
            'ACELNOSZZacelnoszz'))
  )
)
INSERT INTO public.inventory_categories (name, color, icon_name, sort_order, account_key)
SELECT name, color, 'package', sort_order, account_key
FROM missing;
