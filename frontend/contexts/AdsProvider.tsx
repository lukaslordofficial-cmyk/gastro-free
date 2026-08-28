/**
 * AdMob — inicjalizacja, zgoda RODO (UMP), banery + interstitiale.
 * Reklamy tylko gdy hasAds = Free po zakończonym trialu 30 dni
 * (albo EXPO_PUBLIC_FORCE_ADS=1 na preview).
 * Brak rewarded / wymiany wideo za kredyty.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { INTERSTITIAL_MIN_INTERVAL_MS, pickAdUnit } from '@/lib/adConfig';
import { loadAdsModule, type AdsNative } from '@/lib/adsNative';

const LAST_INTERSTITIAL_KEY = 'gastro_last_interstitial_ts';

type AdsContextValue = {
  adsReady: boolean;
  nativeAvailable: boolean;
  showInterstitial: () => Promise<void>;
};

const AdsContext = createContext<AdsContextValue>({
  adsReady: false,
  nativeAvailable: false,
  showInterstitial: async () => {},
});

export function AdsProvider({ children }: { children: React.ReactNode }) {
  const { hasAds } = useSubscription();
  const adsMod = useMemo(() => loadAdsModule(), []);
  const [adsReady, setAdsReady] = useState(false);
  const interstitialRef = useRef<InstanceType<AdsNative['InterstitialAd']> | null>(null);

  useEffect(() => {
    if (!adsMod || !hasAds) {
      setAdsReady(false);
      interstitialRef.current = null;
      return;
    }

    let cancelled = false;
    (async () => {
      const {
        AdsConsent,
        default: mobileAds,
        InterstitialAd,
        AdEventType,
      } = adsMod;

      try {
        await Promise.race([
          (async () => {
            await AdsConsent.requestInfoUpdate();
            await AdsConsent.loadAndShowConsentFormIfRequired();
          })(),
          new Promise<void>((resolve) => setTimeout(resolve, 6000)),
        ]);
      } catch (e) {
        if (__DEV__) console.warn('[ads] UMP/consent — lecimy dalej', e);
      }

      try {
        await Promise.race([
          mobileAds().initialize(),
          new Promise<void>((resolve) => setTimeout(resolve, 8000)),
        ]);
      } catch (e) {
        if (__DEV__) console.warn('[ads] mobileAds.initialize', e);
      }

      if (cancelled) return;

      try {
        const interstitial = InterstitialAd.createForAdRequest(pickAdUnit('interstitial'));
        interstitialRef.current = interstitial;
        interstitial.load();
        interstitial.addAdEventListener(AdEventType.CLOSED, () => interstitial.load());
      } catch (e) {
        if (__DEV__) console.warn('[ads] interstitial', e);
      }

      if (!cancelled) setAdsReady(true);
    })();

    return () => {
      cancelled = true;
    };
  }, [adsMod, hasAds]);

  const showInterstitial = useCallback(async () => {
    if (!hasAds || !adsMod || !interstitialRef.current) return;
    try {
      const last = Number(await AsyncStorage.getItem(LAST_INTERSTITIAL_KEY) ?? '0');
      if (Date.now() - last < INTERSTITIAL_MIN_INTERVAL_MS) return;
      const ad = interstitialRef.current;
      if (!ad.loaded) {
        ad.load();
        return;
      }
      const shown = ad.show();
      const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2500));
      await Promise.race([shown, timeout]);
      await AsyncStorage.setItem(LAST_INTERSTITIAL_KEY, String(Date.now()));
    } catch {
      /* reklama nie może blokować nawigacji */
    }
  }, [adsMod, hasAds]);

  const value = useMemo(
    () => ({
      adsReady,
      nativeAvailable: !!adsMod,
      showInterstitial,
    }),
    [adsReady, adsMod, showInterstitial],
  );

  return <AdsContext.Provider value={value}>{children}</AdsContext.Provider>;
}

export function useAds() {
  return useContext(AdsContext);
}

export { loadAdsModule } from '@/lib/adsNative';
