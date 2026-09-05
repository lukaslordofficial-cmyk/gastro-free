# Load smoke (backend)

Skrypty:
- `backend/scripts/load_smoke.py` (Python + httpx)
- `backend/scripts/load_smoke.mjs` (Node, bez zależności)

```bash
node backend/scripts/load_smoke.mjs --base https://gastro-manager-api-production-21dd.up.railway.app --users 10 --requests 80
```

## Wynik testowy (2026-09-05, `/api/health`)

| Concurrent | Requests | RPS | p50 | p95 | Status |
|---|---|---|---|---|---|
| 10 | 80 | ~14 | ~450 ms | ~2.4 s | 100% 200 |
| 25 | 100 | ~8 | ~2.0 s | ~2.3 s | 100% 200 |
| 50 | 100 | ~15 | ~3.4 s | ~6.0 s | 100% 200 |

Wnioski:
- Lekkie endpointy (health) trzymają się przy ~10–15 RPS; latency rośnie mocno powyżej ~25 równoległych.
- ~10 aktywnych sesji (magazyn/menu, bez OCR) — OK na obecnym Railway.
- 50+ równoległych użytkowników / intensywny OCR — potrzebny scaling (więcej workerów) + kolejka skanów.
- Vision/OCR jest 10–50× cięższy niż health — nie skaluj oczekiwań 1:1.

## Multi-user / to samo konto

- Ten sam e-mail + hasło na kilku urządzeniach (barman / kuchnia / manager) = **działa** (Supabase multi-session).
- Osobne loginy pracowników ze wspólnym `account_key` = **jeszcze nie** (1 user = 1 tenant).
- Role (barman/kucharz/manager) = roadmapa team/invite.
