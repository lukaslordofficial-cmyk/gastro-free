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

W katalogu `frontend/`:

```powershell
npm i -g eas-cli
eas login
eas init
# upewnij się, że preview.env ma publiczny backend URL
eas build -p android --profile preview
eas build:list
```

Profil `preview` w `eas.json` generuje **APK** (`buildType: apk`) do internal distribution.  
Po zakończeniu skopiuj link z `eas build:list` / strony Expo i wyślij mail.

Wymagane: konto Expo, opcjonalnie `EXPO_TOKEN` w CI.  
Jeśli Node zgłasza błąd certyfikatu SSL: `set NODE_OPTIONS=--use-system-ca`.

## Stripe

Closed beta = **wyłącznie Test mode** (`sk_test_` / `pk_test_`).  
Karta testowa: `4242 4242 4242 4242`.
