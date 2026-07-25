# Publiczny backend HTTPS (closed beta → skala)

Data: 2026-07-25.

Cel: FastAPI dostępne pod **publicznym HTTPS**, żeby APK z EAS działał u testerów poza LAN.

---

## Co jest w repo

| Plik | Rola |
|------|------|
| `backend/Dockerfile` | Obraz produkcyjny: `uvicorn` na `0.0.0.0:$PORT`, health `/api/health` |
| `backend/requirements-prod.txt` | Zależności API (bez Playwright Chromium) |
| `backend/railway.toml` / `railway.toml` | Railway healthcheck + Docker build |
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
- `ACCOUNT_KEY=default` (jeden portfel na deploy — patrz multi-tenant poniżej)
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` (maile zamówień)

CORS: aplikacja ma `allow_origins=["*"]` — OK na closed beta.

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
eas build -p android --profile preview --non-interactive
# po buildzie nie commituj kluczy:
git checkout -- eas.json
```

Szczegóły dystrybucji: [`BETA_APK_DISTRIBUTION.md`](./BETA_APK_DISTRIBUTION.md).

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
| **Auth** | `ACCOUNT_KEY=default` — **jeden** portfel kredytów / subskrypcja | Logowanie (Supabase Auth) + `account_key` / `restaurant_id` z JWT; albo szybki win: osobny deploy + `ACCOUNT_KEY` per restauracja |
| **Pliki / CDN** | Lokalne / Supabase Storage | CDN na assety, limity uploadu |
| **Rate limits** | Brak / słabe | Rate limit na `/api/*` (AI kosztuje), Stripe webhook idempotency |
| **HTTPS** | Terminacja u hosta (Railway/Render/Fly) | To samo + własna domena |
| **Stripe** | **Test mode** | Live keys + webhook na publiczny URL |

### Multi-tenant — quick win (bez przebudowy auth)

Schemat już trzyma `account_key` w `subscriptions`. Backend czyta:

```text
ACCOUNT_KEY=<slug-restauracji>
```

Na betę z 2–3 restauracjami: **osobny serwis Railway** (lub osobne env) z innym `ACCOUNT_KEY` i osobnym APK / deep linkiem.  
Pełne „zaloguj się e-mailem → wiele lokali w jednym APK” wymaga ekranu auth + mapowania `auth.uid()` → `account_key` (dziś brak — patrz [`BETA_KNOWN_LIMITATIONS.md`](./BETA_KNOWN_LIMITATIONS.md)).

---

## Publiczny URL (stan 2026-07-25)

| Pole | Wartość |
|------|---------|
| HTTPS API (beta tunnel) | `https://fair-breads-do.loca.lt` |
| Health | `GET /api/health` → **200** (`status: ok`, Supabase + OpenAI OK) |
| Alias health | `/health` |
| Hosting docelowy | **Railway** (login wymagany: `railway login` / kod activate) — Docker w `backend/` |
| Serveo (zapas) | `https://df16e4c99f4dd3f4-37-225-90-5.serveousercontent.com` (sesja SSH; też 200) |

### Uczciwość wobec skali

- **Teraz (closed beta):** tunel HTTPS → lokalny uvicorn `:8001` + Supabase. Działa u zdalnych testerów, dopóki maszyna z API i tunel są włączone.
- **Potem (tysiące):** przenieś ten sam obraz (`backend/Dockerfile`) na Railway/Render/Fly, ustaw env na platformie, stała domena, `railway domain` / custom domain. Multi-tenant: nie trzymać wszystkich na `ACCOUNT_KEY=default` — patrz sekcja wyżej.

Po stałym deployu Railway podmień URL w tej tabeli i w `frontend/.env`, potem przebuduj APK.

Aktywacja Railway (jeśli CLI czeka): https://railway.com/activate — potem `scripts/deploy-backend-railway.ps1`.
