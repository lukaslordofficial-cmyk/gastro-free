/** Auto-generated lazy loaders per folder (~25 WebP each). */
const LOADERS: Record<string, () => { ASSETS: Record<string, number> }> = {
  'apps': () => require('./apps') as { ASSETS: Record<string, number> },
  'asian': () => require('./asian') as { ASSETS: Record<string, number> },
  'bbq': () => require('./bbq') as { ASSETS: Record<string, number> },
  'beers': () => require('./beers') as { ASSETS: Record<string, number> },
  'breakfast': () => require('./breakfast') as { ASSETS: Record<string, number> },
  'burgers': () => require('./burgers') as { ASSETS: Record<string, number> },
  'cakes': () => require('./cakes') as { ASSETS: Record<string, number> },
  'catering': () => require('./catering') as { ASSETS: Record<string, number> },
  'caucasian': () => require('./caucasian') as { ASSETS: Record<string, number> },
  'cocktails': () => require('./cocktails') as { ASSETS: Record<string, number> },
  'coffees': () => require('./coffees') as { ASSETS: Record<string, number> },
  'desserts_cups': () => require('./desserts_cups') as { ASSETS: Record<string, number> },
  'dinners': () => require('./dinners') as { ASSETS: Record<string, number> },
  'dumplings': () => require('./dumplings') as { ASSETS: Record<string, number> },
  'energy_drinks': () => require('./energy_drinks') as { ASSETS: Record<string, number> },
  'fish': () => require('./fish') as { ASSETS: Record<string, number> },
  'french_desserts': () => require('./french_desserts') as { ASSETS: Record<string, number> },
  'ice_cream': () => require('./ice_cream') as { ASSETS: Record<string, number> },
  'indian': () => require('./indian') as { ASSETS: Record<string, number> },
  'juices': () => require('./juices') as { ASSETS: Record<string, number> },
  'kebabs': () => require('./kebabs') as { ASSETS: Record<string, number> },
  'lemonades': () => require('./lemonades') as { ASSETS: Record<string, number> },
  'mediterranean': () => require('./mediterranean') as { ASSETS: Record<string, number> },
  'mexican': () => require('./mexican') as { ASSETS: Record<string, number> },
  'pancakes': () => require('./pancakes') as { ASSETS: Record<string, number> },
  'pastas': () => require('./pastas') as { ASSETS: Record<string, number> },
  'pastries': () => require('./pastries') as { ASSETS: Record<string, number> },
  'pizzas': () => require('./pizzas') as { ASSETS: Record<string, number> },
  'polish': () => require('./polish') as { ASSETS: Record<string, number> },
  'roasts': () => require('./roasts') as { ASSETS: Record<string, number> },
  'salads': () => require('./salads') as { ASSETS: Record<string, number> },
  'sauces': () => require('./sauces') as { ASSETS: Record<string, number> },
  'sides': () => require('./sides') as { ASSETS: Record<string, number> },
  'soups_asia': () => require('./soups_asia') as { ASSETS: Record<string, number> },
  'soups_pl': () => require('./soups_pl') as { ASSETS: Record<string, number> },
  'soups_polish': () => require('./soups_polish') as { ASSETS: Record<string, number> },
  'spirits': () => require('./spirits') as { ASSETS: Record<string, number> },
  'starters': () => require('./starters') as { ASSETS: Record<string, number> },
  'street': () => require('./street') as { ASSETS: Record<string, number> },
  'sushi': () => require('./sushi') as { ASSETS: Record<string, number> },
  'teas': () => require('./teas') as { ASSETS: Record<string, number> },
  'vegan': () => require('./vegan') as { ASSETS: Record<string, number> },
  'wines': () => require('./wines') as { ASSETS: Record<string, number> },
};

const cache = new Map<string, Record<string, number>>();

/** relativePath np. apps/app_01.webp lub dania/apps/app_01.webp → local require id */
export function resolveDishLocalAsset(relativePath: string): number | null {
  const clean = String(relativePath || '')
    .replace(/^dania\//, '')
    .replace(/^\/+/, '');
  const parts = clean.split('/');
  if (parts.length < 2) return null;
  const folder = parts[0];
  const file = parts.slice(1).join('/');
  let assets = cache.get(folder);
  if (!assets) {
    const loader = LOADERS[folder];
    if (!loader) return null;
    try {
      assets = loader().ASSETS;
    } catch {
      return null;
    }
    cache.set(folder, assets);
  }
  const id = assets[file];
  return typeof id === 'number' ? id : null;
}

export function warmDishAssetFolder(folder: string): void {
  if (cache.has(folder)) return;
  const loader = LOADERS[folder];
  if (!loader) return;
  try {
    cache.set(folder, loader().ASSETS);
  } catch {
    /* ignore */
  }
}

export const DISH_ASSET_FOLDERS = Object.keys(LOADERS);
