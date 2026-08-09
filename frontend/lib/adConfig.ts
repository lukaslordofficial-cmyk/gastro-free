import { Platform } from 'react-native';

const APP_ID = 'ca-app-pub-7415277897076822~9839286987';

export const ADMOB_APP_IDS = {
  android: process.env.EXPO_PUBLIC_ADMOB_ANDROID_APP_ID ?? APP_ID,
  ios: process.env.EXPO_PUBLIC_ADMOB_IOS_APP_ID ?? APP_ID,
};

export const AD_UNITS = {
  banner: Platform.select({
    ios: process.env.EXPO_PUBLIC_ADMOB_BANNER_IOS ?? 'ca-app-pub-7415277897076822/3324327010',
    android: process.env.EXPO_PUBLIC_ADMOB_BANNER_ANDROID ?? 'ca-app-pub-7415277897076822/3324327010',
    default: 'ca-app-pub-7415277897076822/3324327010',
  })!,
  interstitial: Platform.select({
    ios: process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_IOS ?? 'ca-app-pub-7415277897076822/5904745552',
    android: process.env.EXPO_PUBLIC_ADMOB_INTERSTITIAL_ANDROID ?? 'ca-app-pub-7415277897076822/5904745552',
    default: 'ca-app-pub-7415277897076822/5904745552',
  })!,
  rewarded: Platform.select({
    ios: process.env.EXPO_PUBLIC_ADMOB_REWARDED_IOS ?? 'ca-app-pub-7415277897076822/2470410344',
    android: process.env.EXPO_PUBLIC_ADMOB_REWARDED_ANDROID ?? 'ca-app-pub-7415277897076822/2470410344',
    default: 'ca-app-pub-7415277897076822/2470410344',
  })!,
};

/** Google test IDs — używane w __DEV__ gdy EXPO_PUBLIC_ADMOB_USE_TEST_IDS=1 */
export const TEST_AD_UNITS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
};

export const INTERSTITIAL_MIN_INTERVAL_MS = 7 * 60 * 1000;
/** @deprecated — rewarded za kredyty wyłączone */
export const REWARDED_DAILY_LIMIT = 0;

export function pickAdUnit(kind: keyof typeof AD_UNITS): string {
  if (__DEV__ && process.env.EXPO_PUBLIC_ADMOB_USE_TEST_IDS === '1') {
    return TEST_AD_UNITS[kind];
  }
  return AD_UNITS[kind];
}
