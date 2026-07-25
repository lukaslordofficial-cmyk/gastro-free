/**
 * AdMob — bezpieczny loader. W Expo Go NIE ładujemy natywnego modułu
 * (TurboModule RNGoogleMobileAdsModule nie istnieje → crash przy starcie).
 */
import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

export type AdsNative = typeof import('react-native-google-mobile-ads');

/** Expo Go / brak custom native build = reklamy wyłączone. */
export function isAdsNativeSupported(): boolean {
  if (Platform.OS === 'web') return false;
  // StoreClient = Expo Go
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) return false;
  // Dodatkowy sygnał (stare / edge)
  if (Constants.appOwnership === 'expo') return false;
  return true;
}

let cached: AdsNative | null | undefined;

/**
 * Lazy-load z cache. W Expo Go zawsze null — bez require() pakietu AdMob.
 */
export function loadAdsModule(): AdsNative | null {
  if (cached !== undefined) return cached;
  if (!isAdsNativeSupported()) {
    cached = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('react-native-google-mobile-ads') as AdsNative;
  } catch {
    cached = null;
  }
  return cached;
}
