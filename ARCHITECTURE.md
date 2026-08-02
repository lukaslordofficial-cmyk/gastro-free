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

### 2026-06 — Kęs #1: Moduł autoryzacji (separacja IO od stanu)
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
