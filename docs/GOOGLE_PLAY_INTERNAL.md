# Google Play — Internal Testing (AAB)

## Build

```powershell
cd frontend
$env:NODE_OPTIONS='--use-system-ca'
node scripts/sync-eas-preview-env.js
eas build --platform android --profile production
```

Profil `production` → **Android App Bundle (`.aab`)**, `distribution: store`.

Wersja: `app.json` → `version: "1.0.0"`, `android.versionCode: 1`.

## Upload

1. [Google Play Console](https://play.google.com/console) → aplikacja → **Testowanie** → **Wewnętrzne testowanie**.
2. Utwórz wersję → prześlij plik `.aab` z Expo (link `expo.dev/artifacts/...aab` lub Build page → Download).
3. Dodaj testerów (e-maile Google) → udostępnij link do programu testów wewnętrznych.

### Pierwszy production AAB (2026-07-25)

- Build: https://expo.dev/accounts/lukaslord/projects/gastro-manager/builds/21a41195-8c92-4fe7-bc6a-3a00ae600089  
- Plik: https://expo.dev/artifacts/eas/rAIbNkoeKj6BJr2bFaZRYUxiv5RDbgPN8l64rAJj_uA.aab  
- `version` 1.0.0 / `versionCode` 1

## Uwagi

- Backend: HTTPS Railway (`EXPO_PUBLIC_BACKEND_URL`).
- Stripe w buildzie: nadal **test keys** (`pk_test_`) — przed płatnościami live zmień klucze i przebuduj.
- `usesCleartextTraffic: false` — tylko HTTPS.
- Po każdej kolejnej wersji na Play zwiększ `versionCode` (2, 3, …) i opcjonalnie `version`.
