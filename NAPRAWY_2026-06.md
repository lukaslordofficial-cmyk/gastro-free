# Naprawy — czerwiec 2026 (3 zgłoszone błędy)

## 1. Spójne jednostki składników proponowanych przez AI
Problem: dla tego samego produktu (np. śmietana) AI raz zwracało `g`, raz `ml`,
przez co nie liczyła się sugerowana liczba porcji (np. magazyn 400 g vs receptura w ml).

Zmiany w `backend/server.py`:
- Nowy silnik ujednolicania: `_canon_dim`, `_iter_ingredients`,
  `_canonicalize_ingredient_units`. Po odpowiedzi AI **każdy składnik o tej samej
  nazwie dostaje JEDNĄ jednostkę we WSZYSTKICH potrawach** z danego skanu (głosowanie
  większościowe; remis → płyny do `ml`, reszta do `g`). Ilości przeliczane 1:1
  (g↔ml) oraz 1000 (kg→g, l→ml).
- Wywoływane w: `/api/menu/scan`, `/api/menu/suggest-recipe`, `/api/menu/confirm-scan`.
- Wzmocniony prompt sugestii receptur: twarda reguła spójności jednostek + lista
  produktów płynnych (zawsze `ml`).
- `_to_base` / `_convert`: **1 g = 1 ml** (wspólna baza). Wcześniej konwersja g↔ml
  zwracała `None`, więc silnik dostępności porcji nie potrafił policzyć dań, w których
  receptura była w ml, a magazyn w g/szt. Teraz np.
  `opak. o zawartości 400 g` ↔ receptura w `ml` liczy się poprawnie.

## 2. Wyrzucanie potraw z menu — jednostka „porcja”
Problem: przy zgłaszaniu straty dla „Danie z menu” dostępne były tylko jednostki
magazynowe (szt, op, l, ml, g, kg) — brak „porcja”.

Zmiany w `frontend/components/VoiceReportModal.tsx`:
- Dla typu **Danie z menu**: jednostki `porcja, l, kg, g, ml`.
- Dla typu **Składnik z magazynu**: jednostki `szt, op, l, ml, g, kg`.
- Przełączenie typu automatycznie ustawia sensowną jednostkę (`porcja` / `szt`).
- Wybór `porcja` → backend odejmuje składniki z receptury × liczba porcji;
  `l/kg/g/ml` → backend przelicza ubytek przez wielkość porcji dania
  (`menu_items.portion_size_grams`). Logika po stronie backendu (`_apply_waste`)
  była już poprawna.

## 3. Ręczne dodawanie produktu u dostawcy
Problem: `null value in column "variant" of relation "supplier_catalog" violates
not-null constraint`. Brak też możliwości podania zawartości sztuki/opakowania.

Zmiany:
- `frontend/app/(tabs)/dostawcy.tsx` — `handleAddManualProduct`: pole `variant`
  **nigdy nie jest null** (etykieta zawartości np. „400 g”, w ostateczności nazwa
  jednostki).
- Nowa sekcja w modalu (dla `szt` / `opak` / `butelka`): pole ilości + jednostka
  `g/kg/ml/l`. Dla płynów (`ml`/`l`) zapisywane do `liters_total` (napędza
  porównywarkę ofert); dla wagi zapisywane jako czytelna etykieta w
  `variant`/`volume_label`.
- Produkt zapisuje się do głównego katalogu dostawcy (`supplier_catalog`,
  `is_visible = true`) i pojawia się w sekcji „Katalog produktów” — także gdy
  wcześniejsze pozycje pochodziły ze skanu oferty.
- `backend/server.py` `_apply_supplier_product` (ścieżka głosowa): również nigdy
  nie wysyła `variant = null`.

---

### Uruchomienie lokalnie
Backend:
```
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001
```
Frontend:
```
cd frontend
yarn install
yarn start
```
Klucze znajdują się w `backend/.env` oraz `frontend/.env`.

---

## Dodatek — cena za kg dla produktów sztukowych/opakowaniowych (kg_total)
Dla produktów w `szt`/`opak`/`butelka` z podaną wagą (g/kg) porównywarka ofert
liczy teraz cenę za kg (analogicznie do `liters_total` dla płynów).

- Nowa kolumna `supplier_catalog.kg_total` — migracja
  `supabase_migrations/ADD_CATALOG_KG_TOTAL.sql` (uruchom w Supabase → SQL Editor).
- `backend/server.py` `_catalog_base_price` → gdy `kg_total > 0`: baza `kg`,
  cena = price / kg. `_fetch_catalog_and_suppliers` pobiera `kg_total` z fallbackiem,
  gdy kolumny jeszcze nie ma.
- `frontend/app/(tabs)/dostawcy.tsx` — waga (g/kg) zapisuje `kg_total`; jeśli kolumna
  jeszcze nie istnieje, zapis odbywa się bez niej (waga zostaje w etykiecie variant),
  więc dodawanie produktu działa PRZED i PO migracji.

> Uwaga: funkcja „cena za kg” aktywuje się po uruchomieniu migracji. Do tego czasu
> waga jest zapisywana jako czytelna etykieta, a produkty płynne (ml/l) działają
> w pełni już teraz przez `liters_total`.

---

## Zakładka Subskrypcja — nowe treści i ceny
- Plan **Free/Darmowy** — opis: reklamy, manualny magazyn/finanse/receptury, jednorazowy
  pakiet 100 kredytów AI na start.
- **Tier 1 Podstawowy — 50 zł** (dopisek „50 zł za miesiąc”): 1000 kredytów/mies.,
  skaner faktur, Skaner Menu z Wizją AI, sterowanie głosem, integracja z POS,
  Kreator Zamówień AI (SMS/E-mail).
- **Tier 2 Profesjonalny — 100 zł/mies.** (było 150): 3500 kredytów/mies.,
  „ŁOWCA OKAZJI”, „Dynamiczny Asystent Zamiany”.
- Karty planów pokazują pełne listy funkcji (`plans[].perks`, `plans[].price_note`
  w `/api/subscription`); Free jest teraz widoczny.
- Usunięto przelicznik „ile kredytów = ile złotych” (linia „≈ X zł w portfelu”).
- `backend/server.py` `TIER_CONFIG` + `_subscription_view`;
  `frontend/components/SubscriptionPanel.tsx`.
