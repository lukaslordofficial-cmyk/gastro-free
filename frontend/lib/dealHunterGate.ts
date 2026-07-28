/**
 * Brama Łowcy Okazji — dostęp od tier 2 lub aktywnego 30-dniowego trialu Premium.
 * (dealHunterUnlocked z SubscriptionContext już uwzględnia trial.)
 */

export const DEAL_HUNTER_GATE_TITLE = 'Łowca okazji';

export const DEAL_HUNTER_GATE_MESSAGE =
  'Łowca okazji dostępny jest od tier 2. Zwiększ tier jeśli chcesz korzystać z inteligentnego zamawiania produktów.';

/** Intenty głosowe / Jarvis wymagające Łowcy (compare-offers / smart basket). */
export const DEAL_HUNTER_INTENTS = new Set([
  'order_product',
  'order_critical_items_by_category',
  'compare_catalogs_top_savings',
  'predictive_weekend_restock',
  'supplier_flip_order',
  'budget_cap_order',
]);

export function isDealHunterIntent(intent: string | null | undefined): boolean {
  return !!intent && DEAL_HUNTER_INTENTS.has(intent);
}
