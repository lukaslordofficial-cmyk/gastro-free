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

**TODO (kolejne kęsy, jeden na raz, po akceptacji):**
- Kęs #2: `app/(tabs)/index.tsx` (dashboard, 26 zapytań) → `services/statsService`.
- Kęs #3: `magazyn` → `services/inventoryService`.
- Kęs #4: `menu` → `services/menuService`.
- Kęs #5: `dostawcy` → `services/suppliersService`.
- Testy jednostkowe (dekalog §IX): brak skonfigurowanego Jest — do wdrożenia w
  osobnym kęsie (config + testy dla logiki biznesowej: parsery, obliczenia).
