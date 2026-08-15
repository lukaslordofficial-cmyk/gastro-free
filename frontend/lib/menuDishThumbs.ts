/**
 * Miniatury Menu — tylko obrazki pasujące do dań użytkownika z Supabase.
 *
 * Strategia:
 * 1) Lekki indeks (imageLibrary.json) — metadane bez require(WebP)
 * 2) Match nazwy dania → storagePath
 * 3) expo-image ładuje wyłącznie te URL-e (np. 40 zamiast 1000)
 *
 * Świadomie NIE importujemy dishImagesCatalog / productImages (setki require).
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
): Map<string, MenuDishThumb> {
  const catalog = getLightDishCatalog();
  const used = new Set<string>();
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
  const urls = [...thumbs.values()].map((t) => t.source.uri).filter(Boolean);
  if (!urls.length) return;
  let i = 0;
  const chunk = 12;
  const pump = () => {
    const slice = urls.slice(i, i + chunk);
    if (!slice.length) return;
    void Image.prefetch(slice).catch(() => {});
    i += chunk;
    if (i < urls.length) setTimeout(pump, 40);
  };
  pump();
}
