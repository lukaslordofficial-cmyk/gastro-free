# Dystrybucja APK (closed beta)

## Bloker: publiczny backend

Obecny `frontend/.env` ma `EXPO_PUBLIC_BACKEND_URL` wskazujący na **IP LAN**.  
APK zbudowany z takim URL **nie zadziała** u restauratorów poza Twoją siecią.

Przed buildem **obowiązkowo** ustaw publiczny HTTPS backendu w profilu `preview`:

```json
"env": {
  "EXPO_PUBLIC_BACKEND_URL": "https://TWOJ-BACKEND.example.com",
  "EXPO_PUBLIC_SUPABASE_URL": "...",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY": "...",
  "EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY": "pk_test_..."
}
```

Albo jednorazowo:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
eas build -p android --profile preview --env EXPO_PUBLIC_BACKEND_URL=https://TWOJ-BACKEND.example.com
```

Bez publicznego backendu APK zainstaluje się, ale Jarvis / skany / Łowca / billing API **nie zadziałają** poza LAN.

## EAS Build (preferowane)

Projekt Expo: [@lukaslord/gastro-manager](https://expo.dev/accounts/lukaslord/projects/gastro-manager)  
(`projectId` w `frontend/app.json`).

W katalogu `frontend/`:

```powershell
$env:NODE_OPTIONS='--use-system-ca'
# wstaw EXPO_PUBLIC_* z lokalnego .env (w tym PUBLICZNY backend HTTPS)
node scripts/sync-eas-preview-env.js
eas build -p android --profile preview --non-interactive
eas build:list
# po buildzie przywróć placeholdery w eas.json (żeby nie commitować kluczy):
git checkout -- eas.json
```

Profil `preview` generuje **APK** (`buildType: apk`) do internal distribution.  
Po sukcesie: link APK z `eas build:list` / strony builda → wyślij mailem.

**Uwaga:** `package.json` → `preinstall` musi być `node ./scripts/cmd-guard.js ...` (bez `./`), inaczej EAS Linux: `Permission denied`.

**Ads / Gradle:** Expo 54 + RN 0.81 wymaga `react-native-google-mobile-ads` ≥ 15.x (14.11 pada na `currentActivity`). Cleartext HTTP: `expo-build-properties` → `android.usesCleartextTraffic`.

Jeśli Node zgłasza błąd certyfikatu SSL: `$env:NODE_OPTIONS='--use-system-ca'`.

## Stripe

Closed beta = **wyłącznie Test mode** (`sk_test_` / `pk_test_`).  
Karta testowa: `4242 4242 4242 4242`.
