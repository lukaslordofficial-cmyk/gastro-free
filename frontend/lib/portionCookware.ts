/**
 * Skalowanie receptur na N porcji + dobór naczynia z Magazynu (kitchen_utensils).
 */
import { utensilCapacityLiters, type KitchenUtensilRow } from '@/lib/kitchenUtensils';

export type ScalableIngredient = {
  name: string;
  quantity: number;
  unit: string;
  piece_weight_g?: number | null;
};

export type ScaledIngredient = ScalableIngredient & {
  baseQuantity: number;
};

/** Linear scale: qty * (N / basePortions). Base często = 1 (receptura na porcję). */
export function scaleRecipeIngredients(
  ings: ScalableIngredient[],
  portions: number,
  basePortions = 1,
): ScaledIngredient[] {
  const n = Math.max(1, Number(portions) || 1);
  const base = Math.max(1, Number(basePortions) || 1);
  const factor = n / base;
  return (ings || []).map((ing) => {
    const qty = Number(ing.quantity) || 0;
    let scaled = Math.round(qty * factor * 100) / 100;
    if (scaled > 0 && scaled < 0.01) scaled = 0.01;
    return {
      ...ing,
      name: ing.name,
      unit: ing.unit,
      piece_weight_g: ing.piece_weight_g ?? null,
      baseQuantity: qty,
      quantity: scaled,
    };
  });
}

const LIQUID_NAME_RE =
  /\b(woda|bulion|rosol|rosół|mleko|olej|oliwa|smietana|śmietana|wino|ocet|sos|stock|broth|water|milk|oil|cream|bouillon)\b/i;

const SOUP_SAUCE_CAT_RE = /zup|sos|soup|sauce|bulion/i;

function normUnit(u: string): string {
  return String(u || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
}

function isLiquidName(name: string): boolean {
  const n = (name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  return LIQUID_NAME_RE.test(n);
}

/**
 * Szacunek objętości cieczy w litrach.
 * Sumuje ml/l; dla kategorii zupa/sos traktuje wodę/bulion/mleko itd. w g ≈ ml.
 * `approximate` = true gdy użyto przybliżenia g≈ml lub brak pewnych jednostek.
 */
export function estimateLiquidLiters(
  ings: { name: string; quantity: number; unit: string }[],
  category?: string | null,
): { liters: number; approximate: boolean } {
  const soupLike = SOUP_SAUCE_CAT_RE.test(String(category || ''));
  let ml = 0;
  let approximate = false;

  for (const ing of ings || []) {
    const qty = Number(ing.quantity) || 0;
    if (qty <= 0) continue;
    const unit = normUnit(ing.unit);

    if (unit === 'l' || unit === 'ltr' || unit === 'litr' || unit === 'litry') {
      ml += qty * 1000;
      continue;
    }
    if (unit === 'ml' || unit === 'mililitr' || unit === 'mililitry') {
      ml += qty;
      continue;
    }
    // g / kg → tylko dla typowych płynów w zupach/sosach
    if (soupLike && isLiquidName(ing.name)) {
      if (unit === 'g' || unit === 'gr' || unit === 'gram' || unit === 'gramy') {
        ml += qty; // g ≈ ml
        approximate = true;
        continue;
      }
      if (unit === 'kg') {
        ml += qty * 1000;
        approximate = true;
        continue;
      }
    }
  }

  if (ml <= 0 && soupLike) {
    // Brak jawnych płynów — zgrubny szacunek z masy składników (g≈ml) tylko jako fallback
    let massG = 0;
    for (const ing of ings || []) {
      const qty = Number(ing.quantity) || 0;
      const unit = normUnit(ing.unit);
      if (unit === 'g' || unit === 'gr') massG += qty;
      else if (unit === 'kg') massG += qty * 1000;
      else if (unit === 'ml') massG += qty;
      else if (unit === 'l') massG += qty * 1000;
    }
    if (massG > 0) {
      ml = massG * 0.85; // zapas przestrzeni na parowanie / mieszanie
      approximate = true;
    }
  }

  return {
    liters: Math.round((ml / 1000) * 1000) / 1000,
    approximate,
  };
}

export type PickUtensilResult = {
  utensil: KitchenUtensilRow | null;
  needLiters: number;
  targetLiters: number;
  capacityLiters: number | null;
};

/**
 * Najmniejsze naczynie o pojemności >= needLiters * 1.12.
 * Preferuje typy z preferredTypes (domyślnie garnek, pojemnik).
 */
export function pickUtensil(
  utensils: KitchenUtensilRow[],
  needLiters: number,
  preferredTypes: string[] = ['garnek', 'pojemnik'],
): PickUtensilResult {
  const need = Math.max(0, Number(needLiters) || 0);
  const target = need * 1.12;
  const pref = new Set(
    preferredTypes.map((t) =>
      t
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim(),
    ),
  );

  const withCap = (utensils || [])
    .map((u) => ({ u, liters: utensilCapacityLiters(u) }))
    .filter((x): x is { u: KitchenUtensilRow; liters: number } => x.liters != null && x.liters > 0);

  const matchesPref = (type: string) => {
    const t = (type || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
    return pref.has(t);
  };

  const preferred = withCap.filter((x) => matchesPref(x.u.utensil_type));
  const pool = preferred.length ? preferred : withCap;

  const fitting = pool
    .filter((x) => x.liters >= target)
    .sort((a, b) => a.liters - b.liters);

  if (fitting.length) {
    return {
      utensil: fitting[0].u,
      needLiters: need,
      targetLiters: Math.round(target * 1000) / 1000,
      capacityLiters: fitting[0].liters,
    };
  }

  return {
    utensil: null,
    needLiters: need,
    targetLiters: Math.round(target * 1000) / 1000,
    capacityLiters: null,
  };
}
