/**
 * Cache mapowań slug/relativePath dla Menu.
 * Źródło obrazka = lokalny require (lazy folder) — nie Supabase dania/.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { resolveDishLocalAsset } from '@/lib/dishAssets';
import type { MenuDishThumb } from '@/lib/menuDishThumbs';

const MAP_KEY = '@gm/menu_thumbs_v5';

export type StoredThumb = {
  slug: string;
  relativePath: string;
  matchTier?: MenuDishThumb['matchTier'];
  placeholderLabel?: string;
  score?: number;
};

type StoredMap = Record<string, StoredThumb>;

let store: StoredMap = {};
let storeLoaded = false;
const thumbsByName = new Map<string, MenuDishThumb>();
const listeners = new Set<() => void>();
let notifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifySoon(delay = 60) {
  if (notifyTimer) return;
  notifyTimer = setTimeout(() => {
    notifyTimer = null;
    for (const fn of listeners) {
      try {
        fn();
      } catch {
        /* ignore */
      }
    }
  }, delay);
}

export function subscribeMenuThumbs(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getMenuThumbSync(name: string): MenuDishThumb | undefined {
  return thumbsByName.get(name);
}

function dishKey(name: string, category?: string): string {
  return `${name}\u0001${category || ''}`;
}

function toThumb(row: StoredThumb): MenuDishThumb | null {
  const local = resolveDishLocalAsset(row.relativePath);
  if (local == null) return null;
  return {
    source: local,
    slug: row.slug,
    relativePath: row.relativePath,
    matchTier: row.matchTier,
    placeholderLabel: row.placeholderLabel,
    score: row.score,
  };
}

function putMemory(name: string, thumb: MenuDishThumb) {
  thumbsByName.set(name, thumb);
}

export function applyThumbsToMemory(thumbs: Map<string, MenuDishThumb>): void {
  for (const [name, thumb] of thumbs) {
    putMemory(name, thumb);
  }
  notifySoon(40);
}

export async function loadMenuThumbStore(): Promise<StoredMap> {
  if (storeLoaded) return store;
  try {
    const raw = await AsyncStorage.getItem(MAP_KEY);
    store = raw ? (JSON.parse(raw) as StoredMap) : {};
  } catch {
    store = {};
  }
  storeLoaded = true;
  return store;
}

async function persistStore(): Promise<void> {
  try {
    await AsyncStorage.setItem(MAP_KEY, JSON.stringify(store));
  } catch {
    /* ignore */
  }
}

function rowForItem(name: string, category?: string): StoredThumb | undefined {
  return store[dishKey(name, category)] || store[name];
}

export async function hydrateMenuThumbsFromDisk(
  items: ReadonlyArray<{ name: string; category?: string }>,
): Promise<Map<string, MenuDishThumb>> {
  await loadMenuThumbStore();
  const out = new Map<string, MenuDishThumb>();

  for (const item of items) {
    const row = rowForItem(item.name, item.category);
    if (!row?.relativePath || !row.slug) continue;
    const thumb = toThumb(row);
    if (!thumb) continue;
    out.set(item.name, thumb);
    putMemory(item.name, thumb);
  }

  notifySoon(40);
  return out;
}

function mergeThumbIntoStore(name: string, category: string | undefined, thumb: MenuDishThumb) {
  const rel =
    thumb.relativePath ||
    (typeof thumb.source === 'object' && 'uri' in thumb.source ? '' : '') ||
    store[dishKey(name, category)]?.relativePath ||
    '';
  if (!thumb.slug || !rel) {
    // Jeśli source jest local number, relativePath powinno być ustawione przez matcher
    if (!thumb.relativePath) return;
  }
  const relativePath = thumb.relativePath || rel;
  if (!relativePath) return;
  const key = dishKey(name, category);
  store[key] = {
    slug: thumb.slug,
    relativePath,
    matchTier: thumb.matchTier,
    placeholderLabel: thumb.placeholderLabel,
    score: thumb.score,
  };
  store[name] = store[key];
  putMemory(name, {
    source: typeof thumb.source === 'number' ? thumb.source : thumb.source,
    slug: thumb.slug,
    relativePath,
    matchTier: thumb.matchTier,
    placeholderLabel: thumb.placeholderLabel,
    score: thumb.score,
  });
}

export async function persistMenuThumbMatches(
  items: ReadonlyArray<{ name: string; category?: string }>,
  thumbs: Map<string, MenuDishThumb>,
): Promise<void> {
  await loadMenuThumbStore();
  for (const item of items) {
    const thumb = thumbs.get(item.name);
    if (!thumb) continue;
    mergeThumbIntoStore(item.name, item.category, thumb);
  }
  await persistStore();
  notifySoon(60);
}

export async function persistOneMenuThumb(
  name: string,
  category: string | undefined,
  thumb: MenuDishThumb,
): Promise<void> {
  await loadMenuThumbStore();
  mergeThumbIntoStore(name, category, thumb);
  await persistStore();
  notifySoon(60);
}

/** No-op — lokalne assety nie wymagają downloadu. Zostawione dla kompatybilności API. */
export async function downloadMenuThumbsLocally(
  _items: ReadonlyArray<{ name: string; category?: string }>,
  thumbs: Map<string, MenuDishThumb>,
  _onProgress?: (next: Map<string, MenuDishThumb>) => void,
): Promise<Map<string, MenuDishThumb>> {
  return thumbs;
}
