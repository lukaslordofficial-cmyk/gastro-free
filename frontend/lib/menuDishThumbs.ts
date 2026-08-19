/**
 * Miniatury Menu — tylko obrazki pasujące do dań użytkownika z Supabase.
 *
 * Strategia:
 * 1) Lekki indeks (imageLibrary.json) — metadane bez require(WebP)
 * 2) Match nazwy dania → storagePath (batch, nie po 1 w pętli)
 * 3) expo-image ładuje URL-e z Supabase (cache memory-disk)
 */
import { Image } from 'expo-image';
import { findDishImageMatch } from '@/lib/dishImageMatch';
import { loadImageLibrary } from '@/lib/imageLibrary';

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '');
const PRODUCT_ICONS_BUCKET = 'product-icons';

export type MenuDishThumb = {
  source: { uri: string };
  slug: string;
  matchTier?: 'exact' | 'tags' | 'category';
  placeholderLabel?: string;
  score?: number;
};

type LightDishEntry = {
  slug: string;
  category: string;
  labelPl: string;
  aliases: string[];
  storagePath: string;
  localAsset: number;
  cooked: boolean;
  menuFamily: string;
};

function publicDishUrl(storagePath: string): string | null {
  if (!SUPABASE_URL || !storagePath) return null;
  return `${SUPABASE_URL}/storage/v1/object/public/${PRODUCT_ICONS_BUCKET}/${storagePath}`;
}

function inferFamily(storagePath: string, slug = ''): string {
  const p = `${storagePath} ${slug}`.toLowerCase();
  if (/soup|zupa/.test(p)) return 'zupy';
  if (/burger|sandwich/.test(p)) return 'burgery';
  if (/pasta|makaron/.test(p)) return 'makarony';
  if (/pizza/.test(p)) return 'pizze';
  if (/salad|salatk/.test(p)) return 'salatki';
  if (/starter|app|przystawk|bruschett/.test(p)) return 'przystawki';
  if (/side|dodatk|surowk|coleslaw|warzywa_grill/.test(p)) return 'sides';
  if (/kebab|shawarma/.test(p)) return 'kebab';
  if (/sushi|nigiri|maki/.test(p)) return 'sushi';
  if (/bbq|ribs|grill|steak|roast|mieso|kotlet|schab/.test(p)) return 'bbq';
  if (/asian|pad_thai|ramen|wok|stir/.test(p)) return 'azjatycka';
  if (/indian|curry|tikka|butter_chicken/.test(p)) return 'indyjska';
  if (/mexican|taco|burrito/.test(p)) return 'meksykanska';
  if (/mediterr|paella|caucas|chaczapuri/.test(p)) return 'srodziemnomorska';
  if (/fish|ryb|losos|seafood/.test(p)) return 'rybne';
  if (/vegan|wege|tofu/.test(p)) return 'wege';
  if (/breakfast|sniadan|jajeczn/.test(p)) return 'sniadania';
  if (/sauce|sos|dip/.test(p)) return 'sosy';
  if (/dessert|cake|ice_cream|pancake|pastr|coffee|tea|lemonad|juice|cocktail|beer|wine|spirit|energy|napoj/.test(p)) {
    if (/coffee|tea|lemonad|juice|cocktail|beer|wine|spirit|energy/.test(p)) return 'napoje';
    return 'desery';
  }
  if (/dinner|obiad|polish|roast/.test(p)) return 'miesa';
  return 'inne';
}

let lightCatalog: LightDishEntry[] | null = null;

function getLightDishCatalog(): LightDishEntry[] {
  if (lightCatalog) return lightCatalog;
  const library = loadImageLibrary();
  lightCatalog = library.map((lib) => {
    const family = inferFamily(lib.storagePath, lib.slug);
    return {
      slug: lib.slug,
      category: family,
      labelPl: lib.primaryName,
      aliases: [...(lib.aliases || [])],
      storagePath: lib.storagePath,
      localAsset: 0,
      cooked: true,
      menuFamily: family,
    };
  });
  return lightCatalog;
}

/**
 * Dopasuj miniatury tylko do listy dań użytkownika (np. 40 pozycji z Supabase).
 */
export function assignMenuDishThumbs(
  items: ReadonlyArray<{ name: string; category?: string }>,
  opts?: { excludeSlugs?: Set<string> },
): Map<string, MenuDishThumb> {
  const catalog = getLightDishCatalog();
  const used = new Set(opts?.excludeSlugs || []);
  const out = new Map<string, MenuDishThumb>();

  for (const item of items) {
    if (!item.name || out.has(item.name)) continue;
    const match = findDishImageMatch(item.name, catalog as any, {
      menuCategory: item.category,
      excludeSlugs: used,
    });
    if (!match) continue;
    if (match.tier === 'category' && match.score < 70) continue;
    const uri = publicDishUrl(match.entry.storagePath);
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

/** Prefetch tylko dopasowanych URL-i (nie całego katalogu). */
export function prefetchMenuDishThumbs(thumbs: Map<string, MenuDishThumb>): void {
  const urls = [...thumbs.values()]
    .map((t) => t.source.uri)
    .filter((u) => u && u.startsWith('http'));
  if (!urls.length) return;
  let i = 0;
  const chunk = 10;
  const pump = () => {
    const slice = urls.slice(i, i + chunk);
    if (!slice.length) return;
    void Image.prefetch(slice).catch(() => {});
    i += chunk;
    if (i < urls.length) setTimeout(pump, 60);
  };
  pump();
}

function yieldFrame(ms = 16): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Szybka ścieżka: cache z dysku → batch match brakujących → prefetch URL.
 * Pobieranie plików lokalnie leci w tle (nie blokuje UI).
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

  const out = new Map(opts?.seed || (await hydrateMenuThumbsFromDisk(items)));
  if (opts?.cancelled?.()) return out;
  opts?.onUpdate?.(out);

  const missing = items.filter((it) => it.name && !out.has(it.name));
  if (missing.length) {
    await yieldFrame(24);
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
    void downloadMenuThumbsLocally(items, out, opts?.onUpdate, { maxJobs: 20 }).catch(() => {});
  }

  return out;
}
