/**
 * Lokalne nadpisania zdjęć dań (AsyncStorage) — „Zmień zdjęcie”.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@gm/dish_custom_images_v1';

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

export async function setDishCustomImage(dishId: string, uri: string): Promise<void> {
  const map = await loadDishCustomImages();
  map[dishId] = uri;
  memory = { ...map };
  await AsyncStorage.setItem(KEY, JSON.stringify(memory));
  notify();
}

export async function clearDishCustomImage(dishId: string): Promise<void> {
  const map = await loadDishCustomImages();
  if (!(dishId in map)) return;
  delete map[dishId];
  memory = { ...map };
  await AsyncStorage.setItem(KEY, JSON.stringify(memory));
  notify();
}
