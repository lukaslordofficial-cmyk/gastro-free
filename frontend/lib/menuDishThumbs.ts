/**
 * Miniatury Menu — dopasowanie nazwy dania → obraz z Supabase (imageLibrary.json).
 */
import { Image } from 'expo-image';
import type { DishImageEntry } from '@/lib/dishImagesCatalog';
import { findDishImageMatch } from '@/lib/dishImageMatch';
import { loadImageLibrary } from '@/lib/imageLibrary';
import { publicIconUrl } from '@/lib/productImages';

export type MenuDishThumb = {
  source: { uri: string };
  slug: string;
  matchTier?: 'exact' | 'tags' | 'category';
  placeholderLabel?: string;
  score?: number;
};

let lightCatalog: DishImageEntry[] | null = null;

function getLightDishCatalog(): DishImageEntry[] {
  if (lightCatalog) return lightCatalog;
  lightCatalog = loadImageLibrary().map((lib) => ({
    slug: lib.slug,
    category: lib.category || 'inne',
    labelPl: lib.primaryName,
    aliases: [...(lib.aliases || [])],
    storagePath: lib.storagePath,
    localAsset: 0,
    cooked: true,
    menuFamily: lib.category || 'inne',
  })) as DishImageEntry[];
  return lightCatalog;
}

/** Publiczny URL miniatury (zawsze http/https gdy bucket skonfigurowany). */
export function menuDishThumbUrl(storagePath: string): string | null {
  return publicIconUrl(storagePath);
}

/** Dopasuj miniatury do listy dań użytkownika (batch, bez blokowania UI). */
export function assignMenuDishThumbs(
  items: ReadonlyArray<{ name: string; category?: string }>,
  opts?: { excludeSlugs?: Set<string> },
): Map<string, MenuDishThumb> {
  const catalog = getLightDishCatalog();
  const used = new Set(opts?.excludeSlugs || []);
  const out = new Map<string, MenuDishThumb>();

  for (const item of items) {
    if (!item.name || out.has(item.name)) continue;
    const match = findDishImageMatch(item.name, catalog, {
      menuCategory: item.category,
      excludeSlugs: used,
    });
    if (!match) continue;
    if (match.tier === 'category' && match.score < 70) continue;
    const uri = menuDishThumbUrl(match.entry.storagePath);
    if (!uri) continue;
    used.add(match.slug);
    out.set(item.name, {
      source: { uri },
      slug: match.slug,
      matchTier: match.tier,
      placeholderLabel: match.placeholderLabel,
      score: match.score,
    });
  }
  return out;
}

export function prefetchMenuDishThumbs(thumbs: Map<string, MenuDishThumb>): void {
  const urls = [...thumbs.values()]
    .map((t) => t.source.uri)
    .filter((u) => u.startsWith('http'));
  if (!urls.length) return;
  let i = 0;
  const chunk = 12;
  const pump = () => {
    const slice = urls.slice(i, i + chunk);
    if (!slice.length) return;
    void Image.prefetch(slice).catch(() => {});
    i += chunk;
    if (i < urls.length) setTimeout(pump, 50);
  };
  pump();
}

function yieldFrame(ms = 16): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 1) Synchroniczne dopasowanie (natychmiastowe URL-e)
 * 2) Cache z dysku (AsyncStorage)
 * 3) Prefetch + opcjonalny zapis lokalny w tle
 */
export async function assignAndCacheMenuThumbs(
  items: ReadonlyArray<{ name: string; category?: string }>,
  opts?: {
    seed?: Map<string, MenuDishThumb>;
    onUpdate?: (map: Map<string, MenuDishThumb>) => void;
    cancelled?: () => boolean;
  },
): Promise<Map<string, MenuDishThumb>> {
  const {
    hydrateMenuThumbsFromDisk,
    persistMenuThumbMatches,
    downloadMenuThumbsLocally,
    notifyMenuThumbsNow,
  } = await import('@/lib/menuThumbCache');

  const out = new Map<string, MenuDishThumb>(opts?.seed);

  // Natychmiastowe dopasowanie — bez czekania na AsyncStorage
  const quick = assignMenuDishThumbs(items, {
    excludeSlugs: new Set([...out.values()].map((t) => t.slug)),
  });
  if (quick.size) {
    for (const [name, thumb] of quick) {
      if (!out.has(name)) out.set(name, thumb);
    }
    notifyMenuThumbsNow();
    opts?.onUpdate?.(new Map(out));
  }

  if (opts?.cancelled?.()) return out;

  const fromDisk = await hydrateMenuThumbsFromDisk(items);
  for (const [name, thumb] of fromDisk) {
    if (!out.has(name)) out.set(name, thumb);
  }
  if (fromDisk.size) {
    notifyMenuThumbsNow();
    opts?.onUpdate?.(new Map(out));
  }

  if (opts?.cancelled?.()) return out;

  const missing = items.filter((it) => it.name && !out.has(it.name));
  if (missing.length) {
    await yieldFrame(16);
    if (opts?.cancelled?.()) return out;
    const used = new Set([...out.values()].map((t) => t.slug));
    const batch = assignMenuDishThumbs(missing, { excludeSlugs: used });
    if (batch.size) {
      for (const [name, thumb] of batch) out.set(name, thumb);
      await persistMenuThumbMatches(missing, batch);
      notifyMenuThumbsNow();
      opts?.onUpdate?.(new Map(out));
    }
  }

  prefetchMenuDishThumbs(out);

  if (!opts?.cancelled?.()) {
    void downloadMenuThumbsLocally(items, out, opts?.onUpdate, { maxJobs: 16 }).catch(() => {});
  }

  return out;
}
