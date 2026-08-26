/** Typy mapowania receptur / POS — wydzielone z MenuRecipeRow. */

export interface MenuItemForMapping {
  id: string;
  name: string;
  category: string | null;
  price_pln: number | null;
  pos_id: string | null;
  is_available?: boolean;
  /** Składniki z receptury (zagnieżdżone z menu_items) — podgląd gramatur */
  recipeIngredients?: RecipeIngredientRow[];
}

export interface RecipeIngredientRow {
  id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  piece_weight_g?: number | null;
  warehouse_product_id: string | null;
  warehouse_product_name?: string | null;
  in_stock?: boolean;
  stock_qty?: number;
}

export interface InventoryItemForRecipe {
  id: string;
  name: string;
  unit: string;
  quantity?: number;
  min_quantity?: number;
  category_name?: string | null;
}

export type EditableIngredient = {
  key: string;
  id: string | null;
  name: string;
  quantity: string;
  unit: string;
  pieceWeightG: string;
  warehouse_product_id: string | null;
  warehouse_product_name?: string | null;
  in_stock?: boolean;
  stock_qty?: number;
};
