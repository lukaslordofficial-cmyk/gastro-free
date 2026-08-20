# Auth + izolacja kont — closed beta

Data: 2026-07-26 (aktualizacja: bez maila confirm + tenant RLS).

## Flow

1. Brak sesji → `/(auth)/login` / rejestracja.
2. Rejestracja: e-mail + hasło (+ nazwa restauracji).
3. Trigger SQL / app tworzy `profiles.account_key = ak_<uuid>` + **100 kredytów AI** + **`trial_ends_at = now()+30d`** (trial Premium / Profesjonalny: Łowca Okazji, dark UI). Po trialu konto wraca do Free; **saldo kredytów nie jest zerowane**.
4. **Closed beta: bez potwierdzenia e-maila** — użytkownik loguje się od razu po rejestracji.
5. Magazyn / menu / dostawcy filtrują po `account_key` → nowy user startuje z **pustymi** danymi (własny „folder” wierszy, nie kopia schematu).

## Migracje (Supabase SQL Editor) — obowiązkowe, w tej kolejności

1. `ADD_SUBSCRIPTIONS.sql` / `FIX_SUBSCRIPTIONS_RLS.sql` (jeśli nie było)
2. **`ADD_AUTH_PROFILES.sql`**
3. **`PREMIUM_TRIAL_100_CREDITS.sql`** ← `trial_ends_at` + starter **100** + trigger 30d trial
4. **`ADD_TENANT_ISOLATION.sql`** ← kolumna `account_key` + RLS na inventory/menu/suppliers/waste  
5. **`FIX_TENANT_RLS.sql`** ← naprawa insertów (`current_account_key()` + warehouse + recipe) — **obowiązkowe**, inaczej błąd „violates row level security”

Bez pkt 4–5 nowi użytkownicy mogą widzieć wspólne dane albo nie móc nic zapisać.

## Supabase Auth (dashboard) — wyłączenie maila (BETA)

**Authentication → Providers → Email → Confirm email = OFF**

To wymagane na closed beta. Sesja powstaje od razu po `signUp`.  
Zapas (tylko closed beta): backend `POST /api/auth/auto-confirm` wymaga **`AUTO_CONFIRM_EMAIL=true`** na Railway (domyślnie wyłączone).

Po zakończeniu bety możesz włączyć Confirm email z powrotem i poprawić szablony PL: Authentication → Email Templates → Confirm signup.

## Backend

- Nagłówek `X-Account-Key` + opcjonalnie `Authorization: Bearer <jwt>`.
- FastAPI dokleja `account_key` do zapytań tenantowych (service_role omija RLS).
- Endpoint: `POST /api/auth/auto-confirm` body `{ "user_id": "<uuid>" }` — tylko gdy `AUTO_CONFIRM_EMAIL=true`.

## Po deployu

1. Odpal SQL w Supabase (kolejność powyżej; jeśli profiles/tenant już są — wystarczy ponownie `FIX_TENANT_RLS.sql`).
2. Wyłącz Confirm email w dashboardzie.
3. Przebuduj APK (`preview-apk`) — Railway sam podciągnie backend z `main`.
