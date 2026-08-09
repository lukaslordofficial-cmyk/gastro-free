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

## HARD RULE widoczności (apka restauratora)

Pokazujemy **wyłącznie**:
`verification_status = 'approved' AND verified = true AND active = true AND archived_at IS NULL`

Produkty: `available = true` (oraz producent spełnia HARD RULE).

## UI apki

- Lista: `Dostawcy → Lokalni Przetwórcy` (sort po km gdy GPS)
- Szczegóły: `/(tabs)/dostawcy/producent/[id]` — adres, dystans, shipping_days, produkty, koszyk
- CTA: **Złóż zamówienie** / **Zamów kuriera** → `producer_orders` + items (`payment_status=pending`)
- Stripe / InPost — poza tym etapem (stub kwot)

## RLS (skrót)

- Producent (`local_producers.auth_user_id = auth.uid()`): CRUD swoich danych / produktów.
- Restaurator: SELECT marketplace-visible producentów + dostępne produkty.
- Admin: `app_metadata.lp_admin = true` lub `app_metadata.role = "admin"`.
- `service_role`: pełny dostęp (backend / weryfikacja).

## Flow pośrednika

1. Rolnik loguje się na WWW → profil + produkty.
2. Admin WWW: **Akceptuj** → `verification_status=approved`, `verified=true`, `active=true`.
3. Apka: lista → klik → produkty / km / **Złóż zamówienie** / **Zamów kuriera**.

## FIX order_status (wymagane przy błędzie CHECK)

Jeśli insert pada na `producer_orders_order_status`, uruchom w SQL Editor:
[`FIX_PRODUCER_ORDERS_ORDER_STATUS.sql`](../supabase_migrations/FIX_PRODUCER_ORDERS_ORDER_STATUS.sql)

Apka wstawia `order_status = 'pending'`.

## Stripe — ten sam klucz co subskrypcje?

**Tak.** Użyj tego samego `STRIPE_SECRET_KEY` (i tego samego konta Stripe) co do kredytów/planów.
Webhook `/api/billing/webhook` obsługuje też `kind=local_producer_order`.
Opcjonalnie osobno: `INPOST_*` dla kuriera.

## Płatność + kurier (bez nowych paczek Expo)

| Endpoint | Rola |
|----------|------|
| `POST /api/local-producers/checkout` | Stripe Checkout (card + BLIK) |
| `POST /api/local-producers/confirm-payment` | Potwierdzenie bez webhooka |
| `POST /api/local-producers/create-shipment` | InPost ShipX (retry) |
| Webhook `checkout.session.completed` + `kind=local_producer_order` | paid + InPost + Connect transfer |

Env (Railway / backend): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, opcjonalnie `INPOST_API_TOKEN`, `INPOST_ORGANIZATION_ID`, `INPOST_API_URL`, `INPOST_SANDBOX=true`.

FE: `services/localProducers/checkoutClient.ts` → `Linking.openURL`.

## Jeszcze poza zakresem

Faktury UI, push FCM, natywne `@stripe/stripe-react-native`.
