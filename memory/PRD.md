# PRD — Gastro Manager (Wielkie Sprzątanie / refaktoryzacja)

## Problem statement
Działająca aplikacja gastronomiczna (React Native Expo + Supabase). Cel: audyt,
refaktoryzacja i uporządkowanie architektury pod duży ruch, wg zasad `.agentrules`
(Dekalog BHP). Absolutny priorytet: 100% zachowanej funkcjonalności, zero regresji.
Praca „kęs po kęsie" — jeden moduł na raz, test na telefonie po każdej zmianie.
Backup = repo Gastro-Manager-15; zmiany → nowe repo Gastro-Manager-16 (Save to Github).

## Stack
- Frontend: React Native Expo + TypeScript (expo-router), Supabase JS, AsyncStorage
- Backend: FastAPI (Python) — auto-confirm, skany, Łowca
- DB: Supabase (Postgres + RLS)

## Zasady pracy (z .agentrules)
Pliki ≤250 linii, separacja warstw (UI ↔ services ↔ lib), sekrety tylko w .env,
RLS na tabelach, kod defensywny (try-catch), TS strict bez `any`, indeksy DB,
refaktor przed nową funkcją, testy jednostkowe, dokumentacja (ARCHITECTURE.md).

## Zrobione
### 2026-06 — Kęs #1: Moduł autoryzacji (separacja IO od stanu) ✅ (czeka na test urządzenia)
- Utworzono `.agentrules` i `ARCHITECTURE.md`.
- Nowa warstwa `frontend/services/` + `authService.ts` (całe IO Supabase/backend auth).
- `contexts/AuthContext.tsx` odchudzony (już nie importuje `supabase`; tylko stan+orkiestracja).
- Publiczny kontrakt `useAuth()` bez zmian → login/register bez modyfikacji.
- `.env` frontendu ustawiony (klucze Supabase); plik w `.gitignore`.
- tsc: parytet z oryginałem (2 istniejące błędy TS2769, brak nowych).

## Backlog (kolejne kęsy — jeden na raz, po akceptacji + teście urządzenia)
### 2026-06 — Kęs #2: Dashboard/Finanse + 2 bugfixy (czeka na test urządzenia)
- Nowy `services/financeService.ts` (całe IO Finanse); `index.tsx` bez `supabase`.
- FIX split-bundle ("failed to load split bundle") — usunięte wszystkie dynamiczne
  importy `@/lib/accountKey` (5 plików) -> statyczne. Panel finansów powinien się ładować.
- FIX multi-tenant — dashboard odświeża dane po zmianie konta (reaktywny accountKey).
- Weryfikacja: bundle Metro OK, tsc 173->166, 0 błędów w index.tsx.

- P0 Kęs #3: `magazyn.tsx` (2653) -> `services/inventoryService` + rozbicie UI.
- P0 Kęs #4: `menu.tsx` (2866) -> `services/menuService` + rozbicie UI.
- P1 Kęs #5: `dostawcy.tsx` (3185) -> `services/suppliersService` + rozbicie UI.
