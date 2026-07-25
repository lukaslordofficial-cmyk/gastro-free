/**
 * AdMob — inicjalizacja, zgoda RODO (UMP) i helpery reklam.
 * W Expo Go natywny moduł jest niedostępny — aplikacja działa bez reklam.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { INTERSTITIAL_MIN_INTERVAL_MS, REWARDED_DAILY_LIMIT, pickAdUnit } from '@/lib/adConfig';
import { loadAdsModule, type AdsNative } from '@/lib/adsNative';

const LAST_INTERSTITIAL_KEY = 'gastro_last_interstitial_ts';
const REWARDED_COUNT_KEY = 'gastro_rewarded_count';
const REWARDED_DATE_KEY = 'gastro_rewarded_date';

type AdsContextValue = {
  adsReady: boolean;
  nativeAvailable: boolean;
  showInterstitial: () => Promise<void>;
  showRewarded: () => Promise<boolean>;
  rewardedViewsToday: number;
  canShowRewarded: boolean;
};

const AdsContext = createContext<AdsContextValue>({
  adsReady: false,
  nativeAvailable: false,
  showInterstitial: async () => {},
  showRewarded: async () => false,
  rewardedViewsToday: 0,
  canShowRewarded: false,
});

export function AdsProvider({ children }: { children: React.ReactNode }) {
  const { hasAds, tier } = useSubscription();
  const adsMod = useMemo(() => loadAdsModule(), []);
  const [adsReady, setAdsReady] = useState(false);
  const [rewardedViewsToday, setRewardedViewsToday] = useState(0);
  const interstitialRef = useRef<InstanceType<AdsNative['InterstitialAd']> | null>(null);
  const rewardedRef = useRef<InstanceType<AdsNative['RewardedAd']> | null>(null);

  const refreshRewardedCount = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const storedDate = await AsyncStorage.getItem(REWARDED_DATE_KEY);
    if (storedDate !== today) {
      await AsyncStorage.multiSet([[REWARDED_COUNT_KEY, '0'], [REWARDED_DATE_KEY, today]]);
      setRewardedViewsToday(0);
      return;
    }
    const n = Number(await AsyncStorage.getItem(REWARDED_COUNT_KEY) ?? '0');
    setRewardedViewsToday(n);
  }, []);

  useEffect(() => { void refreshRewardedCount(); }, [refreshRewardedCount, tier]);

  useEffect(() => {
    if (!adsMod || !hasAds) {
      setAdsReady(false);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { AdsConsent, default: mobileAds, InterstitialAd, AdEventType, RewardedAd, RewardedAdEventType } = adsMod;
        await AdsConsent.requestInfoUpdate();
        await AdsConsent.loadAndShowConsentFormIfRequired();
        await mobileAds().initialize();
        if (cancelled) return;

        const interstitial = InterstitialAd.createForAdRequest(pickAdUnit('interstitial'));
        interstitialRef.current = interstitial;
        interstitial.load();

        const rewarded = RewardedAd.createForAdRequest(pickAdUnit('rewarded'));
        rewardedRef.current = rewarded;
        rewarded.load();

        interstitial.addAdEventListener(AdEventType.CLOSED, () => interstitial.load());
        rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {});
        rewarded.addAdEventListener(RewardedAdEventType.CLOSED, () => rewarded.load());

        setAdsReady(true);
      } catch {
        setAdsReady(false);
      }
    })();

    return () => { cancelled = true; };
  }, [adsMod, hasAds]);

  const showInterstitial = useCallback(async () => {
    if (!hasAds || !adsMod || !interstitialRef.current) return;
    const last = Number(await AsyncStorage.getItem(LAST_INTERSTITIAL_KEY) ?? '0');
    if (Date.now() - last < INTERSTITIAL_MIN_INTERVAL_MS) return;
    const ad = interstitialRef.current;
    if (!ad.loaded) {
      ad.load();
      return;
    }
    await ad.show();
    await AsyncStorage.setItem(LAST_INTERSTITIAL_KEY, String(Date.now()));
  }, [adsMod, hasAds]);

  const showRewarded = useCallback(async (): Promise<boolean> => {
    if (!hasAds || !adsMod || !rewardedRef.current) return false;
    await refreshRewardedCount();
    const today = new Date().toISOString().slice(0, 10);
    const count = Number(await AsyncStorage.getItem(REWARDED_COUNT_KEY) ?? '0');
    if (count >= REWARDED_DAILY_LIMIT) return false;

    const ad = rewardedRef.current;
    if (!ad.loaded) {
      ad.load();
      return false;
    }

    return new Promise((resolve) => {
      const { RewardedAdEventType } = adsMod!;
      const unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, async () => {
        unsubEarned();
        unsubClosed();
        const next = count + 1;
        await AsyncStorage.multiSet([[REWARDED_COUNT_KEY, String(next)], [REWARDED_DATE_KEY, today]]);
        setRewardedViewsToday(next);
        resolve(true);
      });
      const unsubClosed = ad.addAdEventListener(RewardedAdEventType.CLOSED, () => {
        unsubEarned();
        unsubClosed();
        resolve(false);
      });
      ad.show().catch(() => resolve(false));
    });
  }, [adsMod, hasAds, refreshRewardedCount]);

  const canShowRewarded = hasAds && rewardedViewsToday < REWARDED_DAILY_LIMIT;

  const value = useMemo(() => ({
    adsReady,
    nativeAvailable: !!adsMod,
    showInterstitial,
    showRewarded,
    rewardedViewsToday,
    canShowRewarded,
  }), [adsReady, adsMod, showInterstitial, showRewarded, rewardedViewsToday, canShowRewarded]);

  return <AdsContext.Provider value={value}>{children}</AdsContext.Provider>;
}

export function useAds() {
  return useContext(AdsContext);
}

export { loadAdsModule } from '@/lib/adsNative';
