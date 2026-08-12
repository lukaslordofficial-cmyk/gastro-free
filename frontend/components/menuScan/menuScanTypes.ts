/**
 * Typy i stałe skanera menu — wydzielone z MenuScanModal (.agentrules §I).
 */
import { secureId } from '@/lib/secureId';

export const MENU_CATEGORIES = [
  'Przystawki', 'Zupy', 'Sałatki', 'Burgery', 'Dania główne',
  'Makarony', 'Pizza', 'Desery', 'Napoje', 'Alkohole', 'Półprodukty', 'Inne',
];

export const WEIGHT_UNITS = ['g', 'ml', 'szt'] as const;
export type WeightUnit = (typeof WEIGHT_UNITS)[number];

export const INGREDIENT_UNITS = ['g', 'ml', 'szt'] as const;
export type IngredientUnit = (typeof INGREDIENT_UNITS)[number];

export interface Ingredient {
  key: string;
  name: string;
  quantity: string;
  unit: IngredientUnit;
  /** Wzorcowa waga 1 sztuki w gramach */
  pieceWeightG: string;
}

export interface DraftDish {
  key: string;
  name: string;
  category: string;
  priceInput: string;
  portionWeightInput: string;
  portionWeightUnit: WeightUnit | null;
  ingredients: Ingredient[];
  /** Tagi kontekstu grafiki (białko / typ) — z AI lub heurystyki nazwy */
  imageContextTags?: string[];
}

export interface Suggestion {
  suggested_ingredients: { name: string; quantity: number; unit: string }[];
  suggested_portion_weight_value: number | null;
  suggested_portion_weight_unit: string | null;
}

export type MenuScanStage =
  | 'choose'
  | 'scanning'
  | 'edit'
  | 'ask_suggest'
  | 'suggesting'
  | 'confirming'
  | 'syncing'
  | 'done';

export function newIngredientKey(): string {
  return secureId('ing');
}

export function newIngredient(
  name = '',
  quantity = '',
  unit: IngredientUnit = 'g',
  pieceWeightG = '',
): Ingredient {
  return { key: newIngredientKey(), name, quantity, unit, pieceWeightG };
}
