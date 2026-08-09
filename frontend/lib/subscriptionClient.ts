/**
 * Subskrypcja — operacje bezpośrednio przez Supabase (bez wymagania backendu).
 * account_key pochodzi z zalogowanego profilu (AuthProvider → lib/accountKey).
 */
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { getAccountKey } from '@/lib/accountKey';
import {
  FEATURE_CATALOG, TOPUP_PACKAGES, TIER_PLANS, tierName, type TopupKey,
} from '@/lib/subscriptionCatalog';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim();
/** Startowe kredyty AI przy rejestracji (trial Premium 30 dni osobno). */
const STARTER_CREDITS = 100;
const TRIAL_DAYS = 30;

function accountKey(): string {
  return getAccountKey();
}

function trialEndsIso(from = new Date()): string {
  return new Date(from.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** Trial Premium aktywny, gdy trial_ends_at > now (Free plan + features jak Profesjonalny). */
export function isPremiumTrialActive(trialEndsAt: string | null | undefined): boolean {
  if (!trialEndsAt) return false;
  const t = Date.parse(trialEndsAt);
  return Number.isFinite(t) && t > Date.now();
}

/** Tier efektywny do feature-gate: aktywny trial = min. poziom Profesjonalny (2). */
export function effectiveFeatureTier(
  tierLevel: number,
  trialEndsAt: string | null | undefined,
): number {
  const tier = Number(tierLevel ?? 0);
  return isPremiumTrialActive(trialEndsAt) ? Math.max(tier, 2) : tier;
}

/** Płatny Profesjonalny LUB aktywny trial Premium → pełny dostęp feature jak tier 2. */
export function isPremiumEntitled(
  tierLevel: number,
  trialEndsAt: string | null | undefined,
): boolean {
  return effectiveFeatureTier(tierLevel, trialEndsAt) >= 2;
}

/**
 * Reklamy AdMob (baner + interstitial) — Free (tier 0) gdy NIE ma aktywnego trialu.
 * Bez reklam: płatny plan (tier ≥ 1) albo trwający trial 30 dni.
 */
export function shouldShowAds(
  tierLevel: number,
  trialEndsAt: string | null | undefined,
): boolean {
  const tier = Number(tierLevel ?? 0);
  if (tier >= 1) return false;
  if (isPremiumTrialActive(trialEndsAt)) return false;
  return true;
}

export type SubscriptionRow = {
  id: string;
  account_key: string;
  tier_level: number;
  credits_balance: number;
  status: string;
  current_period_end: string | null;
  /** Koniec 30-dniowego trialu Premium; po dacie → Free, kredyty zostają. */
  trial_ends_at?: string | null;
  free_starter_claimed?: boolean | null;
  created_at?: string;
  updated_at?: string;
};

export type SubscriptionState = {
  ok: boolean;
  needs_migration?: boolean;
  load_error?: 'config' | 'network' | 'migration';
  tier_level: number;
  /** Feature-gate tier: trial Premium → min. 2 (jak Profesjonalny). */
  effective_tier_level: number;
  tier_name: string;
  credits_balance: number;
  status: string;
  current_period_end: string | null;
  trial_ends_at: string | null;
  trial_active: boolean;
  deal_hunter_unlocked: boolean;
  /** Dark premium UI — trial, płatny tier lub kredyty > 0 */
  premium_ui: boolean;
  features: Array<{
    key: string; icon: string; name: string; cost: string;
    requires_deal_hunter: boolean; locked: boolean; locked_reason: string | null;
  }>;
  topup_packages: typeof TOPUP_PACKAGES;
  plans: typeof TIER_PLANS;
  message?: string | null;
};

export type WalletSnapshot = Pick<
  SubscriptionState,
  'tier_level' | 'tier_name' | 'credits_balance' | 'status' | 'current_period_end' | 'ok' | 'needs_migration' | 'load_error'
> & { load_message?: string };

function buildView(row: SubscriptionRow, message?: string | null): SubscriptionState {
  const tier = Number(row.tier_level ?? 0);
  const bal = Number(row.credits_balance ?? 0);
  const trialEnds = row.trial_ends_at ?? null;
  const trialActive = isPremiumTrialActive(trialEnds);
  // Paid Profesjonalny LUB aktywny 30-dniowy trial → Łowca + feature gate jak tier 2
  const premiumEntitled = isPremiumEntitled(tier, trialEnds);
  const effTier = effectiveFeatureTier(tier, trialEnds);
  const features = FEATURE_CATALOG.map((f) => {
    let reason: string | null = null;
    if (bal <= 0) {
      reason = 'Brak kredytów — dostępne tylko funkcje manualne';
    } else if (f.requires_deal_hunter && !premiumEntitled) {
      reason = 'Wymaga planu Profesjonalny lub aktywnego trialu Premium (30 dni)';
    }
    return { ...f, locked: reason !== null, locked_reason: reason };
  });
  return {
    ok: true,
    tier_level: tier,
    tier_name: trialActive && tier < 2 ? `${tierName(tier)} · trial Premium` : tierName(tier),
    credits_balance: bal,
    status: row.status ?? 'active',
    current_period_end: row.current_period_end ?? null,
    trial_ends_at: trialEnds,
    trial_active: trialActive,
    deal_hunter_unlocked: premiumEntitled,
    // Dark premium chrome podczas trialu / płatnego planu / gdy są kredyty
    premium_ui: premiumEntitled || bal > 0,
    features,
    topup_packages: TOPUP_PACKAGES,
    plans: TIER_PLANS,
    message: message ?? null,
    effective_tier_level: effTier,
  };
}

async function fetchRow(): Promise<SubscriptionRow | null> {
  if (!isSupabaseConfigured) return null;
  const key = accountKey();
  // Nigdy nie czytaj shared „default” — to portfel demo / pierwszego testu.
  if (!key || key === 'default') return null;
  const { data, error } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('account_key', key)
    .maybeSingle();
  if (error) {
    if (error.code === 'PGRST205' || error.message?.includes('schema cache')) return null;
    throw error;
  }
  return data as SubscriptionRow | null;
}

async function ensureRow(): Promise<SubscriptionRow> {
  const key = accountKey();
  if (!key || key === 'default') {
    throw new Error('Brak account_key — zaloguj się ponownie.');
  }
  const existing = await fetchRow();
  if (existing) return existing;

  const payload = {
    account_key: key,
    tier_level: 0,
    credits_balance: STARTER_CREDITS,
    status: 'active',
    current_period_end: null,
    free_starter_claimed: true,
    // 30-dniowy trial Premium (Łowca itd.); po dacie Free, kredyty zostają
    trial_ends_at: trialEndsIso(),
  };
  const { data, error } = await supabase
    .from('subscriptions')
    .insert(payload)
    .select('*')
    .single();
  if (error) throw error;
  return data as SubscriptionRow;
}

async function patchRow(changes: Partial<SubscriptionRow>): Promise<SubscriptionRow> {
  const { data, error } = await supabase
    .from('subscriptions')
    .update(changes)
    .eq('account_key', accountKey())
    .select('*')
    .single();
  if (error) throw error;
  return data as SubscriptionRow;
}

export async function fetchSubscriptionState(): Promise<SubscriptionState> {
  try {
    const row = await ensureRow();
    return buildView(row);
  } catch {
    return {
      ok: false,
      needs_migration: true,
      load_error: 'migration',
      tier_level: 0,
      effective_tier_level: 0,
      tier_name: '—',
      credits_balance: 0,
      status: 'unknown',
      current_period_end: null,
      trial_ends_at: null,
      trial_active: false,
      deal_hunter_unlocked: false,
      premium_ui: false,
      features: FEATURE_CATALOG.map((f) => ({ ...f, locked: true, locked_reason: 'Brak migracji' })),
      topup_packages: TOPUP_PACKAGES,
      plans: TIER_PLANS,
      message: 'Uruchom ADD_SUBSCRIPTIONS.sql i FIX_SUBSCRIPTIONS_RLS.sql w Supabase SQL Editor.',
    };
  }
}

export async function fetchWalletSnapshot(): Promise<WalletSnapshot> {
  const state = await fetchSubscriptionState();
  return {
    tier_level: state.tier_level,
    tier_name: state.tier_name,
    credits_balance: state.credits_balance,
    status: state.status,
    current_period_end: state.current_period_end,
    ok: state.ok,
    needs_migration: state.needs_migration,
    load_error: state.load_error,
    load_message: state.message ?? undefined,
  };
}

export async function subscribeTier(tierLevel: 1 | 2): Promise<SubscriptionState> {
  const { createCheckoutAndOpen } = await import('@/lib/billingClient');
  const checkout = await createCheckoutAndOpen({ kind: 'subscription', tier_level: tierLevel });
  const row = await ensureRow();
  return buildView(
    row,
    checkout.ok
      ? checkout.message
      : (checkout.message || 'Nie udało się otworzyć płatności Stripe.'),
  );
}

export async function cancelSubscription(): Promise<SubscriptionState> {
  // Preferuj portal Stripe, gdy jest customer_id — lokalnie oznacz canceled jako fallback
  try {
    const { openBillingPortal } = await import('@/lib/billingClient');
    const portal = await openBillingPortal();
    if (portal.ok) {
      const row = await ensureRow();
      return buildView(row, portal.message);
    }
  } catch { /* fall through */ }
  const row = await ensureRow();
  const updated = await patchRow({ status: 'canceled' });
  return buildView(
    updated,
    'Subskrypcja oznaczona jako anulowana lokalnie. W Stripe: Zarządzaj subskrypcją.',
  );
}

/** Rezygnacja z subskrypcji — natychmiastowy powrót do Tier 0 bez ponownego pakietu startowego. */
export async function resignToFreeTier(): Promise<SubscriptionState> {
  const row = await ensureRow();
  const updated = await patchRow({
    tier_level: 0,
    status: 'active',
    current_period_end: null,
    free_starter_claimed: true,
  });
  return buildView(
    updated,
    `Przełączono na plan Free. Saldo kredytów: ${updated.credits_balance} (bez ponownego pakietu startowego).`,
  );
}

export async function topupCredits(packageKey: TopupKey): Promise<SubscriptionState> {
  const pkg = TOPUP_PACKAGES.find((p) => p.key === packageKey);
  if (!pkg) throw new Error('Nieprawidłowy pakiet');
  const { createCheckoutAndOpen } = await import('@/lib/billingClient');
  const checkout = await createCheckoutAndOpen({ kind: 'topup', package: packageKey });
  const row = await ensureRow();
  return buildView(
    row,
    checkout.ok
      ? checkout.message
      : (checkout.message || 'Nie udało się otworzyć płatności Stripe.'),
  );
}

/** Wyłączone — kredyty tylko z subskrypcji / top-up (bez reklam rewarded). */
export async function grantRewardCredit(): Promise<{ ok: boolean; credits_balance: number; message: string }> {
  const row = await ensureRow();
  return {
    ok: false,
    credits_balance: Number(row.credits_balance ?? 0),
    message: 'Kredyty za reklamy są wyłączone. Dokup pakiet w Subskrypcji.',
  };
}

/** Opcjonalnie synchronizuj z backendem (AI billing) — nie blokuje UI. */
export async function syncBackendSubscription(): Promise<void> {
  if (!BACKEND_URL) return;
  try {
    const key = accountKey();
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    await fetch(`${BACKEND_URL}/api/subscription`, {
      method: 'GET',
      headers: {
        'X-Account-Key': key,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
  } catch {
    /* ignore */
  }
}

/** @deprecated użyj getAccountKey() — eksport dla kompatybilności */
const ACCOUNT_KEY = 'default';

export { BACKEND_URL, ACCOUNT_KEY, accountKey as resolveAccountKey };
