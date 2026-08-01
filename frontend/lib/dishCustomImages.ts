/**
 * Lokalne nadpisania zdjęć dań — „Zmień zdjęcie”.
 *
 * Przepływ:
 * 1) PNG/JPG/HEIC z galerii/aparatu → resize (max krawędź 1280) + WebP ~0.8
 * 2) Zapis do FileSystem documentDirectory/dish-custom/{dishId}.webp
 * 3) Mapowanie dishId → file:// URI w AsyncStorage (@gm/dish_custom_images_v1)
 *
 * Nie wysyłamy do Supabase w tym przebiegu — tylko lokalnie na urządzeniu.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

const KEY = '@gm/dish_custom_images_v1';
const MAX_EDGE = 1280;
const WEBP_QUALITY = 0.8;

export type DishCustomImageMap = Record<string, string>;

let memory: DishCustomImageMap | null = null;
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

function customDir(): string {
  const base = FileSystem.documentDirectory || FileSystem.cacheDirectory || '';
  return `${base}dish-custom/`;
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

function destPath(dishId: string): string {
  const safe = String(dishId || 'dish').replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${customDir()}${safe}.webp`;
}

/**
 * Kompresja uploadu użytkownika do lekkiego WebP (max krawędź 1280, quality 0.8).
 * Zwraca URI w cache — caller przenosi do documentDirectory.
 */
export async function compressDishPhotoToWebP(sourceUri: string): Promise<{
  uri: string;
  width: number;
  height: number;
}> {
  const probe = await manipulateAsync(sourceUri, [], {
    compress: 1,
    format: SaveFormat.JPEG,
  });
  const maxDim = Math.max(probe.width || 0, probe.height || 0);
  const actions =
    maxDim > MAX_EDGE
      ? probe.width >= probe.height
        ? [{ resize: { width: MAX_EDGE } }]
        : [{ resize: { height: MAX_EDGE } }]
      : [];
  const out = await manipulateAsync(probe.uri, actions, {
    compress: WEBP_QUALITY,
    format: SaveFormat.WEBP,
  });
  return { uri: out.uri, width: out.width, height: out.height };
}

export function subscribeDishCustomImages(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export async function loadDishCustomImages(): Promise<DishCustomImageMap> {
  if (memory) return memory;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    memory = raw ? (JSON.parse(raw) as DishCustomImageMap) : {};
  } catch {
    memory = {};
  }
  return memory;
}

export function getDishCustomImageSync(dishId: string): string | undefined {
  return memory?.[dishId];
}

/**
 * Konwertuje źródło do WebP, zapisuje w documentDirectory i aktualizuje mapę.
 * Stary plik (jeśli był) jest usuwany.
 */
export async function setDishCustomImage(dishId: string, sourceUri: string): Promise<string> {
  const id = String(dishId || '').trim();
  if (!id) throw new Error('Brak id dania.');
  if (!sourceUri) throw new Error('Brak URI zdjęcia.');

  await ensureCustomDir();
  const compressed = await compressDishPhotoToWebP(sourceUri);
  const dest = destPath(id);

  try {
    const prev = (await loadDishCustomImages())[id];
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

  const map = await loadDishCustomImages();
  map[id] = dest;
  memory = { ...map };
  await AsyncStorage.setItem(KEY, JSON.stringify(memory));
  notify();
  return dest;
}

export async function clearDishCustomImage(dishId: string): Promise<void> {
  const map = await loadDishCustomImages();
  if (!(dishId in map)) return;
  const uri = map[dishId];
  delete map[dishId];
  memory = { ...map };
  await AsyncStorage.setItem(KEY, JSON.stringify(memory));
  if (uri && uri.startsWith('file://')) {
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }
  notify();
}
