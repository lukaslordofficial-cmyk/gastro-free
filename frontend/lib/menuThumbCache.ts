/**
 * Lokalny cache miniaturek dań (Supabase → plik na urządzeniu).
 * Menu ma zwykle 30–40 pozycji — po pierwszym pobraniu przełączanie kategorii
 * czyta file:// zamiast sieci.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import type { MenuDishThumb } from '@/lib/menuDishThumbs';

const MAP_KEY = '@gm/menu_thumbs_v2';

type StoredThumb = {
  slug: string;
  remoteUrl: string;
  localUri?: string;
  matchTier?: MenuDishThumb['matchTier'];
  placeholderLabel?: string;
  score?: number;
};

type StoredMap = Record<string, StoredThumb>;

let memory: StoredMap | null = null;

function cacheDir(): string {
  const base = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  return `${base}menu-thumbs/`;
}

function safeSlug(slug: string): string {
  return String(slug || 'img').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

function destForSlug(slug: string): string {
  return `${cacheDir()}${safeSlug(slug)}.bin`;
}

function dishKey(name: string, category?: string): string {
  return `${name}\u0001${category || ''}`;
}

async function ensureDir(): Promise<void> {
  const dir = cacheDir();
  if (!dir) return;
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
}

export async function loadMenuThumbStore(): Promise<StoredMap> {
  if (memory) return memory;
  try {
    const raw = await AsyncStorage.getItem(MAP_KEY);
    memory = raw ? (JSON.parse(raw) as StoredMap) : {};
  } catch {
    memory = {};
  }
  return memory;
}

async function saveMenuThumbStore(map: StoredMap): Promise<void> {
  memory = map;
  try {
    await AsyncStorage.setItem(MAP_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

function toThumb(row: StoredThumb): MenuDishThumb {
  const uri = row.localUri || row.remoteUrl;
  return {
    source: { uri },
    slug: row.slug,
    matchTier: row.matchTier,
    placeholderLabel: row.placeholderLabel,
    score: row.score,
  };
}

/** Szybki odczyt już pobranych miniaturek (bez matchowania katalogu). */
export async function hydrateMenuThumbsFromDisk(
  items: ReadonlyArray<{ name: string; category?: string }>,
): Promise<Map<string, MenuDishThumb>> {
  const store = await loadMenuThumbStore();
  const out = new Map<string, MenuDishThumb>();
  if (Platform.OS === 'web') {
    for (const item of items) {
      const row = store[dishKey(item.name, item.category)] || store[item.name];
      if (row?.remoteUrl) out.set(item.name, toThumb({ ...row, localUri: undefined }));
    }
    return out;
  }

  for (const item of items) {
    const row = store[dishKey(item.name, item.category)] || store[item.name];
    if (!row) continue;
    if (row.localUri) {
      try {
        const info = await FileSystem.getInfoAsync(row.localUri);
        if (info.exists) {
          out.set(item.name, toThumb(row));
          continue;
        }
      } catch {
        /* fall through */
      }
    }
    if (row.remoteUrl) out.set(item.name, toThumb({ ...row, localUri: undefined }));
  }
  return out;
}

function mergeThumbIntoStore(store: StoredMap, name: string, category: string | undefined, thumb: MenuDishThumb, localUri?: string) {
  const key = dishKey(name, category);
  store[key] = {
    slug: thumb.slug,
    remoteUrl: thumb.source.uri.startsWith('file:')
      ? store[key]?.remoteUrl || ''
      : thumb.source.uri,
    localUri: localUri || store[key]?.localUri,
    matchTier: thumb.matchTier,
    placeholderLabel: thumb.placeholderLabel,
    score: thumb.score,
  };
  if (!store[name]) store[name] = store[key];
}

export async function persistMenuThumbMatches(
  items: ReadonlyArray<{ name: string; category?: string }>,
  thumbs: Map<string, MenuDishThumb>,
): Promise<void> {
  const store = { ...(await loadMenuThumbStore()) };
  for (const item of items) {
    const thumb = thumbs.get(item.name);
    if (!thumb) continue;
    mergeThumbIntoStore(store, item.name, item.category, thumb);
  }
  await saveMenuThumbStore(store);
}

async function downloadOne(remoteUrl: string, dest: string): Promise<string | null> {
  try {
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists && (existing.size ?? 0) > 64) return dest;
    const result = await FileSystem.downloadAsync(remoteUrl, dest);
    if (result.status >= 200 && result.status < 300) return dest;
  } catch {
    /* ignore */
  }
  return null;
}

/**
 * Ściąga brakujące miniatury do documentDirectory (kolejka 3).
 * Zwraca mapę z podmienionymi file://.
 */
export async function downloadMenuThumbsLocally(
  items: ReadonlyArray<{ name: string; category?: string }>,
  thumbs: Map<string, MenuDishThumb>,
  onProgress?: (next: Map<string, MenuDishThumb>) => void,
): Promise<Map<string, MenuDishThumb>> {
  if (Platform.OS === 'web' || !FileSystem.documentDirectory) return thumbs;

  await ensureDir();
  const store = { ...(await loadMenuThumbStore()) };
  const next = new Map(thumbs);
  const jobs: { name: string; category?: string; thumb: MenuDishThumb }[] = [];

  for (const item of items) {
    const thumb = thumbs.get(item.name);
    if (!thumb?.slug) continue;
    if (thumb.source.uri.startsWith('file:')) continue;
    jobs.push({ name: item.name, category: item.category, thumb });
  }

  let i = 0;
  const workers = 3;
  const run = async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      const dest = destForSlug(job.thumb.slug);
      const remote = job.thumb.source.uri;
      const local = await downloadOne(remote, dest);
      if (!local) continue;
      const updated: MenuDishThumb = { ...job.thumb, source: { uri: local } };
      next.set(job.name, updated);
      mergeThumbIntoStore(store, job.name, job.category, { ...job.thumb, source: { uri: remote } }, local);
    }
  };

  await Promise.all(Array.from({ length: Math.min(workers, jobs.length) }, () => run()));
  await saveMenuThumbStore(store);
  onProgress?.(next);
  return next;
}
