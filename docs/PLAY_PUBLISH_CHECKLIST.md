# Play publish — checklist (manual + stan kodu)

Data audytu: **2026-09-05**.  
Cel: ~100% gotowości do Internal Testing / publikacji na Google Play.

Legenda: **[DONE code]** = w repozytorium; **[TODO Ty]** = wymaga Twojego konta / dashboardu.

---

## 1. Supabase Auth — URL Configuration  **[TODO Ty — BLOKER]**

Zrzuty użytkownika: Site URL = `www.gastromanager.org` **bez https** → broken redirect  
`…supabase.co/www.gastromanager.org#error=otp_expired…` + `{"error":"requested path is invalid"}`.

| Pole | Wklej dokładnie |
|------|-----------------|
| **Site URL** | `https://gastromanager.org` (**NIE** `…/wyprobuj`) |
| Redirect | `https://gastromanager.org/auth/verified` |
| Redirect | `https://gastromanager.org/auth/nowe-haslo` |
| Redirect | `https://gastromanager.org/**` |
| Redirect | `https://gastromanager.org/dla-producentow/nowe-haslo` (już było) |
| Redirect | `gastromanager://auth/verified` / `gastromanager://**` (opcjonalnie) |
| Confirm email | **ON** |

Po zmianie Site URL: **zarejestruj NOWE konto** — stare linki = `otp_expired`.

Szczegóły: [`BETA_AUTH.md`](./BETA_AUTH.md).

**Kod:** `EMAIL_VERIFY_REDIRECT` / welcome `generateLink` → `https://gastromanager.org/auth/verified` **[DONE code]**.

---

## 2. Supabase SQL / RLS  **[TODO Ty — uruchom SQL]**

| Migracja | Status |
|----------|--------|
| Auth / profiles / trial / tenant / shipping | Zakładane wdrożone jeśli beta działa |
| `ADD_DEVICE_PUSH_TOKENS.sql` | Tabela + dawniej otwarte RLS |
| **`FIX_DEVICE_PUSH_TOKENS_RLS.sql`** | **[DONE code]** — **musisz odpalić w SQL Editor** (zamyka USING(true)) |
| `FIX_PROD_SECURITY_RLS.sql` | Odpal jeśli jeszcze nie |

Sprawdzenie: `GET /api/admin/migration-status` z `X-Cron-Secret` (Railway) **[DONE code]**.

---

## 3. Railway (backend)  **[TODO Ty — redeploy]**

- Redeploy po pushu (welcome-email, legal, auth).
- Env: `RESEND_*`, `SUPABASE_*`, `STRIPE_*` (live gdy płatności), `CRON_JOB_SECRET`, `PUBLIC_API_URL`.
- **Nie** ustawiaj `AUTO_CONFIRM_EMAIL=true` na prod.
- Legal: `{PUBLIC_API_URL}/privacy` i `/terms` **[DONE code]** — sprawdź w przeglądarce po deployu.
- From maile auth: `asystent.dostaw@gastromanager.org` (nie zmieniać jeśli działa).

---

## 4. Vercel / landing (gastromanager.org)  **[TODO Ty — redeploy]**

| Ścieżka | Status kodu |
|---------|-------------|
| `/auth/verified` | **[DONE code]** — PL: konto zweryfikowane, loguj w apce |
| `/auth/nowe-haslo` | **[DONE code]** — reset hasła aplikacji |
| `/dla-producentow/nowe-haslo` | **[DONE code]** — producenci (już w allowlist) |
| `/polityka-prywatnosci`, `/regulamin` | **[DONE code]** |

Po pushu: Redeploy Vercel (Production). Env: `NEXT_PUBLIC_SUPABASE_URL` + `ANON_KEY`.

---

## 5. Stripe Live  **[TODO Ty — klucze + rebuild]**

| Element | Status |
|---------|--------|
| Sync `pk_live_` do EAS via `frontend/scripts/sync-eas-preview-env.js` | **[DONE code]** (skrypt) |
| Commitowanie `sk_live` / wypełnionego `eas.json` | **NIE** — nigdy |
| Backend Railway: `STRIPE_SECRET_KEY=sk_live_…`, live Price IDs, webhook live | **[TODO Ty]** |
| Frontend `.env` + sync + `eas build --profile production` | **[TODO Ty]** |
| Dokumentacja test→live | [`GOOGLE_PLAY_INTERNAL.md`](./GOOGLE_PLAY_INTERNAL.md) |

---

## 6. AdMob / EAS profiles  **[DONE code]**

| Profil | Test ads |
|--------|----------|
| `preview` / `preview-apk` | `EXPO_PUBLIC_ADMOB_USE_TEST_IDS=1` |
| **`production`** | **bez** flagi test ads — live units |

Package: `pl.gastromanager.app`. Wersja w `app.json`: `1.0.3` / `versionCode: 4`.

---

## 7. Google Play Console  **[TODO Ty]**

- [ ] Privacy policy URL: `https://<railway>/privacy` **lub** `https://gastromanager.org/polityka-prywatnosci`
- [ ] Terms: `https://<railway>/terms` **lub** `https://gastromanager.org/regulamin`
- [ ] Listing: ikona, feature graphic, screenshots, opis PL
- [ ] Content rating kwestionariusz
- [ ] Data safety (konta, e-mail, lokalizacja tylko jeśli faktycznie zbieracie, AdMob, Stripe)
- [ ] Internal testing → upload **AAB** z EAS production
- [ ] Testerzy (e-maile Google) + link programu

Usuwanie konta w apce (Ustawienia) **[DONE code]**.

---

## 8. Device test auth  **[TODO Ty — po Site URL]**

1. Confirm email ON + Site URL https + Redirect URLs.
2. Nowa rejestracja (nie stary mail).
3. Mail → klik → `https://gastromanager.org/auth/verified` → sukces PL.
4. Login w apce działa; bez weryfikacji — blokada.
5. „Zapomniałem hasła” → `/auth/nowe-haslo` → nowe hasło → login.
6. Duplikat e-maila przy rejestracji → komunikat „już zarejestrowany”.

---

## 9. Co jest już w kodzie vs otwarte

### Done w kodzie (ten sprint / wcześniejsze)
- Verify redirect HTTPS landing (nie deep link / localhost)
- Welcome mail stopka `kontakt@…`; prefer From kontakt@
- Krótki komunikat sukcesu rejestracji
- Mapowanie / fake-success duplicate email
- Login blocked until verified + force-unconfirm
- Zapomniałem hasła → resetPasswordForEmail
- Landing `/auth/verified` + `/auth/nowe-haslo`
- Legal routes backend + landing legal pages
- EAS production bez test ads; AdMob live IDs w kodzie
- Migracja `FIX_DEVICE_PUSH_TOKENS_RLS.sql`
- Docs Site URL https

### Tylko Ty (dashboard / konta)
- Supabase Site URL + Redirect + Confirm ON
- SQL `FIX_DEVICE_PUSH_TOKENS_RLS.sql` (i ewentualne brakujące migracje)
- Railway + Vercel redeploy
- Stripe live keys + webhook + EAS rebuild (bez commit secrets)
- Play Console listing / rating / data safety / AAB upload
- Pełny device smoke auth po fix Site URL
