# Auth + izolacja kont

Data: 2026-09-05 (produkcja: potwierdzenie e-maila wymagane + adres dostawy przy rejestracji).

## Flow

1. Brak sesji → `/(auth)/login` / rejestracja.
2. Rejestracja: e-mail + hasło + **nazwa lokalu, telefon, ulica, nr, kod, miasto** (+ opcjonalnie NIP/REGON).
3. Trigger SQL / app tworzy `profiles.account_key = ak_<uuid>` + **100 kredytów AI** + **`trial_ends_at = now()+30d`**.
4. Backend `POST /api/auth/welcome-email`:
   - **force-unconfirm** gdy Supabase ma Confirm email = OFF (czyści `email_confirmed_at`),
   - zapisuje `shipping_*` + `lokal_profile_json` w `profiles`,
   - wysyła mail z linkiem weryfikacyjnym.
5. Link otwiera **https://gastromanager.org/auth/verified** (landing) → komunikat „Konto zweryfikowane” → logowanie w aplikacji hasłem.
6. Bez kliknięcia linku logowanie jest zablokowane (`email_confirmed_at` + guard w `signInWithPassword` / `applySession`).

## Supabase Auth (dashboard) — obowiązkowe

1. **Authentication → Providers → Email → Confirm email = ON** (zalecane).  
   Gdy OFF — backend i tak próbuje force-unconfirm po rejestracji.
2. **Authentication → URL Configuration → Redirect URLs** dodaj:
   - `https://gastromanager.org/auth/verified`
   - `https://gastromanager.org/**`
   - (opcjonalnie deep link) `gastromanager://auth/verified`
3. **Site URL** nie ustawiaj na `http://localhost…` w produkcji.
4. Szablon Confirm signup: `{{ .ConfirmationURL }}`.

## Migracje (Supabase SQL Editor)

1. `ADD_SUBSCRIPTIONS.sql` / `FIX_SUBSCRIPTIONS_RLS.sql`
2. `ADD_AUTH_PROFILES.sql`
3. `PREMIUM_TRIAL_100_CREDITS.sql`
4. `ADD_TENANT_ISOLATION.sql`
5. `FIX_TENANT_RLS.sql`
6. `ADD_LP_RESTAURANT_SHIPPING.sql` + `ADD_PROFILES_LOKAL_JSON.sql`

## Backend

- `POST /api/auth/welcome-email` — force-unconfirm + shipping + Resend.
- `AUTO_CONFIRM_EMAIL` — **nie ustawiaj na true** w produkcji.

## Po deployu

1. Redirect URLs + Site URL (jak wyżej).
2. Redeploy Railway + Vercel (landing `/auth/verified`).
3. Przebuduj APK / AAB.
