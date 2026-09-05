# Auth + izolacja kont

Data: 2026-09-05 (produkcja: potwierdzenie e-maila wymagane).

## Flow

1. Brak sesji → `/(auth)/login` / rejestracja.
2. Rejestracja: e-mail + hasło (+ nazwa restauracji).
3. Trigger SQL / app tworzy `profiles.account_key = ak_<uuid>` + **100 kredytów AI** + **`trial_ends_at = now()+30d`**.
4. **Potwierdzenie e-maila obowiązkowe** — po `signUp` sesja jest zamykana; użytkownik loguje się dopiero po kliknięciu linku w mailu.
5. Link weryfikacyjny otwiera deep link `gastromanager://auth/verified` → ekran „Konto zweryfikowane” → potem logowanie hasłem.
6. Magazyn / menu / dostawcy filtrują po `account_key` → nowy user startuje z pustymi danymi.

## Supabase Auth (dashboard) — obowiązkowe

1. **Authentication → Providers → Email → Confirm email = ON**
2. **Authentication → URL Configuration → Redirect URLs** dodaj:
   - `gastromanager://auth/verified`
   - `gastromanager://**`
3. Szablon Confirm signup: link musi używać `{{ .ConfirmationURL }}` (Supabase doklei redirect).

Bez Confirm email = ON aplikacja nie zablokuje logowania (Supabase ustawia `email_confirmed_at` od razu).

## Migracje (Supabase SQL Editor)

1. `ADD_SUBSCRIPTIONS.sql` / `FIX_SUBSCRIPTIONS_RLS.sql`
2. `ADD_AUTH_PROFILES.sql`
3. `PREMIUM_TRIAL_100_CREDITS.sql`
4. `ADD_TENANT_ISOLATION.sql`
5. `FIX_TENANT_RLS.sql`

## Backend

- Nagłówek `X-Account-Key` + opcjonalnie `Authorization: Bearer <jwt>`.
- `POST /api/auth/send-welcome` — link signup z `redirect_to=gastromanager://auth/verified`.
- `AUTO_CONFIRM_EMAIL` — **nie ustawiaj na true** w produkcji.

## Po deployu

1. Confirm email = ON + Redirect URLs (jak wyżej).
2. Redeploy Railway (backend welcome + sales scan).
3. Przebuduj APK / AAB (`preview-apk` / produkcja).
