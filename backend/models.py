"""Auto-split z server.py (byte-preserving; logika bez zmian) — modul `models`."""
from __future__ import annotations

from pydantic import BaseModel
from pydantic import Field
from typing import Literal
from typing import Optional



# ─────────────────────────────────────────────────────────────────────────────
# Pydantic schemas (Structured Outputs)
# ─────────────────────────────────────────────────────────────────────────────

Intent = Literal[
    "waste",
    "add_revenue",
    "add_fixed_cost",
    "add_variable_cost",
    "add_inventory_item",
    "add_menu_item",
    "add_supplier",
    "add_supplier_product",
    # Voice CRUD (edycja parametrów)
    "edit_menu_item_price",
    "add_recipe_ingredient",
    "edit_recipe_ingredient_qty",
    "edit_inventory_item",
    # Partie dat ważności
    "add_expiration_batch",
    # Zamawianie u dostawców
    "order_product",
    "order_critical_items_by_category",
    "supplier_flip_order",
    "budget_cap_order",
    "compare_catalogs_top_savings",
    "predictive_weekend_restock",
    "check_minimum_order_value",
    # Masowe operacje destrukcyjne (soft-delete / reset) — zabezpieczone modalem na FE
    "bulk_delete_menu",
    "bulk_delete_suppliers",
    "bulk_reset_inventory",
    "bulk_delete_inventory",
    "restore_last_deleted_menu",
    "restore_deleted_inventory",
    "upload_menu",
    # Pojedyncze usuwanie po nazwie (fuzzy)
    "delete_menu_item",
    "delete_supplier",
    "delete_inventory_item",
    # Dostępność dania (POS)
    "toggle_menu_item_availability",
    # Masowe zmiany cenowe / bufory
    "bulk_edit_menu_prices_percentage",
    "bulk_edit_menu_prices_fixed",
    "bulk_edit_inventory_buffers",
    # Edycja kategorii / nazwy dania
    "edit_menu_item_category",
    "rename_menu_item",
    # Skalowanie receptury
    "scale_recipe",
    # Sterowanie UI (nawigacja / filtry) — wykonywane na froncie
    "navigate_screen",
    "filter_ui_inventory",
    "filter_ui_menu_blocked",
    # Analityka okresowa (AI Trend & Analytics Orchestrator)
    "summarize_custom_period",
    "compare_two_periods",
    # Ranking sprzedaży / zużycia magazynu
    "rank_menu_sales",
    "rank_inventory_usage",
    "rank_waste_cost",
    "rank_dead_menu",
    "list_expiring_soon",
    "rank_supplier_spend",
    "manager_core_alerts",
    "haccp_tip",
    "upload_invoice",
    "upload_offer",
    "upload_document",
    "unknown",
]


# --- Payloads per intent -----------------------------------------------------

class WastePayload(BaseModel):
    item_type: Literal["dish", "ingredient", "unknown"] = "unknown"
    related_id: Optional[str] = None
    item_name: str = ""
    quantity: float = 0.0
    unit: str = ""
    reason: str = ""


class RevenuePayload(BaseModel):
    description: str
    amount_pln: float
    note: Optional[str] = None


FixedCostType = Literal["rent", "media", "payroll", "other"]
VarCostType = Literal["materials", "waste", "other"]


class FixedCostPayload(BaseModel):
    type: FixedCostType = "other"
    name: str
    amount_pln: float


class VarCostPayload(BaseModel):
    type: VarCostType = "other"
    name: str
    amount_pln: float


class InventoryItemPayload(BaseModel):
    name: str
    category_name: Optional[str] = None
    quantity: float = 0.0
    unit: str = "szt"
    min_quantity: float = 0.0
    optimal_quantity: Optional[float] = None
    safety_buffer_percent: float = 20.0
    unit_cost: Optional[float] = None
    portion_size: Optional[float] = None
    is_combo_polprodukt: bool = False


class MenuIngredient(BaseModel):
    ingredient_name: str
    quantity: float
    unit: str


class MenuItemPayload(BaseModel):
    name: str
    category: Optional[str] = None
    price_pln: float
    ingredients: list[MenuIngredient] = []


class SupplierPayload(BaseModel):
    name: str
    contact_person: Optional[str] = None
    phone: Optional[str] = None
    email: Optional[str] = None
    category: Optional[str] = None
    nip: Optional[str] = None
    notes: Optional[str] = None


class SupplierProductPayload(BaseModel):
    supplier_name: Optional[str] = None       # for AI to name the supplier
    supplier_id: Optional[str] = None         # if resolved
    product_name: str
    variant: Optional[str] = None
    price_pln: float
    unit_count: Optional[int] = None
    volume_label: Optional[str] = None


# --- Response schema returned by /voice/interpret ---------------------------

class VoiceInterpretation(BaseModel):
    intent: Intent
    confidence: float = Field(ge=0.0, le=1.0, default=0.5)
    reason: Optional[str] = Field(default=None, description="Krótkie uzasadnienie klasyfikacji dla użytkownika")
    payload: dict  # dyskryminator: przy zapisie waliduje się osobno pod właściwy typ
    fuzzy_matches: list[dict] = Field(default_factory=list,
                                      description="Lista dopasowań fuzzy: [{field, matched_to, score, resolved_id}]")
    alternate_intents: list[dict] = Field(
        default_factory=list,
        description="Gdy niepewność: [{intent, label}] — FE pokazuje 2 propozycje",
    )
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None

# --- Apply request (client confirms) ----------------------------------------

class ApplyRequest(BaseModel):
    intent: Intent
    payload: dict
    transcript: Optional[str] = None
    source: Literal["voice", "manual"] = "voice"


class ApplyResponse(BaseModel):
    intent: Intent
    ok: bool
    id: Optional[str] = None
    detail: str = ""
    extras: dict = Field(default_factory=dict)
    warnings: list[str] = Field(default_factory=list)


class InterpretRequest(BaseModel):
    text: str


# ─────────────────────────────────────────────────────────────────────────────
# BC route (used by pre-existing frontend flow) — thin adapter over new schema
# ─────────────────────────────────────────────────────────────────────────────

class WasteInterpretationLegacy(BaseModel):
    item_type: Literal["dish", "ingredient", "unknown"]
    related_id: Optional[str] = None
    item_name: str
    quantity: float
    unit: str
    reason: str
    confidence: float = 0.5
    notes: Optional[str] = None


# ─────────────────────────────────────────────────────────────────────────────
# BC: /api/waste/apply — old shape, wraps new logic
# ─────────────────────────────────────────────────────────────────────────────

class ApplyWasteRequestLegacy(BaseModel):
    item_type: Literal["dish", "ingredient"]
    related_id: Optional[str] = None
    item_name: str
    quantity: float
    unit: str
    reason: str
    transcript: Optional[str] = None
    source: Literal["voice", "manual"] = "voice"


# ─────────────────────────────────────────────────────────────────────────────
# 4) Supplier catalog — AI Vision scan (GPT-4o) + confirm upsert
# ─────────────────────────────────────────────────────────────────────────────

class CatalogProduct(BaseModel):
    product_name: str
    price_netto: float = 0.0
    unit: str = "szt"
    volume_label: str = ""
    product_code: Optional[str] = None


class CatalogExtractionResponse(BaseModel):
    supplier_id: str
    supplier_name: Optional[str] = None
    product_count: int
    products: list[CatalogProduct]
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


class ConfirmCatalogRequest(BaseModel):
    products: list[CatalogProduct]


class InvoiceBatchIn(BaseModel):
    quantity: float = 0.0
    expiration_date: Optional[str] = None  # YYYY-MM-DD


class InvoiceProductIn(BaseModel):
    product_name: str
    quantity: float = 0.0
    price_netto: float = 0.0
    unit: str = "szt"
    category: str = "Inne"
    batches: list[InvoiceBatchIn] = Field(default_factory=list)
    alert_days: list[int] = Field(default_factory=lambda: [7, 3, 1])


class ConfirmInvoiceRequest(BaseModel):
    supplier_id: Optional[str] = None
    supplier_name: Optional[str] = None
    total_amount: float = 0.0
    products: list[InvoiceProductIn]
    # inventory = magazyn+koszt materiałów (domyślnie)
    # variable_cost = tylko koszt zmienny
    # fixed_cost = tylko koszt stały
    destination: str = "inventory"
    # Pola panelu Dostawcy wyodrębnione ze skanu (opcjonalne — merge przy zapisie)
    supplier: Optional[dict] = None
    supplier_nip: Optional[str] = None
    supplier_phone: Optional[str] = None
    supplier_email: Optional[str] = None
    supplier_contact_person: Optional[str] = None
    supplier_address: Optional[str] = None
    supplier_bank_account: Optional[str] = None
    supplier_payment_terms: Optional[str] = None
    supplier_shipping_cost: Optional[float] = None
    supplier_min_order_value: Optional[float] = None
    supplier_free_shipping_threshold: Optional[float] = None
    supplier_lead_time_days: Optional[int] = None


class MenuScanIngredient(BaseModel):
    name: str
    quantity: Optional[float] = None
    unit: str = "g"


class MenuScanDish(BaseModel):
    name: str
    category: str = "Inne"
    price_pln: float = 0.0
    portion_weight_value: Optional[float] = None
    portion_weight_unit: Optional[str] = None
    ingredients: list[MenuScanIngredient] = Field(default_factory=list)
    image_context_tags: list[str] = Field(default_factory=list)


class MenuScanResponse(BaseModel):
    dishes: list[MenuScanDish]
    warnings: list[str] = Field(default_factory=list)
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


class RecipeOcrResponse(BaseModel):
    text: str
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


class SuggestRecipeDishIn(BaseModel):
    name: str
    category: Optional[str] = None
    ingredients: list[MenuScanIngredient] = Field(default_factory=list)
    portion_weight_value: Optional[float] = None
    portion_weight_unit: Optional[str] = None


class SuggestRecipeRequest(BaseModel):
    dishes: list[SuggestRecipeDishIn]


class SuggestedDishOut(BaseModel):
    name: str
    suggested_ingredients: list[MenuScanIngredient] = Field(default_factory=list)
    suggested_portion_weight_value: Optional[float] = None
    suggested_portion_weight_unit: Optional[str] = None


class SuggestRecipeResponse(BaseModel):
    dishes: list[SuggestedDishOut]
    credits_deducted: int = 0
    credits_remaining: Optional[int] = None


# --- 6c) Zapis zatwierdzonych potraw -----------------------------------------

class ConfirmMenuIngredient(BaseModel):
    name: str
    quantity: Optional[float] = None
    unit: str = "g"
    piece_weight_g: Optional[float] = None


class ConfirmMenuDish(BaseModel):
    name: str
    category: str = "Inne"
    price_pln: float = 0.0
    portion_weight_value: Optional[float] = None
    portion_weight_unit: Optional[str] = None
    ingredients: list[ConfirmMenuIngredient] = Field(default_factory=list)


class ConfirmMenuScanRequest(BaseModel):
    dishes: list[ConfirmMenuDish]
    # True tylko gdy użytkownik wybrał TAK w dialogu AI — NIE = zapis bez uzupełnień.
    fill_empty_with_ai: bool = False


# _fmt_pln / _fmt_qty: order_email_format (import wyżej)


# --- Schematy ----------------------------------------------------------------

class CompareItem(BaseModel):
    product_name_or_id: str
    quantity: float
    unit: str
    # Pasmo ±10% wokół deficytu do progu optymalnego — tańsze opakowanie w paśmie wygrywa
    quantity_min: Optional[float] = None
    quantity_max: Optional[float] = None
    # Gramatura 1 sztuki (g/ml) — gdy zamówienie w szt. i magazyn nie ma unit_weight_volume
    unit_weight_volume: Optional[float] = None
    weight_volume_unit: Optional[str] = None


class CompareOffersRequest(BaseModel):
    items: list[CompareItem]
    restaurant_name: Optional[str] = None
    # Strategia koszyka: fast_delivery | min_deliveries | lowest_price
    cart_objective: Optional[str] = None
    # Gdzie Łowca szuka ofert: suppliers_only | local_producers_only | both
    search_scope: Optional[str] = "suppliers_only"


class InterpretOrderRequest(BaseModel):
    text: str


class CriticalOrderRequest(BaseModel):
    """Zamów wszystkie braki krytyczne (opcjonalnie filtr kategorii) — Smart Optimizer v2."""
    categories: list[str] = Field(default_factory=lambda: ["all"])
    restaurant_name: Optional[str] = None
    force_refresh: bool = False
    # suppliers_only | local_producers_only | both
    search_scope: Optional[str] = "suppliers_only"


class ExtraOrderItem(BaseModel):
    """Nazwany produkt do dorzucenia do koszyka braków (voice MIX)."""
    product_name: str = ""
    quantity: Optional[float] = None
    unit: str = "szt"
    unit_weight_volume: Optional[float] = None
    weight_volume_unit: Optional[str] = None


class CriticalByCategoryRequest(BaseModel):
    categories: list[str] = Field(default_factory=list)
    restaurant_name: Optional[str] = None
    skip_compare: bool = False  # True = tylko detekcja braków (bez Łowcy)
    # critical = qty <= min (domyślne dla „brakujące”); optimal = poniżej progu optymalnego
    stock_target: str = "critical"
    # MIX: konkretne produkty z nazwy (np. ser kozi) + braki z categories
    items: list[ExtraOrderItem] = Field(default_factory=list)
    # Strategia koszyka Łowcy: fast_delivery | min_deliveries | lowest_price
    cart_objective: Optional[str] = None
    # suppliers_only | local_producers_only | both
    search_scope: Optional[str] = "suppliers_only"


class VoiceDispatchRequest(BaseModel):
    intent: Intent
    payload: dict


class AnalyzePeriodRequest(BaseModel):
    period_type: Literal["week", "month", "year", "custom"] = "week"
    limit_days: Optional[int] = None
    selected_periods: Optional[list] = None
    period_hint: Optional[str] = None


class ComparePeriodsRequest(BaseModel):
    period_1: str
    period_2: str


# Stripe Connect endpoints: backend/stripe_connect_routes.py (include_router)


# ─────────────────────────────────────────────────────────────────────────────
# Lokalni Przetwórcy — Checkout Stripe (BLIK+karta) + InPost ShipX
# ─────────────────────────────────────────────────────────────────────────────

class LpCheckoutRequest(BaseModel):
    order_id: str
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    idempotency_key: Optional[str] = None
    app_return_url: Optional[str] = None


class LpConfirmRequest(BaseModel):
    session_id: Optional[str] = None
    order_id: Optional[str] = None


class LpShipmentRequest(BaseModel):
    order_id: str
    receiver_name: Optional[str] = None
    receiver_email: Optional[str] = None
    receiver_phone: Optional[str] = None
    street: Optional[str] = None
    building_number: Optional[str] = None
    city: Optional[str] = None
    post_code: Optional[str] = None


class LpCourierQuoteItem(BaseModel):
    quantity: float = 0
    unit: Optional[str] = None
    weight_g: Optional[float] = None
    product_id: Optional[str] = None


class LpCourierQuoteRequest(BaseModel):
    producer_id: str
    items: list[LpCourierQuoteItem] = []
    receiver_name: Optional[str] = None
    receiver_phone: Optional[str] = None
    street: Optional[str] = None
    building_number: Optional[str] = None
    city: Optional[str] = None
    post_code: Optional[str] = None
    width_cm: Optional[int] = None
    height_cm: Optional[int] = None
    depth_cm: Optional[int] = None



class LpProductCreateRequest(BaseModel):
    title: str
    category_id: str
    description: Optional[str] = None
    price: float
    unit: Optional[str] = "szt"
    stock: Optional[float] = 0
    weight_g: Optional[float] = None
    available: Optional[bool] = True
    vat_rate_override: Optional[str] = None

__all__ = ['AnalyzePeriodRequest', 'ApplyRequest', 'ApplyResponse', 'ApplyWasteRequestLegacy', 'CatalogExtractionResponse', 'CatalogProduct', 'CompareItem', 'CompareOffersRequest', 'ComparePeriodsRequest', 'ConfirmCatalogRequest', 'ConfirmInvoiceRequest', 'ConfirmMenuDish', 'ConfirmMenuIngredient', 'ConfirmMenuScanRequest', 'CriticalByCategoryRequest', 'CriticalOrderRequest', 'ExtraOrderItem', 'FixedCostPayload', 'FixedCostType', 'Intent', 'InterpretOrderRequest', 'InterpretRequest', 'InventoryItemPayload', 'InvoiceBatchIn', 'InvoiceProductIn', 'LpCheckoutRequest', 'LpConfirmRequest', 'LpCourierQuoteItem', 'LpCourierQuoteRequest', 'LpProductCreateRequest', 'LpShipmentRequest', 'MenuIngredient', 'MenuItemPayload', 'MenuScanDish', 'MenuScanIngredient', 'MenuScanResponse', 'RecipeOcrResponse', 'RevenuePayload', 'SuggestRecipeDishIn', 'SuggestRecipeRequest', 'SuggestRecipeResponse', 'SuggestedDishOut', 'SupplierPayload', 'SupplierProductPayload', 'VarCostPayload', 'VarCostType', 'VoiceDispatchRequest', 'VoiceInterpretation', 'WasteInterpretationLegacy', 'WastePayload']
