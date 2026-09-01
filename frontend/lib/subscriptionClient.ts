/**
 * Subskrypcja — operacje bezpośrednio przez Supabase (bez wymagania backendu).
 * account_key pochodzi z zalogowanego profilu (AuthProvider → lib/accountKey).
 */
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import { getAccountKey } from '@/lib/accountKey';
import { requireTenantAccountKey } from '@/lib/tenantScope';
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

/** Pełne dni kalendarzowe do końca trialu (0 = ostatni dzień). null gdy brak daty. */
export function trialDaysRemaining(trialEndsAt: string | null | undefined): number | null {
  if (!trialEndsAt) return null;
  const end = Date.parse(trialEndsAt);
  if (!Number.isFinite(end)) return null;
  const diffMs = end - Date.now();
  if (diffMs <= 0) return 0;
  return Math.ceil(diffMs / (24 * 60 * 60 * 1000));
}

/** Tekst PL: „Zostało X dni trialu” / „Został 1 dzień trialu”. */
export function formatTrialDaysLeft(days: number | null | undefined): string | null {
  if (days == null || !Number.isFinite(days)) return null;
  if (days <= 0) return 'Trial Premium kończy się dziś';
  if (days === 1) return 'Został 1 dzień trialu Premium';
  const mod10 = days % 10;
  const mod100 = days % 100;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) {
    return `Zostały ${days} dni trialu Premium`;
  }
  return `Zostało ${days} dni trialu Premium`;
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
 * Reklamy AdMob (baner + interstitial) — wyłącznie Free (tier 0) po zakończonym trialu 30 dni.
 * Bez reklam: brak sesji, ładowanie portfela, płatny plan, aktywny trial.
 *
 * EXPO_PUBLIC_FORCE_ADS=1 — tylko na APK preview (EAS), żeby przetestować AdMob
 * przed końcem trialu / przed publikacją w Play (najlepiej z test unit IDs).
 */
export function shouldShowAds(
  tierLevel: number,
  trialEndsAt: string | null | undefined,
): boolean {
  const force = (process.env.EXPO_PUBLIC_FORCE_ADS ?? '').trim().toLowerCase();
  if (force === '1' || force === 'true' || force === 'yes') return true;
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
      message: 'Subskrypcje są chwilowo niedostępne. Odśwież albo skontaktuj się z supportem.',
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
  // Po upgrade w Stripe (bez Checkout) odśwież wiersz; po Checkout — stan zmieni się po płatności.
  if (!checkout.ok) {
    throw new Error(
      checkout.message
      || 'Nie udało się uruchomić płatności / zmiany planu. Użyj „Zrezygnuj z planu”, potem wybierz ponownie.',
    );
  }
  const row = await ensureRow();
  if (checkout.upgraded) {
    try {
      await syncBackendSubscription();
    } catch { /* ignore */ }
    const fresh = await ensureRow();
    return buildView(
      fresh,
      checkout.message || 'Plan zaktualizowany. Nie trzeba było rezygnować z poprzedniego.',
    );
  }
  return buildView(row, checkout.message);
}

export async function cancelSubscription(): Promise<SubscriptionState> {
  try {
    const { openBillingPortal } = await import('@/lib/billingClient');
    const portal = await openBillingPortal();
    if (portal.ok) {
      const row = await ensureRow();
      return buildView(row, portal.message);
    }
    throw new Error(portal.message || 'Nie udało się otworzyć portalu Stripe.');
  } catch (e) {
    const row = await ensureRow();
    return buildView(
      row,
      e instanceof Error
        ? e.message
        : 'Anulowanie tylko przez portal Stripe (Ustawienia → Zarządzaj subskrypcją).',
    );
  }
}

/** Rezygnacja z subskrypcji — natychmiastowy powrót do Tier 0 bez ponownego pakietu startowego. */
export async function resignToFreeTier(): Promise<SubscriptionState> {
  if (!BACKEND_URL) {
    throw new Error('Brak adresu API — nie można zrezygnować z planu.');
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Account-Key': requireTenantAccountKey(),
  };
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${BACKEND_URL}/api/subscription/resign`, {
    method: 'POST',
    headers,
  });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      typeof payload.detail === 'string'
        ? payload.detail
        : 'Nie udało się zrezygnować z planu. Spróbuj ponownie.',
    );
  }
  const row = await ensureRow();
  return buildView(
    row,
    payload.message
      || `Zrezygnowano z planu. Saldo kredytów: ${row.credits_balance}.`,
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
    const key = requireTenantAccountKey();
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
