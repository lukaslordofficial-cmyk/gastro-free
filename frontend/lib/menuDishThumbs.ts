/**
 * Miniatury Menu — szybkie i lekkie.
 *
 * Dlaczego lokalne assety (nie Supabase URL):
 * bucket product-icons ma składniki (mieso/…), ale NIE ma folderu dania/…
 * Obrazy dań są w assets/premium/dishes — ładujemy je LAZY per folder (~25 WebP).
 *
 * Zasady:
 * 1) Lekki JSON (imageLibrary) — match bez waterfall
 * 2) resolveDishLocalAsset(folder) — tylko foldery użyte w menu użytkownika
 * 3) Partie + yield — lista nie zamarza
 */
import { InteractionManager } from 'react-native';
import { loadImageLibrary, type ImageLibraryEntry } from '@/lib/imageLibrary';
import { resolveDishLocalAsset, warmDishAssetFolder } from '@/lib/dishAssets';

export type MenuDishThumb = {
  /** Lokalny require id LUB { uri } (własne zdjęcie użytkownika / rare remote) */
  source: number | { uri: string };
  slug: string;
  relativePath?: string;
  matchTier?: 'exact' | 'tags' | 'category';
  placeholderLabel?: string;
  score?: number;
};

type IndexedEntry = {
  slug: string;
  storagePath: string;
  relativePath: string;
  primaryName: string;
  labels: string[];
  tokens: string[];
  folder: string;
};

const STOP = new Set([
  'a', 'i', 'z', 'ze', 'w', 'na', 'do', 'od', 'po', 'dla', 'the', 'of', 'and', 'with', 'de', 'la',
]);

function normalize(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .replace(/ą/g, 'a')
    .replace(/ę/g, 'e')
    .replace(/ó/g, 'o')
    .replace(/ń/g, 'n')
    .replace(/ś/g, 's')
    .replace(/ć/g, 'c')
    .replace(/ź|ż/g, 'z')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokensOf(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

function toRelativePath(lib: { storagePath?: string; relativePath?: string; folder?: string; fileName?: string }): string {
  if (lib.relativePath) return String(lib.relativePath).replace(/^dania\//, '');
  const sp = String(lib.storagePath || '').replace(/^dania\//, '');
  if (sp.includes('/')) return sp;
  if (lib.folder && lib.fileName) return `${lib.folder}/${lib.fileName}`;
  return sp;
}

function categoryPlaceholderLabel(category?: string): string {
  const c = (category || '').trim();
  return c ? `Kategoria: ${c}` : 'Podobne danie';
}

function folderCandidates(category?: string, nameHint?: string): string[] {
  const c = normalize(`${category || ''} ${nameHint || ''}`);
  if (!c) return [];
  if (/zup|soup/.test(c)) return ['soups_pl', 'soups_polish', 'soups_asia'];
  if (/burger|kanapk/.test(c)) return ['burgers'];
  if (/makaron|pasta/.test(c)) return ['pastas'];
  if (/pizz/.test(c)) return ['pizzas'];
  if (/salat/.test(c)) return ['salads'];
  if (/przystawk|starter|app/.test(c)) return ['apps', 'starters'];
  if (/dodatk|side|frytk/.test(c)) return ['sides'];
  if (/deser|ciasto|lody|cake|ice/.test(c)) {
    return ['desserts_cups', 'cakes', 'ice_cream', 'pastries', 'pancakes', 'french_desserts'];
  }
  if (/napoj|drink|kawa|herbata|piwo|wino|sok/.test(c)) {
    return ['coffees', 'teas', 'juices', 'lemonades', 'beers', 'wines', 'spirits', 'cocktails', 'energy_drinks'];
  }
  if (/sniadan|breakfast|jajecz/.test(c)) return ['breakfast'];
  if (/kebab/.test(c)) return ['kebabs'];
  if (/sushi/.test(c)) return ['sushi'];
  if (/azjat|ramen|wok|pad/.test(c)) return ['asian'];
  if (/indysk|curry/.test(c)) return ['indian'];
  if (/meksyk|taco|burrito/.test(c)) return ['mexican'];
  if (/ryb|fish|losos/.test(c)) return ['fish'];
  if (/pierog|dumpling/.test(c)) return ['dumplings'];
  if (/grill|bbq|steak/.test(c)) return ['bbq', 'roasts'];
  if (/mieso|obiad|danie|polish|polsk/.test(c)) return ['dinners', 'polish', 'roasts', 'bbq'];
  return ['dinners', 'polish', 'apps'];
}

type FastIndex = {
  entries: IndexedEntry[];
  byLabel: Map<string, IndexedEntry>;
  byToken: Map<string, IndexedEntry[]>;
  byFolder: Map<string, IndexedEntry[]>;
};

let fastIndex: FastIndex | null = null;

function buildFastIndex(): FastIndex {
  if (fastIndex) return fastIndex;
  const library = loadImageLibrary();
  const entries: IndexedEntry[] = [];
  const byLabel = new Map<string, IndexedEntry>();
  const byToken = new Map<string, IndexedEntry[]>();
  const byFolder = new Map<string, IndexedEntry[]>();

  for (const lib of library) {
    const relativePath = toRelativePath(lib);
    if (!relativePath || /packag|opakowan|karton|crate/i.test(relativePath)) continue;
    const labels = [lib.primaryName, ...(lib.aliases || [])]
      .map((x) => normalize(String(x)))
      .filter(Boolean);
    const tokenSet = new Set<string>();
    for (const l of labels) {
      for (const t of tokensOf(l)) tokenSet.add(t);
    }
    const folder = String(lib.folder || relativePath.split('/')[0] || '').toLowerCase();
    const entry: IndexedEntry = {
      slug: lib.slug,
      storagePath: lib.storagePath,
      relativePath,
      primaryName: lib.primaryName,
      labels,
      tokens: [...tokenSet],
      folder,
    };
    entries.push(entry);
    for (const l of labels) {
      if (!byLabel.has(l)) byLabel.set(l, entry);
    }
    for (const t of entry.tokens) {
      const arr = byToken.get(t);
      if (arr) arr.push(entry);
      else byToken.set(t, [entry]);
    }
    if (folder) {
      const arr = byFolder.get(folder);
      if (arr) arr.push(entry);
      else byFolder.set(folder, [entry]);
    }
  }

  fastIndex = { entries, byLabel, byToken, byFolder };
  return fastIndex;
}

function scoreTokenOverlap(qTokens: string[], entry: IndexedEntry): number {
  if (!qTokens.length || !entry.tokens.length) return 0;
  const et = new Set(entry.tokens);
  let hit = 0;
  for (const t of qTokens) if (et.has(t)) hit += 1;
  if (!hit) return 0;
  const precision = hit / qTokens.length;
  const recall = hit / entry.tokens.length;
  return Math.round(100 * (0.65 * precision + 0.35 * recall) + hit * 4);
}

function thumbFromEntry(
  entry: IndexedEntry,
  meta: { matchTier: MenuDishThumb['matchTier']; score: number; placeholderLabel?: string },
): MenuDishThumb | null {
  const local = resolveDishLocalAsset(entry.relativePath);
  if (local == null) return null;
  return {
    source: local,
    slug: entry.slug,
    relativePath: entry.relativePath,
    matchTier: meta.matchTier,
    placeholderLabel: meta.placeholderLabel,
    score: meta.score,
  };
}

export function matchDishThumbFast(
  name: string,
  opts?: { menuCategory?: string; excludeSlugs?: Set<string> },
): MenuDishThumb | null {
  const q = normalize(name);
  if (!q) return null;
  const idx = buildFastIndex();
  const excluded = opts?.excludeSlugs;

  const exact = idx.byLabel.get(q);
  if (exact && !excluded?.has(exact.slug)) {
    const thumb = thumbFromEntry(exact, { matchTier: 'exact', score: 100 });
    if (thumb) return thumb;
  }

  const qTokens = tokensOf(q);
  const candidates = new Map<string, IndexedEntry>();
  for (const t of qTokens) {
    const list = idx.byToken.get(t);
    if (!list) continue;
    for (const e of list) {
      if (excluded?.has(e.slug)) continue;
      candidates.set(e.slug, e);
    }
  }

  let best: { entry: IndexedEntry; score: number } | null = null;
  for (const entry of candidates.values()) {
    const score = scoreTokenOverlap(qTokens, entry);
    if (score < 48) continue;
    if (!best || score > best.score) best = { entry, score };
  }

  if (best) {
    // Słabe overlap (np. pojedynczy wspólny token) — nie bierz z obcego folderu
    const folders = folderCandidates(opts?.menuCategory, name);
    if (best.score < 62 && folders.length && !folders.includes(best.entry.folder)) {
      best = null;
    }
  }

  if (best) {
    const thumb = thumbFromEntry(best.entry, {
      matchTier: best.score >= 72 ? 'exact' : 'tags',
      score: best.score,
      placeholderLabel: best.score >= 72 ? undefined : categoryPlaceholderLabel(opts?.menuCategory),
    });
    if (thumb) return thumb;
  }

  const folders = folderCandidates(opts?.menuCategory, name);
  for (const folder of folders) {
    warmDishAssetFolder(folder);
    const pool = idx.byFolder.get(folder) || [];
    for (const entry of pool) {
      if (excluded?.has(entry.slug)) continue;
      const thumb = thumbFromEntry(entry, {
        matchTier: 'category',
        score: 40,
        placeholderLabel: categoryPlaceholderLabel(opts?.menuCategory),
      });
      if (thumb) return thumb;
    }
  }

  return null;
}

export function assignMenuDishThumbs(
  items: ReadonlyArray<{ name: string; category?: string }>,
): Map<string, MenuDishThumb> {
  buildFastIndex();
  const used = new Set<string>();
  const out = new Map<string, MenuDishThumb>();
  for (const item of items) {
    if (!item.name || out.has(item.name)) continue;
    const thumb = matchDishThumbFast(item.name, {
      menuCategory: item.category,
      excludeSlugs: used,
    });
    if (!thumb) continue;
    used.add(thumb.slug);
    out.set(item.name, thumb);
  }
  return out;
}

function yieldMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Dopasuj TYLKO brakujące dania (pierwsze przypisanie).
 * Gdy seed już pokrywa listę — natychmiastowy return, bez imageLibrary / indeksu.
 */
export async function assignMenuDishThumbsProgressive(
  items: ReadonlyArray<{ name: string; category?: string }>,
  opts?: {
    priorityNames?: ReadonlySet<string> | string[];
    seed?: Map<string, MenuDishThumb>;
    onBatch?: (map: Map<string, MenuDishThumb>) => void;
    cancelled?: () => boolean;
    chunkSize?: number;
  },
): Promise<Map<string, MenuDishThumb>> {
  const out = new Map(opts?.seed || []);
  if (!items.length) return out;

  const missing = items.filter((it) => it.name && !out.has(it.name));
  if (!missing.length) {
    // Kolejne wejścia: zero matchingu, zero skanowania 1000+ obrazków.
    return out;
  }

  await new Promise<void>((resolve) => {
    InteractionManager.runAfterInteractions(() => resolve());
  });
  if (opts?.cancelled?.()) return out;

  await yieldMs(16);
  // Indeks budujemy dopiero gdy naprawdę trzeba dopasować nowe dania.
  buildFastIndex();
  if (opts?.cancelled?.()) return out;

  const priority = new Set(
    opts?.priorityNames instanceof Set ? opts.priorityNames : opts?.priorityNames || [],
  );
  const ordered = [
    ...missing.filter((it) => priority.has(it.name)),
    ...missing.filter((it) => !priority.has(it.name)),
  ];

  const used = new Set([...out.values()].map((t) => t.slug));
  const chunk = Math.max(4, Math.min(opts?.chunkSize ?? 8, 16));
  let sinceNotify = 0;

  for (let i = 0; i < ordered.length; i++) {
    if (opts?.cancelled?.()) return out;
    const item = ordered[i];
    if (!item.name || out.has(item.name)) continue;

    // Lazy require folderu dzieje się w resolveDishLocalAsset przy trafieniu.
    const thumb = matchDishThumbFast(item.name, {
      menuCategory: item.category,
      excludeSlugs: used,
    });
    if (thumb) {
      used.add(thumb.slug);
      out.set(item.name, thumb);
      sinceNotify += 1;
    }

    const endChunk = sinceNotify >= chunk || i === ordered.length - 1;
    if (endChunk && sinceNotify > 0) {
      opts?.onBatch?.(new Map(out));
      sinceNotify = 0;
      await yieldMs(20);
    } else if (i > 0 && i % chunk === 0) {
      await yieldMs(10);
    }
  }

  if (sinceNotify > 0) opts?.onBatch?.(new Map(out));
  return out;
}

/** Prefetch lokalnych assetów nie jest potrzebny — są już w bundlu. No-op dla API. */
export function prefetchMenuDishThumbs(
  _thumbs: Map<string, MenuDishThumb>,
  _opts?: { limit?: number; preferNames?: ReadonlySet<string> },
): void {
  /* local assets — nothing to prefetch over network */
}

/** @deprecated */
export async function assignAndCacheMenuThumbs(
  items: ReadonlyArray<{ name: string; category?: string }>,
  opts?: {
    seed?: Map<string, MenuDishThumb>;
    onUpdate?: (map: Map<string, MenuDishThumb>) => void;
    cancelled?: () => boolean;
  },
): Promise<Map<string, MenuDishThumb>> {
  const { hydrateMenuThumbsFromDisk, persistMenuThumbMatches } = await import('@/lib/menuThumbCache');
  const seed = opts?.seed || (await hydrateMenuThumbsFromDisk(items));
  if (opts?.cancelled?.()) return seed;
  opts?.onUpdate?.(seed);

  const assigned = await assignMenuDishThumbsProgressive(items, {
    seed,
    cancelled: opts?.cancelled,
    onBatch: (map) => {
      opts?.onUpdate?.(map);
      void persistMenuThumbMatches(items, map);
    },
  });
  return assigned;
}

export function warmMenuThumbIndex(): void {
  try {
    buildFastIndex();
  } catch {
    /* ignore */
  }
}

/** Podpowiedzi z katalogu dań (folder kategorii) — modal „Zmień zdjęcie”. */
export function listSimilarDishCatalogEntries(
  dishName: string,
  menuCategory?: string,
  limit = 36,
): Array<{ slug: string; labelPl: string; source: number | { uri: string } }> {
  const idx = buildFastIndex();
  const folders = new Set(folderCandidates(menuCategory, dishName));
  const q = normalize(dishName);
  const qTokens = tokensOf(q);
  const ranked: { entry: IndexedEntry; score: number }[] = [];

  for (const entry of idx.entries) {
    if (folders.size && !folders.has(entry.folder)) continue;
    let score = scoreTokenOverlap(qTokens, entry);
    if (entry.labels.includes(q)) score = 100;
    else if (score < 20) score = 15; // nadal pokaż w folderze kategorii
    // Kara za obce foldery napojów gdy danie nie jest napojem
    if (
      /lemonad|coffee|tea|juice|cocktail|beer|wine|spirit|energy/.test(entry.folder) &&
      !/napoj|drink|kawa|herbata|sok|lemoniad|piwo|wino|smoothie|koktajl/.test(
        normalize(`${menuCategory || ''} ${dishName}`),
      )
    ) {
      score = Math.max(0, score - 40);
    }
    ranked.push({ entry, score });
  }

  ranked.sort((a, b) => b.score - a.score || a.entry.primaryName.localeCompare(b.entry.primaryName));
  const out: Array<{ slug: string; labelPl: string; source: number | { uri: string } }> = [];
  const seen = new Set<string>();
  for (const { entry } of ranked) {
    if (seen.has(entry.slug)) continue;
    const thumb = thumbFromEntry(entry, { matchTier: 'tags', score: 50 });
    if (!thumb) continue;
    seen.add(entry.slug);
    out.push({ slug: entry.slug, labelPl: entry.primaryName, source: thumb.source });
    if (out.length >= limit) break;
  }
  return out;
}

export type { ImageLibraryEntry };
