# Uwaga do skanera The Code Registry / „Demo Project”

Data: 2026-07-25.

## Co NIE dotyczy Gastro Manager (Expo)

Ścieżki typu:

- `public/assets/fonts/meteocons/demo-files/demo.js`
- `public/assets/fonts/meteocons/liga.js`
- `src/app/theme-layouts/.../NotificationCard.js`
- stare `webpack` / `crypto-js` w ogromnym `package-lock.json`

pochodzą z szablonu **Fuse React / Demo Project**, nie z aplikacji mobilnej w `frontend/` (Expo / React Native). W tym repo tych plików **nie ma** — nie ma czego „łatać” pod XSS w meteocons.

W panelu Code Registry skanuj vault **Gastro-Manager-15** / właściwy folder `frontend` Expo, nie „Demo Project”.

## Co warto pilnować w naszym frontendzie Expo

- Brak sekretów w git (`sk_…`, `service_role`) — tylko `EXPO_PUBLIC_*` (anon / publishable).
- Nie commituj wyniku `sync-eas-preview-env.js` z prawdziwymi kluczami do `eas.json` (placeholder w repo).
- Zależności Expo aktualizuj przez `npx expo install` / audit gdy będzie rebuild AAB.

## Backend (Railway)

- Healthcheck: szybki `GET /api/health` (bez DB).
- W Variables obowiązkowo: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
