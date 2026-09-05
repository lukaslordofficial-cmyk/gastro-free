# Google Play — Internal Testing (AAB)

## Build

```powershell
cd frontend
$env:NODE_OPTIONS='--use-system-ca'
# Wpisuje EXPO_PUBLIC_* z frontend/.env do eas.json (preview + production).
# NIE commituj eas.json po syncu, jeśli zawiera prawdziwe klucze (pk_live / anon).
node scripts/sync-eas-preview-env.js
eas build --platform android --profile production
```

Profil `production` → **Android App Bundle (`.aab`)**, `distribution: store`.  
**Bez** `EXPO_PUBLIC_ADMOB_USE_TEST_IDS` (live AdMob). Preview APK nadal używa test IDs.

Wersja: `app.json` → `version: "1.0.3"`, `android.versionCode: 4` (zwiększaj przy każdym uploadzie).

## Stripe: test → live

1. Stripe Dashboard → **Live mode**: `pk_live_…`, `sk_live_…`, nowe Price IDs, webhook → Railway `/api/billing/webhook`.
2. `frontend/.env`: `EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…`
3. Railway: `STRIPE_SECRET_KEY=sk_live_…` + live price env.
4. `node scripts/sync-eas-preview-env.js` → `eas build --profile production`
5. **Nie commituj** `.env` ani wypełnionego `eas.json` z live kluczami. Po buildzie możesz przywrócić placeholdery w `eas.json`.

## Upload

1. [Google Play Console](https://play.google.com/console) → **Testowanie** → **Wewnętrzne testowanie**.
2. Utwórz wersję → prześlij `.aab` z Expo.
3. Dodaj testerów (e-maile Google) → udostępnij link.

Privacy / terms: backend `/privacy` `/terms` lub landing `/polityka-prywatnosci` `/regulamin`.  
Pełna checklista: [`PLAY_PUBLISH_CHECKLIST.md`](./PLAY_PUBLISH_CHECKLIST.md). Auth URLs: [`BETA_AUTH.md`](./BETA_AUTH.md).

## Uwagi

- Backend: HTTPS Railway (`EXPO_PUBLIC_BACKEND_URL`).
- `usesCleartextTraffic: false` — tylko HTTPS.
- Po każdej wersji na Play zwiększ `versionCode`.
