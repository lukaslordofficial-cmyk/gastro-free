# Auth + izolacja kont — closed beta

Data: 2026-07-25 (aktualizacja: tenant isolation + bez maila confirm).

## Flow

1. Brak sesji → `/(auth)/login` / rejestracja.
2. Rejestracja: e-mail + hasło (+ nazwa restauracji).
3. Trigger SQL / app tworzy `profiles.account_key = ak_<uuid>` + **1000 kredytów**.
4. Jeśli Supabase wymaga potwierdzenia e-maila → backend `POST /api/auth/auto-confirm` (service_role) i od razu logowanie — **bez maila**.
5. Magazyn / menu / dostawcy filtrują po `account_key` → nowy user startuje z **pustymi** danymi.

## Migracje (Supabase SQL Editor) — obowiązkowe

1. `ADD_SUBSCRIPTIONS.sql` / `FIX_SUBSCRIPTIONS_RLS.sql` (jeśli nie było)
2. **`ADD_AUTH_PROFILES.sql`**
3. **`ADD_TENANT_ISOLATION.sql`** ← kolumna `account_key` + RLS na inventory/menu/suppliers/waste

Bez pkt 3 nowi użytkownicy mogą nadal widzieć wspólne dane demo (`default`).

## Supabase Auth (dashboard) — wyłączenie maila

**Authentication → Providers → Email → Confirm email = OFF**

To najczystszy wariant (sesja od razu po `signUp`).  
Auto-confirm na backendzie jest zapasem (`AUTO_CONFIRM_EMAIL=true` na Railway, domyślnie włączone).

Szablony PL (gdy kiedyś włączysz confirm): Authentication → Email Templates → Confirm signup → treść po polsku.

## Backend

- Nagłówek `X-Account-Key` + opcjonalnie `Authorization: Bearer <jwt>`.
- FastAPI dokleja `account_key` do zapytań tenantowych (service_role omija RLS).
- Endpoint: `POST /api/auth/auto-confirm` body `{ "user_id": "<uuid>" }`.

## Po deployu

1. Odpal SQL w Supabase.
2. Wyłącz Confirm email.
3. Przebuduj APK (zmiany FE) — Railway sam podciągnie backend z `main`.
