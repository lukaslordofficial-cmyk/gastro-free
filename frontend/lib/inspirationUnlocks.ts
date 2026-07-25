/**
 * Persistencja odkrytych przepisów Inspiracji (per urządzenie).
 * Po pierwszym wygenerowaniu przepis zostaje na stałe — bez ponownego AI.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@gm/inspiration_unlocks_v1';

export type InspirationRecipe = {
  dish_name: string;
  prep_time_minutes: number;
  difficulty: string;
  default_portions: number;
  short_teaser: string;
  ingredients_sections: {
    section_name: string;
    ingredients: { name: string; base_quantity: number; unit: string }[];
  }[];
  steps: string[];
  chef_tip: string;
  cached?: boolean;
};

export type UnlockedInspiration = {
  slug: string;
  dishName: string;
  unlockedAt: string;
  recipe: InspirationRecipe;
};

type Store = Record<string, UnlockedInspiration>;

async function readStore(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStore(store: Store): Promise<void> {
  await AsyncStorage.setItem(KEY, JSON.stringify(store));
}

export async function loadUnlockedInspirations(): Promise<Store> {
  return readStore();
}

export async function getUnlockedInspiration(slug: string): Promise<UnlockedInspiration | null> {
  const store = await readStore();
  return store[slug] ?? null;
}

export async function saveUnlockedInspiration(
  slug: string,
  dishName: string,
  recipe: InspirationRecipe,
): Promise<void> {
  const store = await readStore();
  store[slug] = {
    slug,
    dishName,
    unlockedAt: new Date().toISOString(),
    recipe: { ...recipe, cached: true },
  };
  await writeStore(store);
}
