/**
 * Lokalny cache miniaturek dań (Supabase → plik na urządzeniu).
 * Lista dań jest niezależna — ten moduł dotyczy tylko obrazków.
 */
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { Image } from 'expo-image';
import type { MenuDishThumb } from '@/lib/menuDishThumbs';

const MAP_KEY = '@gm/menu_thumbs_v4';

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

function notifySoon(delayMs = 120) {
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
  }, delayMs);
}

export function notifyMenuThumbsNow() {
  if (notifyTimer) {
    clearTimeout(notifyTimer);
    notifyTimer = null;
  }
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
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

function isSuspiciousLocalUri(uri: string | undefined): boolean {
  if (!uri || !uri.startsWith('file:')) return true;
  const lower = uri.toLowerCase();
  return lower.endsWith('.bin') || lower.endsWith('.tmp') || lower.endsWith('.download');
}

function toThumb(row: StoredThumb, preferRemote = false): MenuDishThumb | null {
  const remote = (row.remoteUrl || '').trim();
  const local = (row.localUri || '').trim();
  let uri = remote;
  if (!preferRemote && local && !isSuspiciousLocalUri(local)) {
    uri = local;
  }
  if (!uri) return null;
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
    // Migruj stare wpisy v3 — usuń podejrzane pliki lokalne.
    let dirty = false;
    for (const [key, row] of Object.entries(store)) {
      if (!row || typeof row !== 'object') continue;
      if (row.localUri && isSuspiciousLocalUri(row.localUri)) {
        delete row.localUri;
        store[key] = row;
        dirty = true;
      }
    }
    if (dirty) {
      try {
        await AsyncStorage.setItem(MAP_KEY, JSON.stringify(store));
      } catch {
        /* ignore */
      }
    }
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

async function localFileUsable(uri: string): Promise<boolean> {
  if (isSuspiciousLocalUri(uri)) return false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return !!(info.exists && (info.size ?? 0) > 200);
  } catch {
    return false;
  }
}

export async function hydrateMenuThumbsFromDisk(
  items: ReadonlyArray<{ name: string; category?: string }>,
): Promise<Map<string, MenuDishThumb>> {
  await loadMenuThumbStore();
  const out = new Map<string, MenuDishThumb>();
  let dirty = false;

  for (const item of items) {
    const row = rowForItem(item.name, item.category);
    if (!row?.remoteUrl && !row?.localUri) continue;

    let useRemote = true;
    if (Platform.OS !== 'web' && row.localUri && !isSuspiciousLocalUri(row.localUri)) {
      if (await localFileUsable(row.localUri)) {
        useRemote = false;
      } else if (row.localUri) {
        delete row.localUri;
        const key = dishKey(item.name, item.category);
        store[key] = row;
        store[item.name] = row;
        dirty = true;
      }
    }

    const thumb = toThumb(row, useRemote);
    if (!thumb) continue;
    out.set(item.name, thumb);
    putMemory(item.name, thumb);
  }

  if (dirty) await persistStore();
  notifyMenuThumbsNow();
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
  if (!remote) return;
  store[key] = {
    slug: thumb.slug,
    remoteUrl: remote,
    localUri: localUri && !isSuspiciousLocalUri(localUri) ? localUri : prev?.localUri,
    matchTier: thumb.matchTier,
    placeholderLabel: thumb.placeholderLabel,
    score: thumb.score,
  };
  store[name] = store[key];
  const resolved = toThumb(store[key], !store[key].localUri) || thumb;
  putMemory(name, resolved);
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
    if (existing.exists && (existing.size ?? 0) > 200) return dest;
    const result = await FileSystem.downloadAsync(remoteUrl, dest);
    if (result.status >= 200 && result.status < 300) {
      const info = await FileSystem.getInfoAsync(dest);
      if ((info.size ?? 0) > 200) return dest;
    }
  } catch {
    /* fallback below */
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
      if (info.exists && (info.size ?? 0) > 200) return dest;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Tło: zapis plików lokalnie (UI już pokazuje remote URL). */
export async function downloadMenuThumbsLocally(
  items: ReadonlyArray<{ name: string; category?: string }>,
  thumbs: Map<string, MenuDishThumb>,
  onProgress?: (next: Map<string, MenuDishThumb>) => void,
  opts?: { maxJobs?: number },
): Promise<Map<string, MenuDishThumb>> {
  if (Platform.OS === 'web') return thumbs;
  const ok = await ensureDir();
  if (!ok) return thumbs;

  await loadMenuThumbStore();
  const next = new Map(thumbs);
  const jobs: { name: string; category?: string; thumb: MenuDishThumb }[] = [];
  const maxJobs = opts?.maxJobs ?? 16;

  for (const item of items) {
    if (jobs.length >= maxJobs) break;
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
      mergeThumbIntoStore(job.name, job.category, job.thumb, local);
    }
    if (i > 0 && i % 4 === 0) {
      onProgress?.(new Map(next));
      notifySoon(80);
      await new Promise((r) => setTimeout(r, 12));
    }
  }

  if (jobs.length) await persistStore();
  onProgress?.(next);
  notifySoon();
  return next;
}
