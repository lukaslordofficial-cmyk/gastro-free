/**
 * Lista faktur / dostaw u dostawcy (chronologicznie) + suma wydatków.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { FileText, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { formatPln } from '@/lib/format';
import {
  fetchSupplierInvoices,
  type SupplierInvoiceEntry,
} from '@/services/supplierSpendService';

type Props = {
  visible: boolean;
  supplierId: string;
  supplierName: string;
  onClose: () => void;
};

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}.${mm}.${yyyy}`;
}

export function SupplierInvoicesModal({
  visible,
  supplierId,
  supplierName,
  onClose,
}: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const bg = prem ? DS.color.bgPrimary : Colors.background;
  const card = prem ? DS.color.surfaceCard : Colors.card;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const accent = prem ? DS.color.greenEnd : Colors.accent;

  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<SupplierInvoiceEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!supplierId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSupplierInvoices(supplierId);
      setEntries(res.entries);
      setTotal(res.totalSpent);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Nie udało się wczytać faktur.');
      setEntries([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [supplierId]);

  useEffect(() => {
    if (visible) void load();
  }, [visible, load]);

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.wrap, { backgroundColor: bg }]}>
        <View style={[styles.head, { borderBottomColor: border }]}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <FileText size={18} color={accent} strokeWidth={2.2} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: text }]} allowFontScaling={false}>
                Faktury
              </Text>
              <Text style={[styles.sub, { color: muted }]} numberOfLines={1} allowFontScaling={false}>
                {supplierName}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} testID="supplier-invoices-close">
            <X size={22} color={muted} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <View style={[styles.sumCard, { backgroundColor: card, borderColor: border }]}>
          <Text style={[styles.sumLabel, { color: muted }]} allowFontScaling={false}>
            Suma wydatków u dostawcy
          </Text>
          <Text style={[styles.sumValue, { color: accent }]} allowFontScaling={false}>
            {formatPln(total)}
          </Text>
          <Text style={[styles.sumHint, { color: muted }]} allowFontScaling={false}>
            Skany AI + zrealizowane zamówienia ręczne
          </Text>
        </View>

        {loading ? (
          <ActivityIndicator style={{ marginTop: 32 }} color={accent} />
        ) : error ? (
          <Text style={[styles.empty, { color: muted }]}>{error}</Text>
        ) : (
          <FlatList
            data={entries}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            ListEmptyComponent={
              <Text style={[styles.empty, { color: muted }]}>
                Brak faktur i dostaw dla tego dostawcy.
              </Text>
            }
            renderItem={({ item }) => (
              <View style={[styles.row, { backgroundColor: card, borderColor: border }]}>
                <View style={{ flex: 1, minWidth: 0, paddingRight: 8 }}>
                  <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2} allowFontScaling={false}>
                    {item.title}
                  </Text>
                  <Text style={[styles.rowMeta, { color: muted }]} allowFontScaling={false}>
                    {formatWhen(item.created_at)}
                    {item.source === 'invoice' ? ' · faktura' : ' · koszt zmienny'}
                    {item.notePreview ? ` · ${item.notePreview}` : ''}
                  </Text>
                  {item.lines.slice(0, 4).map((line) => (
                    <Text key={line} style={[styles.line, { color: muted }]} numberOfLines={1}>
                      {line}
                    </Text>
                  ))}
                  {item.lines.length > 4 ? (
                    <Text style={[styles.line, { color: muted }]}>
                      +{item.lines.length - 4} poz.
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.amt, { color: text }]} allowFontScaling={false}>
                  {formatPln(item.amount_pln)}
                </Text>
              </View>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 14 : 12,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 12, marginTop: 2 },
  sumCard: {
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 8,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  sumLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  sumValue: { fontSize: 24, fontWeight: '800', marginTop: 4 },
  sumHint: { fontSize: 11, marginTop: 4 },
  list: { padding: 16, paddingTop: 8, gap: 10, paddingBottom: 40 },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    marginBottom: 10,
  },
  rowTitle: { fontSize: 14, fontWeight: '700' },
  rowMeta: { fontSize: 11, marginTop: 3 },
  line: { fontSize: 11, marginTop: 2 },
  amt: { fontSize: 14, fontWeight: '800' },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 13, paddingHorizontal: 24 },
});
