/**
 * Lokalne receptury użytkownika (kafelek Receptury w Menu).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@gm/user_recipes_v1';

export type UserRecipeIngredient = {
  name: string;
  quantity: number;
  unit: string;
};

export type UserRecipe = {
  id: string;
  name: string;
  /** slug dopasowanego obrazka z katalogu dań */
  imageSlug?: string;
  /** require() asset number — ustawiane przy zapisie przez resolve */
  localAsset?: number;
  ingredients: UserRecipeIngredient[];
  /** Pełny tekst przepisu (kroki / notatki kuchenne) */
  instructions?: string;
  createdAt: string;
  updatedAt: string;
};

async function readAll(): Promise<UserRecipe[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as UserRecipe[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeAll(list: UserRecipe[]): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

export async function loadUserRecipes(): Promise<UserRecipe[]> {
  return readAll();
}

export async function saveUserRecipe(recipe: Omit<UserRecipe, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Promise<UserRecipe> {
  const list = await readAll();
  const now = new Date().toISOString();
  if (recipe.id) {
    const idx = list.findIndex((r) => r.id === recipe.id);
    const next: UserRecipe = {
      ...list[idx],
      ...recipe,
      id: recipe.id,
      updatedAt: now,
      createdAt: list[idx]?.createdAt || now,
    } as UserRecipe;
    if (idx >= 0) list[idx] = next;
    else list.unshift(next);
    await writeAll(list);
    return next;
  }
  const created: UserRecipe = {
    id: `ur_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: recipe.name,
    imageSlug: recipe.imageSlug,
    localAsset: recipe.localAsset,
    ingredients: recipe.ingredients,
    instructions: recipe.instructions ?? '',
    createdAt: now,
    updatedAt: now,
  };
  list.unshift(created);
  await writeAll(list);
  return created;
}

export async function deleteUserRecipe(id: string): Promise<void> {
  const list = await readAll();
  await writeAll(list.filter((r) => r.id !== id));
}
