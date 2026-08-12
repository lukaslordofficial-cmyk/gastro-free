/**
 * Przełącznik podzakładek w module Dostawcy.
 * U góry tylko: Dostawcy | Lokalni Przetwórcy.
 * (Dostawy są wewnątrz Lokalnych Przetwórców.)
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { Colors } from '@/constants/colors';
import { PremiumTokens } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { LOCAL_PRODUCERS_MODULE } from '@/types/localProducers';

const TABS = [
  { key: 'index', label: 'Dostawcy', href: '/(tabs)/dostawcy' as const },
  {
    key: 'lokalni',
    label: LOCAL_PRODUCERS_MODULE.tabLabel,
    href: '/(tabs)/dostawcy/lokalni-przetworcy' as const,
  },
] as const;

export function DostawcySubTabs() {
  const pathname = usePathname();
  const router = useRouter();
  const theme = useAppTheme();
  const isPremium = theme.isPremium;

  const activeKey =
    pathname.includes('lokalni-przetworcy')
    || pathname.includes('/producent/')
    || pathname.includes('/dostawy')
      ? 'lokalni'
      : 'index';

  return (
    <View
      style={[
        styles.row,
        {
          backgroundColor: isPremium ? 'rgba(255,255,255,0.06)' : Colors.borderLight,
          borderColor: isPremium ? 'rgba(255,255,255,0.12)' : Colors.border,
        },
      ]}
    >
      {TABS.map((tab) => {
        const active = tab.key === activeKey;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[
              styles.tab,
              active && {
                backgroundColor: isPremium ? PremiumTokens.color.neon : Colors.accent,
              },
            ]}
            onPress={() => {
              if (!active) router.replace(tab.href);
            }}
            activeOpacity={0.85}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
          >
            <Text
              style={[
                styles.label,
                {
                  color: active
                    ? isPremium
                      ? '#0A0A0A'
                      : '#fff'
                    : isPremium
                      ? 'rgba(255,255,255,0.65)'
                      : Colors.textSecondary,
                },
              ]}
              numberOfLines={1}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 8,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },
});
