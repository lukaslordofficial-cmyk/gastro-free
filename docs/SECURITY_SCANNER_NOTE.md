# Uwaga do skanera The Code Registry / „Demo Project”

Data: 2026-08-12 (aktualizacja po raporcie GitHub vault v1.0.0 — 61 security findings, głównie SSRF false-flags + OSS).

## Co NIE dotyczy Gastro Manager (Expo)

Ścieżki typu:

- `public/assets/fonts/meteocons/demo-files/demo.js`
- `public/assets/fonts/meteocons/liga.js`
- `src/app/theme-layouts/.../NotificationCard.js`
- stare `webpack` / `crypto-js` w ogromnym `package-lock.json`

pochodzą z szablonu **Fuse React / Demo Project**, nie z aplikacji mobilnej w `frontend/` (Expo / React Native). W tym repo tych plików **nie ma** — nie ma czego „łatać” pod XSS w meteocons.

W panelu Code Registry skanuj vault **gastro-18** / właściwy folder `frontend` Expo, nie „Demo Project”.

## Remediacja po raporcie Code Registry (v1.0.0)

Zrobione w kodzie:

| Finding | Status |
|---|---|
| SSRF (`server.py` / Stripe redirects / RPC) | → `url_safety.py` + **`supabase_rest.py`** (`httpx.URL` host z env; path tylko tabela/rpc) |
| Sensitive Data in Source (`WIPE_FIRST_TEST_TENANT.sql`) | → placeholdery w SQL; wipe script bierze scope z env |
| Weak RNG (`Math.random`) | → `frontend/lib/secureId.ts` (`secureId`, `secureRandomIndex`) |
| `python-dotenv` symlink (CVE-2026-28684) | → **1.2.2** |
| `postcss` path traversal | → yarn resolution **8.5.23** |
| `image-size` DoS (ICNS) | → resolution **1.2.1** (tylko tool chain Metro; **nie** importować w RN — używa Node `fs`) |
| `python-multipart` DoS / path traversal | → **0.0.32** |
| Dockerfile jako root | → **USER appuser** |
| Weak hash MD5 | → **SHA-256** (smart basket fingerprints) |
| `nanoid` < 3.3.17 | → yarn resolution **3.3.18** |

Świadomie **nie** bumpujemy poza pinami Expo 54:

- `react-native-webview@13.15.0`
- `@react-native-async-storage/async-storage@2.2.0`
- `@react-native-community/datetimepicker@~8.4.4`

(„Latest” spoza SDK 54 = breaking dla Expo Go / EAS. Dług zależności redukowany przez resolutions + mitigacje.)

**Usunięte (2026-08):** Delta-Scraper (`backend/delta_scraper`, `/api/scraper/*`, UI monitora). Migracja: `DROP_DELTA_SCRAPER.sql`.

Fałszywe alarmy z raportu (nie wymagały patcha kryptograficznego):

- Skrót kategorii menu `"Desery": "DESR"` (nie dotyczy szyfrów)
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
- Wipe tenant: `WIPE_ACCOUNT_KEYS`, `WIPE_PROFILE_ID`, `WIPE_PROFILE_EMAIL` (bez PII w git).
