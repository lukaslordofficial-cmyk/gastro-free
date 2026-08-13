import 'react-native-gesture-handler';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, InteractionManager, LogBox, View } from 'react-native';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import { useFrameworkReady } from '@/hooks/useFrameworkReady';
import { useIconFonts } from '@/src/hooks/use-icon-fonts';
import { AuthProvider, useAuth } from '@/contexts/AuthContext';
import { SubscriptionProvider } from '@/contexts/SubscriptionContext';
import { UiOverlayProvider } from '@/contexts/UiOverlayContext';
import { AdsProvider } from '@/contexts/AdsProvider';
import { ThemeModeProvider, useThemeMode } from '@/contexts/ThemeModeContext';
import { ProductCascadeHost } from '@/components/premium/ProductCascadeHost';
import { JarvisVoiceHost } from '@/components/JarvisVoiceHost';
import { DocumentScanHost } from '@/components/DocumentScanHost';
import { PremiumAlertProvider } from '@/components/PremiumAlert';
import { PushConsentBootstrap } from '@/components/PushConsentBootstrap';
import {
  LpPaymentReturnHost,
  ProducerShipmentWatcher,
  ProducerInvoiceWatcher,
} from '@/components/localProducers';
import { BrandSplash, BRAND_SPLASH_MIN_MS } from '@/components/BrandSplash';
import { warmProductImageIndexes } from '@/lib/productImages';
import { DS } from '@/constants/premiumTheme';


LogBox.ignoreLogs(['Unable to activate keep awake', 'KeepAwake']);
// Produkcja: nie spamuj LogBoxem (Metro i tak nie działa w store build).
if (!__DEV__) {
  LogBox.ignoreAllLogs(true);
}

// W Expo Go keep-awake czasem nie jest dostępne — nie wolno crashować startu.
void SplashScreen.preventAutoHideAsync().catch(() => {});

function StatusBarThemed() {
  const { isPremiumUi } = useThemeMode();
  return <StatusBar style={isPremiumUi ? 'light' : 'dark'} />;
}

function AuthGate({ children }: { children: React.ReactNode }) {
  const { ready, isAuthenticated } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  useEffect(() => {
    if (!ready) return;
    const root = String(segments[0] || '');
    const inAuth = root === '(auth)';
    const paymentReturn = root === 'lp' || root === 'success' || root === 'cancel';
    if (!isAuthenticated && !inAuth && !paymentReturn) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuth) {
      router.replace('/(tabs)');
    }
  }, [ready, isAuthenticated, segments, router]);

  if (!ready) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#0A120E',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color={DS.color.greenEnd} />
      </View>
    );
  }

  return <>{children}</>;
}

function RootLayoutNav() {
  return (
    <AuthGate>
      <SubscriptionProvider>
        <PremiumAlertProvider>
              <PushConsentBootstrap />
              <LpPaymentReturnHost />
              <ProducerShipmentWatcher />
              <ProducerInvoiceWatcher />
              <UiOverlayProvider>
            <AdsProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(auth)" options={{ headerShown: false }} />
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                <Stack.Screen name="lp" options={{ headerShown: false }} />
                <Stack.Screen name="success" options={{ headerShown: false }} />
                <Stack.Screen name="cancel" options={{ headerShown: false }} />
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
    </AuthGate>
  );
}

export default function RootLayout() {
  useFrameworkReady();
  const [loaded, error] = useIconFonts();
  const [showBrandSplash, setShowBrandSplash] = useState(true);
  const splashStarted = useRef(Date.now());
  const nativeHidden = useRef(false);

  useEffect(() => {
    if (!(loaded || error) || nativeHidden.current) return;
    nativeHidden.current = true;
    void SplashScreen.hideAsync().catch(() => {});
  }, [loaded, error]);

  useEffect(() => {
    if (!(loaded || error)) return;
    const elapsed = Date.now() - splashStarted.current;
    const wait = Math.max(0, BRAND_SPLASH_MIN_MS - elapsed);
    const t = setTimeout(() => setShowBrandSplash(false), wait);
    return () => clearTimeout(t);
  }, [loaded, error]);

  // Po starcie UI: tylko indeks katalogów składników (bez ciężkiego dishCatalog).
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
        <AuthProvider>
          <View style={{ flex: 1, backgroundColor: '#0A120E' }}>
            <RootLayoutNav />
            {showBrandSplash ? <BrandSplash /> : null}
          </View>
        </AuthProvider>
      </ThemeModeProvider>
    </SafeAreaProvider>
  );
}
