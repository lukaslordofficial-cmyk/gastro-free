/**
 * Szczegóły zamówienia LP: pozycje, koszty, dokumenty rozliczeniowe.
 */
import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import {
  getMyProducerOrder,
  listMyProducerOrderItems,
  type ProducerOrderLine,
} from '@/services/localProducers/localProducersService';
import type { ProducerOrderWithProducer } from '@/types/localProducers';
import { formatPlnNumber } from '@/lib/format';
import { SettlementDocumentsSection } from '@/components/localProducers/SettlementDocumentsSection';
import {
  paymentStatusLabelPl,
  shipmentStatusLabelPl,
} from '@/lib/localProducers/orderStatusLabels';

const DS_NEON = '#00FF88';

export default function ProducerOrderDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const theme = useAppTheme();
  const isPremium = !!theme.isPremium;
  const bg = isPremium ? '#0A0A0A' : Colors.background;
  const titleColor = isPremium ? '#F5F5F5' : Colors.textPrimary;
  const muted = isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary;
  const cardBg = isPremium ? 'rgba(255,255,255,0.06)' : Colors.card;
  const border = isPremium ? 'rgba(255,255,255,0.10)' : Colors.border;

  const [order, setOrder] = useState<ProducerOrderWithProducer | null>(null);
  const [lines, setLines] = useState<ProducerOrderLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const row = await getMyProducerOrder(String(id));
      setOrder(row);
      if (!row) {
        setError('Nie znaleziono zamówienia.');
        setLines([]);
        return;
      }
      const items = await listMyProducerOrderItems(String(id));
      setLines(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd ładowania');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const company = order?.local_producers?.company_name || 'Lokalny przetwórca';
  const productsSum =
    order?.producer_amount != null
      ? Number(order.producer_amount)
      : lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
  const delivery = Number(order?.delivery_cost ?? order?.shipping_cost ?? 0) || 0;
  const platformFee = Number(order?.platform_fee ?? 0) || 0;
  const total = Number(order?.total_price ?? 0) || productsSum + delivery + platformFee;

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={12} style={styles.back}>
          <ArrowLeft size={22} color={titleColor} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: titleColor }]} numberOfLines={1}>
          Zamówienie #{String(id || '').slice(0, 8)}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator
          style={{ marginTop: 40 }}
          color={isPremium ? DS_NEON : Colors.accent}
        />
      ) : error || !order ? (
        <Text style={[styles.error, { color: '#DC2626' }]}>{error || 'Brak danych'}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.body}>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
            <Text style={[styles.name, { color: titleColor }]}>{company}</Text>
            <Text style={[styles.meta, { color: muted }]}>
              Płatność: {paymentStatusLabelPl(order.payment_status)}
            </Text>
            <Text style={[styles.meta, { color: muted }]}>
              Wysyłka: {shipmentStatusLabelPl(order.shipment_status)}
            </Text>
            {order.delivery_tracking ? (
              <Text style={[styles.meta, { color: isPremium ? DS_NEON : Colors.accent }]}>
                Numer przesyłki: {order.delivery_tracking}
              </Text>
            ) : null}
          </View>

          <Text style={[styles.section, { color: titleColor }]}>Zamówione produkty</Text>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
            {lines.length === 0 ? (
              <Text style={[styles.meta, { color: muted }]}>Brak pozycji na zamówieniu.</Text>
            ) : (
              lines.map((line) => {
                const lineTotal = line.quantity * line.unit_price;
                return (
                  <View key={line.id} style={styles.lineRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.lineTitle, { color: titleColor }]} numberOfLines={2}>
                        {line.title}
                      </Text>
                      <Text style={[styles.meta, { color: muted }]}>
                        {line.quantity}
                        {line.unit ? ` ${line.unit}` : ' szt.'}
                        {' × '}
                        {formatPlnNumber(line.unit_price)} zł
                      </Text>
                    </View>
                    <Text style={[styles.lineTotal, { color: titleColor }]}>
                      {formatPlnNumber(lineTotal)} zł
                    </Text>
                  </View>
                );
              })
            )}
          </View>

          <Text style={[styles.section, { color: titleColor }]}>Rozliczenie</Text>
          <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
            <View style={styles.costRow}>
              <Text style={[styles.meta, { color: muted }]}>Produkty</Text>
              <Text style={[styles.meta, { color: titleColor }]}>
                {formatPlnNumber(productsSum)} zł
              </Text>
            </View>
            <View style={styles.costRow}>
              <Text style={[styles.meta, { color: muted }]}>Transport (kurier)</Text>
              <Text style={[styles.meta, { color: titleColor }]}>
                {formatPlnNumber(delivery)} zł
              </Text>
            </View>
            <View style={styles.costRow}>
              <Text style={[styles.meta, { color: muted }]}>Opłata Gastro Manager (5%)</Text>
              <Text style={[styles.meta, { color: titleColor }]}>
                {formatPlnNumber(platformFee)} zł
              </Text>
            </View>
            <View style={[styles.costRow, styles.costTotal]}>
              <Text style={[styles.totalLabel, { color: titleColor }]}>Razem zapłacono</Text>
              <Text style={[styles.totalValue, { color: isPremium ? DS_NEON : Colors.accent }]}>
                {formatPlnNumber(total)} zł
              </Text>
            </View>
          </View>

          <Text style={[styles.section, { color: titleColor }]}>Faktury i rozliczenia</Text>
          <SettlementDocumentsSection order={order} isPremium={isPremium} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  back: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  body: { padding: 16, paddingBottom: 40, gap: 8 },
  card: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
  },
  name: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  meta: { fontSize: 13 },
  section: { fontSize: 15, fontWeight: '800', marginTop: 12 },
  lineRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.25)',
  },
  lineTitle: { fontSize: 14, fontWeight: '700' },
  lineTotal: { fontSize: 14, fontWeight: '800' },
  costRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  costTotal: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(128,128,128,0.3)',
  },
  totalLabel: { fontSize: 14, fontWeight: '800' },
  totalValue: { fontSize: 16, fontWeight: '800' },
  error: { textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
});
