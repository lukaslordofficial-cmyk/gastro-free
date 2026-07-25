-- Opcjonalny katalog ikon produktów (Supabase).
-- Aplikacja ma też lokalny katalog w frontend/lib/productImages.ts —
-- tabela pozwala aktualizować mapowania bez release'u aplikacji.

create table if not exists public.product_image_catalog (
  slug text primary key,
  category text not null,
  label_pl text,
  aliases text[] default '{}',
  storage_path text not null,
  public_url text not null,
  updated_at timestamptz default now()
);

alter table public.product_image_catalog enable row level security;

drop policy if exists "product_image_catalog_read" on public.product_image_catalog;
create policy "product_image_catalog_read"
  on public.product_image_catalog
  for select
  to anon, authenticated
  using (true);

-- Storage bucket `product-icons` tworzy skrypt upload_product_icons.py (public).
