import { Tabs, usePathname } from 'expo-router';
import { TrendingUp, Package, UtensilsCrossed, Truck, Settings as SettingsIcon } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS, PremiumTokens } from '@/constants/premiumTheme';
import { Platform, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useEffect, useMemo, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAds } from '@/contexts/AdsProvider';
import { useThemeMode } from '@/contexts/ThemeModeContext';
import { BlurView } from 'expo-blur';

function TabInterstitialWatcher() {
  const pathname = usePathname();
  const prev = useRef<string | null>(null);
  const { showInterstitial } = useAds();

  useEffect(() => {
    if (prev.current && prev.current !== pathname) {
      void showInterstitial();
    }
    prev.current = pathname;
  }, [pathname, showInterstitial]);

  return null;
}

function PremiumTabBarBackground() {
  if (Platform.OS === 'ios') {
    return (
      <BlurView intensity={52} tint="dark" style={StyleSheet.absoluteFill}>
        <View style={styles.glassOverlay} />
      </BlurView>
    );
  }
  return <View style={[StyleSheet.absoluteFill, styles.androidGlass]} />;
}

function PremiumTabIcon({
  focused,
  children,
}: {
  focused: boolean;
  children: React.ReactNode;
}) {
  if (!focused) {
    return <View style={styles.tabIconIdle}>{children}</View>;
  }
  return (
    <View style={[styles.tabIconActiveWrap, DS.shadow.greenGlow]}>
      <LinearGradient
        colors={[...DS.gradient.green]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.tabIconActive}
      >
        {children}
      </LinearGradient>
    </View>
  );
}

export default function TabLayout() {
  const { isPremiumUi } = useThemeMode();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 10) + (isPremiumUi ? 12 : 10);
  const tabHeight = (isPremiumUi ? 56 : 52) + bottomPad;

  const screenOptions = useMemo(
    () => ({
      headerShown: false as const,
      lazy: true,
      tabBarActiveTintColor: isPremiumUi ? PremiumTokens.color.neon : Colors.tabActive,
      tabBarInactiveTintColor: isPremiumUi ? PremiumTokens.color.textMuted : Colors.tabInactive,
      tabBarStyle: [
        styles.tabBar,
        {
          height: tabHeight,
          paddingBottom: bottomPad,
          paddingTop: isPremiumUi ? 10 : 8,
        },
        isPremiumUi && {
          backgroundColor: 'transparent',
          borderTopColor: PremiumTokens.color.glassBorder,
          borderTopWidth: StyleSheet.hairlineWidth,
          elevation: 16,
          shadowColor: '#00FF88',
          shadowOffset: { width: 0, height: -4 },
          shadowOpacity: 0.12,
          shadowRadius: 16,
        },
      ],
      tabBarBackground: isPremiumUi ? () => <PremiumTabBarBackground /> : undefined,
      tabBarAllowFontScaling: false,
      tabBarLabelStyle: [
        styles.tabLabel,
        isPremiumUi && { fontSize: 9, fontWeight: '600' as const, marginTop: 1 },
      ],
      tabBarItemStyle: [styles.tabItem, isPremiumUi && { paddingHorizontal: 0, minWidth: 0 }],
      tabBarIconStyle: isPremiumUi ? { marginBottom: -2 } : undefined,
    }),
    [isPremiumUi, tabHeight, bottomPad],
  );

  return (
    <>
      <TabInterstitialWatcher />
      <Tabs screenOptions={screenOptions}>
        <Tabs.Screen
          name="index"
          options={{
            title: 'Finanse',
            tabBarIcon: ({ color, size, focused }) => (
              isPremiumUi ? (
                <PremiumTabIcon focused={focused}>
                  <TrendingUp
                    size={focused ? 18 : 18}
                    color={focused ? '#0A0A0A' : color}
                    strokeWidth={PremiumTokens.icon.stroke}
                  />
                </PremiumTabIcon>
              ) : (
                <TrendingUp size={size} color={color} strokeWidth={PremiumTokens.icon.stroke} />
              )
            ),
          }}
        />
        <Tabs.Screen
          name="magazyn"
          options={{
            title: 'Magazyn',
            tabBarIcon: ({ color, size, focused }) => (
              isPremiumUi ? (
                <PremiumTabIcon focused={focused}>
                  <Package
                    size={18}
                    color={focused ? '#0A0A0A' : color}
                    strokeWidth={PremiumTokens.icon.stroke}
                  />
                </PremiumTabIcon>
              ) : (
                <Package size={size} color={color} strokeWidth={PremiumTokens.icon.stroke} />
              )
            ),
          }}
        />
        <Tabs.Screen
          name="menu"
          options={{
            title: 'Menu',
            tabBarIcon: ({ color, size, focused }) => (
              isPremiumUi ? (
                <PremiumTabIcon focused={focused}>
                  <UtensilsCrossed
                    size={18}
                    color={focused ? '#0A0A0A' : color}
                    strokeWidth={PremiumTokens.icon.stroke}
                  />
                </PremiumTabIcon>
              ) : (
                <UtensilsCrossed size={size} color={color} strokeWidth={PremiumTokens.icon.stroke} />
              )
            ),
          }}
        />
        <Tabs.Screen
          name="dostawcy"
          options={{
            title: 'Dostawcy',
            tabBarIcon: ({ color, size, focused }) => (
              isPremiumUi ? (
                <PremiumTabIcon focused={focused}>
                  <Truck
                    size={18}
                    color={focused ? '#0A0A0A' : color}
                    strokeWidth={PremiumTokens.icon.stroke}
                  />
                </PremiumTabIcon>
              ) : (
                <Truck size={size} color={color} strokeWidth={PremiumTokens.icon.stroke} />
              )
            ),
          }}
        />
        <Tabs.Screen
          name="ustawienia"
          options={{
            title: 'Ustawienia',
            tabBarIcon: ({ color, size, focused }) => (
              isPremiumUi ? (
                <PremiumTabIcon focused={focused}>
                  <SettingsIcon
                    size={18}
                    color={focused ? '#0A0A0A' : color}
                    strokeWidth={PremiumTokens.icon.stroke}
                  />
                </PremiumTabIcon>
              ) : (
                <SettingsIcon size={size} color={color} strokeWidth={PremiumTokens.icon.stroke} />
              )
            ),
          }}
        />
      </Tabs>
    </>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: Colors.tabBackground,
    borderTopColor: Colors.border,
    borderTopWidth: 1,
    paddingTop: 8,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 8,
  },
  tabLabel: {
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0,
  },
  tabItem: {
    gap: 2,
  },
  tabIconIdle: {
    width: 36,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabIconActiveWrap: {
    borderRadius: 10,
  },
  tabIconActive: {
    width: 36,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glassOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(12,12,12,0.52)',
  },
  androidGlass: {
    backgroundColor: 'rgba(14,14,14,0.96)',
  },
});
