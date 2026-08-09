/**
 * AdMob — inicjalizacja, zgoda RODO (UMP), banery + interstitiale.
 * Reklamy tylko gdy hasAds = Free po zakończonym trialu 30 dni.
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
      try {
        const {
          AdsConsent,
          default: mobileAds,
          InterstitialAd,
          AdEventType,
        } = adsMod;
        await AdsConsent.requestInfoUpdate();
        await AdsConsent.loadAndShowConsentFormIfRequired();
        await mobileAds().initialize();
        if (cancelled) return;

        const interstitial = InterstitialAd.createForAdRequest(pickAdUnit('interstitial'));
        interstitialRef.current = interstitial;
        interstitial.load();
        interstitial.addAdEventListener(AdEventType.CLOSED, () => interstitial.load());

        setAdsReady(true);
      } catch {
        setAdsReady(false);
      }
    })();

    return () => {
      cancelled = true;
    };
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
