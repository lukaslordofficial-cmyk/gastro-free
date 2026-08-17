/**
 * Lokalny cache miniaturek dań (Supabase → plik na urządzeniu).
 * Nazwy dań w liście NIE zależą od tego modułu — tylko obrazki.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import type { MenuDishThumb } from '@/lib/menuDishThumbs';

const MAP_KEY = '@gm/menu_thumbs_v3';

export type StoredThumb = {
  slug: string;
  remoteUrl: string;
  localUri?: string;
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

function notifySoon() {
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
  }, 280);
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

function cacheDir(): string {
  const base = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  return `${base}menu-thumbs/`;
}

function extFromUrl(url: string): string {
  const path = (url.split('?')[0] || '').toLowerCase();
  if (path.endsWith('.png')) return 'png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'jpg';
  if (path.endsWith('.webp')) return 'webp';
  if (path.endsWith('.gif')) return 'gif';
  return 'webp';
}

function safeSlug(slug: string): string {
  return String(slug || 'img').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
}

function destForSlug(slug: string, remoteUrl: string): string {
  return `${cacheDir()}${safeSlug(slug)}.${extFromUrl(remoteUrl)}`;
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

function putMemory(name: string, thumb: MenuDishThumb) {
  thumbsByName.set(name, thumb);
}

async function ensureDir(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const dir = cacheDir();
  if (!dir) return false;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
    }
    return true;
  } catch {
    return false;
  }
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
    if (!row?.remoteUrl && !row?.localUri) continue;

    if (Platform.OS !== 'web' && row.localUri) {
      try {
        const info = await FileSystem.getInfoAsync(row.localUri);
        if (info.exists && (info.size ?? 0) > 64) {
          const thumb = toThumb(row);
          out.set(item.name, thumb);
          putMemory(item.name, thumb);
          continue;
        }
      } catch {
        /* use remote */
      }
    }

    const thumb = toThumb({ ...row, localUri: undefined });
    out.set(item.name, thumb);
    putMemory(item.name, thumb);
  }

  notifySoon();
  return out;
}

function mergeThumbIntoStore(
  name: string,
  category: string | undefined,
  thumb: MenuDishThumb,
  localUri?: string,
) {
  const key = dishKey(name, category);
  const prev = store[key] || store[name];
  const remote = thumb.source.uri.startsWith('file:')
    ? prev?.remoteUrl || ''
    : thumb.source.uri;
  store[key] = {
    slug: thumb.slug,
    remoteUrl: remote,
    localUri: localUri || prev?.localUri,
    matchTier: thumb.matchTier,
    placeholderLabel: thumb.placeholderLabel,
    score: thumb.score,
  };
  store[name] = store[key];
  putMemory(name, toThumb(store[key]));
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
  notifySoon();
}

export async function persistOneMenuThumb(
  name: string,
  category: string | undefined,
  thumb: MenuDishThumb,
  localUri?: string,
): Promise<void> {
  await loadMenuThumbStore();
  mergeThumbIntoStore(name, category, thumb, localUri);
  await persistStore();
  notifySoon();
}

async function downloadOne(remoteUrl: string, dest: string): Promise<string | null> {
  try {
    const existing = await FileSystem.getInfoAsync(dest);
    if (existing.exists && (existing.size ?? 0) > 64) return dest;
    const result = await FileSystem.downloadAsync(remoteUrl, dest);
    if (result.status >= 200 && result.status < 300) {
      const info = await FileSystem.getInfoAsync(dest);
      if ((info.size ?? 0) > 64) return dest;
    }
  } catch {
    /* try expo-image cache */
  }
  try {
    await Image.prefetch(remoteUrl);
    const cached =
      typeof (Image as { getCachePathAsync?: (u: string) => Promise<string | null> }).getCachePathAsync ===
      'function'
        ? await (Image as { getCachePathAsync: (u: string) => Promise<string | null> }).getCachePathAsync(
            remoteUrl,
          )
        : null;
    if (cached) {
      await FileSystem.copyAsync({ from: cached, to: dest }).catch(async () => {
        await FileSystem.downloadAsync(cached.startsWith('file:') ? cached : remoteUrl, dest);
      });
      const info = await FileSystem.getInfoAsync(dest);
      if (info.exists && (info.size ?? 0) > 64) return dest;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export async function downloadMenuThumbsLocally(
  items: ReadonlyArray<{ name: string; category?: string }>,
  thumbs: Map<string, MenuDishThumb>,
  onProgress?: (next: Map<string, MenuDishThumb>) => void,
): Promise<Map<string, MenuDishThumb>> {
  if (Platform.OS === 'web') return thumbs;
  const ok = await ensureDir();
  if (!ok) return thumbs;

  await loadMenuThumbStore();
  const next = new Map(thumbs);
  const jobs: { name: string; category?: string; thumb: MenuDishThumb }[] = [];

  for (const item of items) {
    const thumb = thumbs.get(item.name) || thumbsByName.get(item.name);
    if (!thumb?.slug) continue;
    if (thumb.source.uri.startsWith('file:')) continue;
    const remote = thumb.source.uri;
    if (!remote.startsWith('http')) continue;
    jobs.push({ name: item.name, category: item.category, thumb: { ...thumb, source: { uri: remote } } });
  }

  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i];
    const dest = destForSlug(job.thumb.slug, job.thumb.source.uri);
    const local = await downloadOne(job.thumb.source.uri, dest);
    if (local) {
      const updated: MenuDishThumb = { ...job.thumb, source: { uri: local } };
      next.set(job.name, updated);
      await persistOneMenuThumb(job.name, job.category, job.thumb, local);
    } else {
      await persistOneMenuThumb(job.name, job.category, job.thumb);
    }
    if (i < jobs.length - 1) {
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  onProgress?.(next);
  notifySoon();
  return next;
}
