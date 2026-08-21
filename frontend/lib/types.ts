/**
 * Typy domenowe + ksztaĹ‚t Database dla @supabase/supabase-js.
 *
 * WAĹ»NE (supabase-js â‰Ą2.43): kaĹĽda tabela MUSI mieÄ‡ `Relationships`, a schemat
 * `public` musi mieÄ‡ Views/Functions/Enums â€” bez tego Insert/Update stajÄ… siÄ™
 * `never` (154 bĹ‚Ä™dy tsc). Docelowo: `npx supabase gen types typescript â€¦`
 * â†’ `types.generated.ts` i re-eksport Row stÄ…d.
 */

/** Minimalny wpis tabeli zgodny z GenericTable z supabase-js. */
type DbTable<
  Row,
  Insert = Omit<Row, 'id' | 'created_at'> & {
    id?: string;
    created_at?: string;
  },
  Update = Partial<Row>,
> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      inventory_categories: DbTable<InventoryCategory>;
      suppliers: DbTable<Supplier>;
      supplier_catalog: DbTable<SupplierCatalog>;
      supplier_offers: DbTable<SupplierOffer>;
      supplier_products: DbTable<SupplierProduct>;
      supplier_offer_items: DbTable<SupplierOfferItem>;
      supplier_orders: DbTable<SupplierOrder>;
      supplier_order_items: DbTable<SupplierOrderItem>;
      revenue_entries: DbTable<RevenueEntry>;
      variable_cost_entries: DbTable<VariableCostEntry>;
      inventory_items: DbTable<InventoryItem>;
      waste_logs: DbTable<WasteLog>;
      fixed_costs: DbTable<FixedCost>;
      financial_records: DbTable<FinancialRecord>;
      menu_items: DbTable<MenuItem>;
      recipe_ingredients: DbTable<
        RecipeIngredient,
        Omit<RecipeIngredient, 'id'> & { id?: string },
        Partial<RecipeIngredient>
      >;
      kitchen_utensils: DbTable<KitchenUtensil>;
      purchase_suggestions: DbTable<PurchaseSuggestion>;
      pos_settings: DbTable<
        PosSettings,
        Omit<PosSettings, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      pos_products: DbTable<PosProduct>;
      recipes: DbTable<Recipe>;
      pos_sales_log: DbTable<
        PosSalesLog,
        Omit<PosSalesLog, 'id'> & { id?: string },
        Partial<PosSalesLog>
      >;
      subscriptions: DbTable<
        Subscription,
        Omit<Subscription, 'id' | 'created_at' | 'updated_at'> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
      profiles: DbTable<
        Profile,
        Omit<Profile, 'created_at' | 'updated_at'> & {
          created_at?: string;
          updated_at?: string;
        },
        Partial<Omit<Profile, 'id'>>
      >;
      /** Tabele używane w kodzie, ale bez pełnego modelu domenowego — stub pod typowanie. */
      warehouse_inventory: DbTable<Record<string, unknown>>;
      device_push_tokens: DbTable<Record<string, unknown>>;
      inventory_combo_ingredients: DbTable<Record<string, unknown>>;
      daily_reports: DbTable<Record<string, unknown>>;
      token_usage: DbTable<Record<string, unknown>>;
      sales_log: DbTable<Record<string, unknown>>;
      /** Marketplace B2B — Lokalni Przetwórcy (niezależne od suppliers). */
      local_producers: DbTable<Record<string, unknown>>;
      producer_categories: DbTable<Record<string, unknown>>;
      producer_products: DbTable<Record<string, unknown>>;
      producer_product_gallery: DbTable<Record<string, unknown>>;
      producer_orders: DbTable<Record<string, unknown>>;
      producer_order_items: DbTable<Record<string, unknown>>;
      producer_reviews: DbTable<Record<string, unknown>>;
      producer_documents: DbTable<Record<string, unknown>>;
      producer_notifications: DbTable<Record<string, unknown>>;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

export type Profile = {
  id: string;
  email: string | null;
  account_key: string;
  restaurant_name: string | null;
  created_at: string;
  updated_at: string;
}

export type InventoryCategory = {
  id: string;
  name: string;
  color: string;
  icon_name: string;
  sort_order: number;
  account_key: string;
  created_at: string;
}

export type Supplier = {
  id: string;
  name: string;
  nip: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  category: string | null;
  notes: string | null;
  icon_color: string;
  account_key: string;
  min_order_value?: number | null;
  shipping_cost?: number | null;
  free_shipping_threshold?: number | null;
  lead_time_days?: number | null;
  is_visible?: boolean | null;
  created_at: string;
}

export type SupplierCatalog = {
  id: string;
  supplier_id: string;
  name: string;
  variant: string;
  volume_label: string;
  unit_count: number;
  price_pln: number;
  liters_total: number;
  sort_order: number;
  unit?: string | null;
  is_visible?: boolean | null;
  created_at: string;
}

export type SupplierOffer = {
  id: string;
  supplier_id: string;
  file_name: string;
  file_path: string | null;
  file_type: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  parsed_count: number;
  error_message: string | null;
  account_key: string;
  created_at: string;
}

export type SupplierProduct = {
  id: string;
  supplier_id: string;
  offer_id: string;
  name: string;
  price_pln: number | null;
  unit: string;
  category: string | null;
  notes: string | null;
  is_visible: boolean;
  warehouse_product_id: string | null;
  created_at: string;
}

export type SupplierOfferItem = {
  id: string;
  supplier_id: string;
  offer_id: string | null;
  raw_product_name: string;
  price_net: number | null;
  unit: string;
  warehouse_product_id: string | null;
  created_at: string;
}

export type SupplierOrder = {
  id: string;
  supplier_id: string;
  status: 'draft' | 'sent' | 'confirmed' | 'received';
  notes: string | null;
  account_key?: string;
  created_at: string;
}

export type SupplierOrderItem = {
  id: string;
  order_id: string;
  raw_product_name: string;
  price_net: number | null;
  unit: string;
  quantity_ordered: number;
  warehouse_product_id: string | null;
  created_at: string;
}

export type RevenueEntry = {
  id: string;
  year_month: string;
  description: string | null;
  amount_pln: number;
  note?: string | null;
  account_key: string;
  created_at: string;
}

export type VariableCostEntry = {
  id: string;
  year_month: string;
  name: string;
  type: 'materials' | 'waste' | 'other';
  amount_pln: number;
  note?: string | null;
  account_key: string;
  created_at: string;
}

export type InventoryItem = {
  id: string;
  name: string;
  category_id: string | null;
  quantity: number;
  unit: string;
  min_quantity: number;
  optimal_quantity?: number | null;
  portion_size: number | null;
  unit_cost: number;
  supplier_id: string | null;
  is_combo_polprodukt: boolean;
  is_critical: boolean;
  is_active?: boolean | null;
  safety_buffer_percent?: number | null;
  unit_weight_volume?: number | null;
  weight_volume_unit?: string | null;
  account_key: string;
  created_at: string;
}

export type InventoryItemWithCategory = InventoryItem & {
  inventory_categories: InventoryCategory | null;
  suppliers: Pick<Supplier, 'id' | 'name'> | null;
};

export type WasteLog = {
  id: string;
  item_id: string | null;
  item_name: string;
  quantity: number;
  unit: string;
  reason: string | null;
  account_key: string;
  created_at: string;
}

export type FixedCost = {
  id: string;
  name: string;
  type: 'rent' | 'media' | 'payroll' | 'other';
  amount_pln: number;
  year_month: string;
  note?: string | null;
  account_key: string;
  created_at: string;
}

export type FinancialRecord = {
  id: string;
  year_month: string;
  revenue_pln: number;
  variable_costs_pln: number;
  account_key?: string;
  created_at: string;
}

export type MenuItem = {
  id: string;
  name: string;
  category: string;
  price_pln: number;
  pos_id: string | null;
  is_active: boolean;
  account_key: string;
  created_at: string;
}

export type MenuItemWithRecipe = MenuItem & {
  recipe_ingredients: RecipeIngredient[];
};

export type RecipeIngredient = {
  id: string;
  menu_item_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  sort_order: number;
  /** Wzorcowa waga 1 sztuki w gramach (gdy unit=szt). */
  piece_weight_g?: number | null;
}

export type KitchenUtensil = {
  id: string;
  name: string;
  utensil_type: string;
  capacity_value: number | null;
  capacity_unit: string | null;
  notes: string | null;
  account_key?: string | null;
  created_at: string;
}

export type PurchaseSuggestion = {
  id: string;
  item_id: string | null;
  supplier_id: string | null;
  title: string;
  suggestion_text: string;
  savings_amount_pln: number;
  is_active: boolean;
  created_at: string;
}

export type PosSettings = {
  id: string;
  pos_system: string;
  api_key: string | null;
  location_id: string | null;
  is_connected: boolean;
  last_sync_at: string | null;
  webhook_url?: string | null;
  account_key?: string;
  created_at: string;
  updated_at: string;
}

export type PosProduct = {
  id: string;
  pos_external_id: string;
  name: string;
  price_pln: number;
  is_active: boolean;
  created_at: string;
}

export type Recipe = {
  id: string;
  pos_product_id: string;
  warehouse_product_id: string;
  quantity_per_portion: number;
  unit: string;
  created_at: string;
}

export type PosSalesLog = {
  id: string;
  pos_external_id: string;
  pos_product_id: string | null;
  quantity_sold: number;
  processed_at: string;
  account_key?: string;
}

export type Subscription = {
  id: string;
  account_key: string;
  tier_level: number;
  credits_balance: number;
  status: string;
  current_period_end: string | null;
  free_starter_claimed: boolean;
  created_at: string;
  updated_at: string;
}
