import React, { useMemo } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAds } from '@/contexts/AdsProvider';
import { loadAdsModule } from '@/lib/adsNative';
import { pickAdUnit } from '@/lib/adConfig';

type Props = { testID?: string };

/**
 * Baner AdMob — tylko gdy hasAds (Free po zakończonym trialu).
 * W Expo Go / bez natywnego modułu: nic nie renderuje.
 */
export function AdBannerFooter({ testID = 'ad-banner-footer' }: Props) {
  const { hasAds } = useSubscription();
  const { adsReady, nativeAvailable } = useAds();
  const adsMod = useMemo(() => loadAdsModule(), []);

  if (!hasAds || !nativeAvailable || !adsReady || !adsMod) {
    return null;
  }

  const { BannerAd, BannerAdSize } = adsMod;

  return (
    <View style={styles.wrap} testID={testID} pointerEvents="box-none">
      <BannerAd
        unitId={pickAdUnit('banner')}
        size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
        requestOptions={{ requestNonPersonalizedAdsOnly: true }}
        onAdFailedToLoad={() => {
          /* cicho — brak miejsca na spam błędów */
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 4,
    paddingBottom: Platform.OS === 'ios' ? 2 : 4,
    minHeight: 50,
  },
});
