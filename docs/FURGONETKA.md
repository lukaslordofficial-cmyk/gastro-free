# Furgonetka — automatyczna wysyłka LP

Jedno konto Furgonetki **platformy** (Gastro Manager) zleca kuriera:
nadawca = dystrybutor, odbiorca = restauracja. Koszt etykiety schodzi ze skarbonki prepaid.
Dystrybutor **nie** płaci osobno za kuriera — restaurator już zapłacił dostawę w Stripe.

Nie budujemy osobnego OAuth per dystrybutor i nie trzymamy sekretów w Expo / WWW.

## Panel dystrybutora vs apka

| Flow | Repo | Env |
| --- | --- | --- |
| `/producent/zamowienia` → etykieta / kurier | **gastro-manager-landing** (Vercel) | `FURGONETKA_*` na Vercel |
| Wyceny kuriera w Expo | **gastro-18** (Railway) | `FURGONETKA_*` na Railway |

Instrukcja sandbox (klucze testowe):  
`gastro-manager-landing` → `docs/FURGONETKA_SANDBOX.md`

## Co musi być na Railway (backend gastro-18)

**Testy (zalecane na start):**

```
FURGONETKA_SANDBOX=1
FURGONETKA_MOCK=0
FURGONETKA_CLIENT_ID=   # z https://sandbox.furgonetka.pl → OAuth2
FURGONETKA_CLIENT_SECRET=
FURGONETKA_EMAIL=       # login sandbox
FURGONETKA_PASSWORD=
```

**NIE ustawiaj** `FURGONETKA_API_URL=https://api.sandbox.furgonetka.pl` — OAuth nie działa.  
Host API: zawsze `https://api.furgonetka.pl` (sandbox i produkcja).

Opcjonalnie: `FURGONETKA_INPOST_SERVICE_ID`, `FURGONETKA_LABEL_PAGE=a6`.

**Szybki mock bez konta:** `FURGONETKA_MOCK=1` (etykieta awaryjna, bez prawdziwego API).

**Produkcja później:**

```
FURGONETKA_SANDBOX=0
FURGONETKA_PRODUCTION=1
FURGONETKA_CLIENT_ID=   # z furgonetka.pl
…
```

Błąd „Cena przesyłek > saldo” = klucze z konta **produkcyjnego** bez środków. Podmień na sandbox albo doładuj prepaid.

## Integracja „Własna” (Furgonetka woła nasz sklep)

To **nie** jest REST OAuth (`/packages`). Po zapisaniu formularza Furgonetka odpytuje:

`GET {Adres URL}/orders`

z tokenem w `Authorization: Bearer …` albo `?token=`.

W sandbox.furgonetka.pl → Ustawienia → Integracje → Własne wklej:

| Pole | Wartość |
| --- | --- |
| Nazwa wyświetlana | Gastro Manager |
| Adres URL | `https://gastro-manager-api-production-21dd.up.railway.app/api/furgonetka` |
| Token | `FURGONETKA_SHOP_TOKEN` albo token sandbox `gm_furg_shop_7c9e4a2b18f04d6e9a51c3b8d0e27f14` |
| Synchronizacja zamówień | włącz |
| Wysyłaj informacje o przesyłce | włącz (stub `PUT /orders/{id}` zwraca 200) |

Na początek API zwraca `{ "orders": [] }` (HTTP 200) — test połączenia ma przejść nawet bez tokenu w GET. Token jest wymagany przy PUT (status przesyłki).
Jeśli Railway ma inny `FURGONETKA_SHOP_TOKEN`, token sandbox z tabeli powyżej nadal jest akceptowany.

## Baza (Supabase)

Uruchom `supabase_migrations/ADD_LP_FURGONETKA_TRACKING.sql`
(pickup_date, tracking_state, label_storage_path, shipping_error, …).

## Panel WWW (gastro-manager-landing)

W Vercel te same `FURGONETKA_*` co wyżej (sandbox na start).  
Etykieta: `/api/producent/label`. Status: `/api/producent/furgonetka-status`.

Profil dystrybutora musi mieć: telefon, e-mail, ulica+numer, kod, miasto.

## Flow po płatności

paid → waga z pozycji → validate → POST /packages → PUT /order-commands
→ PDF etykiety do Storage → POST pickup-date-proposals → PUT /pickup-commands
→ tracking GET /packages/{id}/tracking.

Idempotencja: ten sam `order_id` nie tworzy drugiej przesyłki.
