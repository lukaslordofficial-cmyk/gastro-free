/**
 * Layout zakładki Dostawcy — podzakładki:
 *  • Dostawcy (index) — istniejący ekran bez zmian logiki
 *  • Lokalni Przetwórcy — nowy, niezależny moduł
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Slot, usePathname } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DostawcySubTabs } from '@/components/localProducers';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';

export default function DostawcySectionLayout() {
  const theme = useAppTheme();
  const pathname = usePathname();
  const bg = theme.isPremium ? '#0A0A0A' : Colors.background;
  const hideSubTabs =
    pathname.includes('/producent/') || pathname.includes('/zamowienie/');

  return (
    <SafeAreaView
      style={[styles.root, { backgroundColor: bg }]}
      edges={hideSubTabs ? [] : ['top']}
    >
      {hideSubTabs ? null : <DostawcySubTabs />}
      <View style={styles.slot}>
        <Slot />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  slot: { flex: 1 },
});
