# Auth (login / rejestracja) — closed beta

Data: 2026-07-25.

## Flow

1. Aplikacja startuje → brak sesji → ekran `/(auth)/login`.
2. Rejestracja: e-mail + hasło (+ opcjonalna nazwa restauracji).
3. Supabase Auth tworzy `auth.users` → trigger SQL (`ADD_AUTH_PROFILES.sql`) tworzy:
   - `profiles` z `account_key = ak_<uuid_bez_kresek>`
   - `subscriptions` z **1000 kredytów** (tier 0)
4. Sesja w AsyncStorage; Magazyn/Menu/Subskrypcja używają `account_key` z profilu.
5. Wylogowanie: Ustawienia → Konto → Wyloguj.

## Migracja (obowiązkowa w Supabase SQL Editor)

Uruchom po `ADD_SUBSCRIPTIONS.sql` / `FIX_SUBSCRIPTIONS_RLS.sql`:

- [`supabase_migrations/ADD_AUTH_PROFILES.sql`](../supabase_migrations/ADD_AUTH_PROFILES.sql)

## Supabase Auth (dashboard)

- Authentication → Providers → **Email** włączony.
- Na closed beta: rozważ wyłączenie **Confirm email** (Authentication → Providers → Email), żeby testerzy od razu dostawali sesję.
- Stripe pozostaje w **test mode** — portfel jest per `account_key`, nie globalny `default`.

## Backend

Klient wysyła nagłówek `X-Account-Key` (+ opcjonalnie `Authorization: Bearer <jwt>`).  
Middleware FastAPI ustawia tenant na request; bez nagłówka = `ACCOUNT_KEY` z env (legacy).

## Uwagi multi-tenant

- Magazyn / menu w schemacie nadal często są **globalne** (historyczne tabele bez `account_key`) — izolacja kredytów/Stripe jest per user; pełne RLS na inventory/menu to kolejny etap.
- Konto `default` zostaje dla starych deployów / seedów.
