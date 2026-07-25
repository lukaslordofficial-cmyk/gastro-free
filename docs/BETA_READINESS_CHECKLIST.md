# Checklist gotowości beta — Gastro Manager

Ocena na podstawie kodu w repozytorium (nie marketing). Data przeglądu: 2026-07-25.  
Workspace: `Gastro-Manager-fixed`.

---

## Gotowe na ~100% / stabilne

Funkcje z pełnym UI + backendiem (lub lokalnym seedem), rozsądnie domknięte przy poprawnych migracjach i env:

- **Finance / PnL** — `PremiumFinanceScreen`, `RevenueChart`, archiwum raportów dobowych, close-day POS, agregacje w `server.py`
- **Magazyn** — `magazyn.tsx`: kategorie, stany, alerty krytyczne, powiązanie z Łowcą; partie ważności w DB
- **Menu** — `menu.tsx`: dania, kategorie, receptury inline, skan karty (`MenuScanModal`)
- **Dostawcy** — `dostawcy.tsx`: CRUD, katalogi, shipping / **czas dostawy** w formularzu (+ hint „Uzupełnij czas dostawy”), skan ofert
- **Łowca Okazji Faza 1–2** — `bargain_hunter.py` + `smart_basket_optimizer.py` + `DealHunterModal` (monolith/split, 3 scenariusze, sugestie); testy jednostkowe
- **Łowca Faza 3 (lead time)** — kolumna + UI dostawców + `DEFAULT_LEAD_TIME_DAYS=2` w optymalizerze gdy NULL (bez fałszowania DB)
- **Receptury** — `RecipesModal` (tekst / OCR / głos), endpoint `/api/recipes/ocr-text`, mapowanie magazyn↔składnik (`ADD_RECIPE_WAREHOUSE_MAP`)
- **Inspiracje** — ~28 katalogów `*Catalog.ts` + `inspirationsRegistry` + `InspirationsModal` + `/api/inspirations/recipe`
- **Expiry UI** — `ProductExpiryEditor`, `InvoiceExpiryReviewForm`, lokalne przypomnienia (`pushNotifications.scheduleExpiryReminders`), Jarvis intent `list_expiring_soon` (drabina)
- **Tipy Zero Waste (Phase 1)** — `expiryTipsCatalog.ts` + `pickExpiryTips` / `buildExpiryTipsForItem` **podpięte** w `VoiceReportModal` (drabina Jarvis); gry `game_safe` + disclaimer; `requires_legal_review` pomijane w auto-pick
- **Auth / subskrypcje / kredyty** — Stripe checkout/webhook, `SubscriptionContext`, wallet kredytów, migracje billing
- **Jarvis / głos** — `VoiceReportModal` + intenty rankingów / drabiny / HACCP (przy działającym backendzie)

---

## Działa, ale wymaga ręcznego setupu

Bez tych kroków funkcje „są w kodzie”, ale lokal/staging nie zadziała:

- **Migracje Supabase** — 20 plików w `supabase_migrations/` (m.in. daily reports, soft delete, expiry, push tokens, shipping, `lead_time_days`, reliability, Stripe, delta scraper). Uruchamiać ręcznie w SQL Editor.
- **`EXPO_PUBLIC_BACKEND_URL`** — musi wskazywać host:port backendu (**8001**, nie Metro 8081); po zmianie IP → restart Expo
- **`backend/.env`** — Supabase URL/keys, OpenAI, Stripe (`STRIPE_*`, price IDs), opcjonalnie `ALLOW_MOCK_BILLING`
- **Edge cron expiry** — deploy `supabase/functions/expiry-daily-cron` + harmonogram **lub** scheduler na `/api/inventory/expiry-daily-job`
- **Stripe webhook** — URL produkcyjny/staging → `/api/billing/webhook`
- **Lead time / shipping / reliability** — kolumny puste, dopóki nie uzupełnisz w UI dostawców / nie włączysz migracji
- **Dane demo** — Finance/PnL sensowne dopiero po seedzie (`backend/scripts/seed_sim_*.py`) lub realnych wpisach
- **Push produkcyjny** — migracja `ADD_DEVICE_PUSH_TOKENS` + EAS `projectId` (brak gotowego `eas.json` w repo)

---

## Najmniej pewne / nieprzetestowane end-to-end

- **Gry legal-safe** — tipy/gry w drabinie Jarvis (Phase 1); brak osobnego ekranu „Uruchom grę” / PDF regulaminu
- **Reliability Score (Łowca Faza 4)** — backend liczy score gdy są oceny; UI na karcie dostawcy = „brak danych / wstępna” (bez pełnego formularza ocen)
- **Sugestie Deal Hunter** — zależą od żywych katalogów dostawców + stanów; bez danych wynik pusty/słaby
- **OCR receptur / skan menu / Inspiracje AI** — wiring OK (`RecipesModal` → `/api/recipes/ocr-text`); wymaga backendu + kredytów + OpenAI; brak E2E w CI
- **Push** — lokalne przypomnienia OK; zdalny Expo Push wymaga `projectId` (EAS) + tokenów w DB + crona; web bez tokena → **znane ograniczenie bety**
- **Soft-delete magazynu** — backend/głos używa `is_active`; UI `magazyn.tsx` może robić twarde `.delete()`
- **`ExpirationScanModal`** — plik istnieje, niezaimportowany (orphan)
- **Mapowanie receptura→magazyn** — głównie Ustawienia/POS, nie pełny flow z głównego menu
- **Brak EAS Build** — brak `eas.json` / projectId → ryzyko przy internal distribution i push
- **Cache Inspiracji** — plik lokalny na serwerze (`.inspiration_recipe_cache.json`), nie współdzielony multi-instancyjnie

---

## Przed beta dla restauratorów (checklist działań)

### Infrastruktura

- [ ] Uruchomić migracje SQL z `supabase_migrations/` (kolejność: core → feature; szczególnie expiry, push, shipping, lead_time, reliability, Stripe)
- [ ] Ustawić `frontend/.env` → `EXPO_PUBLIC_BACKEND_URL` (IP/host:8001) i zrestartować Expo
- [ ] Ustawić `backend/.env` (Supabase, OpenAI, Stripe **Test**) i odpalić API na 8001
- [ ] Deploy + cron `expiry-daily-cron` **albo** zewnętrzny scheduler na expiry-daily-job
- [ ] Skonfigurować Stripe **Test mode** (keys, price IDs, webhook) i przejść test checkout
- [ ] (Opcjonalnie) seed danych demo pod Finance / magazyn

### Build / dystrybucja

- [ ] Dodać / uzupełnić EAS (`eas.json`, `projectId` w `app.json`) pod internal distribution
- [ ] Zbudować build wewnętrzny (Android/iOS) i zainstalować na 1–2 urządzeniach testowych
- [ ] Utworzyć GitHub release / tag (np. `v0.9.0-beta`) — **gdy właściciel poprosi o push**

### Smoke test (minimum)

- [ ] Logowanie / sesja
- [ ] Magazyn: dodaj produkt, partię z datą ważności, alert
- [ ] Menu: dodaj danie + recepturę (opcjonalnie OCR jeśli kredyty)
- [ ] Dostawcy: **czas dostawy** + shipping; skan/katalog jeśli dostępny
- [ ] Łowca Okazji: optimize / critical-order na realnych brakach
- [ ] Finance: wpis przychodu / raport dobowy / wykres
- [ ] Jarvis: `list_expiring_soon` — drabina **z tipami z katalogu** (+ gra + disclaimer gdy dotyczy)
- [ ] Push: zgoda + rejestracja tokena (urządzenie fizyczne) — albo świadomie pominąć na web
- [ ] Stripe: checkout → confirm-session (**test mode**)

### Produkt / legal (Zero Waste tipy)

- [x] **Podpiąć `pickExpiryTips`** do Jarvis / drabiny (Phase 1) — `VoiceReportModal` + `buildExpiryTipsForItem`
- [x] W UI drabiny: disclaimer gdy gra/legal_note; `requires_legal_review` nie w auto-pick
- [ ] Nie obiecywać restauratorom „gotowych loterii” — tylko skill / everyone-wins / negocjacja
- [ ] (Później) PDF regulaminu + tipy w push — Phase 2–3 planu

### Znane długi techniczne do świadomej decyzji

- [ ] Soft-delete vs hard-delete w UI magazynu — ujednolicić przed beta
- [x] Reliability UI — minimalna uczciwa powierzchnia („brak danych / wstępna”); pełny rating → v2
- [ ] Podpiąć lub usunąć `ExpirationScanModal`
- [ ] Krótki README setup (migracje, env, porty) — obecny README to placeholder

---

## Beta smoke checklist (krótka)

Ręczny przebieg przed oddaniem zamkniętej bety restauratorom (~15–25 min).  
**Dla restauratorów (język prosty, 5–8 kroków):** → [`docs/BETA_SMOKE_TEST.md`](./BETA_SMOKE_TEST.md).

1. **Start** — migracje kluczowe + backend 8001 + Expo/`EXPO_PUBLIC_BACKEND_URL` (publiczny HTTPS dla APK poza LAN)
2. **Auth** — logowanie; sesja trzyma się po restarcie
3. **Magazyn** — produkt + partia z datą T-1/T-2/T-3
4. **Jarvis drabina** — „co kończy się wkrótce?” → tipy z katalogu; przy grze → disclaimer
5. **Dostawcy** — ustaw **Czas dostawy**; na karcie wartość albo „Uzupełnij…”
6. **Łowca** — critical / optimize; brak crasha przy pustym lead_time (default 2 dni)
7. **Receptura OCR** — opcjonalnie; wymaga OpenAI + kredytów **lub** wpis ręczny
8. **Stripe Test** — checkout kartą `4242…`; **bez live keys**
9. **Kredyty beta** — saldo startowe / Free max = **1000** (migracja `BETA_CREDITS_1000.sql`)

**Stripe:** dla beta testów = **Test mode**. Live dopiero przy płatnych pilotach + gotowej firmie + produkcyjnych webhookach.

### Limity kredytów (closed beta = 1000)

| Miejsce | Zmiana |
|---------|--------|
| `backend/server.py` → `TIER_CONFIG[0]` | `max_credits` 500→**1000**, starter create **1000** |
| `frontend/lib/subscriptionClient.ts` | `STARTER_CREDITS` **1000** |
| `frontend/lib/subscriptionCatalog.ts` | copy Free: pakiet **1000** |
| `supabase_migrations/ADD_SUBSCRIPTIONS.sql` | DEFAULT / seed **1000** |
| `supabase_migrations/BETA_CREDITS_1000.sql` | dopełnienie istniejących kont do **1000** |
| `backend/scripts/ensure_supabase_setup.py` | seed **1000** |

Bez zmian (nie są limitami planu): `MAX_GAP` optymalizera (~150 zł), koszty akcji AI, top-upy Stripe.

---

## Szybkie odniesienia

| Temat | Ścieżka |
|-------|---------|
| Seed tipów/gier | `frontend/lib/expiryTipsCatalog.ts` |
| Plan tipów | `docs/EXPIRY_TIPS_PLAN.md` |
| Jarvis drabina + tipy UI | `frontend/components/VoiceReportModal.tsx` (`renderExpiryLadder`) |
| Jarvis drabina API | `backend/server.py` → `_run_list_expiring_soon` |
| Deal Hunter UI | `frontend/components/DealHunterModal.tsx` |
| Lead time default | `backend/smart_basket_optimizer.py` → `DEFAULT_LEAD_TIME_DAYS` |
| Migracje | `supabase_migrations/` |
| Push | `frontend/lib/pushNotifications.ts` |
| OCR receptur | `RecipesModal` → `POST /api/recipes/ocr-text` |
