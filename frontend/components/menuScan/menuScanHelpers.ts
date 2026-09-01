/**
 * Czyste helpery skanera menu — bez UI (.agentrules §I).
 */
import { normalizeRecipeQuantity } from '@/lib/recipeUnits';
import { newIngredient, type DraftDish, type Suggestion } from './menuScanTypes';

export function dishesMissingHelp(list: DraftDish[]) {
  const needIng: string[] = [];
  const needQty: string[] = [];
  const needWeight: string[] = [];
  list.forEach((d) => {
    const named = d.ingredients.filter((i) => i.name.trim());
    const hasIngredients = named.length > 0;
    const missingQty = named.some((i) => !i.quantity.trim());
    const hasWeight = !!d.portionWeightInput.trim() && !!d.portionWeightUnit;
    if (!hasIngredients) needIng.push(d.key);
    else if (missingQty) needQty.push(d.key);
    if (!hasWeight) needWeight.push(d.key);
  });
  return { needIng, needQty, needWeight };
}

export function applySuggestionsToDishes(
  current: DraftDish[],
  byName: Record<string, Suggestion>,
  needIng: string[],
  needQty: string[],
  needWeight: string[],
): DraftDish[] {
  return current.map((d) => {
    const s = byName[d.name.trim().toLowerCase()];
    if (!s) return d;
    let next = { ...d };
    const suggested = s.suggested_ingredients ?? [];

    if (needIng.includes(d.key) && suggested.length > 0) {
      next = {
        ...next,
        ingredients: suggested.map((si) =>
          newIngredient(
            si.name,
            si.quantity != null && Number(si.quantity) > 0
              ? String(normalizeRecipeQuantity(si.quantity))
              : (si.unit === 'szt' ? '1' : si.unit === 'ml' ? '30' : '50'),
            si.unit === 'ml' || si.unit === 'szt' ? si.unit : 'g'
          )
        ),
      };
    } else if (needQty.includes(d.key) && suggested.length > 0) {
      const bySugName = new Map(
        suggested.map((si) => [si.name.trim().toLowerCase(), si]),
      );
      next = {
        ...next,
        ingredients: next.ingredients.map((ing, idx) => {
          if (!ing.name.trim() || ing.quantity.trim()) return ing;
          const hit =
            bySugName.get(ing.name.trim().toLowerCase()) ??
            suggested[idx];
          if (!hit || hit.quantity == null || !(Number(hit.quantity) > 0)) {
            const fallback =
              ing.unit === 'szt' || hit?.unit === 'szt'
                ? '1'
                : ing.unit === 'ml' || hit?.unit === 'ml'
                  ? '30'
                  : '50';
            return {
              ...ing,
              quantity: fallback,
              unit:
                hit?.unit === 'ml' || hit?.unit === 'szt'
                  ? hit.unit
                  : (ing.unit || 'g'),
            };
          }
          return {
            ...ing,
            quantity: String(normalizeRecipeQuantity(hit.quantity)),
            unit:
              hit.unit === 'ml' || hit.unit === 'szt'
                ? hit.unit
                : (ing.unit || 'g'),
          };
        }),
      };
    }

    if (
      needWeight.includes(d.key) &&
      s.suggested_portion_weight_value != null &&
      s.suggested_portion_weight_unit
    ) {
      const u = s.suggested_portion_weight_unit;
      next = {
        ...next,
        portionWeightInput: String(s.suggested_portion_weight_value),
        portionWeightUnit: u === 'g' || u === 'ml' || u === 'szt' ? u : null,
      };
    }
    return next;
  });
}
