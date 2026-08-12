/**
 * Dostawy LP — status zamówień (oczekujące / w drodze / doręczone).
 * Osadzone pod „Lokalni Przetwórcy” (nie jako osobny kafelek u góry).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { Package, Truck, CheckCircle2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useFocusEffect } from 'expo-router';
import { listMyProducerOrders } from '@/services/localProducers/localProducersService';
import {
  deliveryBucketForOrder,
  type DeliveryBucket,
  type ProducerOrderWithProducer,
} from '@/types/localProducers';
import { formatPlnNumber } from '@/lib/format';

const DS_NEON = '#00FF88';

const SUB_TABS: { key: DeliveryBucket; label: string }[] = [
  { key: 'pending', label: 'Oczekujące' },
  { key: 'in_transit', label: 'W drodze' },
  { key: 'delivered', label: 'Doręczone' },
];

function statusLabel(order: ProducerOrderWithProducer): string {
  const pay = String(order.payment_status || '').toLowerCase();
  const ship = String(order.shipment_status || '').toLowerCase();
  if (pay !== 'paid') return 'Oczekuje na płatność';
  if (ship === 'delivered') return 'Doręczone';
  if (ship === 'shipped') return 'Kurier w drodze';
  if (ship === 'preparing' || ship === 'confirmed') return 'Przygotowywane u przetwórcy';
  return 'Oczekujące';
}

function OrderCard({
  order,
  isPremium,
}: {
  order: ProducerOrderWithProducer;
  isPremium: boolean;
}) {
  const titleColor = isPremium ? '#F5F5F5' : Colors.textPrimary;
  const muted = isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary;
  const cardBg = isPremium ? 'rgba(255,255,255,0.06)' : Colors.card;
  const border = isPremium ? 'rgba(255,255,255,0.10)' : Colors.border;
  const company = order.local_producers?.company_name || 'Lokalny przetwórca';
  const tracking = (order.delivery_tracking || '').trim();
  const created = order.created_at
    ? new Date(order.created_at).toLocaleString('pl-PL', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
      <Text style={[styles.cardTitle, { color: titleColor }]} numberOfLines={2}>
        {company}
      </Text>
      <Text style={[styles.meta, { color: muted }]}>
        {statusLabel(order)}
        {' · '}
        {formatPlnNumber(Number(order.total_price) || 0)} zł
      </Text>
      <Text style={[styles.meta, { color: muted }]}>Złożono: {created}</Text>
      <Text style={[styles.meta, { color: muted }]}>
        ID: {String(order.id).slice(0, 8)}…
      </Text>
      {tracking ? (
        <Text style={[styles.tracking, { color: isPremium ? DS_NEON : Colors.accent }]}>
          Przesyłka: {tracking}
        </Text>
      ) : null}
      {deliveryBucketForOrder(order) === 'in_transit' ? (
        <Text style={[styles.eta, { color: muted }]}>
          Spodziewane doręczenie: zwykle 1–2 dni robocze.
        </Text>
      ) : null}
    </View>
  );
}

/** Panel Dostawy — używany wewnątrz Lokalnych Przetwórców. */
export function DeliveriesPanel() {
  const theme = useAppTheme();
  const isPremium = !!theme.isPremium;
  const [bucket, setBucket] = useState<DeliveryBucket>('pending');
  const [orders, setOrders] = useState<ProducerOrderWithProducer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (soft?: boolean) => {
    if (!soft) setLoading(true);
    setError(null);
    try {
      const rows = await listMyProducerOrders();
      setOrders(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się pobrać dostaw');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const filtered = useMemo(
    () => orders.filter((o) => deliveryBucketForOrder(o) === bucket),
    [orders, bucket],
  );

  const counts = useMemo(() => {
    const c = { pending: 0, in_transit: 0, delivered: 0 };
    for (const o of orders) c[deliveryBucketForOrder(o)] += 1;
    return c;
  }, [orders]);

  const emptyIcon =
    bucket === 'delivered' ? CheckCircle2 : bucket === 'in_transit' ? Truck : Package;
  const EmptyIcon = emptyIcon;

  return (
    <View style={styles.root}>
      <Text
        style={[
          styles.sub,
          { color: isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary },
        ]}
      >
        Status zamówień od lokalnych przetwórców
      </Text>

      <View
        style={[
          styles.subTabs,
          {
            backgroundColor: isPremium ? 'rgba(255,255,255,0.06)' : Colors.borderLight,
            borderColor: isPremium ? 'rgba(255,255,255,0.12)' : Colors.border,
          },
        ]}
      >
        {SUB_TABS.map((t) => {
          const active = t.key === bucket;
          return (
            <TouchableOpacity
              key={t.key}
              style={[
                styles.subTab,
                active && {
                  backgroundColor: isPremium ? DS_NEON : Colors.accent,
                },
              ]}
              onPress={() => setBucket(t.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text
                style={[
                  styles.subTabLabel,
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
                {t.label}
                {counts[t.key] ? ` (${counts[t.key]})` : ''}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator
          style={{ marginTop: 28 }}
          color={isPremium ? DS_NEON : Colors.accent}
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(true);
              }}
              tintColor={isPremium ? DS_NEON : Colors.accent}
            />
          }
        >
          {error ? (
            <Text style={[styles.empty, { color: '#DC2626' }]}>{error}</Text>
          ) : null}
          {!error && filtered.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyIcon
                size={28}
                color={isPremium ? 'rgba(255,255,255,0.35)' : Colors.textSecondary}
              />
              <Text
                style={[
                  styles.empty,
                  { color: isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary },
                ]}
              >
                Brak zamówień w tej kategorii.
              </Text>
            </View>
          ) : null}
          {filtered.map((o) => (
            <OrderCard key={o.id} order={o} isPremium={isPremium} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

export default function DostawyScreen() {
  const theme = useAppTheme();
  const bg = theme.isPremium ? '#0A0A0A' : Colors.background;
  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      <DeliveriesPanel />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  sub: {
    fontSize: 13,
    marginHorizontal: 16,
    marginTop: 4,
    marginBottom: 10,
  },
  subTabs: {
    flexDirection: 'row',
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  subTab: {
    flex: 1,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: 'center',
  },
  subTabLabel: { fontSize: 11, fontWeight: '700' },
  list: { paddingHorizontal: 16, paddingBottom: 40, gap: 10 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  cardTitle: { fontSize: 15, fontWeight: '800', marginBottom: 4 },
  meta: { fontSize: 12, marginTop: 2 },
  tracking: { fontSize: 12, fontWeight: '700', marginTop: 8 },
  eta: { fontSize: 12, marginTop: 6, fontStyle: 'italic' },
  emptyWrap: { alignItems: 'center', marginTop: 40, gap: 10 },
  empty: { fontSize: 14, textAlign: 'center' },
});
