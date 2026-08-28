import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  fetchSubscriptionState,
  shouldShowAds,
  subscribeTier,
  cancelSubscription,
  resignToFreeTier,
  topupCredits,
  type SubscriptionState,
} from '@/lib/subscriptionClient';
import type { TopupKey } from '@/lib/subscriptionCatalog';
import { useThemeMode } from '@/contexts/ThemeModeContext';
import { useAuth } from '@/contexts/AuthContext';

type SubscriptionContextValue = {
  state: SubscriptionState | null;
  loading: boolean;
  tier: number;
  credits: number;
  /** Banery + interstitiale — Free po zakończonym trialu 30 dni. */
  hasAds: boolean;
  premiumUi: boolean;
  dealHunterUnlocked: boolean;
  trialActive: boolean;
  trialEndsAt: string | null;
  refresh: () => Promise<void>;
  subscribe: (tierLevel: 1 | 2) => Promise<SubscriptionState>;
  cancel: () => Promise<SubscriptionState>;
  resign: () => Promise<SubscriptionState>;
  topup: (key: TopupKey) => Promise<SubscriptionState>;
};

const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);

export function SubscriptionProvider({ children }: { children: React.ReactNode }) {
  const { setAppearance } = useThemeMode();
  const { isAuthenticated, accountKey, ready: authReady } = useAuth();
  const [state, setState] = useState<SubscriptionState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!isAuthenticated) {
      setState(null);
      setLoading(false);
      // Wylogowany: nie wracamy do białego skina — chrome zostaje premium.
      await setAppearance('premium');
      return;
    }
    // Czekaj na prawdziwy account_key — inaczej wczytamy portfel „default” (wyciek testowego konta).
    if (!accountKey || accountKey === 'default') {
      setLoading(true);
      return;
    }
    try {
      const next = await fetchSubscriptionState();
      // Nie nadpisuj realnego salda „zerem awaryjnym” (ok:false / migration),
      // gdy wcześniej mieliśmy poprawny portfel — inaczej CreditsGate kłamie.
      setState((prev) => {
        if (
          prev &&
          prev.ok &&
          (!next.ok || next.load_error) &&
          Number(prev.credits_balance ?? 0) > 0
        ) {
          return prev;
        }
        return next;
      });
      // Closed beta: Free plan też dostaje dark premium chrome.
      // NIE bramkuj wyglądu kredytami / tierem (wipe SQL zerował kredyty → biały UI).
      await setAppearance('premium');
    } catch {
      // Nie kasuj ostatniego znanego salda przy chwilowym błędzie sieci —
      // inaczej UI pokazuje 0 kredytów mimo że konto ma saldo w backendzie.
      setState((prev) => prev);
      // Zalogowany mimo błędu subskrypcji — nadal dark premium.
      await setAppearance('premium');
    } finally {
      setLoading(false);
    }
  }, [setAppearance, isAuthenticated, accountKey]);

  useEffect(() => {
    if (!authReady) return;
    void refresh();
  }, [authReady, refresh]);

  const wrap = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      const result = await fn();
      await refresh();
      return result;
    } catch (e) {
      await refresh();
      throw e;
    }
  }, [refresh]);

  const value = useMemo<SubscriptionContextValue>(() => {
    const tier = state?.tier_level ?? 0;
    const trialEnds = state?.trial_ends_at ?? null;
    return {
      state,
      loading,
      tier,
      credits: state?.credits_balance ?? 0,
      // Reklamy tylko Free po trialu — nie zgadujemy przy błędzie/ładowaniu portfela.
      hasAds:
        !!isAuthenticated &&
        !loading &&
        !!state?.ok &&
        shouldShowAds(tier, trialEnds),
      // Dark premium chrome: trial Premium, płatny plan, albo zalogowany (closed beta).
      premiumUi: isAuthenticated ? true : !!state?.premium_ui,
      dealHunterUnlocked: !!state?.deal_hunter_unlocked,
      trialActive: !!state?.trial_active,
      trialEndsAt: trialEnds,
      refresh,
      subscribe: (t) => wrap(() => subscribeTier(t)),
      cancel: () => wrap(cancelSubscription),
      resign: () => wrap(resignToFreeTier),
      topup: (k) => wrap(() => topupCredits(k)),
    };
  }, [state, loading, refresh, wrap, isAuthenticated]);

  return (
    <SubscriptionContext.Provider value={value}>
      {children}
    </SubscriptionContext.Provider>
  );
}

export function useSubscription() {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) throw new Error('useSubscription must be used within SubscriptionProvider');
  return ctx;
}

/** Alias zgodny z wytycznymi AdMob. */
export function useUserTier() {
  const { tier, hasAds, credits, loading, refresh } = useSubscription();
  return { tier, hasAds, credits, loading, refresh };
}
