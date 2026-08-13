/**
 * Lista marketplace + wewnętrzna zakładka Dostawy.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronRight, MapPin, Search } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { PremiumTabChrome } from '@/components/premium/PremiumTabChrome';
import { LocalProducersEmptyState } from '@/components/localProducers';
import { useLocalProducers } from '@/hooks/localProducers';
import { DeliveriesPanel } from '@/screens/localProducers/DeliveriesScreen';
import {
  LOCAL_PRODUCERS_MODULE,
  type LocalProducerWithDistance,
} from '@/types/localProducers';
import { formatPlnNumber } from '@/lib/format';
import { formatDistanceKm } from '@/lib/localProducers/haversine';

const DS_NEON = '#00FF88';

type InnerTab = 'producers' | 'deliveries';

function ProducerCard({
  item,
  isPremium,
  onPress,
}: {
  item: LocalProducerWithDistance;
  isPremium: boolean;
  onPress: () => void;
}) {
  const titleColor = isPremium ? '#F5F5F5' : Colors.textPrimary;
  const muted = isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary;
  const cardBg = isPremium ? 'rgba(255,255,255,0.06)' : Colors.card;
  const border = isPremium ? 'rgba(255,255,255,0.10)' : Colors.border;
  const place = [item.city, item.voivodeship].filter(Boolean).join(', ');

  return (
    <TouchableOpacity
      activeOpacity={0.85}
      onPress={onPress}
      style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}
    >
      <View style={styles.cardTop}>
        {item.logo_url ? (
          <Image source={{ uri: item.logo_url }} style={styles.logo} />
        ) : (
          <View style={[styles.logo, styles.logoFallback]}>
            <MapPin size={18} color={muted} />
          </View>
        )}
        <View style={styles.cardBody}>
          <Text style={[styles.cardTitle, { color: titleColor }]} numberOfLines={2}>
            {String(item.company_name || 'Dystrybutor')}
          </Text>
          {place ? (
            <Text style={[styles.cardMeta, { color: muted }]} numberOfLines={1}>
              {place}
            </Text>
          ) : null}
          <Text style={[styles.cardMeta, { color: muted }]}>
            {formatDistanceKm(item.distanceKm)}
            {' · '}
            Min. {formatPlnNumber(Number(item.min_order_value) || 0)} zł
            {item.courier_available ? ' · kurier' : ''}
          </Text>
        </View>
        <ChevronRight size={18} color={muted} />
      </View>
    </TouchableOpacity>
  );
}

export function LocalProducersScreen() {
  const theme = useAppTheme();
  const router = useRouter();
  const [innerTab, setInnerTab] = useState<InnerTab>('producers');
  const [query, setQuery] = useState('');
  const {
    items,
    loading,
    error,
    refreshing,
    refresh,
    backendReady,
    permissionDenied,
  } = useLocalProducers({ query: query.trim() || undefined });

  const bg = theme.isPremium ? '#0A0A0A' : Colors.background;
  const muted = theme.isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary;
  const inputBg = theme.isPremium ? 'rgba(255,255,255,0.06)' : Colors.card;
  const border = theme.isPremium ? 'rgba(255,255,255,0.12)' : Colors.border;
  const textColor = theme.isPremium ? '#F5F5F5' : Colors.textPrimary;
  const isPremium = !!theme.isPremium;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: bg }]} edges={[]}>
      <PremiumTabChrome
        title={LOCAL_PRODUCERS_MODULE.title}
        subtitle="Marketplace lokalnych producentów"
        meta={
          innerTab === 'deliveries'
            ? 'Twoje dostawy'
            : backendReady
              ? `${items.length} zatwierdzonych`
              : 'Skonfiguruj Supabase (.env)'
        }
        floatNames={['chleb', 'ser', 'miód', 'warzywa']}
      >
        <View style={styles.body}>
          <View
            style={[
              styles.innerTabs,
              {
                backgroundColor: isPremium ? 'rgba(255,255,255,0.06)' : Colors.borderLight,
                borderColor: border,
              },
            ]}
          >
            {(
              [
                { key: 'producers' as const, label: 'Producenci' },
                { key: 'deliveries' as const, label: 'Dostawy' },
              ]
            ).map((tab) => {
              const active = innerTab === tab.key;
              return (
                <TouchableOpacity
                  key={tab.key}
                  style={[
                    styles.innerTab,
                    active && {
                      backgroundColor: isPremium ? DS_NEON : Colors.accent,
                    },
                  ]}
                  onPress={() => setInnerTab(tab.key)}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Text
                    style={[
                      styles.innerTabLabel,
                      {
                        color: active
                          ? isPremium
                            ? '#0A0A0A'
                            : '#fff'
                          : muted,
                      },
                    ]}
                  >
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {innerTab === 'deliveries' ? (
            <DeliveriesPanel />
          ) : (
            <>
              <View style={[styles.searchWrap, { backgroundColor: inputBg, borderColor: border }]}>
                <Search size={16} color={muted} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Szukaj producenta, miasta…"
                  placeholderTextColor={muted}
                  style={[styles.searchInput, { color: textColor }]}
                  autoCorrect={false}
                />
              </View>

              <Text style={[styles.badgeText, { color: muted }]}>
                Tylko approved + verified + active
                {permissionDenied ? ' · włącz GPS, by sortować po km' : ' · sortowanie po dystansie'}
              </Text>

              {loading && !refreshing ? (
                <View style={styles.center}>
                  <ActivityIndicator color={isPremium ? DS_NEON : Colors.accent} />
                </View>
              ) : (
                <ScrollView
                  contentContainerStyle={styles.scroll}
                  refreshControl={
                    <RefreshControl
                      refreshing={refreshing}
                      onRefresh={refresh}
                      tintColor={isPremium ? DS_NEON : Colors.accent}
                    />
                  }
                >
                  {error ? (
                    <Text style={[styles.error, { color: Colors.danger }]}>{error}</Text>
                  ) : null}

                  {items.length === 0 ? (
                    <LocalProducersEmptyState
                      title="Brak zatwierdzonych producentów"
                      message="Widoczni są tylko producenci z verification_status = approved (po akceptacji w panelu admina WWW)."
                    />
                  ) : (
                    items.map((item) => (
                      <ProducerCard
                        key={item.id}
                        item={item}
                        isPremium={isPremium}
                        onPress={() =>
                          router.push({
                            pathname: '/(tabs)/dostawcy/producent/[id]',
                            params: { id: item.id },
                          })
                        }
                      />
                    ))
                  )}
                </ScrollView>
              )}
            </>
          )}
        </View>
      </PremiumTabChrome>
    </SafeAreaView>
  );
}

export default LocalProducersScreen;

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1 },
  innerTabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  innerTab: {
    flex: 1,
    paddingVertical: 9,
    borderRadius: 9,
    alignItems: 'center',
  },
  innerTabLabel: { fontSize: 12, fontWeight: '700' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  badgeText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '500',
    paddingHorizontal: 16,
    paddingBottom: 8,
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
    paddingBottom: 8,
    fontSize: 13,
  },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 12,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logo: { width: 48, height: 48, borderRadius: 10, backgroundColor: '#1a1a1a' },
  logoFallback: { alignItems: 'center', justifyContent: 'center' },
  cardBody: { flex: 1, gap: 2 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  cardMeta: { fontSize: 12, fontWeight: '500' },
});
