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

**Sandbox.furgonetka.pl nie ma OAuth2.** Integracje → Własne = token sklepu (Furgonetka → Railway).  
Tworzenie paczek wymaga OAuth produkcyjnego albo `FURGONETKA_MOCK=1`.  
Instrukcja: `gastro-manager-landing` → `docs/FURGONETKA_SANDBOX.md`

## Co musi być na Railway (backend gastro-18)

**Testy (bez prawdziwego kuriera):**

```
FURGONETKA_SANDBOX=1
FURGONETKA_MOCK=1
```

**Prawdziwe etykiety (produkcja + prepaid):**

```
FURGONETKA_SANDBOX=0
FURGONETKA_PRODUCTION=1
FURGONETKA_MOCK=0
FURGONETKA_CLIENT_ID=   # z furgonetka.pl → OAuth2
FURGONETKA_CLIENT_SECRET=
FURGONETKA_EMAIL=
FURGONETKA_PASSWORD=
```

Host API: zawsze `https://api.furgonetka.pl`. Nie używaj `api.sandbox.furgonetka.pl`.

Błąd „Cena przesyłek > saldo” = produkcyjne OAuth bez środków w skarbonce. Do testów: `FURGONETKA_MOCK=1`.

## Integracja „Własna” (Furgonetka woła nasz sklep)

To **nie** jest REST OAuth (`/packages`). Po zapisaniu formularza Furgonetka odpytuje:

`GET {Adres URL}/orders`

z tokenem w `Authorization: Bearer …` albo `?token=`.

W panelu Furgonetka → Integracje → **Własne** (formularz „DODAJ”) wpisz:

| Pole | Wartość |
| --- | --- |
| Nazwa wyświetlana | `Gastro Manager` |
| Adres sklepu | `https://gastro-manager-api-production-21dd.up.railway.app/api/furgonetka` |
| Token | ten sam string co `FURGONETKA_SHOP_TOKEN` na Railway (losowy hex, min. 32 znaki) |

Furgonetka woła `{Adres sklepu}/orders` → u nas `GET /api/furgonetka/orders`.

Na Railway **i** w lokalnym `backend/.env` ustaw:

```env
FURGONETKA_SHOP_TOKEN=twój_losowy_token
PUBLIC_API_URL=https://gastro-manager-api-production-21dd.up.railway.app
```

Token generujesz Ty (np. PowerShell: `-join ((1..48) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })`) — **ten sam** string wklejasz w Furgonetce i w env. Nie commituj go do gita.

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
