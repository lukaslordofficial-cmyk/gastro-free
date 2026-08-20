/** Typy ekranu Menu — wspólne dla karty dania, formularza i listy. */

export type Unit = 'g' | 'ml' | 'szt' | 'opak' | 'L' | 'kg';

export interface RecipeIngredient {
  name: string;
  quantity: number;
  unit: string;
  piece_weight_g?: number | null;
}

export interface Dish {
  id: string;
  name: string;
  category: string;
  price_pln: number;
  pos_id: string;
  recipe: RecipeIngredient[];
}

export type DishThumbAssignment = {
  source?: number | { uri: string };
  slug?: string;
};

export type MenuListRow =
  | { type: 'header'; category: string; count: number }
  | { type: 'dish'; dish: Dish };

export interface KitchenUtensil {
  id: string;
  name: string;
  utensil_type: string;
  capacity_value: number | null;
  capacity_unit: string | null;
}

export interface IngredientDraft {
  key: string;
  name: string;
  quantity: string;
  unit: string;
  /** Wzorcowa waga 1 sztuki (g) — gdy unit=szt */
  pieceWeightG: string;
}

/** Kształt pozycji magazynu lustrzany z magazyn.tsx */
export interface InventoryItem {
  id: string;
  product_name: string;
  category: string;
  current_qty: number;
  critical_threshold: number;
  unit: Unit;
  is_combo_półprodukt: boolean;
  portion_size: number | null;
}

export type DishDbRow = {
  id: string;
  name: string;
  category: string;
  price_pln: number | string;
  pos_id?: string | null;
  recipe_ingredients?: Array<{
    ingredient_name: string;
    quantity: number | string;
    unit: string;
    piece_weight_g?: number | string | null;
    sort_order: number;
  }> | null;
};

export type InventoryDbRow = {
  id: string;
  name: string;
  inventory_categories?: { name?: string | null } | null;
  quantity: number | string;
  min_quantity: number | string;
  unit: Unit;
  is_combo_polprodukt?: boolean | null;
  portion_size?: number | string | null;
};
