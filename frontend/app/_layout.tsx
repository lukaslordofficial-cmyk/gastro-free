import 'react-native-gesture-handler';
import { useEffect } from 'react';
import { InteractionManager, LogBox } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { useIconFonts } from '@/src/hooks/use-icon-fonts';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { UiOverlayProvider } from '@/contexts/UiOverlayContext';
import { AdsProvider } from '@/contexts/AdsProvider';
import { ThemeModeProvider, useThemeMode } from '@/contexts/ThemeModeContext';
import { ProductCascadeHost } from '@/components/premium/ProductCascadeHost';
import { JarvisVoiceHost } from '@/components/JarvisVoiceHost';
import { DocumentScanHost } from '@/components/DocumentScanHost';
import { PremiumAlertProvider } from '@/components/PremiumAlert';
import { PushConsentBootstrap } from '@/components/PushConsentBootstrap';
import { warmProductImageIndexes } from '@/lib/productImages';

// Nie wyciszaj wszystkich logów w closed beta — widać prawdziwe błędy.
LogBox.ignoreLogs(['Unable to activate keep awake', 'KeepAwake']);

// W Expo Go keep-awake czasem nie jest dostępne — nie wolno crashować startu.
void SplashScreen.preventAutoHideAsync().catch(() => {});

function StatusBarThemed() {
  const { isPremiumUi } = useThemeMode();
  return <StatusBar style={isPremiumUi ? 'light' : 'dark'} />;
}

export default function RootLayout() {
  useFrameworkReady();
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [loaded, error]);

  // Po starcie UI: tylko indeks katalogów (require ids), bez dekodowania ~1000 bitmap do RAM.
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => {
      try {
        warmProductImageIndexes();
      } catch {
        /* ignore */
      }
    });
    return () => task.cancel();
  }, []);

  if (!loaded && !error) return null;

  return (
    <SafeAreaProvider>
      <ThemeModeProvider>
        <SubscriptionProvider>
          <PremiumAlertProvider>
          <PushConsentBootstrap />
          <UiOverlayProvider>
            <AdsProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="+not-found" />
              </Stack>
              <StatusBarThemed />
              <ProductCascadeHost />
              <JarvisVoiceHost />
              <DocumentScanHost />
            </AdsProvider>
          </UiOverlayProvider>
          </PremiumAlertProvider>
        </SubscriptionProvider>
      </ThemeModeProvider>
    </SafeAreaProvider>
  );
}
