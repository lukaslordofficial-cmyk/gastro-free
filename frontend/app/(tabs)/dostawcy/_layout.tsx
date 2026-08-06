/**
 * Layout zakładki Dostawcy — podzakładki:
 *  • Dostawcy (index) — istniejący ekran bez zmian logiki
 *  • Lokalni Przetwórcy — nowy, niezależny moduł
 */
import React from 'react';
import { View, StyleSheet } from 'react-native';
import { Slot } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DostawcySubTabs } from '@/components/localProducers';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';

export default function DostawcySectionLayout() {
  const theme = useAppTheme();
  const bg = theme.isPremium ? '#0A0A0A' : Colors.background;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['top']}>
      <DostawcySubTabs />
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
