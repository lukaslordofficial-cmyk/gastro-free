/**
 * Szczegóły zamówienia LP + dokumenty rozliczeniowe (faktura/rachunek).
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
import { getMyProducerOrder } from '@/services/localProducers/localProducersService';
import type { ProducerOrderWithProducer } from '@/types/localProducers';
import { formatPlnNumber } from '@/lib/format';
import { SettlementDocumentsSection } from '@/components/localProducers/SettlementDocumentsSection';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const row = await getMyProducerOrder(String(id));
      setOrder(row);
      if (!row) setError('Nie znaleziono zamówienia.');
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
              Status płatności: {String(order.payment_status || '—')}
            </Text>
            <Text style={[styles.meta, { color: muted }]}>
              Wysyłka: {String(order.shipment_status || '—')}
            </Text>
            <Text style={[styles.meta, { color: muted }]}>
              Kwota: {formatPlnNumber(Number(order.total_price) || 0)} zł
            </Text>
            {order.delivery_tracking ? (
              <Text style={[styles.meta, { color: isPremium ? DS_NEON : Colors.accent }]}>
                Tracking: {order.delivery_tracking}
              </Text>
            ) : null}
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
    gap: 6,
  },
  name: { fontSize: 18, fontWeight: '800', marginBottom: 4 },
  meta: { fontSize: 13 },
  section: { fontSize: 15, fontWeight: '800', marginTop: 12 },
  error: { textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
});
