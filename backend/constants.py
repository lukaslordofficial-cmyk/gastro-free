"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `constants`."""
from __future__ import annotations




# Health + auto-confirm: backend/health_routes.py (app.include_router)

# Voice STT: backend/voice_transcribe_routes.py

# ─────────────────────────────────────────────────────────────────────────────
# 2) Interpret voice → intent + payload
# ─────────────────────────────────────────────────────────────────────────────

# JSON Schema for Structured Outputs — enforces exact shape and enums.
_JSON_SCHEMA = {
    "name": "VoiceInterpretation",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["intent", "confidence", "reason", "payload"],
        "properties": {
            "intent": {
                "type": "string",
                "enum": [
                    "waste", "add_revenue", "add_fixed_cost", "add_variable_cost",
                    "add_inventory_item", "add_menu_item",
                    "add_supplier", "add_supplier_product",
                    "edit_menu_item_price", "add_recipe_ingredient",
                    "edit_recipe_ingredient_qty", "edit_inventory_item",
                    "add_expiration_batch",
                    "order_product", "order_critical_items_by_category",
                    "supplier_flip_order", "budget_cap_order",
                    "compare_catalogs_top_savings", "predictive_weekend_restock",
                    "check_minimum_order_value",
                    "bulk_delete_menu", "bulk_delete_suppliers", "bulk_reset_inventory",
                    "bulk_delete_inventory", "restore_last_deleted_menu", "restore_deleted_inventory",
                    "delete_menu_item", "delete_supplier", "delete_inventory_item",
                    "toggle_menu_item_availability",
                    "bulk_edit_menu_prices_percentage", "bulk_edit_menu_prices_fixed",
                    "bulk_edit_inventory_buffers",
                    "edit_menu_item_category", "rename_menu_item", "scale_recipe",
                    "navigate_screen", "filter_ui_inventory", "filter_ui_menu_blocked",
                    "summarize_custom_period", "compare_two_periods",
                    "rank_menu_sales", "rank_inventory_usage",
                    "rank_waste_cost", "rank_dead_menu", "list_expiring_soon",
                    "rank_supplier_spend", "manager_core_alerts", "haccp_tip",
                    "upload_invoice", "upload_offer", "upload_document", "upload_menu",
                    "unknown",
                ],
            },
            "confidence": {"type": "number", "minimum": 0, "maximum": 1},
            "reason": {"type": "string"},
            "payload": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "item_type", "related_id", "item_name", "quantity", "unit",
                    "reason_text",
                    "description", "amount_pln", "note",
                    "cost_type", "cost_name",
                    "product_name", "category_name",
                    "min_quantity", "current_quantity", "safety_buffer_percent",
                    "unit_cost", "portion_size", "is_combo_polprodukt",
                    "menu_category", "price_pln", "ingredients",
                    "supplier_name", "supplier_id", "contact_person", "phone",
                    "email", "supplier_category", "nip", "notes",
                    "variant", "unit_count", "volume_label",
                    # Voice CRUD + supplier intents
                    "dish_name", "new_price", "ingredient_name",
                    "from_supplier", "to_supplier", "category",
                    "max_budget",
                    "items",
                    "categories",
                    # Bulk / delete / availability / navigation / scaling
                    "percentage", "amount", "action", "available",
                    "new_category", "new_name", "portions", "screen",
                    # Analityka okresowa
                    "period_type", "limit_days", "period_1", "period_2",
                    # Ranking sprzedaży / zużycia
                    "rank", "top_n",
                    # Partie dat ważności
                    "expiration_date", "alert_days",
                ],
                "properties": {
                    # waste
                    "item_type": {"type": ["string", "null"], "enum": ["dish", "ingredient", "unknown", None]},
                    "related_id": {"type": ["string", "null"]},
                    "item_name": {"type": ["string", "null"]},
                    "quantity": {"type": ["number", "null"]},
                    "unit": {"type": ["string", "null"]},
                    "reason_text": {"type": ["string", "null"]},
                    # revenue / costs
                    "description": {"type": ["string", "null"]},
                    "amount_pln": {"type": ["number", "null"]},
                    "note": {"type": ["string", "null"]},
                    "cost_type": {
                        "type": ["string", "null"],
                        "enum": ["rent", "media", "payroll", "materials", "waste", "other", None],
                    },
                    "cost_name": {"type": ["string", "null"]},
                    # inventory item
                    "product_name": {"type": ["string", "null"]},
                    "category_name": {"type": ["string", "null"]},
                    "min_quantity": {"type": ["number", "null"]},
                    "current_quantity": {"type": ["number", "null"]},
                    "safety_buffer_percent": {"type": ["number", "null"]},
                    "unit_cost": {"type": ["number", "null"]},
                    "portion_size": {"type": ["number", "null"]},
                    "is_combo_polprodukt": {"type": ["boolean", "null"]},
                    # menu item
                    "menu_category": {"type": ["string", "null"]},
                    "price_pln": {"type": ["number", "null"]},
                    "ingredients": {
                        "type": ["array", "null"],
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["ingredient_name", "quantity", "unit"],
                            "properties": {
                                "ingredient_name": {"type": "string"},
                                "quantity": {"type": "number"},
                                "unit": {"type": "string"},
                            },
                        },
                    },
                    # supplier
                    "supplier_name": {"type": ["string", "null"]},
                    "supplier_id": {"type": ["string", "null"]},
                    "contact_person": {"type": ["string", "null"]},
                    "phone": {"type": ["string", "null"]},
                    "email": {"type": ["string", "null"]},
                    "supplier_category": {"type": ["string", "null"]},
                    "nip": {"type": ["string", "null"]},
                    "notes": {"type": ["string", "null"]},
                    # supplier product
                    "variant": {"type": ["string", "null"]},
                    "unit_count": {"type": ["integer", "null"]},
                    "volume_label": {"type": ["string", "null"]},
                    # Voice CRUD — nazwa dania/składnika + nowa cena
                    "dish_name": {"type": ["string", "null"]},
                    "new_price": {"type": ["number", "null"]},
                    "ingredient_name": {"type": ["string", "null"]},
                    # Supplier intents
                    "from_supplier": {"type": ["string", "null"]},
                    "to_supplier": {"type": ["string", "null"]},
                    "category": {"type": ["string", "null"]},
                    "max_budget": {"type": ["number", "null"]},
                    # Bulk / delete / availability / navigation / scaling
                    "percentage": {"type": ["number", "null"]},
                    "amount": {"type": ["number", "null"]},
                    "action": {"type": ["string", "null"], "enum": ["increase", "decrease", None]},
                    "available": {"type": ["boolean", "null"]},
                    "new_category": {"type": ["string", "null"]},
                    "new_name": {"type": ["string", "null"]},
                    "portions": {"type": ["number", "null"]},
                    "screen": {
                        "type": ["string", "null"],
                        "enum": ["index", "menu", "magazyn", "dostawcy", "ustawienia", None],
                    },
                    # Analityka okresowa (AI Trend & Analytics Orchestrator)
                    "period_type": {
                        "type": ["string", "null"],
                        "enum": ["day", "week", "month", "year", "custom", None],
                    },
                    "limit_days": {"type": ["integer", "null"]},
                    "period_1": {"type": ["string", "null"]},
                    "period_2": {"type": ["string", "null"]},
                    # Ranking: best/worst + ile pozycji
                    "rank": {
                        "type": ["string", "null"],
                        "enum": ["best", "worst", None],
                    },
                    "top_n": {"type": ["integer", "null"]},
                    "expiration_date": {"type": ["string", "null"], "description": "YYYY-MM-DD"},
                    "alert_days": {
                        "type": ["array", "null"],
                        "items": {"type": "integer"},
                        "description": "Dni przed końcem ważności na przypomnienie, np. [7,3,1]",
                    },
                    # Lista produktów dla order_product / supplier_flip_order
                    "items": {
                        "type": ["array", "null"],
                        "items": {
                            "type": "object",
                            "additionalProperties": False,
                            "required": ["product_name", "quantity", "unit"],
                            "properties": {
                                "product_name": {"type": "string"},
                                "quantity": {"type": "number"},
                                "unit": {"type": "string"},
                            },
                        },
                    },
                    # Lista kategorii magazynowych dla order_critical_items_by_category
                    # ('all' → globalnie wszystkie krytyczne braki).
                    "categories": {
                        "type": ["array", "null"],
                        "items": {"type": "string"},
                    },
                },
            },
        },
    },
}


# ─────────────────────────────────────────────────────────────────────────────
# Subskrypcje i Portfel Kredytowy (Quota & Tier Authorization Management)
# ─────────────────────────────────────────────────────────────────────────────

TIER_CONFIG = {
    0: {
        "name": "Free", "max_credits": 1000, "monthly_grant": 0, "price_pln": 0,
        "deal_hunter": False, "price_note": None,
        "perks": [
            "Reklamy w aplikacji (po zakończeniu trialu)",
            "Manualny magazyn, finanse i baza receptur, bez wsparcia automatyzacji",
            "100 kredytów AI na start + 30 dni trialu Premium "
            "(Łowca Okazji, dark UI — jak plan Profesjonalny)",
            "Po trialu: Free; pozostałe kredyty zostają na koncie",
        ],
    },
    1: {
        "name": "Podstawowy", "max_credits": 5000, "monthly_grant": 1000, "price_pln": 50,
        "deal_hunter": False, "price_note": "50 zł za miesiąc",
        "perks": [
            "100% bez reklam",
            "Odnawialny pakiet 1000 kredytów AI dodawany na konto co miesiąc",
            "Skanowanie, kategoryzacja i księgowanie faktur zakupowych przez AI",
            "„Skaner Menu z Wizją AI” – AI samo stworzy bazę potraw z roboczą "
            "propozycją składu i gramatury",
            "Pełne zarządzanie aplikacją poprzez sterowanie głosem",
            "Integracja z POS – system monitoruje sprzedaż, zużycie produktów, "
            "a nawet blokuje sprzedaż dań, jeśli braknie kluczowych składników produkcyjnych",
            "Bezobsługowy „Kreator Zamówień AI” – automatyczne wykrywanie braków "
            "magazynowych, generowanie gotowych wiadomości SMS/E-mail do twoich "
            "dostawców z treścią zamówienia",
        ],
    },
    2: {
        "name": "Profesjonalny", "max_credits": 20000, "monthly_grant": 2500, "price_pln": 100,
        "deal_hunter": True, "price_note": "100 zł za miesiąc",
        "perks": [
            "Wszystkie funkcje z pakietu Podstawowego (Skaner Faktur, Ofert, Menu, "
            "Sterowanie Głosem itp.)",
            "Odnawialny pakiet 2500 kredytów AI co miesiąc",
            "Inteligentny moduł „ŁOWCA OKAZJI” – automatyczne skanowanie i analiza "
            "ofert dostawców, i tworzenie najtańszych ofert zakupowych, podczas "
            "składania zamówień",
            "„Dynamiczny Asystent Zamiany” – przeliczanie gramatur potraw",
        ],
    },
}

STARTER_CREDITS = 100
TRIAL_DAYS = 30


TOPUP_PACKAGES = {
    "small":  {"credits": 100,  "price_pln": 10, "label": "+100 kredytów"},
    "medium": {"credits": 500,  "price_pln": 30, "label": "+500 kredytów"},
    "large":  {"credits": 1000, "price_pln": 50, "label": "+1000 kredytów"},
}

FEATURE_CATALOG = [
    {"key": "voice",       "icon": "🎙️", "name": "Szybka komenda głosowa",           "cost": "~1-2 kredyty",    "requires_deal_hunter": False},
    {"key": "invoice",     "icon": "🧾", "name": "Skanowanie i księgowanie faktury",  "cost": "~15-20 kredytów", "requires_deal_hunter": False},
    {"key": "menu",        "icon": "🥗", "name": "Analiza karty menu i receptur",     "cost": "~25-30 kredytów", "requires_deal_hunter": False},
    {"key": "trend",       "icon": "📊", "name": "Analiza trendów AI",                "cost": "~5-10 kredytów",  "requires_deal_hunter": False},
    {"key": "deal_hunter", "icon": "🏷️", "name": "Łowca Okazji (porównywarka ofert)", "cost": "~3-8 kredytów",   "requires_deal_hunter": True},
]


_CATALOG_JSON_SCHEMA = {
    "name": "SupplierCatalogExtraction",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["products"],
        "properties": {
            "products": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["product_name", "price_netto", "unit", "volume_label", "product_code"],
                    "properties": {
                        "product_name": {"type": "string"},
                        "price_netto": {"type": "number"},
                        "unit": {"type": "string"},
                        "volume_label": {"type": "string"},
                        "product_code": {"type": ["string", "null"]},
                    },
                },
            },
        },
    },
}

_CATALOG_SYSTEM_PROMPT = (
    "Jesteś ekspertem od digitalizacji cenników i ofert handlowych hurtowni "
    "gastronomicznych. Otrzymujesz zdjęcie(a) lub strony PDF cennika od dostawcy. "
    "Wyodrębnij WSZYSTKIE pozycje produktowe do tablicy `products`. Dla każdej pozycji:\n"
    "- product_name: pełna nazwa produktu (np. 'Mąka Tipo 00').\n"
    "- price_netto: cena NETTO za opakowanie jako liczba (przecinek zamień na kropkę, "
    "usuń symbol PLN/zł). Jeśli widoczna jest tylko cena brutto, przelicz na netto dla "
    "VAT 23% (brutto/1.23), ale preferuj kolumnę netto jeśli istnieje. Gdy brak ceny → 0.\n"
    "- unit: jednostka miary (np. 'kg', 'l', 'szt', 'opak').\n"
    "- volume_label: opis opakowania widoczny na cenniku (np. 'worek 5kg', 'butelka 1L', "
    "'karton 12szt'). Jeśli brak → pusty string.\n"
    "- product_code: kod artykułu / indeks z hurtowni jeśli widoczny (np. 'MK-500'), "
    "w przeciwnym razie null.\n"
    "Nie wymyślaj produktów, których nie ma na dokumencie. Zwróć wyłącznie poprawny JSON "
    "zgodny ze schematem."
)


# confirm-catalog: backend/supplier_catalog_scan_routes.py (include_router)


# ─────────────────────────────────────────────────────────────────────────────
# 4b) Uniwersalny procesor dokumentów — faktura (ścieżka 1) vs oferta (ścieżka 2)
#     Plik przetwarzany WYŁĄCZNIE w RAM, natychmiast niszczony. Zero zapisu na dysk.
# ─────────────────────────────────────────────────────────────────────────────

DOCUMENT_CATEGORIES = [
    "Mięso i wędliny", "Ryby i owoce morza", "Nabiał", "Warzywa i owoce", "Pieczywo",
    "Suchy magazyn", "Oleje i tłuszcze", "Przyprawy", "Mrożonki", "Napoje", "Alkohole",
    "Wywary i sosy", "Chemia i czystość", "Opakowania", "Inne",
]

_DOCUMENT_JSON_SCHEMA = {
    "name": "DocumentExtraction",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["document_type", "supplier_name", "total_amount", "supplier", "products"],
        "properties": {
            "document_type": {"type": "string", "enum": ["FAKTURA_ZAKUPOWA", "OFERTA_HANDLOWA", "MENU_RESTAURACYJNE"]},
            "supplier_name": {"type": ["string", "null"]},
            "total_amount": {"type": "number"},
            "supplier": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "nip", "phone", "email", "contact_person", "address",
                    "payment_terms", "shipping_cost", "min_order_value",
                    "free_shipping_threshold", "lead_time_days",
                ],
                "properties": {
                    "nip": {"type": ["string", "null"]},
                    "phone": {"type": ["string", "null"]},
                    "email": {"type": ["string", "null"]},
                    "contact_person": {"type": ["string", "null"]},
                    "address": {"type": ["string", "null"]},
                    "payment_terms": {"type": ["string", "null"]},
                    "shipping_cost": {"type": ["number", "null"]},
                    "min_order_value": {"type": ["number", "null"]},
                    "free_shipping_threshold": {"type": ["number", "null"]},
                    "lead_time_days": {"type": ["number", "null"]},
                },
            },
            "products": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["product_name", "quantity", "price_netto", "unit", "volume_label", "product_code", "category"],
                    "properties": {
                        "product_name": {"type": "string"},
                        "quantity": {"type": "number"},
                        "price_netto": {"type": "number"},
                        "unit": {"type": "string"},
                        "volume_label": {"type": "string"},
                        "product_code": {"type": ["string", "null"]},
                        "category": {"type": "string", "enum": DOCUMENT_CATEGORIES},
                    },
                },
            },
        },
    },
}

_DOCUMENT_SYSTEM_PROMPT = (
    "Jesteś ekspertem od dokumentów w gastronomii. Otrzymujesz zdjęcie(a) lub "
    "strony PDF. Najpierw ROZPOZNAJ typ dokumentu:\n"
    "- Jeśli to KARTA DAŃ / MENU RESTAURACJI dla gości (nazwy potraw z cenami dla klienta, "
    "sekcje typu Przystawki/Dania główne/Desery/Napoje, bez NIP nabywcy i bez 'Do zapłaty' "
    "jak na fakturze) — to jest 'MENU_RESTAURACYJNE'. NIE myl z cennikiem hurtowym dostawcy.\n"
    "- Jeśli dokument zawiera dane transakcyjne — słowa: 'Faktura VAT', 'Faktura', 'Nabywca', "
    "'Sprzedawca', 'Do zapłaty', 'Razem do zapłaty', 'Termin płatności', numer faktury, NIP nabywcy "
    "— to jest 'FAKTURA_ZAKUPOWA'.\n"
    "- Jeśli to cennik/oferta HANDLOWA DOSTAWCY (gazetka, lista SKU hurtowych, opakowania zbiorcze, "
    "ceny netto dla restauracji) BEZ danych faktury — to jest 'OFERTA_HANDLOWA'.\n\n"
    "Następnie wypełnij pola:\n"
    "- document_type: 'MENU_RESTAURACYJNE' albo 'FAKTURA_ZAKUPOWA' albo 'OFERTA_HANDLOWA'.\n"
    "- supplier_name: dla oferty/faktury nazwa SPRZEDAWCY / dostawcy (NIE nabywcy); "
    "dla MENU_RESTAURACYJNE → null.\n"
    "- total_amount: dla FAKTURA_ZAKUPOWA → końcowa kwota 'Do zapłaty' (brutto) jako liczba; "
    "dla OFERTA_HANDLOWA i MENU_RESTAURACYJNE → 0.\n"
    "- supplier{}: DANE PROFILU DOSTAWCY (panel Dostawcy). AKTYWNIE szukaj w nagłówku, stopce, "
    "bloku 'Sprzedawca' / 'Dostawca' / 'Sprzedający' / 'Wykonawca' oraz w warunkach handlowych:\n"
    "  * nip — NIP sprzedawcy/dostawcy (nie nabywcy); zachowaj cyfry i myślniki jak na dokumencie.\n"
    "  * phone — telefon kontaktowy / zamówień.\n"
    "  * email — e-mail zamówień / biura.\n"
    "  * contact_person — osoba do kontaktu, jeśli podana.\n"
    "  * address — pełny adres siedziby/magazynu sprzedawcy (ulica, kod, miasto).\n"
    "  * payment_terms — termin płatności / warunki (np. '14 dni', 'przelew 7 dni', 'gotówka').\n"
    "  * shipping_cost — koszt dostawy / transportu / logistyki w PLN (liczba). "
    "null gdy brak na dokumencie; 0 TYLKO gdy dokument wyraźnie mówi 'darmowa dostawa' / 'gratis'.\n"
    "  * min_order_value — minimum logistyczne / min. wartość zamówienia / 'zamówienia od X zł' w PLN.\n"
    "  * free_shipping_threshold — próg darmowej dostawy w PLN (np. 'darmowa dostawa od 500 zł').\n"
    "  * lead_time_days — czas realizacji / dostawy w dniach (liczba, np. '1-2 dni robocze' → 2).\n"
    "  Gdy pola NIE ma na dokumencie → null (NIE zgaduj, NIE wstawiaj 0).\n"
    "  Dla MENU_RESTAURACYJNE wszystkie pola supplier → null.\n"
    "- products[]: dla faktury/oferty WSZYSTKIE pozycje towarowe z tabeli (każdy wiersz osobno).\n"
    "  NIGDY nie pomijaj nabiału, serów (mozzarella/mozarella, feta, parmezan…), ziół, przypraw, "
    "opakowań ani pozycji o niskiej kwocie — każda linia faktury = jeden element products[].\n"
    "  Jeśli w nazwie jest odmiana sera (mozzarella, feta, kozi…) — product_name MUSI zawierać "
    "tę odmianę w całości (NIGDY nie skracaj 'Ser mozzarella' / 'Mozzarella' do samego 'Ser').\n"
    "  product_name: nazwa towaru JAK NA FAKTURZE (zachowaj wariant: 'Ser mozzarella', nie skracaj do 'Ser').\n"
    "  quantity / unit / price_netto: z wiersza; jeśli ilość nieczytelna → quantity=1, unit='szt'.\n"
    "  Dla MENU_RESTAURACYJNE wpisz potrawy (product_name = nazwa dania, price_netto = cena dla gościa, "
    "quantity=0, unit='szt', category najlepiej dopasuj lub 'Inne').\n\n"
    "KATEGORYZACJA (pole category): dozwolone: 'Mięso i wędliny', 'Ryby i owoce morza', "
    "'Nabiał', 'Warzywa i owoce', 'Pieczywo', 'Suchy magazyn', 'Oleje i tłuszcze', "
    "'Przyprawy', 'Mrożonki', 'Napoje', 'Alkohole', 'Wywary i sosy', 'Chemia i czystość', "
    "'Opakowania', 'Inne'.\n"
    "WAŻNE: oliwa / olive oil / olej / masło klarowane / smalec → 'Oleje i tłuszcze' "
    "(NIGDY 'Alkohole'). Extra Virgin ≠ alkohol.\n"
    "Nie wymyślaj pozycji ani danych dostawcy. Zwróć wyłącznie poprawny JSON zgodny ze schematem."
)


# documents/process + confirm-invoice: backend/documents_routes.py (include_router)


# ─────────────────────────────────────────────────────────────────────────────
# 5) Dynamic Portions Yield — endpoint: inventory_yield_routes.py
# ─────────────────────────────────────────────────────────────────────────────


# ─────────────────────────────────────────────────────────────────────────────
# 6) Menu scan (GPT-4o Vision) — czyta menu restauracji, wyciąga potrawy
#    Trzy endpointy: /scan (podgląd), /suggest-recipe (AI składniki/gramatura),
#    /confirm-scan (zapis do menu_items + recipe_ingredients).
# ─────────────────────────────────────────────────────────────────────────────

MENU_CATEGORIES = [
    "Przystawki", "Zupy", "Sałatki", "Burgery", "Dania główne",
    "Makarony", "Pizza", "Desery", "Napoje", "Alkohole", "Półprodukty", "Inne",
]

_MENU_SCAN_JSON_SCHEMA = {
    "name": "MenuExtraction",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["dishes"],
        "properties": {
            "dishes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "name", "category", "price_pln",
                        "portion_weight_value", "portion_weight_unit",
                        "ingredients",
                    ],
                    "properties": {
                        "name": {"type": "string"},
                        "category": {"type": "string", "enum": MENU_CATEGORIES},
                        "price_pln": {"type": "number"},
                        "portion_weight_value": {"type": ["number", "null"]},
                        "portion_weight_unit": {
                            "type": ["string", "null"],
                            "enum": ["g", "ml", "szt", None],
                        },
                        "ingredients": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "quantity", "unit"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "quantity": {"type": ["number", "null"]},
                                    "unit": {"type": "string"},
                                },
                            },
                        },
                    },
                },
            },
        },
    },
}

_MENU_SCAN_SYSTEM_PROMPT = (
    "Jesteś ekspertem od digitalizacji kart menu restauracji. Otrzymujesz zdjęcie(a) "
    "lub strony PDF menu. Wyodrębnij WSZYSTKIE potrawy do tablicy `dishes`.\n\n"
    "Dla każdej pozycji:\n"
    "- name: nazwa dania (bez ceny, bez gramatury; np. 'Burger Podwójny').\n"
    "- category: jedna z dozwolonych kategorii: "
    f"{', '.join(MENU_CATEGORIES)}. Wybierz najbardziej pasującą na podstawie nazwy i sekcji menu. "
    "Pozycje typu półprodukt / mise en place / warzywa grillowane / pieczone / mix sałat "
    "(przygotowywane wewnętrznie, nie danie sprzedażowe) → kategoria 'Półprodukty'.\n"
    "- price_pln: cena w PLN jako liczba dziesiętna (przecinek zamień na kropkę, "
    "usuń symbole '/zł/PLN'). Jeśli brak ceny → 0.\n"
    "- portion_weight_value: gramatura porcji jeśli widoczna na menu (np. '250 g' → 250, "
    "'0,3 l' → 300). Jeśli brak → null.\n"
    "- portion_weight_unit: jednostka gramatury: 'g' (waga), 'ml' (płyny), 'szt' (sztuki). "
    "Jeśli brak wagi → null.\n"
    "- ingredients: lista składników jeśli są WYSZCZEGÓLNIONE pod nazwą dania (np. "
    "'sos pomidorowy, mozzarella, bazylia'). Dla każdego składnika: name (nazwa), "
    "quantity (null jeśli menu nie podaje ilości), unit (jednostka lub 'g' domyślnie). "
    "Jeśli menu nie wypisuje składników danej potrawy → pusta lista [].\n\n"
    "WAŻNE:\n"
    "- Nie wymyślaj składników których nie ma w menu — jeśli menu podaje tylko nazwę, "
    "zwróć puste `ingredients: []`. AI zaproponuje je później osobno.\n"
    "- Nie wymyślaj gramatury — jeśli menu nie podaje, zwróć null.\n"
    "- KATEGORYCZNIE ZAKAZANE: nazwy 'Porcja', 'Porcje', 'Wielkość porcji', "
    "'Gramatura', 'Gramatura porcji' NIE MOGĄ pojawić się w `ingredients`. "
    "Wielkość porcji zapisuj TYLKO w `portion_weight_value` + `portion_weight_unit`.\n"
    "- Zignoruj sekcje: promocje/loga/adres/godziny/opisy restauracji.\n"
    "- Zwróć wyłącznie poprawny JSON zgodny ze schematem."
)


# ─────────────────────────────────────────────────────────────────────────────
# Vision AI — skaner daty ważności (partie warehouse_inventory)
# ─────────────────────────────────────────────────────────────────────────────

_EXPIRY_SCAN_SYSTEM_PROMPT = (
    "You are a precise data extraction agent for a restaurant inventory system. "
    "Analyze the provided image of a food product.\n"
    "Identify:\n"
    "1. The clean product name (e.g., \"Mleko UHT 3.2%\").\n"
    "2. The exact expiration date. Convert any Polish or international date formats "
    "(e.g., \"Najlepiej spożyć przed: 24.12.2026\", \"EXP 12/26\", \"24-LIS-2026\") "
    "into a standard YYYY-MM-DD format. If only a month/year is visible, set the date "
    "to the last day of that month.\n\n"
    "Respond strict JSON only."
)

_EXPIRY_SCAN_JSON_SCHEMA = {
    "name": "ExpirationScan",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["product_name", "expiration_date", "confidence_score"],
        "properties": {
            "product_name": {"type": "string"},
            "expiration_date": {"type": "string", "description": "YYYY-MM-DD"},
            "confidence_score": {"type": "number"},
        },
    },
}


# --- 6a2) OCR tekstu receptury (notatki / odręczne) ----------------------------

_RECIPE_OCR_JSON_SCHEMA = {
    "name": "RecipeOcrText",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["text"],
        "properties": {
            "text": {
                "type": "string",
                "description": "Pełny tekst przepisu odczytany z obrazu, po polsku.",
            },
        },
    },
}


# --- 6b) Sugestie receptury (AI) ---------------------------------------------

_MENU_SUGGEST_JSON_SCHEMA = {
    "name": "MenuRecipeSuggestions",
    "strict": True,
    "schema": {
        "type": "object",
        "additionalProperties": False,
        "required": ["dishes"],
        "properties": {
            "dishes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "name",
                        "suggested_portion_weight_value",
                        "suggested_portion_weight_unit",
                        "suggested_ingredients",
                    ],
                    "properties": {
                        "name": {"type": "string"},
                        "suggested_portion_weight_value": {"type": ["number", "null"]},
                        "suggested_portion_weight_unit": {
                            "type": ["string", "null"],
                            "enum": ["g", "ml", "szt", None],
                        },
                        "suggested_ingredients": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": False,
                                "required": ["name", "quantity", "unit"],
                                "properties": {
                                    "name": {"type": "string"},
                                    "quantity": {"type": "number"},
                                    "unit": {"type": "string"},
                                },
                            },
                        },
                    },
                },
            },
        },
    },
}


_MENU_SUGGEST_BATCH_SIZE = 4
_MENU_SUGGEST_BATCH_TIMEOUT_S = 55.0

_MENU_SUGGEST_SYSTEM_PROMPT = (
    "Jesteś doświadczonym szefem kuchni. Dla listy potraw restauracyjnych proponujesz "
    "receptury na 1 porcję zgodnie z powszechnie stosowanymi standardami gastronomicznymi.\n\n"
    "Dla KAŻDEJ potrawy zwróć obiekt z polami:\n"
    "- name: dokładnie taka sama nazwa jak wejściowa.\n"
    "- suggested_portion_weight_value: łączna wzorcowa waga/objętość porcji "
    "(np. burger ≈ 350, spaghetti ≈ 400, latte ≈ 250). Jeśli wejście `has_portion_weight=true`, "
    "zwróć null (użytkownik już podał gramaturę).\n"
    "- suggested_portion_weight_unit: 'g' (dania stałe), 'ml' (napoje), 'szt' (jeżeli liczone w sztukach). "
    "Null jeśli suggested_portion_weight_value=null.\n"
    "- suggested_ingredients: lista składników z realistycznymi gramaturami wzorcowymi "
    "(np. bułka 80g, kotlet wołowy 150g, ser 20g, sałata 20g, sos 30g). Zasady:\n"
    "   * Jeśli `has_ingredients=true` (użytkownik już podał składniki), UŻYJ dokładnie tych nazw "
    "     (pole name musi być identyczne) — możesz jedynie doszacować ilości.\n"
    "   * Jeśli `has_ingredients=false`, wygeneruj kompletny wzorcowy skład (5–10 pozycji).\n"
    "   * Jednostki: 'g' (waga), 'ml' (płyny), 'szt' (jajko, plaster itp.).\n"
    "   * SPÓJNOŚĆ JEDNOSTEK (KRYTYCZNE): ten sam składnik musi mieć IDENTYCZNĄ "
    "jednostkę we WSZYSTKICH potrawach naraz. Jeśli 'śmietana' jest w ml w jednym "
    "daniu, MUSI być w ml we wszystkich. Płyny/nabiał/oleje/sosy (śmietana, mleko, "
    "olej, sos, bulion, woda, sok, krem) ZAWSZE w 'ml'; produkty stałe ZAWSZE w 'g'; "
    "liczone na sztuki (jajko, plaster, bułka) w 'szt'. Nigdy nie mieszaj g i ml dla "
    "tego samego produktu.\n"
    "   * Ilości > 0 — WYŁĄCZNIE liczby całkowite (integer). Zakaz ułamków typu 0.25.\n"
    "   * KAŻDY składnik MUSI mieć quantity > 0 (nigdy null / 0) — typowe gramatury porcji: "
    "mięso 120–180 g, warzywa 40–80 g, sos 20–40 ml, przyprawy 1–3 g.\n"
    "   * Przyprawy / małe ilości (sól, pieprz, przyprawy): minimum 1–2 jednostki na porcję "
    "(np. 1 g lub 2 g), nigdy ułamki gramów.\n"
    "   * CAŁY PRODUKT (KRYTYCZNE): jeśli przepis używa części (żółtko, białko, skórka cytryny, "
    "sok z cytryny, ząbek czosnku, miąższ awokado), podaj nazwę CAŁEGO produktu magazynowego "
    "(jajko, cytryna, czosnek, awokado) — nie części.\n"
    "   * LICZBA POJEDYNCZA (KRYTYCZNE): zapisuj składniki w formie kanonicznej liczby pojedynczej "
    "(pomidor nie pomidory, jajko nie jajka, ziemniak nie ziemniaki).\n"
    "   * SKŁADNIKI KUPOWANE, NIE DANIA: nie twórz pozycji magazynowej o nazwie gotowego dania "
    "(risotto, paella). Zamiast tego podaj surowiec (ryż arborio / ryż do risotto).\n"
    "   * PÓŁPRODUKT COMBO: jeśli pozycja to przetworzona mieszanka bez jednego SKU "
    "(warzywa grillowane, mix sałat, pieczone warzywa), nadal wymień osobne surowce w recepturze "
    "dania; nie wstawiaj samej nazwy mieszanki jako jedynego składnika.\n"
    "   * KATEGORYCZNIE ZAKAZANE: 'Porcja', 'Porcje', 'Wielkość porcji', 'Gramatura', "
    "'Gramatura porcji' NIE MOGĄ pojawić się w `suggested_ingredients`. Wielkość porcji "
    "zapisuj TYLKO w `suggested_portion_weight_value` + `suggested_portion_weight_unit`.\n\n"
    "Zwróć wyłącznie poprawny JSON zgodny ze schematem."
)


# Sztywne kategorie systemowe (Menu-to-Inventory Onboarding).
MENU_CATEGORIES = ['Burgery', 'Pizze', 'Zupy', 'Dania obiadowe', 'Sałatki',
                   'Desery', 'Napoje', 'Półprodukty', 'Inne']
WAREHOUSE_CATEGORIES = [
    'Mięso i wędliny', 'Ryby i owoce morza', 'Nabiał', 'Warzywa i owoce', 'Pieczywo',
    'Suchy magazyn', 'Oleje i tłuszcze', 'Przyprawy', 'Mrożonki', 'Napoje', 'Alkohole',
    'Wywary i sosy', 'Półprodukty', 'Chemia i czystość', 'Opakowania', 'Inne',
]
_WAREHOUSE_CAT_COLORS = {
    'Mięso i wędliny': '#DC2626', 'Ryby i owoce morza': '#0284C7', 'Nabiał': '#F59E0B',
    'Warzywa i owoce': '#16A34A', 'Pieczywo': '#78716C', 'Suchy magazyn': '#B45309',
    'Oleje i tłuszcze': '#CA8A04', 'Przyprawy': '#D97706', 'Mrożonki': '#0EA5E9',
    'Napoje': '#0891B2', 'Alkohole': '#7C3AED', 'Wywary i sosy': '#EA580C',
    'Półprodukty': '#A855F7',
    'Chemia i czystość': '#6366F1', 'Opakowania': '#64748B', 'Inne': '#94A3B8',
}

# Profil restauracji: backend/restaurant_profile.py + restaurant_profile_routes.py

# --- Jednostki: przeliczanie do wspólnej jednostki bazowej (kg / l / szt) ----
# dim -> (base_dim, factor_do_bazowej)
_UNIT_MAP = {
    "g": ("kg", 0.001), "gram": ("kg", 0.001), "gramy": ("kg", 0.001),
    "kg": ("kg", 1.0), "kilogram": ("kg", 1.0),
    "ml": ("l", 0.001), "mililitr": ("l", 0.001),
    "l": ("l", 1.0), "litr": ("l", 1.0), "litry": ("l", 1.0),
    "szt": ("szt", 1.0), "sztuka": ("szt", 1.0), "sztuk": ("szt", 1.0),
    "opak": ("szt", 1.0), "opakowanie": ("szt", 1.0),
    "porcja": ("szt", 1.0), "porcje": ("szt", 1.0),
}


# Auto-accept bez AI — tylko bardzo pewne (np. ser kozi ⊂ ser kozi rolka)
LOCAL_CATALOG_MATCH_MIN = 0.88
# Prefilter kandydatów dla agenta AI (luźniej — AI odrzuci śmieci)
AI_CATALOG_CANDIDATE_MIN = 0.22
AI_CATALOG_MAX_CANDIDATES = 45
AI_CATALOG_MAX_ITEM_CALLS = 24  # ile pozycji zamówienia max. przez agenta na 1 compare


# ── AI Catalog Agent (świadome wyszukiwanie w katalogach dostawców) ────────────
AI_SYNONYM_SIM_MIN = 40      # token_set do puli AI (plurale / inna kolejność słów)
AI_SYNONYM_CONF_MIN = 0.72   # min. pewność AI, by uznać dopasowanie / zapisać synonim
AI_MAX_PER_ITEM = 3          # legacy pairwise (fallback)
AI_MAX_CHECKS = 12           # legacy global cap (fallback pairwise)


_LONG_SHELF_KEYWORDS = (
    "mąka", "maka", "cukier", "sól", "sol ", "olej", "ocet", "ryż", "ryz",
    "makaron", "kasza", "pelati", "puszka", "konserwa", "bulion", "przypraw",
)


# --- Bulk Category-Targeted Orders (Łowca Okazji na braki) ------------------

# Potoczne słowa KATEGORII → sztywne nazwy (BEZ nazw pojedynczych produktów!).
# „ser"/"kurczak" w synonimach powodowało, że MIX wrzucał nazwę produktu do categories
# i wciągał całą kategorię Nabiał/Mięso zamiast tylko nazwanej pozycji.
_CATEGORY_SYNONYMS: dict[str, list[str]] = {
    'Mięso i wędliny':   ['mieso', 'mięso', 'wedliny', 'wędliny', 'mieso i wedliny',
                          'mięso i wędliny'],
    'Ryby i owoce morza': ['ryby', 'ryba', 'owoce morza', 'ryby i owoce morza'],
    'Nabiał':            ['nabial', 'nabiał', 'nabialowe', 'nabiałowe'],
    'Warzywa i owoce':   ['warzywa', 'owoce', 'jarzyny', 'warzywa i owoce', 'warzywo'],
    'Pieczywo':          ['pieczywo'],
    'Alkohole':          ['alkohol', 'alkohole'],
    'Napoje':            ['napoje', 'napoj', 'napój'],
    'Mrożonki':          ['mrozonki', 'mrożonki', 'mrozone', 'mrożone'],
    'Suchy magazyn':     ['suchy', 'suchy magazyn', 'sucha pantry', 'pantry'],
    'Oleje i tłuszcze':  ['olej', 'oleje', 'oliwa', 'oliwy', 'tluszcze', 'tłuszcze',
                          'oleje i tluszcze', 'oleje i tłuszcze'],
    'Przyprawy':         ['przyprawy', 'przyprawa', 'ziola', 'zioła'],
    'Wywary i sosy':     ['wywary', 'sosy', 'wywar', 'sos', 'wywary i sosy'],
    'Chemia i czystość': ['chemia', 'srodki czystosci', 'środki czystości',
                          'chemia i czystosc', 'chemia i czystość'],
    'Opakowania':        ['opakowania', 'opakowanie'],
    'Inne':              ['inne', 'pozostale', 'pozostałe'],
}


_CATEGORY_STOPWORDS = frozenset({
    "brakujace", "brakujacych", "brakujacy", "braki", "wszystkie",
    "wszystkich", "kategoria", "kategorii", "z", "i", "oraz", "a", "też",
    "tez", "plus", "zamow", "zamów", "prosze", "proszę",
})


# ─────────────────────────────────────────────────────────────────────────────
# Migracja info — informacja dla FE o brakujących kolumnach/tabelach Supabase.

# Admin migration-status: backend/admin_routes.py (include_router)

# Daily reports: backend/daily_report_routes.py (include_router)

# ─────────────────────────────────────────────────────────────────────────────
# AI TREND & ANALYTICS ORCHESTRATOR — podsumowania i porównania okresowe
# ─────────────────────────────────────────────────────────────────────────────

_PL_MONTHS = {
    "styczen": 1, "stycznia": 1, "luty": 2, "lutego": 2, "marzec": 3, "marca": 3,
    "kwiecien": 4, "kwietnia": 4, "maj": 5, "maja": 5, "czerwiec": 6, "czerwca": 6,
    "lipiec": 7, "lipca": 7, "sierpien": 8, "sierpnia": 8, "wrzesien": 9, "wrzesnia": 9,
    "pazdziernik": 10, "pazdziernika": 10, "listopad": 11, "listopada": 11,
    "grudzien": 12, "grudnia": 12,
}
_PL_MONTH_NAMES = ["", "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
                   "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień"]


SIM_FINANCE_YEAR = 2025  # legacy alias; nie używaj do nowych fallbacków


_MONTHS_PL = {
    "styczen": 1, "stycznia": 1, "sty": 1,
    "luty": 2, "lutego": 2, "lut": 2,
    "marzec": 3, "marca": 3, "mar": 3,
    "kwiecien": 4, "kwietnia": 4, "kwi": 4,
    "maj": 5, "maja": 5,
    "czerwiec": 6, "czerwca": 6, "cze": 6,
    "lipiec": 7, "lipca": 7, "lip": 7,
    "sierpien": 8, "sierpnia": 8, "sie": 8,
    "wrzesien": 9, "wrzesnia": 9, "wrz": 9,
    "pazdziernik": 10, "pazdziernika": 10, "paz": 10,
    "listopad": 11, "listopada": 11, "lis": 11,
    "grudzien": 12, "grudnia": 12, "grudznia": 12, "gru": 12,
}
_MONTH_NAMES_PL = [
    "", "styczeń", "luty", "marzec", "kwiecień", "maj", "czerwiec",
    "lipiec", "sierpień", "wrzesień", "październik", "listopad", "grudzień",
]


_HACCP_RULES = [
    {
        "id": "fifo",
        "keys": ["fifo", "kolejnosc", "rotacja"],
        "title": "Zasada FIFO",
        "body": (
            "First In, First Out: produkty z najkrótszą datą ważności na przód półki "
            "i zużywane jako pierwsze. Etykietuj każdą partię datą przyjęcia."
        ),
    },
    {
        "id": "ryby",
        "keys": ["ryb", "losos", "dorsz", "krewet", "malz"],
        "title": "Świeże ryby",
        "body": "Lodówka 0–2°C, osobna strefa. Zużyj w 24–48 h. Nie trzymaj na rampie w upale.",
    },
    {
        "id": "mieso",
        "keys": ["mieso", "wolow", "wieprz", "kurczak", "indyk"],
        "title": "Mięso świeże",
        "body": "0–4°C, dolna półka. Surowy kurczak osobno. Po otwarciu 24–48 h lub mrożenie.",
    },
    {
        "id": "nabial",
        "keys": ["mleko", "smietan", "jogurt", "ser", "twarog", "jajk"],
        "title": "Nabiał",
        "body": "2–6°C, nie w drzwiach lodówki. Po otwarciu mleka/śmietany — 2–3 dni.",
    },
    {
        "id": "salata",
        "keys": ["salat", "rukol", "szpinak"],
        "title": "Sałaty",
        "body": "Przed podaniem namocz w zimnej wodzie — będą chrupiące. Osusz, trzymaj 2–5°C.",
    },
    {
        "id": "ryz",
        "keys": ["ryz", "risotto"],
        "title": "Ryż ugotowany",
        "body": "Szybko schłodź. Do sypkości przepłucz zimną wodą. W lodówce max 24 h.",
    },
    {
        "id": "polprodukt",
        "keys": ["sos", "wywar", "bulion", "polprodukt", "gulasz"],
        "title": "Półprodukty / sosy",
        "body": "Schłodź do ≤5°C w max 2 h. Etykieta: data produkcji + ważności. Regeneracja ≥75°C.",
    },
]

__all__ = ['AI_CATALOG_CANDIDATE_MIN', 'AI_CATALOG_MAX_CANDIDATES', 'AI_CATALOG_MAX_ITEM_CALLS', 'AI_MAX_CHECKS', 'AI_MAX_PER_ITEM', 'AI_SYNONYM_CONF_MIN', 'AI_SYNONYM_SIM_MIN', 'DOCUMENT_CATEGORIES', 'FEATURE_CATALOG', 'LOCAL_CATALOG_MATCH_MIN', 'MENU_CATEGORIES', 'SIM_FINANCE_YEAR', 'STARTER_CREDITS', 'TIER_CONFIG', 'TOPUP_PACKAGES', 'TRIAL_DAYS', 'WAREHOUSE_CATEGORIES', '_CATALOG_JSON_SCHEMA', '_CATALOG_SYSTEM_PROMPT', '_CATEGORY_STOPWORDS', '_CATEGORY_SYNONYMS', '_DOCUMENT_JSON_SCHEMA', '_DOCUMENT_SYSTEM_PROMPT', '_EXPIRY_SCAN_JSON_SCHEMA', '_EXPIRY_SCAN_SYSTEM_PROMPT', '_HACCP_RULES', '_JSON_SCHEMA', '_LONG_SHELF_KEYWORDS', '_MENU_SCAN_JSON_SCHEMA', '_MENU_SCAN_SYSTEM_PROMPT', '_MENU_SUGGEST_BATCH_SIZE', '_MENU_SUGGEST_BATCH_TIMEOUT_S', '_MENU_SUGGEST_JSON_SCHEMA', '_MENU_SUGGEST_SYSTEM_PROMPT', '_MONTHS_PL', '_MONTH_NAMES_PL', '_PL_MONTHS', '_PL_MONTH_NAMES', '_RECIPE_OCR_JSON_SCHEMA', '_UNIT_MAP', '_WAREHOUSE_CAT_COLORS']
