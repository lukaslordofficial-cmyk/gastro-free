import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { pickAdUnit } from '@/lib/adConfig';
import { loadAdsModule } from '@/lib/adsNative';

type Props = { testID?: string };

export function AdBannerFooter({ testID = 'ad-banner-footer' }: Props) {
  const { hasAds } = useSubscription();
  const { hideAds } = useUiOverlay();
  const adsMod = loadAdsModule();

  if (!hasAds || hideAds || !adsMod || Platform.OS === 'web') return null;

  try {
    const { BannerAd, BannerAdSize } = adsMod;
    return (
      <View style={styles.wrap} testID={testID}>
        <BannerAd
          unitId={pickAdUnit('banner')}
          size={BannerAdSize.ANCHORED_ADAPTIVE_BANNER}
          requestOptions={{ requestNonPersonalizedAdsOnly: false }}
        />
      </View>
    );
  } catch {
    return null;
  }
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    paddingVertical: 4,
    backgroundColor: 'transparent',
  },
});
