import { ingredientDedupeKey } from '@/lib/fuzzyProductMatch';
import { secureId } from '@/lib/secureId';
import type { Dish, DishDbRow, IngredientDraft, InventoryDbRow, InventoryItem } from '@/types/menu';

export function makePosId(category: string, total: number): string {
  const prefix: Record<string, string> = {
    Burgery: 'BRG',
    'Dania główne': 'DAN',
    Sałatki: 'SAL',
    Makarony: 'MAK',
    Zupy: 'ZUP',
  };
  return `${prefix[category] ?? 'DAN'}-${String(total).padStart(3, '0')}`;
}

export function newDraftIngredient(): IngredientDraft {
  return { key: secureId('ing'), name: '', quantity: '', unit: 'g', pieceWeightG: '' };
}

/** Dedupe / link key — stem-ish (pomidor ≡ pomidory). */
export function normIngredientName(name: string): string {
  return ingredientDedupeKey(name);
}

export const PIECE_WEIGHT_HINT =
  'Pole nieobowiązkowe — wpisz, jeśli ten produkt kupujesz u dostawcy na wagę. Dzięki temu możliwe będzie monitorowanie stanu tego produktu na magazynie.';

export function mapDbToDish(row: unknown): Dish {
  const r = (row ?? {}) as DishDbRow;
  const ingredients = (r.recipe_ingredients ?? []).sort((a, b) => a.sort_order - b.sort_order);
  return {
    id: r.id,
    name: r.name,
    category: r.category,
    price_pln: Number(r.price_pln),
    pos_id: r.pos_id ?? '',
    recipe: ingredients.map((i) => ({
      name: i.ingredient_name,
      quantity: Number(i.quantity),
      unit: i.unit,
      piece_weight_g: i.piece_weight_g != null ? Number(i.piece_weight_g) : null,
    })),
  };
}

export function mapInvDbRow(row: unknown): InventoryItem {
  const r = (row ?? {}) as InventoryDbRow;
  return {
    id: r.id,
    product_name: r.name,
    category: r.inventory_categories?.name ?? 'Inne',
    current_qty: Number(r.quantity),
    critical_threshold: Number(r.min_quantity),
    unit: r.unit,
    is_combo_półprodukt: r.is_combo_polprodukt ?? false,
    portion_size: r.portion_size != null ? Number(r.portion_size) : null,
  };
}
