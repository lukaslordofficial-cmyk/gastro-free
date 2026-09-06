# Crony backendu (Railway)

Joby chronione nagłówkiem `X-Cron-Secret` (= zmienna `CRON_JOB_SECRET` na Railway).

| Endpoint | Cel | Sugerowany harmonogram |
|----------|-----|------------------------|
| `GET /api/inventory/expiry-daily-job` | Push o kończącej się dacie ważności | codziennie ~05:15 UTC |
| `GET /api/reports/auto-close-daily-job` | Auto-zamknięcie dnia + raport (~24h) | codziennie ~05:30 UTC |
| `GET /api/inventory/critical-stock-job` | Push o krytycznym stanie magazynu | co 6h |
| `GET /api/manager/core-alerts-job` | Alerty CORE managera | poniedziałek ~06:00 UTC |

## Opcja A — GitHub Actions (już w repo)

Plik: `.github/workflows/backend-cron-jobs.yml`

1. W GitHub → Settings → Secrets and variables → Actions dodaj:
   - `BACKEND_API_URL` — np. `https://gastro-manager-api-production-21dd.up.railway.app`
   - `CRON_JOB_SECRET` — ta sama wartość co `CRON_JOB_SECRET` na Railway
2. Actions → **Backend cron jobs** → Run workflow (test ręczny).
3. Harmonogramy z YAML zaczną działać automatycznie (repo musi być publiczne **albo** masz GitHub Actions minutes na private).

## Opcja B — Railway Cron (jeśli masz w planie)

Dla każdego joba: Cron Job → URL powyżej + header `X-Cron-Secret: <secret>`.

## Opcja C — ręczny test

```bash
curl -sS -H "X-Cron-Secret: $CRON_JOB_SECRET" \
  "$BACKEND_API_URL/api/reports/auto-close-daily-job"
```

Bez poprawnego sekretu API zwraca 401/503.
