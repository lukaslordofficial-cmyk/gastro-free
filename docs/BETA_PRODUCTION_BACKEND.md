# Publiczny backend HTTPS (closed beta → skala)

Data: 2026-07-25.

Cel: FastAPI dostępne pod **publicznym HTTPS**, żeby APK z EAS działał u testerów poza LAN.

---

## Co jest w repo

| Plik | Rola |
|------|------|
| `Dockerfile` (root) | Obraz produkcyjny Railway z context = root repo |
| `requirements-prod.txt` (root) | Zależności API — musi być w root (sync z `backend/`) |
| `backend/Dockerfile` | Build lokalny: `cd backend && docker build` |
| `backend/requirements-prod.txt` | Kopia zależności (trzymaj zsynchronizowaną z root) |
| `railway.toml` (root) | `dockerfilePath = "Dockerfile"`, health `/api/health` |
| `render.yaml` | Blueprint Render (Docker, rootDir=`backend`) |
| `fly.toml` | Opcjonalny Fly.io |
| `scripts/deploy-backend-railway.ps1` | Deploy + sync zmiennych z `backend/.env` |

Lokalnie API nadal: `uvicorn server:app --host 0.0.0.0 --port 8001`.

---

## Zmienne środowiskowe (platforma — nie commitować)

Wymagane:

- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY` (**tylko `sk_test_` na betę**)
- `STRIPE_PUBLISHABLE_KEY` (`pk_test_...`)

Zalecane / billing:

- `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_TIER1/2`, `STRIPE_PRICE_TOPUP_*`
- `PUBLIC_APP_URL`, `BILLING_SUCCESS_URL`, `BILLING_CANCEL_URL`
- `ALLOW_MOCK_BILLING=false`
- `ACCOUNT_KEY=default` (fallback gdy brak nagłówka `X-Account-Key` — apka z logowaniem wysyła klucz z `profiles`)
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (maile zamówień)

CORS: aplikacja ma `allow_origins=["*"]` — OK na closed beta.

### Checklist zmiennych Railway (wklej w Variables)

- [ ] `OPENAI_API_KEY`
- [ ] `SUPABASE_URL`
- [ ] `SUPABASE_SERVICE_ROLE_KEY`
- [ ] `STRIPE_SECRET_KEY` (`sk_test_…`)
- [ ] `STRIPE_PUBLISHABLE_KEY` (`pk_test_…`)
- [ ] `STRIPE_WEBHOOK_SECRET` (po skonfigurowaniu webhooka)
- [ ] `STRIPE_PRICE_TIER1` / `STRIPE_PRICE_TIER2` / `STRIPE_PRICE_TOPUP_*` (jeśli używane)
- [ ] `PUBLIC_APP_URL` / `BILLING_SUCCESS_URL` / `BILLING_CANCEL_URL`
- [ ] `ALLOW_MOCK_BILLING=false`
- [ ] `ACCOUNT_KEY=default` (tylko fallback)
- [ ] `RESEND_API_KEY` / `RESEND_FROM_EMAIL` (opcjonalnie)
- [ ] `PORT` — Railway ustawia samo; Dockerfile czyta `${PORT}`

**Root Directory:** zostaw **puste / repo root** (używa root `Dockerfile` + `requirements-prod.txt`).  
Nie ustawiaj Root Directory = `backend`, jeśli `dockerfilePath` wskazuje na root `Dockerfile`.  
Healthcheck: `GET /api/health`.

---

## Deploy — Railway (preferowane)

```powershell
$env:NODE_OPTIONS='--use-system-ca'
railway login
# albo: railway login --browserless  → otwórz link / wpisz kod
cd backend
railway init          # raz: projekt + service
powershell -ExecutionPolicy Bypass -File ..\scripts\deploy-backend-railway.ps1
railway domain        # generuje *.up.railway.app
```

Health: `https://<domena>/api/health` → JSON `status: ok`.

Dashboard: wklej te same klucze w Variables, jeśli skrypt nie przejdzie.

### Render

1. New → Blueprint → `render.yaml`
2. Uzupełnij secret env vars w UI
3. URL: `https://gastro-manager-api.onrender.com` (lub własna nazwa)

### Fly.io

```powershell
fly auth login
fly launch --config fly.toml
fly secrets set OPENAI_API_KEY=... SUPABASE_URL=... # itd.
fly deploy
```

---

## Po live URL → APK

```powershell
cd frontend
# ustaw EXPO_PUBLIC_BACKEND_URL=https://... (bez slash na końcu)
$env:NODE_OPTIONS='--use-system-ca'
node scripts/sync-eas-preview-env.js
eas build -p android --profile preview --non-interactive   # AAB (app-bundle)
# opcjonalny APK: --profile preview-apk
# po buildzie nie commituj kluczy:
git checkout -- eas.json
```

Szczegóły: [`APP_SIZE_AND_AAB.md`](./APP_SIZE_AND_AAB.md), [`BETA_APK_DISTRIBUTION.md`](./BETA_APK_DISTRIBUTION.md).

---

## Tunel (ostatnia deska ratunku na betę)

Jeśli brak logowania do Railway/Render/Fly:

```powershell
# lokalny backend musi działać na 8001
cloudflared tunnel --url http://127.0.0.1:8001
```

Otrzymasz `https://*.trycloudflare.com` — wstaw do `EXPO_PUBLIC_BACKEND_URL` i przebuduj APK.  
**Uwaga:** URL quick-tunnel zmienia się po restarcie → nie nadaje się na tysiące użytkowników; tylko smoke / kilku testerów.

---

## Skalowanie — uczciwie

| Warstwa | Closed beta (OK) | Tysiące użytkowników później |
|---------|------------------|------------------------------|
| **DB** | Supabase (Postgres) — już primary, nie SQLite | Connection pooler (Supabase pooler / PgBouncer), indeksy, RLS per tenant |
| **API** | 1× uvicorn worker na Railway/Render | Kilka replik; `gunicorn -k uvicorn.workers.UvicornWorker -w 2..4`; osobny worker na scraper/playwright |
| **Auth** | Login/register + `profiles.account_key` + nagłówek `X-Account-Key` (patrz [`BETA_AUTH.md`](./BETA_AUTH.md)) | Pełne RLS na inventory/menu per tenant; JWT claim w `app_metadata` |
| **Pliki / CDN** | Lokalne / Supabase Storage | CDN na assety, limity uploadu |
| **Rate limits** | Brak / słabe | Rate limit na `/api/*` (AI kosztuje), Stripe webhook idempotency |
| **HTTPS** | Terminacja u hosta (Railway/Render/Fly) | To samo + własna domena |
| **Stripe** | **Test mode** | Live keys + webhook na publiczny URL |

### Multi-tenant

- **Aplikacja:** logowanie → `profiles.account_key` → kredyty/Stripe per user (migracja `ADD_AUTH_PROFILES.sql`).
- **Backend:** `X-Account-Key` z klienta; env `ACCOUNT_KEY` tylko jako fallback.
- **Ograniczenie:** tabele magazynu/menu historycznie bez kolumny tenant — pełna izolacja danych operacyjnych to kolejny etap (patrz [`BETA_KNOWN_LIMITATIONS.md`](./BETA_KNOWN_LIMITATIONS.md)).

---

## Publiczny URL (stan 2026-07-25)

| Pole | Wartość |
|------|---------|
| HTTPS API (beta tunnel) | `https://7aa96d61295f7058-31-128-20-61.serveousercontent.com` |
| Health | `GET /api/health` → **200** przy żywym tunelu |
| Alias health | `/health` |
| APK z tym URL | https://expo.dev/artifacts/eas/vocidXWLqoJLWOv2Ei7TKFFEmNc7AvTCn-D-rzPnZ-E.apk |
| Hosting docelowy | **Railway** — `railway login` (browser OAuth; poprzednia próba agenta timeout) → `scripts/deploy-backend-railway.ps1` |
| Uwaga | Serveo/localtunnel **zmienia URL** — nie na tysiące użytkowników; tylko closed beta przy włączonym PC |

### Uczciwość wobec skali

- **Teraz (closed beta):** tunel HTTPS → lokalny uvicorn `:8001` + Supabase. Działa u zdalnych testerów, dopóki maszyna z API i tunel są włączone.
- **Potem (tysiące):** przenieś ten sam obraz (`backend/Dockerfile`) na Railway/Render/Fly, ustaw env na platformie, stała domena, `railway domain` / custom domain. Multi-tenant: nie trzymać wszystkich na `ACCOUNT_KEY=default` — patrz sekcja wyżej.

Po stałym deployu Railway podmień URL w tej tabeli i w `frontend/.env`, potem przebuduj APK.

Aktywacja Railway (jeśli CLI czeka): https://railway.com/activate — potem `scripts/deploy-backend-railway.ps1`.
