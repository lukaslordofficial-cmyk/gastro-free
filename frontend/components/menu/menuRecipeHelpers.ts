import AsyncStorage from '@react-native-async-storage/async-storage';
import { secureId } from '@/lib/secureId';
import { ingredientDedupeKey } from '@/lib/fuzzyProductMatch';
import { claimLegacyStorageKey, tenantStorageKey } from '@/lib/tenantStorage';
import type { EditableIngredient, RecipeIngredientRow } from './menuRecipeTypes';

export const RECIPE_WH_MAP_LEGACY = '@gm/recipe_wh_map';
export const RECIPE_WH_MAP_PREFIX = '@gm/recipe_wh_map_v2:';
export const UNIT_OPTIONS = ['g', 'ml', 'szt', 'kg', 'L'] as const;
export const PIECE_WEIGHT_HINT =
  'Pole nieobowiązkowe — wpisz, jeśli ten produkt kupujesz u dostawcy na wagę. Dzięki temu możliwe będzie monitorowanie stanu tego produktu na magazynie.';

export function recipeWhMapKey(): string {
  return tenantStorageKey(RECIPE_WH_MAP_PREFIX);
}

export async function loadSoftMap(): Promise<Record<string, string>> {
  try {
    const key = recipeWhMapKey();
    let raw = await AsyncStorage.getItem(key);
    if (raw == null) {
      raw = await claimLegacyStorageKey(
        (k) => AsyncStorage.getItem(k),
        (k, v) => AsyncStorage.setItem(k, v),
        (k) => AsyncStorage.removeItem(k),
        RECIPE_WH_MAP_LEGACY,
        key,
      );
    }
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export async function saveSoftMap(map: Record<string, string>) {
  await AsyncStorage.setItem(recipeWhMapKey(), JSON.stringify(map));
}

export function normName(s: string) {
  return ingredientDedupeKey(s) || (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9s]/g, ' ')
    .replace(/s+/g, ' ')
    .trim();
}

export function toEditable(rows: RecipeIngredientRow[]): EditableIngredient[] {
  return rows.map((r) => ({
    key: r.id,
    id: r.id,
    name: r.ingredient_name,
    quantity: String(r.quantity ?? 0),
    unit: r.unit || 'g',
    pieceWeightG: r.piece_weight_g != null ? String(r.piece_weight_g) : '',
    warehouse_product_id: r.warehouse_product_id,
    warehouse_product_name: r.warehouse_product_name,
    in_stock: r.in_stock,
    stock_qty: r.stock_qty,
  }));
}

export function newEditable(): EditableIngredient {
  return {
    key: secureId('new'),
    id: null,
    name: '',
    quantity: '',
    unit: 'g',
    pieceWeightG: '',
    warehouse_product_id: null,
  };
}
