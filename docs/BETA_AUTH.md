# Auth + izolacja kont — closed beta

Data: 2026-07-26 (aktualizacja: bez maila confirm + tenant RLS).

## Flow

1. Brak sesji → `/(auth)/login` / rejestracja.
2. Rejestracja: e-mail + hasło (+ nazwa restauracji).
3. Trigger SQL / app tworzy `profiles.account_key = ak_<uuid>` + **1000 kredytów**.
4. **Closed beta: bez potwierdzenia e-maila** — użytkownik loguje się od razu po rejestracji.
5. Magazyn / menu / dostawcy filtrują po `account_key` → nowy user startuje z **pustymi** danymi (własny „folder” wierszy, nie kopia schematu).

## Migracje (Supabase SQL Editor) — obowiązkowe, w tej kolejności

1. `ADD_SUBSCRIPTIONS.sql` / `FIX_SUBSCRIPTIONS_RLS.sql` (jeśli nie było)
2. **`ADD_AUTH_PROFILES.sql`**
3. **`ADD_TENANT_ISOLATION.sql`** ← kolumna `account_key` + RLS na inventory/menu/suppliers/waste  
4. **`FIX_TENANT_RLS.sql`** ← naprawa insertów (`current_account_key()` + warehouse + recipe) — **obowiązkowe**, inaczej błąd „violates row level security”

Bez pkt 3–4 nowi użytkownicy mogą widzieć wspólne dane albo nie móc nic zapisać.

## Supabase Auth (dashboard) — wyłączenie maila (BETA)

**Authentication → Providers → Email → Confirm email = OFF**

To wymagane na closed beta. Sesja powstaje od razu po `signUp`.  
Zapas: backend `POST /api/auth/auto-confirm` (`AUTO_CONFIRM_EMAIL=true` na Railway).

Po zakończeniu bety możesz włączyć Confirm email z powrotem i poprawić szablony PL: Authentication → Email Templates → Confirm signup.

## Backend

- Nagłówek `X-Account-Key` + opcjonalnie `Authorization: Bearer <jwt>`.
- FastAPI dokleja `account_key` do zapytań tenantowych (service_role omija RLS).
- Endpoint: `POST /api/auth/auto-confirm` body `{ "user_id": "<uuid>" }`.

## Po deployu

1. Odpal SQL w Supabase (kolejność powyżej; jeśli profiles/tenant już są — wystarczy ponownie `FIX_TENANT_RLS.sql`).
2. Wyłącz Confirm email w dashboardzie.
3. Przebuduj APK (`preview-apk`) — Railway sam podciągnie backend z `main`.
