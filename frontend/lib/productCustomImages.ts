/**
 * Lokalne nadpisania zdjęć produktów magazynu — „Zmień zdjęcie” (jak dania w menu).
 *
 * Przepływ jak dishCustomImages:
 * 1) Galeria/aparat → WebP (max 1280, q≈0.8)
 * 2) documentDirectory/product-custom/{account_key}/{itemId}.webp
 * 3) AsyncStorage map itemId → file:// URI
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { getAccountKey } from '@/lib/accountKey';
import { compressDishPhotoToWebP } from '@/lib/dishCustomImages';
import { claimLegacyStorageKey, tenantStorageKey } from '@/lib/tenantStorage';

const LEGACY_KEY = '@gm/product_custom_images_v1';
const KEY_PREFIX = '@gm/product_custom_images_v1:';

export type ProductCustomImageMap = Record<string, string>;

let memory: ProductCustomImageMap | null = null;
let memoryAccountKey = '';
const listeners = new Set<() => void>();

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function storageKey(): string {
  return tenantStorageKey(KEY_PREFIX);
}

function customDir(): string {
  const base = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  const ak = (getAccountKey() || 'default').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${base}product-custom/${ak}/`;
}

async function ensureCustomDir(): Promise<string> {
  const dir = customDir();
  if (!dir) throw new Error('Brak katalogu dokumentów aplikacji.');
  const info = await FileSystem.getInfoAsync(dir);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }
  return dir;
}

function destPath(itemId: string): string {
  const safe = String(itemId || 'item').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${customDir()}${safe}.webp`;
}

export function subscribeProductCustomImages(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetProductCustomImagesMemory(): void {
  memory = null;
  memoryAccountKey = '';
  notify();
}

export async function loadProductCustomImages(): Promise<ProductCustomImageMap> {
  const ak = getAccountKey() || 'default';
  if (memory && memoryAccountKey === ak) return memory;
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
    memory = raw ? (JSON.parse(raw) as ProductCustomImageMap) : {};
    memoryAccountKey = ak;
  } catch {
    memory = {};
    memoryAccountKey = ak;
  }
  return memory;
}

export function getProductCustomImageSync(itemId: string): string | undefined {
  return memory?.[itemId];
}

export async function setProductCustomImage(itemId: string, sourceUri: string): Promise<string> {
  const id = String(itemId || '').trim();
  if (!id) throw new Error('Brak id produktu.');
  if (!sourceUri) throw new Error('Brak URI zdjęcia.');

  await ensureCustomDir();
  const compressed = await compressDishPhotoToWebP(sourceUri);
  const dest = destPath(id);

  try {
    const prev = (await loadProductCustomImages())[id];
    if (prev && prev !== dest && prev.startsWith('file://')) {
      await FileSystem.deleteAsync(prev, { idempotent: true }).catch(() => undefined);
    }
  } catch {
    /* ignore */
  }

  const existing = await FileSystem.getInfoAsync(dest);
  if (existing.exists) {
    await FileSystem.deleteAsync(dest, { idempotent: true }).catch(() => undefined);
  }
  await FileSystem.copyAsync({ from: compressed.uri, to: dest });

  const map = await loadProductCustomImages();
  map[id] = dest;
  memory = { ...map };
  memoryAccountKey = getAccountKey() || 'default';
  await AsyncStorage.setItem(storageKey(), JSON.stringify(memory));
  notify();
  return dest;
}

export async function clearProductCustomImage(itemId: string): Promise<void> {
  const map = await loadProductCustomImages();
  if (!(itemId in map)) return;
  const uri = map[itemId];
  delete map[itemId];
  memory = { ...map };
  memoryAccountKey = getAccountKey() || 'default';
  await AsyncStorage.setItem(storageKey(), JSON.stringify(memory));
  if (uri && uri.startsWith('file://')) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }
  notify();
}
