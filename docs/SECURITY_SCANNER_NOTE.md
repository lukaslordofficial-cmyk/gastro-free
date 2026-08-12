# Uwaga do skanera The Code Registry / „Demo Project”

Data: 2026-08-12 (aktualizacja po raporcie v1.0.0 / score 490).

## Co NIE dotyczy Gastro Manager (Expo)

Ścieżki typu:

- `public/assets/fonts/meteocons/demo-files/demo.js`
- `public/assets/fonts/meteocons/liga.js`
- `src/app/theme-layouts/.../NotificationCard.js`
- stare `webpack` / `crypto-js` w ogromnym `package-lock.json`

pochodzą z szablonu **Fuse React / Demo Project**, nie z aplikacji mobilnej w `frontend/` (Expo / React Native). W tym repo tych plików **nie ma** — nie ma czego „łatać” pod XSS w meteocons.

W panelu Code Registry skanuj vault **gastro-17** / właściwy folder `frontend` Expo, nie „Demo Project”.

## Remediacja po raporcie Code Registry (v1.0.0)

Zrobione w kodzie:

| Finding | Status |
|---|---|
| `python-multipart==0.0.12` (DoS / path traversal) | → **0.0.32** (`requirements-prod.txt`, `backend/requirements*.txt`) |
| Dockerfile jako root | → **USER appuser** (uid 10001) w `Dockerfile` i `backend/Dockerfile` |
| SSRF (`server.py` / Stripe redirects) | → `backend/url_safety.py` + walidacja path REST, allowlista redirectów |
| Weak hash MD5 (fingerprint) | → **SHA-256** (smart basket fingerprints) |
| Weak RNG (`Math.random` na ID) | → `frontend/lib/secureId.ts` (Web Crypto) |
| `nanoid` < 3.3.17 | → yarn resolution **3.3.18** |
| `image-size` DoS | → resolution **1.2.1** (już patched w lockfile) |

Świadomie **nie** bumpujemy poza pinami Expo 54:

- `react-native-webview@13.15.0`
- `@react-native-async-storage/async-storage@2.2.0`
- `@react-native-community/datetimepicker@~8.4.4`

(„Latest” spoza SDK 54 = breaking dla Expo Go / EAS.)

**Usunięte (2026-08):** Delta-Scraper (`backend/delta_scraper`, `/api/scraper/*`, UI monitora). Migracja: `DROP_DELTA_SCRAPER.sql`.

Fałszywe alarmy z raportu (nie wymagały patcha):

- **DES cipher** — kod kategorii menu `"Desery": "DES"`, nie algorytm DES
- **Sensitive data in source** — w git nie ma `sk_live` / service_role; tylko env placeholders
- Większość „SSRF” na liniach `sb_get` / billing payload — stały `SUPABASE_URL`, nie user-controlled base URL
- Lokalne `http://localhost` w fallbackach Stripe / testach

## Co warto pilnować w naszym frontendzie Expo

- Brak sekretów w git (`sk_…`, `service_role`) — tylko `EXPO_PUBLIC_*` (anon / publishable).
- Nie commituj wyniku `sync-eas-preview-env.js` z prawdziwymi kluczami do `eas.json` (placeholder w repo).
- Zależności Expo aktualizuj przez `npx expo install` / audit gdy będzie rebuild AAB.

## Backend (Railway)

- Healthcheck: szybki `GET /api/health` (bez DB).
- W Variables obowiązkowo: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.
- Opcjonalnie: `PUBLIC_APP_URL`, `ALLOWED_REDIRECT_HOSTS` (comma-separated) dla Stripe return URLs.
