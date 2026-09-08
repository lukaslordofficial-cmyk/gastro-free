/**
 * AdMob units. Native App ID siedzi w app.json (plugin react-native-google-mobile-ads).
 * Package: pl.gastromanager.app — w AdMob musi być aplikacja z TYM package,
 * inaczej baner na APK nie wypełni się (stary com.emergent… nie pasuje).
 */
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

/** Google test IDs — Metro/__DEV__, albo gdy EXPO_PUBLIC_ADMOB_USE_TEST_IDS=1 (EAS preview). */
export const TEST_AD_UNITS = {
  banner: 'ca-app-pub-3940256099942544/6300978111',
  interstitial: 'ca-app-pub-3940256099942544/1033173712',
  rewarded: 'ca-app-pub-3940256099942544/5224354917',
};

export const INTERSTITIAL_MIN_INTERVAL_MS = 5 * 60 * 1000;
/** Minimalny odstęp między reklamami po akcji (zapis dostawcy itd.). */
export const ACTION_INTERSTITIAL_MIN_MS = 90 * 1000;
/** Limit nagród za reklamę / dzień (klient UI + backend). */
export const REWARDED_DAILY_LIMIT = Math.max(
  0,
  Number(process.env.EXPO_PUBLIC_AD_REWARD_DAILY_LIMIT || '5') || 5,
);

/**
 * Live units when:
 * - EAS `production` profile (no EXPO_PUBLIC_ADMOB_USE_TEST_IDS), or
 * - EXPO_PUBLIC_ADMOB_USE_LIVE=1 on any build.
 * Test units when: Metro (__DEV__), or EAS preview / preview-apk (TEST_IDS=1).
 */
export function useTestAdUnits(): boolean {
  if (process.env.EXPO_PUBLIC_ADMOB_USE_LIVE === '1') return false;
  if (__DEV__) return true;
  const flag = (process.env.EXPO_PUBLIC_ADMOB_USE_TEST_IDS ?? '').trim().toLowerCase();
  return flag === '1' || flag === 'true' || flag === 'yes';
}

export function pickAdUnit(kind: keyof typeof AD_UNITS): string {
  if (useTestAdUnits()) return TEST_AD_UNITS[kind];
  return AD_UNITS[kind];
}
