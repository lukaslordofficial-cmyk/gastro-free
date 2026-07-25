# Gastro Manager

Aplikacja dla restauracji: magazyn, menu, dostawcy, Jarvis, Łowca Okazji, subskrypcje (Stripe Test).

## Closed beta

- Smoke test dla restauratorów: [`docs/BETA_SMOKE_TEST.md`](docs/BETA_SMOKE_TEST.md)
- Gotowość / limity kredytów (1000): [`docs/BETA_READINESS_CHECKLIST.md`](docs/BETA_READINESS_CHECKLIST.md)
- APK / EAS: [`docs/BETA_APK_DISTRIBUTION.md`](docs/BETA_APK_DISTRIBUTION.md)
- Publiczny backend HTTPS: [`docs/BETA_PRODUCTION_BACKEND.md`](docs/BETA_PRODUCTION_BACKEND.md)
- Znane limity (multi-tenant, tunel vs Railway): [`docs/BETA_KNOWN_LIMITATIONS.md`](docs/BETA_KNOWN_LIMITATIONS.md)

## Struktura

- `frontend/` — Expo (React Native)
- `backend/` — FastAPI (port **8001**)
- `supabase_migrations/` — SQL do uruchomienia w Supabase SQL Editor

## Szybki start (dev)

1. Skopiuj `frontend/.env.example` → `frontend/.env` i ustaw `EXPO_PUBLIC_BACKEND_URL` + Supabase.
2. Skopiuj `backend/.env.example` → `backend/.env` (Stripe **test** keys).
3. Backend: `uvicorn` / skrypt startowy na porcie 8001.
4. Frontend: `yarn` / `npm start` w `frontend/`.

**Stripe:** closed beta = wyłącznie `sk_test_` / `pk_test_`.
