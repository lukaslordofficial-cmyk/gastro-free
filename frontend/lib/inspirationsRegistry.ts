/**
 * Rejestr kategorii „Inspiracje Kulinarne”.
 * Nowe plansze: dopisz katalog + wpis tutaj — UI i API działają od razu.
 */
import type { DishImageEntry } from '@/lib/dishImagesCatalog';

export type InspirationDish = {
  slug: string;
  labelPl: string;
  localAsset: number;
  categoryId: string;
};

export type InspirationCategory = {
  id: string;
  titlePl: string;
  emojiHint?: string;
  dishes: InspirationDish[];
};

/** Dodatki / gotowce — nie generujemy przepisu „od zera”. */
const DENY_RE =
  /\b(frytk|waffle fries|szklanka mleka|sok ze|sok pomara|cz[aą]stki cytryn|lemon wedge|miseczka z|sos tatarski|sweet chili|sos mas[lł]owo|sos tahini|aioli wege|sos orzechowy|salsa z mango|ketchup$)\b/i;

function eligible(entry: { labelPl: string; slug: string; recipeEligible?: boolean }): boolean {
  if (entry.recipeEligible === false) return false;
  if (entry.recipeEligible === true) return true;
  const hay = `${entry.labelPl} ${entry.slug}`;
  return !DENY_RE.test(hay);
}

function fromCatalog(
  id: string,
  titlePl: string,
  catalog: DishImageEntry[],
): InspirationCategory {
  return {
    id,
    titlePl,
    dishes: catalog
      .filter((d) => eligible(d))
      .map((d) => ({
        slug: d.slug,
        labelPl: d.labelPl,
        localAsset: d.localAsset,
        categoryId: id,
      })),
  };
}

function loadCatalogs(): InspirationCategory[] {
  const cats: InspirationCategory[] = [];
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const soups = require('@/lib/dishImagesCatalog') as {
      SOUPS_PL_CATALOG: DishImageEntry[];
      SOUPS_ASIA_CATALOG: DishImageEntry[];
      BURGERS_CATALOG: DishImageEntry[];
    };
    cats.push(
      fromCatalog('soups_pl', 'Zupy', soups.SOUPS_PL_CATALOG),
      fromCatalog('soups_asia', 'Zupy orientalne', soups.SOUPS_ASIA_CATALOG),
      fromCatalog('burgers', 'Burgery i kanapki', soups.BURGERS_CATALOG),
    );
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const m = require('@/lib/streetAppsCatalog') as {
      STREET_FOOD_CATALOG: DishImageEntry[];
    };
    cats.push(fromCatalog('street', 'Street food', m.STREET_FOOD_CATALOG));
    // FINE_APPS — matching Menu only; Inspiracje = board 51 (starters)
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const s = require('@/lib/startersSaladsCatalog') as {
      STARTERS_CATALOG: DishImageEntry[];
      SALADS_CATALOG: DishImageEntry[];
    };
    cats.push(
      fromCatalog('starters', 'Przystawki', s.STARTERS_CATALOG),
      fromCatalog('salads', 'Sałatki', s.SALADS_CATALOG),
    );
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const d = require('@/lib/sidesKebabsDinnersCatalog') as {
      SIDES_CATALOG: DishImageEntry[];
      KEBABS_CATALOG: DishImageEntry[];
      DINNERS_CATALOG: DishImageEntry[];
    };
    cats.push(
      fromCatalog('sides', 'Surówki i dodatki', d.SIDES_CATALOG),
      fromCatalog('kebabs', 'Kebaby', d.KEBABS_CATALOG),
      fromCatalog('dinners', 'Obiady klasyczne', d.DINNERS_CATALOG),
    );
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('@/lib/dumplingsPizzasPastasCatalog') as {
      DUMPLINGS_CATALOG: DishImageEntry[];
      PIZZAS_CATALOG: DishImageEntry[];
      PASTAS_CATALOG: DishImageEntry[];
    };
    cats.push(
      fromCatalog('dumplings', 'Pierogi i kluski', p.DUMPLINGS_CATALOG),
      fromCatalog('pizzas', 'Pizze', p.PIZZAS_CATALOG),
      fromCatalog('pastas', 'Makarony', p.PASTAS_CATALOG),
    );
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const b = require('@/lib/bbqSushiCatalog') as {
      BBQ_CATALOG: DishImageEntry[];
      SUSHI_CATALOG: DishImageEntry[];
    };
    cats.push(
      fromCatalog('bbq', 'BBQ i grill', b.BBQ_CATALOG),
      fromCatalog('sushi', 'Sushi', b.SUSHI_CATALOG),
    );
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const aim = require('@/lib/asianIndianMexicanCatalog') as {
      ASIAN_CATALOG: DishImageEntry[];
      INDIAN_CATALOG: DishImageEntry[];
      MEXICAN_CATALOG: DishImageEntry[];
    };
    cats.push(
      fromCatalog('asian', 'Kuchnia azjatycka', aim.ASIAN_CATALOG),
      fromCatalog('indian', 'Kuchnia indyjska', aim.INDIAN_CATALOG),
      fromCatalog('mexican', 'Kuchnia meksykańska', aim.MEXICAN_CATALOG),
    );
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mc = require('@/lib/mediterraneanCaucasianCatalog') as {
      MEDITERRANEAN_CATALOG: DishImageEntry[];
      CAUCASIAN_CATALOG: DishImageEntry[];
    };
    cats.push(
      fromCatalog('mediterranean', 'Kuchnia śródziemnomorska', mc.MEDITERRANEAN_CATALOG),
      fromCatalog('caucasian', 'Kuchnia kaukaska', mc.CAUCASIAN_CATALOG),
    );
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fv = require('@/lib/fishVeganCatalog') as {
      FISH_CATALOG: DishImageEntry[];
      VEGAN_CATALOG: DishImageEntry[];
    };
    cats.push(
      fromCatalog('fish', 'Dania rybne', fv.FISH_CATALOG),
      fromCatalog('vegan', 'Dania wege', fv.VEGAN_CATALOG),
    );
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const kb = require('@/lib/kidsBreakfastCatalog') as {
      BREAKFAST_CATALOG: DishImageEntry[];
    };
    cats.push(fromCatalog('breakfast', 'Śniadania', kb.BREAKFAST_CATALOG));
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cd = require('@/lib/cakesDessertsCatalog') as {
      CAKES_CATALOG: DishImageEntry[];
      DESSERTS_CUPS_CATALOG: DishImageEntry[];
    };
    cats.push(
      fromCatalog('cakes', 'Ciasta', cd.CAKES_CATALOG),
      fromCatalog('desserts_cups', 'Desery w kubkach', cd.DESSERTS_CUPS_CATALOG),
    );
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ip = require('@/lib/iceCreamPancakesCatalog') as {
      PANCAKES_CATALOG: DishImageEntry[];
    };
    // ice_cream ukryte w Inspiracjach — assets zostają pod matching Menu
    cats.push(fromCatalog('pancakes', 'Gofry i naleśniki', ip.PANCAKES_CATALOG));
  } catch { /* empty */ }

  // french_desserts / pastries — ukryte w Inspiracjach (assets pod matching)

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cf = require('@/lib/coffeesCatalog') as { COFFEES_CATALOG: DishImageEntry[] };
    cats.push(fromCatalog('coffees', 'Kawy', cf.COFFEES_CATALOG));
  } catch { /* empty */ }

  // teas / beers / wines / spirits / energy_drinks — ukryte w Inspiracjach

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const lem = require('@/lib/lemonadesCatalog') as { LEMONADES_CATALOG: DishImageEntry[] };
    cats.push(fromCatalog('lemonades', 'Lemoniady', lem.LEMONADES_CATALOG));
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const j = require('@/lib/juicesCatalog') as { JUICES_CATALOG: DishImageEntry[] };
    cats.push(fromCatalog('juices', 'Soki i smoothie', j.JUICES_CATALOG));
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ck = require('@/lib/cocktailsCatalog') as { COCKTAILS_CATALOG: DishImageEntry[] };
    cats.push(fromCatalog('cocktails', 'Drinki', ck.COCKTAILS_CATALOG));
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const catering = require('@/lib/cateringCatalog') as { CATERING_CATALOG: DishImageEntry[] };
    cats.push(fromCatalog('catering', 'Catering i bankiet', catering.CATERING_CATALOG));
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const roasts = require('@/lib/roastsCatalog') as { ROASTS_CATALOG: DishImageEntry[] };
    cats.push(fromCatalog('roasts', 'Pieczenie i mięsa', roasts.ROASTS_CATALOG));
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const polish = require('@/lib/polishCatalog') as { POLISH_CATALOG: DishImageEntry[] };
    cats.push(fromCatalog('polish', 'Polskie klasyki', polish.POLISH_CATALOG));
  } catch { /* empty */ }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sauces = require('@/lib/saucesCatalog') as { SAUCES_CATALOG: DishImageEntry[] };
    cats.push(fromCatalog('sauces', 'Sosy', sauces.SAUCES_CATALOG));
  } catch { /* empty */ }

  // soups_polish (board 46) — redundantne vs board 52 „Zupy”; assets zostają pod matching

  return cats.filter((c) => c.dishes.length > 0);
}

let _cached: InspirationCategory[] | null = null;

export function getInspirationCategories(): InspirationCategory[] {
  if (!_cached) _cached = loadCatalogs();
  return _cached;
}

export function findInspirationDish(slug: string): InspirationDish | null {
  for (const c of getInspirationCategories()) {
    const hit = c.dishes.find((d) => d.slug === slug);
    if (hit) return hit;
  }
  return null;
}
