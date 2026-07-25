# Zmiany — luty 2026

## Runda 1 — Silnik receptur i konwersji jednostek

### 1. Eliminacja błędu „Porcja" (Recipe Structure Fix)
- `POST /api/menu/confirm-scan` — wielkość porcji zapisywana teraz w
  `menu_items.portion_size_grams` + `portion_size_unit`. `recipe_ingredients`
  nie dostaje już wiersza „Porcja".
- Filtr `_is_porcja_row(...)` blokuje „Porcja / Wielkość porcji / Gramatura"
  w składnikach, w `_auto_onboard_inventory` i w `_apply_waste`.
- Prompty AI (menu-scan + sugestie receptur) mają twardy zakaz zwracania
  „Porcja" jako składnika.

### 2. Konwersja płynów (Liquid & Unit Conversion Engine)
Helpery `_to_gml`, `_from_gml`, `_convert_culinary` z gęstością 1 g = 1 ml
dla płynów gastronomicznych. Obsługiwane: `g / kg / ml / l / szt / opak`.

Scenariusz: 0,5 l kremu z dyni (porcja 300 ml, śmietana 100 ml/porcja,
magazyn w szt 200 ml/szt) → **0,833 szt** odjęte poprawnie.

### 3. Soft Exception Handling
`_apply_waste` w pełni opakowany w `try/except` na wszystkich zapytaniach
Supabase. Brak składnika w magazynie → warning w response, pętla leci dalej,
żadnego HTTP 502.

### Migracja SQL — WYMAGANE uruchomienie
`supabase_migrations/ADD_PORTION_SIZE.sql`
- Dodaje `menu_items.portion_size_grams` / `portion_size_unit`.
- Backfill z legacy wierszy „Porcja" w `recipe_ingredients`.
- Kasuje stare „Porcja" z `recipe_ingredients` i `inventory_items`.

---

## Runda 2 — Bulk Category-Targeted Orders

Nowa intencja `order_critical_items_by_category` — zbiorcze zamówienie braków
magazynowych z filtrem po kategoriach, otwierające Modal Łowcy Okazji
z gotowym zestawieniem najtańszych ofert.

### 1. Schemat AI (`/api/voice/interpret`)
- Nowa intencja `order_critical_items_by_category` dodana do `Intent` +
  enum + JSON schema.
- Payload zawiera pole `categories: string[]`.
  - `['all']` — użytkownik chce wszystkie braki globalnie
    („zamów wszystkie braki").
  - `['Mięso i wędliny', 'Nabiał']` — konkretne kategorie
    („zamów mięso i nabiał").
- Prompt GPT-4o-mini rozszerzony o mapowanie potocznych słów
  (mięso/wołowinę/wędliny → 'Mięso i wędliny', nabiał/mleko/sery → 'Nabiał',
  warzywa/owoce → 'Warzywa i owoce', soki/napoje/woda → 'Napoje' itd.).

### 2. Backend
- **`_resolve_warehouse_categories(raw)`** — trójstopniowe dopasowanie:
  exact match po `_norm_pl` → słownik synonimów → rapidfuzz `token_set_ratio ≥ 70`
  do sztywnych `WAREHOUSE_CATEGORIES`.
- **`POST /api/orders/critical-by-category`** (nowy endpoint) —
  1. Rozpoznaje żądane kategorie (`['all']` = wszystkie).
  2. Pobiera `inventory_items` z joinem do `inventory_categories(name)`
     (fallback bez joina, jeśli schemat starszy).
  3. Filtruje `quantity <= min_quantity` (produkty krytyczne).
  4. Jeśli `matched != ['all']` — dodatkowo filtruje po
     kategoria produktu ∈ zwrócone kategorie.
  5. Wylicza deficyt = `min_quantity * (1 + safety_buffer_percent/100) - quantity`.
  6. Przekazuje wyliczony koszyk do `POST /api/orders/compare-offers`.
  7. Zwraca `{ ok, matched_categories, unmatched_categories, critical_products,
     compare, message }`.
- Dispatch przez `/api/voice/dispatch` (routing z `/api/actions/apply`).

### 3. Frontend (Expo)
- **`VoiceReportModal.tsx`** — nowy edytowalny podgląd kategorii
  (`voice-edit-order-categories`, comma-separated). Domyślnie `['all']`,
  jeśli AI nie wypełniło pola.
- Po `handleApply` z sukcesem dla `order_critical_items_by_category` modal
  automatycznie otwiera **Modal Łowcy Okazji** (`DealHunterModal`) w trybie
  bulk (`initialCompare`, `bulkContextLabel`).
- **`DealHunterModal.tsx`** — nowe propsy `initialCompare` +
  `bulkContextLabel`. Gdy `initialCompare` jest ustawione:
  - Modal pomija krok „Ilość" (nie ma pojedynczego `product`).
  - Od razu pokazuje krok „Oferty" z gotowym `CompareResult`.
  - Steps indicator dostosowany (`Oferty → Kontakt → Wyślij`).
  - Nagłówek pokazuje kontekst („Braki: Mięso i wędliny, Nabiał"
    lub „Braki: wszystkie kategorie").
- Cała reszta flow (wybór opcji Opcja 1 / Opcja 2, przygotowanie e-maila,
  edytowalny podgląd wiadomości, wysyłka) działa bez zmian.

### Przykłady użycia głosowego
| Powiedzenie                                    | `payload.categories`             |
|------------------------------------------------|----------------------------------|
| „zamów wszystkie braki"                        | `["all"]`                        |
| „zamów wszystko czego brakuje"                 | `["all"]`                        |
| „zamów mięso i nabiał"                         | `["Mięso i wędliny", "Nabiał"]`  |
| „zamów braki z warzyw"                         | `["Warzywa i owoce"]`            |
| „zamów napoje i alkohole"                      | `["Napoje", "Alkohole"]`         |
| „uzupełnij chemię"                             | `["Chemia i czystość"]`          |

---

## Zmienione pliki

**Backend:**
- `backend/server.py`
  - `Intent` Literal + JSON schema enum: `order_critical_items_by_category`
  - JSON schema payload: `categories: array<string> | null`
  - Prompt systemowy: rozszerzony o rozdział 13b (fuzzy → sztywne kategorie)
  - `_CATEGORY_SYNONYMS` + `_resolve_warehouse_categories()`
  - `CriticalByCategoryRequest` + `POST /api/orders/critical-by-category`
  - `/api/actions/apply` + `/api/voice/dispatch` — routing nowej intencji
  - Runda 1: `menu_confirm_scan`, `_auto_onboard_inventory`, `_apply_waste`
- `supabase_migrations/ADD_PORTION_SIZE.sql` **(NOWY)**

**Frontend:**
- `frontend/components/VoiceReportModal.tsx`
  - `Intent` type + `INTENT_META` — nowa intencja
  - Import `DealHunterModal`, state `bulkCompare` / `bulkContextLabel`
  - `handleApply` — po sukcesie otwiera Łowcę Okazji w trybie bulk
  - Editor: `voice-edit-order-categories`
  - `seedPayload` — domyślnie `['all']`, jeśli AI nie wypełniło
- `frontend/components/DealHunterModal.tsx`
  - Props: `initialCompare`, `bulkContextLabel`
  - Bulk mode: pomija krok „Ilość", od razu pokazuje `compare`
  - Steps indicator: `Oferty → Kontakt → Wyślij` w bulk mode
  - Nagłówek: `bulkContextLabel` zamiast `product.product_name`

## Testy (offline)

```
# Fuzzy category resolver
_resolve_warehouse_categories(['mieso','nabial']) == (['Mięso i wędliny','Nabiał'], [])
_resolve_warehouse_categories(['all'])           == (['all'], [])
_resolve_warehouse_categories(['xyz'])           == ([], ['xyz'])

# Endpoint POST /api/orders/critical-by-category (TestClient)
{'categories': []}         → ok:false, 'Nie rozpoznano...'
{'categories': ['xyz']}    → ok:false, unmatched_categories:['xyz']

# Dispatch przez /api/actions/apply
POST /api/actions/apply {intent:'order_critical_items_by_category',
                         payload:{categories:['mięso','nabiał']}}
→ 200 (przekierowane do /voice/dispatch → orders_critical_by_category)
```

Wszystkie testy przechodzą.
