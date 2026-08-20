# ARCHITECTURE.md — Gastro Manager

Dokument opisuje architekturę po refaktoryzacji „Wielkiego Sprzątania" wg `.agentrules`.
Aktualizowany przy każdej dużej zmianie strukturalnej (dekalog §X).

## Warstwy (Clean Architecture, dekalog §II)

```
frontend/
├── app/            # Ekrany (expo-router) — TYLKO render + stan lokalny UI
├── components/     # Komponenty prezentacyjne (docelowo < 250 linii, dekalog §I)
├── contexts/       # Stan globalny React (orkiestracja, bez zapytań do bazy)
├── hooks/          # Reużywalne hooki stanowe
├── services/       # ⬅ NOWA warstwa: całe IO (Supabase, backend API)
└── lib/            # Utilsy czyste (formatery, katalogi danych, klient supabase)
```

Reguła kierunku zależności: `app`/`components` → `contexts`/`hooks` → `services` → `lib`.
Warstwa UI **nigdy** nie importuje `supabase` bezpośrednio — tylko przez `services/*`.

## Dziennik zmian strukturalnych

### 2026-08-20 — Kęs: market-ready security + IngredientRow (`chore/split-monoliths`)

- Auto-confirm: wymaga `email` zgodnego z kontem + konto młodsze niż 15 min; błędy Admin API nie wyciekają do klienta; osobny rate-limit IP.
- JWT cache 25s; zapisy zawsze robią live lookup; 401/403 invaliduje cache.
- `X-Account-Key` bez JWT jest ignorowany (spoof odczytów) — wyjątek: Bearer service_role.
- `restaurant_profile` + `kitchen_utensils` w filtrze tenant; migracja `ADD_RESTAURANT_PROFILE_TENANT.sql`.
- Token Furgonetki tylko z `FURGONETKA_SHOP_TOKEN`; brak hardcoded Railway URL.
- TLS: `OPENAI_SSL_VERIFY=0` ignorowane na Railway production (`backend/http_ssl.py`).
- Outbound URL: domyślnie tylko HTTPS.
- Cron `expiry-daily-job` iteruje wszystkie `profiles.account_key` (push tylko do userów danego tenanta).
- Menu: `IngredientRow` + status magazynu → `frontend/components/menu/`.

### 2026-08-20 — Kęs: split monolitów (`chore/split-monoliths`)

Osobny branch od `chore/release-hardening` — działająca linia release **nie** jest tu ruszana.
Zachowanie 1:1, tylko przeniesienie kodu:

- Menu: `DishCard` + style → `frontend/components/menu/`; typy → `frontend/types/menu.ts`;
  stałe → `frontend/constants/menuUi.ts`; mapowania → `frontend/lib/menuScreenHelpers.ts`.
  Miniatury nadal przez `getMenuThumbSync` / `dishCustomImages` (bez mieszania z Inspiracjami).
- Backend: liveness + auto-confirm + deep health → `backend/health_routes.py` (`APIRouter`).

### 2026-08-20 — Kęs: hardening przed rynkiem (`chore/release-hardening`)

Przegląd całej aplikacji vs dekalog `.agentrules`. Ten branch **nie** tnie monolitu
(`server.py` ~16k, `menu.tsx` ~3k) — to osobne kęsy po akceptacji. Zrobione teraz:

- `AUTO_CONFIRM_EMAIL` domyślnie **false** (Admin API nie potwierdza maili byle komu).
- Joby cron (`expiry-daily-job`, `core-alerts-job`, `migration-status`) wymagają `CRON_JOB_SECRET`.
- CORS z `CORS_ALLOW_ORIGINS` (niehardkodowane `*`).
- Usunięty leftover `GET /api/download/gastro-manager-updated.zip`.
- Health nie wycieka `ACCOUNT_KEY` / nazw modeli.
- Token sandbox Furgonetki tylko poza `FURGONETKA_PRODUCTION=1`.
- Moduł `backend/cron_auth.py` + testy.
- JWT cache 25s + wspólny httpx (keepalive); zapisy bez cache.
- Zapis przy `account_key=default` → 401 (wyjątek: Stripe/POS/Furgonetka webhooki).
- Rate limit AI 40/min i zapis 180/min na tenanta (per worker).
- POS: link z HMAC (`GET /api/pos/webhook-config`) — master `POS_WEBHOOK_SECRET` zostaje na serwerze.
- Stripe Price ID z env (testowe fallbacki tylko z `ALLOW_STRIPE_TEST_PRICE_FALLBACK`).
- Komunikaty UI bez nazw SQL / `STRIPE_SECRET_KEY`; usunięty martwy `PremiumDashboard`.

**Kolejne kęsy (jeden na raz, po teście na telefonie):**
1. Dokończyć cięcie `menu.tsx` (IngredientRow, ekran) i `server.py` (voice, POS, billing).
2. Ciąć pozostałe ekrany >250 linii: `magazyn.tsx`, `dostawcy/index.tsx`, `index.tsx` (Finanse).
3. Podwójny katalog obrazków: Menu = `dishAssets` (lazy); Inspiracje = `dishImagesCatalog` (eager `require` WebP) — nie scalać bez testu Menu.
4. `as any` na ekranach Voice/Finanse.
5. RLS audit (`SCALE_INDEXES_AND_RLS.sql`) jeśli jeszcze nie odpalone na produkcji.

### 2026-08-12 — Łowca: lokalni → „Zamów i zapłać” (Stripe)

- Przy koszyku lokalnego przetwórcy zamiast e-mail/SMS: sheet adresu + Stripe Checkout
  (`LocalProducerCheckoutSheet` + `createProducerOrder` / `openProducerOrderCheckout`).
- Hurtownicy bez zmian (przygotuj e-mail/SMS).

### 2026-08-12 — `insufficient_capabilities_for_transfer` → komunikat dla restauratora

- Checkout wymaga `transfers=active` (nie `pending`); Restricted → HTTP 400 z PL komunikatem.
- `Account.create` wymusza `capabilities.card_payments/transfers.requested=true` (+ refresh po create).
- Mapowanie błędu Stripe `insufficient_capabilities_for_transfer` (bez retry BLIK).

### 2026-08-12 — Fix Stripe 400 przy zamówieniu od lokalnych (Connect)

- Istniejące `acct_...` dostają `Account.update` z `card_payments` + `transfers`
  (wcześniej capabilities tylko przy `accounts.create` → stare konta → 400).
- Przed Checkout: `assert_destination_charge_ready`; czytelny komunikat PL.
- Destination charge: `application_fee_amount` (kurier+5%) + `transfer_data.destination`
  (bez `transfer_data.amount`); retry Checkout card-only gdy BLIK/capability pada.

### 2026-08-12 — Fix: Łowca Okazji `search_scope` lokalni vs hurtownicy

- Jarvis `order_critical_items_by_category` **nie przekazywał** `search_scope` → zawsze hurtownicy.
- `compare-offers`: twarda bramka katalogu po scope + czytelny komunikat gdy lokalni pusti.
- Cache `optimizer/critical-order` uwzględnia scope w kluczu.
- FE DealHunter: `compare-offers` z `apiJsonHeaders` (tenant).

### 2026-08-12 — Kęs #9: `supabase_rest` + SSRF posture (Code Registry GitHub report)

- **`backend/supabase_rest.py`** — `sb_get` / `sb_post` / `sb_patch` / `sb_delete` + tenant filters
  wydzielone z monolitu `server.py` (dekalog §I / §VIII). URL = stały host z env + walidowany path
  (`httpx.URL(scheme, host, path)` — bez składania hosta z inputu).
- Middleware account_key: Auth `/user` i REST `profiles` przez `build_supabase_auth_user_url` /
  `build_supabase_rest_url`.
- **`dayjs` → 1.11.21** (patch OSS). Bez bumpów Expo native (async-storage / webview / datetimepicker).

### 2026-08-12 — Code Registry harden + fix Expo bundle

- **`backend/url_safety.py`** — walidacja REST/RPC path, origin Supabase, allowlista redirectów Stripe
  (SSRF / open redirect). Helpery: `build_supabase_rest_url`, `build_supabase_auth_admin_url`.
- **`frontend/lib/secureId.ts`** — wspólne `secureId` / `secureRandomIndex` (bez `Math.random`).
- **Nie importować `image-size` w RN** — paczka używa Node `fs`; pin zostaje tylko w yarn resolutions.
- Expo crash (bundle) naprawiony przez usunięcie `src/utils/imageSizeSecurity.ts`.

### 2026-08 — Kęs #8: Skan menu → pełny magazyn (jak gastro-manager-15)

- Porównano z `lukaslordofficial-cmyk/gastro-manager-15`: onboarding = składniki z receptur.
- `confirm-scan` **sam uzupełnia puste receptury AI** przed zapisem (bez tego tylko OCR → 1 produkt).
- Soft-deleted: przywracanie z inactive + hard-delete przy usuwaniu z UI (UNIQUE nie blokuje).
- FE: brak składników → od razu `confirmSave(true)`.

### 2026-08 — Kęs #7: Usuwanie w Magazynie + onboarding skanu menu

- **UI Magazyn (premium):** przycisk usuwania produktu zawsze widoczny (Trash) obok edycji —
  wcześniej ternary `onOrder`/`onEdit` ukrywał delete.
- **Usuwanie kategorii:** Trash poza zagnieżdżonym `TouchableOpacity` (Android gubił tap);
  `deleteCategory` z `account_key`.
- **Skan menu → magazyn:** soft-deleted produkty są przywracane zamiast blokować tworzenie;
  składniki z pominiętych (już w menu) dań też idą do onboardingu.

### 2026-08 — Kęs #6: Dedup skanów + sync finansów + półprodukty / dark product-suppliers

- **Finanse:** snapshot magazynu filtruje `is_active=true` (bez wypadania filtra przy fallbacku
  kolumn); licznik „wymaga uzupełnienia” = krytyczny + poniżej optymalnego; `useFocusEffect`
  odświeża po Magazynie.
- **Skan menu/faktura:** blokada double-submit (`savingRef` / `processingRef`); dedup potraw
  w payloadzie; wzajemne wykluczenie skanu oferty vs menu w `UiOverlayContext`.
- **Menu → magazyn:** `ensureWarehouseLinks` czyta świeży DB + race-retry; zapis produktu
  z menu aktualizuje istniejący wiersz zamiast dublować.
- **Półprodukty:** CTA „Dorób” zamiast zamówienia u dostawcy (`magazyn.tsx`).
- **product-suppliers:** wymuszony dark premium (bez białego skina).
- **SQL:** `SCALE_INDEXES_AND_RLS.sql` — indeksy `status`/`created_at` warunkowe (`information_schema`).

### 2026-08 — Kęs #5: Typy Database + skala DB (P0)
- **`frontend/lib/types.ts`** — naprawiony kształt `Database` pod `@supabase/supabase-js` 2.58:
  `Relationships: []`, Views/Functions/Enums/CompositeTypes, domenowe `type` (nie
  `interface` — inaczej Row nie spełnia `Record<string, unknown>` i Insert → `never`).
  Dodane `account_key` tam, gdzie migracje tenantowe je wymagają. Stuby tabel
  używanych w kodzie (`warehouse_inventory`, …).
- **tsc:** ~154 błędów (`never`) → ~100 (reszta: brakujące pola UI, bargainHunter,
  AdsProvider — nie blokują IO).
- **`services/suppliersService.ts`** — `recipe_ingredients` filtr przez
  `menu_items!inner(account_key)` (szczelność tenanta + limit 2000). Usunięte `any`.
- **Nowa migracja `supabase_migrations/SCALE_INDEXES_AND_RLS.sql`** — indeksy B-Tree
  + RLS audyt (account_key / join parent). **Do uruchomienia w SQL Editor.**
- Docelowo: `npx supabase gen types typescript --project-id … > lib/types.generated.ts`.


- **Nowy plik `services/authService.ts`** — całe IO auth: `getSession`,
  `subscribeToAuthState`, `signInWithPassword`, `signUp`, `signOut`,
  `autoConfirmUser`, `fetchProfile`, `upsertProfile`, `seedSubscription`,
  `seedWarehouseCategories`. Każda funkcja owinięta w `try-catch` (dekalog §V),
  ściśle otypowana (dekalog §VI), z komentarzami JSDoc *dlaczego* (dekalog §X).
- **`contexts/AuthContext.tsx` odchudzony (300 → ~250 linii)** — już nie importuje
  `supabase`; trzyma wyłącznie stan React + orkiestrację. Publiczny kontrakt
  `useAuth()` bez zmian → ekrany `login.tsx` / `register.tsx` działają bez zmian.
- **`.env`** — klucze Supabase wyłącznie w `.env` (dekalog §III); plik jest już
  w `.gitignore`.

### 2026-06 — Kęs #2: Dashboard/Finanse + naprawa 2 błędów (czeka na test urządzenia)
- **Nowy `services/financeService.ts`** — całe IO Supabase modułu Finanse:
  `fetchFinanceRows` (odczyt miesiąca + historii + snapshot magazynu, z fallbackiem
  `account_key`), `insertRevenue/insertFixedCost/insertVariableCost`, `updateCost`,
  `updateNote`, `deleteCost`. Try-catch, typy, JSDoc.
- **`app/(tabs)/index.tsx`** — 0 bezpośrednich zapytań `supabase` (było 26); tylko UI+stan.
- **BUGFIX "failed to load split bundle" (panel finansów):** usunięto WSZYSTKIE
  dynamiczne `await import('@/lib/accountKey')` (index, magazyn, JarvisFormExtras,
  DealHunterModal, ProductExpiryEditor) -> statyczne importy. Root cause: Metro
  tworzył kruche split-bundle pobierane runtime na telefonie.
- **BUGFIX multi-tenant (brak danych po przelogowaniu):** dashboard odświeża się
  reaktywnie po zmianie `accountKey` (useAuth), z guardem na `default`. Auth gate
  używa `router.replace` (bez remountu) -> wcześniej `fetchData` nie odpalał ponownie.
- Weryfikacja: pełny bundle Metro OK (HTTP 200, importy się rozwiązują), tsc bez
  nowych błędów (projekt 173->166), `index.tsx` = 0 błędów.

**TODO (kolejne kęsy, jeden na raz, po akceptacji):**
### 2026-06 — Kęs #4: Serwis Dostawców (czeka na test urządzenia)
- **Nowe `services/suppliersService.ts` + `services/supplierOrdersService.ts`** —
  całe IO Dostawców: fetch z 4-poziomowym fallbackiem schematu, katalog, oferty AI,
  edge function `process-offer`, zamówienia/drafty. `app/(tabs)/dostawcy.tsx` = 0
  bezpośrednich zapytań `supabase` (było 36).
- Weryfikacja: bundle Metro OK, tsc 166->154 (usunięte surowe inserty `never`).
- Pozostałe ekrany z `supabase` w UI: `menu.tsx` (7), `ustawienia.tsx` (2) — kolejne kęsy.
### 2026-06 — Kęs #3: Serwis Magazynu + fix crashu (czeka na test urządzenia)
- **BUGFIX krytyczny "Rendered more hooks / change in order of Hooks" (ExpandableDateJournal):**
  `useMemo(leafById)` był wołany PO wczesnym `return` przy pustej liście → dodanie
  pierwszego kosztu zmiennego (pusta→niepusta) łamało Rules of Hooks i wywalało
  ekran finansów. Hook przeniesiony przed early-return.
- **Nowy `services/inventoryService.ts`** — całe IO Magazynu (fetch+seed, insert/delete
  kategorii, soft-delete produktu, save z fallbackami, combo, auto-unlock ofert).
  `app/(tabs)/magazyn.tsx` ma teraz 0 bezpośrednich zapytań `supabase`.
- Próba naprawy typu `Database` (never przy insertach) — nieudana bez `supabase gen
  types` (wymaga CLI+bazy); cofnięta, bo nie pomagała. Typy nie wpływają na runtime.
- Weryfikacja: bundle Metro OK, tsc bez nowych błędów (173→166).
