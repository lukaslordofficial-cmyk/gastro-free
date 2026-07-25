export type Database = {
  public: {
    Tables: {
      inventory_categories: {
        Row: InventoryCategory;
        Insert: Omit<InventoryCategory, 'id' | 'created_at'>;
        Update: Partial<Omit<InventoryCategory, 'id' | 'created_at'>>;
      };
      suppliers: {
        Row: Supplier;
        Insert: Omit<Supplier, 'id' | 'created_at'>;
        Update: Partial<Omit<Supplier, 'id' | 'created_at'>>;
      };
      supplier_catalog: {
        Row: SupplierCatalog;
        Insert: Omit<SupplierCatalog, 'id' | 'created_at'>;
        Update: Partial<Omit<SupplierCatalog, 'id' | 'created_at'>>;
      };
      supplier_offers: {
        Row: SupplierOffer;
        Insert: Omit<SupplierOffer, 'id' | 'created_at'>;
        Update: Partial<Omit<SupplierOffer, 'id' | 'created_at'>>;
      };
      supplier_products: {
        Row: SupplierProduct;
        Insert: Omit<SupplierProduct, 'id' | 'created_at'>;
        Update: Partial<Omit<SupplierProduct, 'id' | 'created_at'>>;
      };
      supplier_offer_items: {
        Row: SupplierOfferItem;
        Insert: Omit<SupplierOfferItem, 'id' | 'created_at'>;
        Update: Partial<Omit<SupplierOfferItem, 'id' | 'created_at'>>;
      };
      supplier_orders: {
        Row: SupplierOrder;
        Insert: Omit<SupplierOrder, 'id' | 'created_at'>;
        Update: Partial<Omit<SupplierOrder, 'id' | 'created_at'>>;
      };
      supplier_order_items: {
        Row: SupplierOrderItem;
        Insert: Omit<SupplierOrderItem, 'id' | 'created_at'>;
        Update: Partial<Omit<SupplierOrderItem, 'id' | 'created_at'>>;
      };
      revenue_entries: {
        Row: RevenueEntry;
        Insert: Omit<RevenueEntry, 'id' | 'created_at'>;
        Update: Partial<Omit<RevenueEntry, 'id' | 'created_at'>>;
      };
      variable_cost_entries: {
        Row: VariableCostEntry;
        Insert: Omit<VariableCostEntry, 'id' | 'created_at'>;
        Update: Partial<Omit<VariableCostEntry, 'id' | 'created_at'>>;
      };
      inventory_items: {
        Row: InventoryItem;
        Insert: Omit<InventoryItem, 'id' | 'created_at'>;
        Update: Partial<Omit<InventoryItem, 'id' | 'created_at'>>;
      };
      waste_logs: {
        Row: WasteLog;
        Insert: Omit<WasteLog, 'id' | 'created_at'>;
        Update: Partial<Omit<WasteLog, 'id' | 'created_at'>>;
      };
      fixed_costs: {
        Row: FixedCost;
        Insert: Omit<FixedCost, 'id' | 'created_at'>;
        Update: Partial<Omit<FixedCost, 'id' | 'created_at'>>;
      };
      financial_records: {
        Row: FinancialRecord;
        Insert: Omit<FinancialRecord, 'id' | 'created_at'>;
        Update: Partial<Omit<FinancialRecord, 'id' | 'created_at'>>;
      };
      menu_items: {
        Row: MenuItem;
        Insert: Omit<MenuItem, 'id' | 'created_at'>;
        Update: Partial<Omit<MenuItem, 'id' | 'created_at'>>;
      };
      recipe_ingredients: {
        Row: RecipeIngredient;
        Insert: Omit<RecipeIngredient, 'id'>;
        Update: Partial<Omit<RecipeIngredient, 'id'>>;
      };
      kitchen_utensils: {
        Row: KitchenUtensil;
        Insert: Omit<KitchenUtensil, 'id' | 'created_at'>;
        Update: Partial<Omit<KitchenUtensil, 'id' | 'created_at'>>;
      };
      purchase_suggestions: {
        Row: PurchaseSuggestion;
        Insert: Omit<PurchaseSuggestion, 'id' | 'created_at'>;
        Update: Partial<Omit<PurchaseSuggestion, 'id' | 'created_at'>>;
      };
      pos_settings: {
        Row: PosSettings;
        Insert: Omit<PosSettings, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<PosSettings, 'id' | 'created_at'>>;
      };
      pos_products: {
        Row: PosProduct;
        Insert: Omit<PosProduct, 'id' | 'created_at'>;
        Update: Partial<Omit<PosProduct, 'id' | 'created_at'>>;
      };
      recipes: {
        Row: Recipe;
        Insert: Omit<Recipe, 'id' | 'created_at'>;
        Update: Partial<Omit<Recipe, 'id' | 'created_at'>>;
      };
      pos_sales_log: {
        Row: PosSalesLog;
        Insert: Omit<PosSalesLog, 'id'>;
        Update: Partial<Omit<PosSalesLog, 'id'>>;
      };
      subscriptions: {
        Row: Subscription;
        Insert: Omit<Subscription, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Subscription, 'id' | 'created_at'>>;
      };
      profiles: {
        Row: Profile;
        Insert: Omit<Profile, 'created_at' | 'updated_at'> & {
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Omit<Profile, 'id'>>;
      };
    };
  };
};

export interface Profile {
  id: string;
  email: string | null;
  account_key: string;
  restaurant_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryCategory {
  id: string;
  name: string;
  color: string;
  icon_name: string;
  sort_order: number;
  created_at: string;
}

export interface Supplier {
  id: string;
  name: string;
  nip: string | null;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  category: string | null;
  notes: string | null;
  icon_color: string;
  created_at: string;
}

export interface SupplierCatalog {
  id: string;
  supplier_id: string;
  name: string;
  variant: string;
  volume_label: string;
  unit_count: number;
  price_pln: number;
  liters_total: number;
  sort_order: number;
  created_at: string;
}

export interface SupplierOffer {
  id: string;
  supplier_id: string;
  file_name: string;
  file_path: string | null;
  file_type: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  parsed_count: number;
  error_message: string | null;
  created_at: string;
}

export interface SupplierProduct {
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

export interface SupplierOfferItem {
  id: string;
  supplier_id: string;
  offer_id: string | null;
  raw_product_name: string;
  price_net: number | null;
  unit: string;
  warehouse_product_id: string | null;
  created_at: string;
}

export interface SupplierOrder {
  id: string;
  supplier_id: string;
  status: 'draft' | 'sent' | 'confirmed' | 'received';
  notes: string | null;
  created_at: string;
}

export interface SupplierOrderItem {
  id: string;
  order_id: string;
  raw_product_name: string;
  price_net: number | null;
  unit: string;
  quantity_ordered: number;
  warehouse_product_id: string | null;
  created_at: string;
}

export interface RevenueEntry {
  id: string;
  year_month: string;
  description: string | null;
  amount_pln: number;
  note?: string | null;
  created_at: string;
}

export interface VariableCostEntry {
  id: string;
  year_month: string;
  name: string;
  type: 'materials' | 'waste' | 'other';
  amount_pln: number;
  note?: string | null;
  created_at: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  category_id: string | null;
  quantity: number;
  unit: string;
  min_quantity: number;
  portion_size: number | null;
  unit_cost: number;
  supplier_id: string | null;
  is_combo_polprodukt: boolean;
  is_critical: boolean;
  created_at: string;
}

export interface InventoryItemWithCategory extends InventoryItem {
  inventory_categories: InventoryCategory | null;
  suppliers: Pick<Supplier, 'id' | 'name'> | null;
}

export interface WasteLog {
  id: string;
  item_id: string | null;
  item_name: string;
  quantity: number;
  unit: string;
  reason: string | null;
  created_at: string;
}

export interface FixedCost {
  id: string;
  name: string;
  type: 'rent' | 'media' | 'payroll' | 'other';
  amount_pln: number;
  year_month: string;
  note?: string | null;
  created_at: string;
}

export interface FinancialRecord {
  id: string;
  year_month: string;
  revenue_pln: number;
  variable_costs_pln: number;
  created_at: string;
}

export interface MenuItem {
  id: string;
  name: string;
  category: string;
  price_pln: number;
  pos_id: string | null;
  is_active: boolean;
  created_at: string;
}

export interface MenuItemWithRecipe extends MenuItem {
  recipe_ingredients: RecipeIngredient[];
}

export interface RecipeIngredient {
  id: string;
  menu_item_id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  sort_order: number;
}

export interface KitchenUtensil {
  id: string;
  name: string;
  utensil_type: string;
  capacity_value: number | null;
  capacity_unit: string | null;
  notes: string | null;
  created_at: string;
}

export interface PurchaseSuggestion {
  id: string;
  item_id: string | null;
  supplier_id: string | null;
  title: string;
  suggestion_text: string;
  savings_amount_pln: number;
  is_active: boolean;
  created_at: string;
}

export interface PosSettings {
  id: string;
  pos_system: string;
  api_key: string | null;
  location_id: string | null;
  is_connected: boolean;
  last_sync_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PosProduct {
  id: string;
  pos_external_id: string;
  name: string;
  price_pln: number;
  is_active: boolean;
  created_at: string;
}

export interface Recipe {
  id: string;
  pos_product_id: string;
  warehouse_product_id: string;
  quantity_per_portion: number;
  unit: string;
  created_at: string;
}

export interface PosSalesLog {
  id: string;
  pos_external_id: string;
  pos_product_id: string | null;
  quantity_sold: number;
  processed_at: string;
}

export interface Subscription {
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
