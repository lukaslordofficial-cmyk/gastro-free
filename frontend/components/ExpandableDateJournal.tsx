/**
 * ExpandableDateJournal — drzewo Rok → Miesiąc → Tydzień → Dzień → pozycje.
 * Wspólne dla dziennika przychodów (free + premium) i podobnych list.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  ScrollView,
  Pressable,
} from 'react-native';
import { ChevronDown, ChevronRight, X } from 'lucide-react-native';
import {
  buildUsageTree,
  fmtDayLabel,
  MONTHS_PL,
  toLocalDateParts,
  type UsageDayGroup,
  type UsageTree,
} from '@/lib/creditsUsage';
import { useAppTheme } from '@/hooks/useAppTheme';
import { SafeAreaView } from 'react-native-safe-area-context';

export type JournalLeaf = {
  id: string;
  created_at: string;
  title: string;
  amount: number;
  meta?: string;
  /** Gdy podane — pokazywane zamiast formatAmount(amount) (np. „−5 l”). */
  amountLabel?: string;
  /** Szczegóły faktury (pozycje) — otwierane w czytelnym modalu. */
  detailLines?: string[];
};

type Props = {
  items: JournalLeaf[];
  emptyText?: string;
  formatAmount: (n: number) => string;
  renderActions?: (item: JournalLeaf) => React.ReactNode;
  amountPositive?: boolean;
};

function toPseudoUsage(items: JournalLeaf[]) {
  return items.map((it) => {
    const parts = toLocalDateParts(it.created_at);
    return {
      id: it.id,
      endpoint: it.title,
      model: it.meta ?? '',
      credits: it.amount,
      cost_pln: it.amount,
      created_at: it.created_at,
      action_label: it.title,
      date: parts.date,
      time: parts.time,
    };
  });
}

export function ExpandableDateJournal({
  items,
  emptyText = 'Brak pozycji',
  formatAmount,
  renderActions,
  amountPositive,
}: Props) {
  const t = useAppTheme();
  const [openYear, setOpenYear] = useState<number | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);
  /** Podgląd faktury w osobnym oknie. */
  const [previewLeaf, setPreviewLeaf] = useState<JournalLeaf | null>(null);

  const tree: UsageTree = useMemo(() => buildUsageTree(toPseudoUsage(items) as any), [items]);
  const years = Array.from(tree.keys()).sort((a, b) => b - a);

  React.useEffect(() => {
    if (years.length && openYear === null) setOpenYear(years[0]);
  }, [years, openYear]);

  // Hook MUSI być wołany bezwarunkowo (przed early-return) — inaczej „rendered
  // more hooks" gdy lista przechodzi z pustej na niepustą (dekalog §V).
  const leafById = useMemo(() => {
    const m = new Map<string, JournalLeaf>();
    items.forEach((i) => m.set(i.id, i));
    return m;
  }, [items]);

  if (!items.length) {
    return (
      <View style={styles.empty}>
        <Text style={{ color: t.textMuted, fontSize: 13 }}>{emptyText}</Text>
      </View>
    );
  }

  return (
    <View>
      {years.map((year) => {
        const yearOpen = openYear === year;
        const months = Array.from(tree.get(year)!.keys()).sort((a, b) => b - a);
        return (
          <View key={year}>
            <TouchableOpacity
              style={[styles.row, { borderBottomColor: t.border }]}
              onPress={() => setOpenYear(yearOpen ? null : year)}
            >
              {yearOpen ? (
                <ChevronDown size={18} color={t.text} />
              ) : (
                <ChevronRight size={18} color={t.textSecondary} />
              )}
              <Text style={[styles.l1, { color: t.text }]}>{year}</Text>
            </TouchableOpacity>

            {yearOpen &&
              months.map((month) => {
                const mKey = `${year}-${month}`;
                const mOpen = openMonth === mKey;
                const weeks = Array.from(tree.get(year)!.get(month)!.keys()).sort((a, b) => b - a);
                return (
                  <View key={mKey}>
                    <TouchableOpacity
                      style={[styles.rowL2, { borderBottomColor: t.border }]}
                      onPress={() => setOpenMonth(mOpen ? null : mKey)}
                    >
                      {mOpen ? (
                        <ChevronDown size={16} color={t.text} />
                      ) : (
                        <ChevronRight size={16} color={t.textSecondary} />
                      )}
                      <Text style={[styles.l2, { color: t.text }]}>{MONTHS_PL[month - 1]}</Text>
                    </TouchableOpacity>

                    {mOpen &&
                      weeks.map((week) => {
                        const wKey = `${year}-${month}-${week}`;
                        const wOpen = openWeek === wKey;
                        const days = tree.get(year)!.get(month)!.get(week)! as UsageDayGroup[];
                        const weekSum = days.reduce(
                          (s, d) => s + d.items.reduce((ss, i) => ss + i.credits, 0),
                          0
                        );
                        return (
                          <View key={wKey}>
                            <TouchableOpacity
                              style={[styles.rowL3, { borderBottomColor: t.border }]}
                              onPress={() => setOpenWeek(wOpen ? null : wKey)}
                            >
                              {wOpen ? (
                                <ChevronDown size={15} color={t.text} />
                              ) : (
                                <ChevronRight size={15} color={t.textSecondary} />
                              )}
                              <Text style={[styles.l3, { color: t.textSecondary }]}>
                                Tydzień {week}
                              </Text>
                              <Text
                                style={[
                                  styles.meta,
                                  { color: amountPositive ? t.accent : t.text },
                                ]}
                              >
                                {formatAmount(weekSum)}
                              </Text>
                            </TouchableOpacity>

                            {wOpen &&
                              days.map((dayGroup) => {
                                const dKey = dayGroup.date;
                                const dOpen = openDay === dKey;
                                const daySum = dayGroup.items.reduce((s, i) => s + i.credits, 0);
                                return (
                                  <View key={dKey}>
                                    <TouchableOpacity
                                      style={[styles.rowL4, { borderBottomColor: t.border }]}
                                      onPress={() => setOpenDay(dOpen ? null : dKey)}
                                    >
                                      {dOpen ? (
                                        <ChevronDown size={14} color={t.text} />
                                      ) : (
                                        <ChevronRight size={14} color={t.textSecondary} />
                                      )}
                                      <Text style={[styles.l4, { color: t.textSecondary }]}>
                                        {fmtDayLabel(dKey)}
                                      </Text>
                                      <Text
                                        style={[
                                          styles.meta,
                                          { color: amountPositive ? t.accent : t.text },
                                        ]}
                                      >
                                        {formatAmount(daySum)}
                                      </Text>
                                    </TouchableOpacity>

                                    {dOpen &&
                                      dayGroup.items.map((entry) => {
                                        const leaf = leafById.get(entry.id);
                                        if (!leaf) return null;
                                        const hasDetails =
                                          Array.isArray(leaf.detailLines);
                                        const main = (
                                          <>
                                            <View style={{ flex: 1, minWidth: 0, paddingRight: 4 }}>
                                              <Text style={[styles.leafTitle, { color: t.text }]}>
                                                {leaf.title}
                                              </Text>
                                              <Text
                                                style={{ color: t.textMuted, fontSize: 11, flexShrink: 1 }}
                                              >
                                                {entry.time}
                                                {leaf.meta ? ` · ${leaf.meta}` : ''}
                                                {hasDetails ? ' · dotknij → szczegóły' : ''}
                                              </Text>
                                            </View>
                                            <Text
                                              style={[
                                                styles.leafAmt,
                                                { color: amountPositive ? t.accent : t.text },
                                              ]}
                                            >
                                              {(amountPositive ? '+' : '')
                                                + (leaf.amountLabel
                                                  ?? formatAmount(leaf.amount))}
                                            </Text>
                                          </>
                                        );
                                        return (
                                          <View
                                            key={entry.id}
                                            style={[styles.leaf, { borderBottomColor: t.border }]}
                                          >
                                            {hasDetails ? (
                                              <TouchableOpacity
                                                style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', minWidth: 0 }}
                                                onPress={() => setPreviewLeaf(leaf)}
                                                activeOpacity={0.75}
                                                testID={`journal-invoice-${leaf.id}`}
                                              >
                                                {main}
                                              </TouchableOpacity>
                                            ) : (
                                              <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-start', minWidth: 0 }}>
                                                {main}
                                              </View>
                                            )}
                                            {renderActions?.(leaf)}
                                          </View>
                                        );
                                      })}
                                  </View>
                                );
                              })}
                          </View>
                        );
                      })}
                  </View>
                );
              })}
          </View>
        );
      })}

      <Modal
        visible={!!previewLeaf}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPreviewLeaf(null)}
      >
        <SafeAreaView style={[styles.modalSafe, { backgroundColor: t.bg }]} edges={['top', 'bottom']}>
          <View style={[styles.modalHeader, { borderBottomColor: t.border }]}>
            <View style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
              <Text style={[styles.modalTitle, { color: t.text }]} numberOfLines={2}>
                {previewLeaf?.title || 'Podgląd faktury'}
              </Text>
              {previewLeaf?.meta ? (
                <Text style={{ color: t.textMuted, fontSize: 13, marginTop: 4 }}>
                  {previewLeaf.meta}
                </Text>
              ) : null}
            </View>
            <Pressable
              onPress={() => setPreviewLeaf(null)}
              hitSlop={12}
              style={[styles.modalClose, { backgroundColor: t.border }]}
            >
              <X size={18} color={t.text} strokeWidth={2.2} />
            </Pressable>
          </View>
          <View style={[styles.modalAmountRow, { borderBottomColor: t.border }]}>
            <Text style={{ color: t.textSecondary, fontSize: 13, fontWeight: '600' }}>Kwota</Text>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '800' }}>
              {previewLeaf
                ? previewLeaf.amountLabel ?? formatAmount(previewLeaf.amount)
                : ''}
            </Text>
          </View>
          <ScrollView contentContainerStyle={styles.modalBody} showsVerticalScrollIndicator={false}>
            <Text style={[styles.modalSection, { color: t.textSecondary }]}>
              Pozycje ({previewLeaf?.detailLines?.length ?? 0})
            </Text>
            {(previewLeaf?.detailLines || []).map((line, i) => (
              <View
                key={`inv-line-${i}`}
                style={[styles.modalLine, { borderBottomColor: t.border }]}
              >
                <Text style={[styles.modalLineText, { color: t.text }]}>{line}</Text>
              </View>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { padding: 16, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowL2: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowL3: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 28,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowL4: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 36,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  l1: { fontSize: 15, fontWeight: '800', flex: 1 },
  l2: { fontSize: 14, fontWeight: '700', flex: 1 },
  l3: { fontSize: 13, fontWeight: '600', flex: 1 },
  l4: { fontSize: 12, fontWeight: '600', flex: 1 },
  meta: { fontSize: 12, fontWeight: '700' },
  leaf: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leafTitle: {
    fontSize: 13,
    fontWeight: '600',
    flexShrink: 1,
    flexWrap: 'wrap',
  },
  leafAmt: {
    fontSize: 13,
    fontWeight: '700',
    marginRight: 4,
    flexShrink: 0,
    marginTop: 1,
  },
  modalSafe: { flex: 1 },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalTitle: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  modalClose: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalAmountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalBody: { paddingHorizontal: 20, paddingTop: 16, paddingBottom: 40 },
  modalSection: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 10,
  },
  modalLine: {
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  modalLineText: { fontSize: 15, lineHeight: 22, fontWeight: '500' },
});
