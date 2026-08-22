/**
 * Faktury u dostawcy — drzewo rok/miesiąc/tydzień, kafelek ze skrótem, szczegóły po kliknięciu.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  ScrollView,
} from 'react-native';
import { FileText, X } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { formatPln } from '@/lib/format';
import {
  ExpandableDateJournal,
  type JournalLeaf,
} from '@/components/ExpandableDateJournal';
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

function productCountLabel(n: number): string {
  if (n <= 0) return 'Zakup — szczegóły po kliknięciu';
  if (n === 1) return 'Zamówiono 1 produkt';
  if (n >= 2 && n <= 4) return `Zamówiono ${n} produkty`;
  return `Zamówiono ${n} produktów`;
}

function toJournalLeaves(entries: SupplierInvoiceEntry[]): JournalLeaf[] {
  return entries.map((e) => {
    const n = e.lines.length;
    const source =
      e.source === 'invoice' ? 'faktura' : 'dostawa / koszt zmienny';
    const summary = productCountLabel(n);
    const detailLines =
      n > 0
        ? [
            `Data: ${formatWhen(e.created_at)}`,
            `Źródło: ${source}`,
            `Podsumowanie: ${summary}`,
            '—',
            ...e.lines,
          ]
        : [
            `Data: ${formatWhen(e.created_at)}`,
            `Źródło: ${source}`,
            `Kwota: ${formatPln(e.amount_pln)}`,
            e.notePreview || 'Brak rozbicia pozycji (np. starszy zapis).',
          ];
    return {
      id: e.id,
      created_at: e.created_at,
      title: e.title,
      amount: e.amount_pln,
      meta: `${formatWhen(e.created_at)} · ${summary}`,
      detailLines,
    };
  });
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

  const leaves = useMemo(() => toJournalLeaves(entries), [entries]);

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

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollBody}
          showsVerticalScrollIndicator
          keyboardShouldPersistTaps="handled"
        >
          <View style={[styles.sumCard, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.sumLabel, { color: muted }]} allowFontScaling={false}>
              Suma wydatków u dostawcy
            </Text>
            <Text style={[styles.sumValue, { color: accent }]} allowFontScaling={false}>
              {formatPln(total)}
            </Text>
            <Text style={[styles.sumHint, { color: muted }]} allowFontScaling={false}>
              Od najnowszych · zwijane: rok → miesiąc → tydzień → dzień
            </Text>
          </View>

          {loading ? (
            <ActivityIndicator style={{ marginTop: 32 }} color={accent} />
          ) : error ? (
            <Text style={[styles.empty, { color: muted }]}>{error}</Text>
          ) : (
            <ExpandableDateJournal
              items={leaves}
              emptyText="Brak faktur i dostaw dla tego dostawcy."
              formatAmount={formatPln}
            />
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
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
  scrollBody: { paddingHorizontal: 12, paddingBottom: 24 },
  sumCard: {
    marginTop: 14,
    marginBottom: 12,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
  },
  sumLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  sumValue: { fontSize: 24, fontWeight: '800', marginTop: 4 },
  sumHint: { fontSize: 11, marginTop: 4, lineHeight: 15 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 13, paddingHorizontal: 24 },
});
