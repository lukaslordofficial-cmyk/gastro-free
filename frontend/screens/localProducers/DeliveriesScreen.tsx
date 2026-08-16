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
import { Package, Truck, CheckCircle2, CreditCard } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useFocusEffect, useRouter } from 'expo-router';
import { listMyProducerOrders } from '@/services/localProducers/localProducersService';
import { markProducerOrderReceived } from '@/services/localProducers/shippingClient';
import {
  deliveryBucketForOrder,
  type DeliveryBucket,
  type ProducerOrderWithProducer,
} from '@/types/localProducers';
import { formatPlnNumber } from '@/lib/format';
import { SettlementDocumentsSection } from '@/components/localProducers/SettlementDocumentsSection';
import {
  deliverySummaryLabelPl,
  paymentStatusLabelPl,
  shipmentStatusLabelPl,
  isAwaitingLpPayment,
} from '@/lib/localProducers/orderStatusLabels';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { openProducerOrderCheckout } from '@/services/localProducers/checkoutClient';
import { StripeOpeningOverlay } from '@/components/localProducers';

const DS_NEON = '#00FF88';

const SUB_TABS: { key: DeliveryBucket; label: string }[] = [
  { key: 'pending', label: 'Oczekujące' },
  { key: 'in_transit', label: 'W drodze' },
  { key: 'delivered', label: 'Doręczone' },
];

function OrderCard({
  order,
  isPremium,
  onPress,
  onMarkReceived,
  receiving,
  onResumePayment,
  paying,
}: {
  order: ProducerOrderWithProducer;
  isPremium: boolean;
  onPress: () => void;
  onMarkReceived?: () => void;
  receiving?: boolean;
  onResumePayment?: () => void;
  paying?: boolean;
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
  const inTransit = deliveryBucketForOrder(order) === 'in_transit';
  const awaitingPay = isAwaitingLpPayment(order.payment_status);

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}
    >
      <Text style={[styles.cardTitle, { color: titleColor }]} numberOfLines={2}>
        {company}
      </Text>
      <Text style={[styles.meta, { color: muted }]}>
        {deliverySummaryLabelPl(order)}
        {' · '}
        {formatPlnNumber(Number(order.total_price) || 0)} zł
      </Text>
      <Text style={[styles.meta, { color: muted }]}>
        Płatność: {paymentStatusLabelPl(order.payment_status)}
        {' · '}
        Wysyłka: {shipmentStatusLabelPl(order.shipment_status)}
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
      {awaitingPay && onResumePayment ? (
        <TouchableOpacity
          style={[
            styles.receiveBtn,
            {
              backgroundColor: isPremium ? DS_NEON : Colors.accent,
              opacity: paying ? 0.7 : 1,
            },
          ]}
          onPress={(e) => {
            e?.stopPropagation?.();
            onResumePayment();
          }}
          disabled={!!paying}
          activeOpacity={0.85}
          testID={`lp-resume-payment-${order.id}`}
        >
          {paying ? (
            <ActivityIndicator color={isPremium ? '#0A0A0A' : '#fff'} />
          ) : (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <CreditCard size={16} color={isPremium ? '#0A0A0A' : '#fff'} />
              <Text style={[styles.receiveBtnText, { color: isPremium ? '#0A0A0A' : '#fff' }]}>
                Dokończ płatność
              </Text>
            </View>
          )}
        </TouchableOpacity>
      ) : null}
      {inTransit ? (
        <Text style={[styles.eta, { color: muted }]}>
          Spodziewane doręczenie: zwykle 1–2 dni robocze. Po odbiorze produkty trafią do magazynu,
          a koszt zakupu do finansów.
        </Text>
      ) : null}
      {inTransit && onMarkReceived ? (
        <TouchableOpacity
          style={[
            styles.receiveBtn,
            {
              backgroundColor: isPremium ? DS_NEON : Colors.accent,
              opacity: receiving ? 0.7 : 1,
            },
          ]}
          onPress={(e) => {
            e?.stopPropagation?.();
            onMarkReceived();
          }}
          disabled={!!receiving}
          activeOpacity={0.85}
          testID={`lp-mark-received-${order.id}`}
        >
          {receiving ? (
            <ActivityIndicator color={isPremium ? '#0A0A0A' : '#fff'} />
          ) : (
            <Text style={[styles.receiveBtnText, { color: isPremium ? '#0A0A0A' : '#fff' }]}>
              Odebrałem paczkę
            </Text>
          )}
        </TouchableOpacity>
      ) : null}
      <SettlementDocumentsSection order={order} isPremium={isPremium} />
    </TouchableOpacity>
  );
}

/** Panel Dostawy — używany wewnątrz Lokalnych Przetwórców. */
export function DeliveriesPanel() {
  const theme = useAppTheme();
  const router = useRouter();
  const { alert } = usePremiumAlert();
  const isPremium = !!theme.isPremium;
  const [bucket, setBucket] = useState<DeliveryBucket>('pending');
  const [orders, setOrders] = useState<ProducerOrderWithProducer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [receivingId, setReceivingId] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);

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

  const handleMarkReceived = useCallback(
    (order: ProducerOrderWithProducer) => {
      alert(
        'Odebrałem paczkę',
        'Potwierdzasz odbiór? Produkty zostaną dodane do magazynu, a koszt zakupu — do kosztów zmiennych w finansach.',
        [
          { text: 'Anuluj', style: 'cancel' },
          {
            text: 'Potwierdź',
            style: 'primary',
            onPress: () => {
              void (async () => {
                setReceivingId(order.id);
                try {
                  const res = await markProducerOrderReceived(order.id);
                  alert(res.ok ? 'Gotowe' : 'Błąd', res.message, [
                    { text: 'OK', style: 'primary' },
                  ]);
                  if (res.ok) {
                    setBucket('delivered');
                    await load(true);
                  }
                } finally {
                  setReceivingId(null);
                }
              })();
            },
          },
        ],
      );
    },
    [alert, load],
  );

  const handleResumePayment = useCallback(
    (order: ProducerOrderWithProducer) => {
      if (payingId) return;
      void (async () => {
        setPayingId(order.id);
        try {
          const pay = await openProducerOrderCheckout(order.id);
          if (!pay.ok) {
            alert('Płatność', pay.message, [{ text: 'OK', style: 'primary' }]);
          }
        } catch (e) {
          alert(
            'Płatność',
            e instanceof Error ? e.message : 'Nie udało się otworzyć Stripe',
            [{ text: 'OK', style: 'primary' }],
          );
        } finally {
          setPayingId(null);
        }
      })();
    },
    [alert, payingId],
  );

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
            <OrderCard
              key={o.id}
              order={o}
              isPremium={isPremium}
              receiving={receivingId === o.id}
              paying={payingId === o.id}
              onMarkReceived={
                bucket === 'in_transit' ? () => handleMarkReceived(o) : undefined
              }
              onResumePayment={
                isAwaitingLpPayment(o.payment_status)
                  ? () => handleResumePayment(o)
                  : undefined
              }
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/dostawcy/zamowienie/[id]',
                  params: { id: o.id },
                })
              }
            />
          ))}
        </ScrollView>
      )}
      <StripeOpeningOverlay visible={!!payingId} message="Otwieranie Stripe…" />
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
  eta: { fontSize: 12, marginTop: 6, fontStyle: 'italic', lineHeight: 17 },
  receiveBtn: {
    marginTop: 12,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  receiveBtnText: { fontSize: 14, fontWeight: '800' },
  emptyWrap: { alignItems: 'center', marginTop: 40, gap: 10 },
  empty: { fontSize: 14, textAlign: 'center' },
});
