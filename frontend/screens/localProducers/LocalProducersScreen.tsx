/**
 * Ekran modułu „Lokalni Przetwórcy”.
 * Lista aktywnych + zweryfikowanych producentów (Realtime).
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
import { LOCAL_PRODUCERS_MODULE, type LocalProducer } from '@/types/localProducers';
import { formatPlnNumber } from '@/lib/format';

function ProducerCard({
  item,
  isPremium,
}: {
  item: LocalProducer;
  isPremium: boolean;
}) {
  const titleColor = isPremium ? '#F5F5F5' : Colors.textPrimary;
  const muted = isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary;
  const cardBg = isPremium ? 'rgba(255,255,255,0.06)' : Colors.card;
  const border = isPremium ? 'rgba(255,255,255,0.10)' : Colors.border;
  const place = [item.city, item.voivodeship].filter(Boolean).join(', ');

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
      <Text style={[styles.cardTitle, { color: titleColor }]} numberOfLines={2}>
        {item.company_name}
      </Text>
      {place ? (
        <Text style={[styles.cardMeta, { color: muted }]} numberOfLines={1}>
          {place}
        </Text>
      ) : null}
      {item.description ? (
        <Text style={[styles.cardDesc, { color: muted }]} numberOfLines={3}>
          {item.description}
        </Text>
      ) : null}
      <Text style={[styles.cardMeta, { color: muted }]}>
        Min. zamówienie: {formatPlnNumber(Number(item.min_order_value) || 0)} zł
        {item.pickup_available ? ' · odbiór' : ''}
        {item.courier_available ? ' · kurier' : ''}
      </Text>
    </View>
  );
}

export function LocalProducersScreen() {
  const theme = useAppTheme();
  const { items, loading, error, refreshing, refresh, backendReady } = useLocalProducers();
  const bg = theme.isPremium ? '#0A0A0A' : Colors.background;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={[]}>
      <PremiumTabChrome
        title={LOCAL_PRODUCERS_MODULE.title}
        subtitle="Marketplace lokalnych producentów"
        meta={
          backendReady
            ? `${items.length} zweryfikowanych`
            : 'Skonfiguruj Supabase (.env)'
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
              Aktualizacja na żywo · tylko verified + active · bez dostawców Resto
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

              {items.length === 0 ? (
                <LocalProducersEmptyState
                  title="Brak zweryfikowanych producentów"
                  message="Gdy rolnik doda ofertę na stronie i admin oznaczy profil jako verified, pojawi się tutaj u wszystkich restauratorów (Realtime)."
                />
              ) : (
                items.map((item) => (
                  <ProducerCard key={item.id} item={item} isPremium={!!theme.isPremium} />
                ))
              )}
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
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 10,
  },
  error: {
    textAlign: 'center',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 8,
    fontSize: 13,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    gap: 4,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  cardMeta: {
    fontSize: 12,
    fontWeight: '500',
  },
  cardDesc: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
});

export default LocalProducersScreen;
