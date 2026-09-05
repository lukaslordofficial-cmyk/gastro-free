# Auth + izolacja kont

Data: 2026-09-05 (produkcja: potwierdzenie e-maila wymagane + adres dostawy przy rejestracji).

## Flow

1. Brak sesji → `/(auth)/login` / rejestracja.
2. Rejestracja: e-mail + hasło + **nazwa lokalu, telefon, ulica, nr, kod, miasto** (+ opcjonalnie NIP/REGON).
3. Trigger SQL / app tworzy `profiles.account_key = ak_<uuid>` + **100 kredytów AI** + **`trial_ends_at = now()+30d`**.
4. Backend `POST /api/auth/welcome-email`:
   - **force-unconfirm** gdy Supabase ma Confirm email = OFF (czyści `email_confirmed_at`),
   - zapisuje `shipping_*` + `lokal_profile_json` w `profiles`,
   - wysyła mail z linkiem weryfikacyjnym (stopka: **kontakt@gastromanager.org**).
5. Link otwiera **https://gastromanager.org/auth/verified** (landing) → „Konto zweryfikowane” → logowanie w aplikacji hasłem.
6. Bez kliknięcia linku logowanie jest zablokowane (`email_confirmed_at` + guard w `signInWithPassword` / `applySession`).
7. Reset hasła (login → „Zapomniałem hasła”) → Supabase mail → **https://gastromanager.org/auth/nowe-haslo**.

## Supabase Auth (dashboard) — OBOWIĄZKOWE (copy-paste)

### Site URL
```
https://gastromanager.org
```
**KRYTYCZNE:** nie ustawiaj Site URL na `https://www.gastromanager.org/wyprobuj` —
wtedy linki resetu/weryfikacji lądują na stronie „Wypróbuj” zamiast `/auth/nowe-haslo` / `/auth/verified`.

Musi być z `https://`. Preferuj apex `https://gastromanager.org`.

### Redirect URLs (allowlist) — dodaj / zostaw:
```
https://gastromanager.org/auth/verified
https://gastromanager.org/auth/nowe-haslo
https://gastromanager.org/**
https://www.gastromanager.org/**
https://gastromanager.org/dla-producentow/nowe-haslo
gastromanager://auth/verified
gastromanager://**
```

### Confirm email
**Authentication → Providers → Email → Confirm email = ON**

### Po zmianie Site URL
Stare linki weryfikacyjne są **martwe** (`otp_expired`). Zarejestruj **NOWE** konto testowe i użyj świeżego maila.

### Szablon Confirm signup
Użyj `{{ .ConfirmationURL }}` (redirect_to idzie z app / welcome-email: `https://gastromanager.org/auth/verified`).

## Migracje (Supabase SQL Editor)

1. `ADD_SUBSCRIPTIONS.sql` / `FIX_SUBSCRIPTIONS_RLS.sql`
2. `ADD_AUTH_PROFILES.sql`
3. `PREMIUM_TRIAL_100_CREDITS.sql`
4. `ADD_TENANT_ISOLATION.sql`
5. `FIX_TENANT_RLS.sql`
6. `ADD_LP_RESTAURANT_SHIPPING.sql` + `ADD_PROFILES_LOKAL_JSON.sql`
7. `ADD_DEVICE_PUSH_TOKENS.sql` + **`FIX_DEVICE_PUSH_TOKENS_RLS.sql`** (zamyka otwarte RLS)
8. `FIX_PROD_SECURITY_RLS.sql` (jeśli jeszcze nie)

## Backend

- `POST /api/auth/welcome-email` — force-unconfirm + shipping + Resend.
- `AUTO_CONFIRM_EMAIL` — **nie ustawiaj na true** w produkcji.
- From: preferuj `kontakt@gastromanager.org` (`WELCOME_FROM_EMAIL` / `RESEND_FROM_EMAIL`).  
  Jeśli Resend wymaga `asystent.dostaw@…` do deliverability — ustaw env na asystent; **stopka maila i tak pokazuje kontakt@**.

## Po deployu

1. Site URL + Redirect URLs (jak wyżej) + Confirm email ON.
2. Redeploy Railway (backend) + Vercel (landing `/auth/verified` + `/auth/nowe-haslo`).
3. Przebuduj AAB (EAS production) po `node scripts/sync-eas-preview-env.js` — **nie commituj** wypełnionego `eas.json` z kluczami.
4. Nowe konto testowe → mail → verified → login.
