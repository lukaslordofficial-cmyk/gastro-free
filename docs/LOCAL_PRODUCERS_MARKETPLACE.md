# Lokalni Przetwórcy — Marketplace B2B (ETAP 2)

## Co zrobić w Supabase (wymagane)

1. Otwórz **SQL Editor** w tym samym projekcie co apka.
2. Wklej i uruchom całość pliku:
   [`supabase_migrations/ADD_LOCAL_PRODUCERS_MARKETPLACE.sql`](../supabase_migrations/ADD_LOCAL_PRODUCERS_MARKETPLACE.sql)
3. Sprawdź **Storage** → buckety:
   - `producer-logos`, `producer-banners`, `producer-products` (public)
   - `producer-documents` (private)
4. **Database → Publications → supabase_realtime**: tabele
   `local_producers`, `producer_products`, `producer_reviews`.

## Tabele (nowe, bez zmian w `suppliers`)

| Tabela | Rola |
|--------|------|
| `local_producers` | Profil gospodarstwa / przetwórni |
| `producer_categories` | Seed: Miody, Dżemy, … Inne |
| `producer_products` | Oferta produktów |
| `producer_product_gallery` | Wiele zdjęć produktu |
| `producer_orders` / `producer_order_items` | Zamówienia (bez płatności) |
| `producer_reviews` | Opinie restauracji |
| `producer_documents` | Dokumenty producenta |
| `producer_notifications` | Powiadomienia producenta |

`restaurant_id` = `auth.users.id` restauratora; `restaurant_account_key` = `profiles.account_key`.

## RLS (skrót)

- Producent (`local_producers.auth_user_id = auth.uid()`): CRUD swoich danych / produktów.
- Restaurator: SELECT tylko `active AND verified` producentów + ich dostępne produkty.
- Admin: `app_metadata.lp_admin = true` lub `app_metadata.role = "admin"`.
- `service_role`: pełny dostęp (backend / weryfikacja).

## Flow pośrednika

1. Rolnik loguje się na stronie WWW (osobne konto Auth) → formularz → insert do `local_producers` / `producer_products`.
2. Admin ustawia `verified = true` (SQL / panel).
3. Apka restauratora (`Dostawcy → Lokalni Przetwórcy`) czyta listę + **Realtime** bez redeployu.

## Świadomie NIE w ETAP 2

Stripe, InPost, koszyk UI, Edge Functions, płatności.
