/**
 * Ekran modułu „Lokalni Przetwórcy” (ETAP 1 — szkielet).
 * Nie korzysta z suppliersService / OrderModal dostawców restauracyjnych.
 */
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MapPin } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { PremiumTabChrome } from '@/components/premium/PremiumTabChrome';
import { LocalProducersEmptyState } from '@/components/localProducers';
import { useLocalProducers } from '@/hooks/localProducers';
import { LOCAL_PRODUCERS_MODULE } from '@/types/localProducers';

export function LocalProducersScreen() {
  const theme = useAppTheme();
  const { items, loading, error, refreshing, refresh, backendReady } = useLocalProducers();

  const bg = theme.isPremium ? '#0A0A0A' : Colors.background;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={[]}>
      <PremiumTabChrome
        title={LOCAL_PRODUCERS_MODULE.title}
        subtitle="Panel lokalnych przetwórców"
        meta={
          backendReady
            ? `${items.length} producentów`
            : 'Supabase — wspólny projekt'
        }
        floatNames={['chleb', 'ser', 'miód', 'warzywa']}
      >
        <View style={styles.body}>
          <View style={styles.badgeRow}>
            <MapPin
              size={14}
              color={theme.isPremium ? DS_NEON : Colors.accent}
              strokeWidth={2}
            />
            <Text
              style={[
                styles.badgeText,
                { color: theme.isPremium ? 'rgba(255,255,255,0.7)' : Colors.textSecondary },
              ]}
            >
              Osobna warstwa · ten sam projekt Supabase · bez katalogu dostawców Resto
            </Text>
          </View>

          {loading && !refreshing ? (
            <View style={styles.center}>
              <ActivityIndicator color={theme.isPremium ? DS_NEON : Colors.accent} />
            </View>
          ) : (
            <ScrollView
              contentContainerStyle={styles.scroll}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={refresh}
                  tintColor={theme.isPremium ? DS_NEON : Colors.accent}
                />
              }
            >
              {error ? (
                <Text style={[styles.error, { color: Colors.danger }]}>{error}</Text>
              ) : null}
              <LocalProducersEmptyState
                title={items.length ? undefined : 'Lokalni Przetwórcy — ETAP 1'}
                message={
                  items.length
                    ? undefined
                    : 'Architektura modułu jest gotowa. W kolejnych etapach: tabele Supabase, lista producentów, produkty i zamówienia — bez zmian w obecnym systemie dostawców.'
                }
              />
            </ScrollView>
          )}
        </View>
      </PremiumTabChrome>
    </SafeAreaView>
  );
}

const DS_NEON = '#00FF88';

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1 },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  badgeText: {
    flex: 1,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
  },
  scroll: {
    flexGrow: 1,
    paddingBottom: 24,
  },
  error: {
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingTop: 12,
    fontSize: 13,
  },
});

export default LocalProducersScreen;
