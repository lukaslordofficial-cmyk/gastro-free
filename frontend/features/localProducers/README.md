# Lokalni Przetwórcy (ETAP 1)

Niezależna warstwa pod zakładką **Dostawcy**. Nie korzysta z `suppliersService` / tabel dostawców restauracyjnych. Ten sam klient Supabase (`@/lib/supabase`).

## Struktura

- `features/localProducers/` — barrel feature
- `types/localProducers/` — typy domenowe
- `services/localProducers/` — IO (stub list/create; tabele w kolejnym etapie)
- `hooks/localProducers/` — `useLocalProducers`
- `components/localProducers/` — UI (sub-tabs, empty state)
- `screens/localProducers/` — ekran główny
- Route: `app/(tabs)/dostawcy/lokalni-przetworcy.tsx`
