/**
 * Typy + loader imageLibrary.json (metadane tagów do waterfall matchingu).
 * Grafiki nadal pochodzą z DISH_IMAGE_CATALOG (localAsset require).
 */
export type ImageLibraryEntry = {
  id: string;
  slug: string;
  fileName: string;
  relativePath?: string;
  storagePath: string;
  primaryName: string;
  aliases?: string[];
  category: string;
  folder?: string;
  fallbackTags: string[];
  forbiddenTags: string[];
};

export type ImageLibraryFile = {
  version: number;
  generatedAt?: string;
  count: number;
  packagingExcluded?: boolean;
  images: ImageLibraryEntry[];
};

let cached: ImageLibraryEntry[] | null = null;
let bySlug: Map<string, ImageLibraryEntry> | null = null;

export function loadImageLibrary(): ImageLibraryEntry[] {
  if (cached) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require('@/assets/premium/imageLibrary.json') as ImageLibraryFile;
    cached = Array.isArray(raw?.images) ? raw.images : [];
  } catch {
    cached = [];
  }
  bySlug = new Map(cached.map((e) => [e.slug, e]));
  return cached;
}

export function getLibraryEntryBySlug(slug: string): ImageLibraryEntry | undefined {
  if (!bySlug) loadImageLibrary();
  return bySlug?.get(slug);
}

/** Reset cache (testy / hot reload). */
export function clearImageLibraryCache(): void {
  cached = null;
  bySlug = null;
}
