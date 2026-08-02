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
- P0 Kęs #2: Naprawa typu `Database` (lib/types.ts) → dodać Views/Functions/Enums/
  Relationships, by supabase-js przestał typować inserty jako `never`. Usuwa ~większość
  ze 171 błędów tsc naraz (dekalog §VI). Wysoka wartość, ale wymaga ostrożnego testu.
- P0 Kęs #3: `app/(tabs)/index.tsx` (dashboard, 26 zapytań) → `services/statsService`.
- P1 Kęs #4: `magazyn.tsx` (2653) → `services/inventoryService` + rozbicie UI.
- P1 Kęs #5: `menu.tsx` (2866) → `services/menuService` + rozbicie UI.
- P1 Kęs #6: `dostawcy.tsx` (3185) → `services/suppliersService` + rozbicie UI.
- P2 Kęs #7: `VoiceReportModal.tsx` (4355) → rozbicie na komponenty.
- P2 Kęs: konfiguracja Jest + testy jednostkowe logiki biznesowej (dekalog §IX).
- P2: audyt polityk RLS per tabela (dekalog §IV) + indeksy B-Tree (§VII).
