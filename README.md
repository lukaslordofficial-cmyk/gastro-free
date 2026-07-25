# Gastro Manager

Aplikacja dla restauracji: magazyn, menu, dostawcy, Jarvis, Łowca Okazji, subskrypcje (Stripe Test).

## Closed beta

- Smoke test dla restauratorów: [`docs/BETA_SMOKE_TEST.md`](docs/BETA_SMOKE_TEST.md)
- Gotowość / limity kredytów (1000): [`docs/BETA_READINESS_CHECKLIST.md`](docs/BETA_READINESS_CHECKLIST.md)
- Auth (login/register): [`docs/BETA_AUTH.md`](docs/BETA_AUTH.md)
- AAB / rozmiar: [`docs/APP_SIZE_AND_AAB.md`](docs/APP_SIZE_AND_AAB.md)
- APK / EAS: [`docs/BETA_APK_DISTRIBUTION.md`](docs/BETA_APK_DISTRIBUTION.md)
- Publiczny backend HTTPS (Railway): [`docs/BETA_PRODUCTION_BACKEND.md`](docs/BETA_PRODUCTION_BACKEND.md)
- Znane limity: [`docs/BETA_KNOWN_LIMITATIONS.md`](docs/BETA_KNOWN_LIMITATIONS.md)

## Struktura

- `frontend/` — Expo (React Native); EAS AAB: profile `preview` / `production`
- `backend/` — FastAPI (`Dockerfile`, health `/api/health`) — Root Directory na Railway
- `supabase_migrations/` — SQL do uruchomienia w Supabase SQL Editor (w tym `ADD_AUTH_PROFILES.sql`)
- `railway.toml` — build z `backend/Dockerfile` gdy Root = repo root

## Szybki start (dev)

1. Skopiuj `frontend/.env.example` → `frontend/.env` i ustaw `EXPO_PUBLIC_BACKEND_URL` + Supabase.
2. Skopiuj `backend/.env.example` → `backend/.env` (Stripe **test** keys).
3. Backend: `uvicorn` / skrypt startowy na porcie 8001.
4. Frontend: `yarn` / `npm start` w `frontend/`.

**Stripe:** closed beta = wyłącznie `sk_test_` / `pk_test_`.
