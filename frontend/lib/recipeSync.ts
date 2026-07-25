import { DeviceEventEmitter } from 'react-native';

export const RECIPE_INGREDIENTS_CHANGED = 'gm:recipe-ingredients-changed';

export type RecipeIngredientsChangedPayload = {
  menuItemId: string;
};

/** Powiadom Menu / Ustawienia POS o zmianie receptury (ta sama tabela recipe_ingredients). */
export function emitRecipeIngredientsChanged(menuItemId: string) {
  DeviceEventEmitter.emit(RECIPE_INGREDIENTS_CHANGED, {
    menuItemId,
  } satisfies RecipeIngredientsChangedPayload);
}
