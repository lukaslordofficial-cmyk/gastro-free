import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  fetchSubscriptionState,
  grantRewardCredit,
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
  hasAds: boolean;
  premiumUi: boolean;
  dealHunterUnlocked: boolean;
  refresh: () => Promise<void>;
  subscribe: (tierLevel: 1 | 2) => Promise<SubscriptionState>;
  cancel: () => Promise<SubscriptionState>;
  resign: () => Promise<SubscriptionState>;
  topup: (key: TopupKey) => Promise<SubscriptionState>;
  addRewardCredit: () => Promise<{ ok: boolean; credits_balance: number; message: string }>;
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
      await setAppearance('free');
      return;
    }
    try {
      const next = await fetchSubscriptionState();
      setState(next);
      const wantPremium = Number(next.credits_balance) > 0;
      await setAppearance(wantPremium ? 'premium' : 'free');
    } catch {
      setState(null);
      await setAppearance('free');
    } finally {
      setLoading(false);
    }
  }, [setAppearance, isAuthenticated, accountKey]);

  useEffect(() => {
    if (!authReady) return;
    void refresh();
  }, [authReady, refresh]);

  const wrap = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    const result = await fn();
    await refresh();
    return result;
  }, [refresh]);

  const value = useMemo<SubscriptionContextValue>(() => ({
    state,
    loading,
    tier: state?.tier_level ?? 0,
    credits: state?.credits_balance ?? 0,
    // Closed beta / Internal Testing: bez reklam (AdMob wyłączony w UI).
    hasAds: false,
    premiumUi: !!state?.premium_ui,
    dealHunterUnlocked: !!state?.deal_hunter_unlocked,
    refresh,
    subscribe: (t) => wrap(() => subscribeTier(t)),
    cancel: () => wrap(cancelSubscription),
    resign: () => wrap(resignToFreeTier),
    topup: (k) => wrap(() => topupCredits(k)),
    addRewardCredit: async () => {
      const r = await grantRewardCredit();
      await refresh();
      return r;
    },
  }), [state, loading, refresh, wrap]);

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
