/**
 * Persistencja odkrytych przepisów Inspiracji — per account_key na urządzeniu.
 * Po pierwszym wygenerowaniu przepis zostaje lokalnie (bez ponownego AI / Railway).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { claimLegacyStorageKey, tenantStorageKey } from '@/lib/tenantStorage';

const LEGACY_KEY = '@gm/inspiration_unlocks_v1';
const KEY_PREFIX = '@gm/inspiration_unlocks_v2:';

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
  credits_deducted?: number;
  credits_remaining?: number | null;
};

export type UnlockedInspiration = {
  slug: string;
  dishName: string;
  unlockedAt: string;
  recipe: InspirationRecipe;
};

type Store = Record<string, UnlockedInspiration>;

function storageKey(): string {
  return tenantStorageKey(KEY_PREFIX);
}

async function readStore(): Promise<Store> {
  try {
    const key = storageKey();
    let raw = await AsyncStorage.getItem(key);
    if (raw == null) {
      raw = await claimLegacyStorageKey(
        (k) => AsyncStorage.getItem(k),
        (k, v) => AsyncStorage.setItem(k, v),
        (k) => AsyncStorage.removeItem(k),
        LEGACY_KEY,
        key,
      );
    }
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Store;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function writeStore(store: Store): Promise<void> {
  await AsyncStorage.setItem(storageKey(), JSON.stringify(store));
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
