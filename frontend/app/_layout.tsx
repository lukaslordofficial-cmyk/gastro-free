import 'react-native-gesture-handler';
import { useEffect } from 'react';
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
    const inAuth = segments[0] === '(auth)';
    if (!isAuthenticated && !inAuth) {
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
          backgroundColor: DS.color.bgPrimary,
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
          <UiOverlayProvider>
            <AdsProvider>
              <Stack screenOptions={{ headerShown: false }}>
                <Stack.Screen name="(auth)" options={{ headerShown: false }} />
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
    </AuthGate>
  );
}

export default function RootLayout() {
  useFrameworkReady();
  const [loaded, error] = useIconFonts();

  useEffect(() => {
    if (loaded || error) {
      void SplashScreen.hideAsync().catch(() => {});
    }
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
          <RootLayoutNav />
        </AuthProvider>
      </ThemeModeProvider>
    </SafeAreaProvider>
  );
}
