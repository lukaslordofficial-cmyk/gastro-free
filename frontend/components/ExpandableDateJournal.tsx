/**
 * ExpandableDateJournal — drzewo Rok → Miesiąc → Tydzień → Dzień → pozycje.
 * Wspólne dla dziennika przychodów (free + premium) i podobnych list.
 */
import React, { useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { ChevronDown, ChevronRight } from 'lucide-react-native';
import {
  buildUsageTree,
  fmtDayLabel,
  MONTHS_PL,
  toLocalDateParts,
  type UsageDayGroup,
  type UsageTree,
} from '@/lib/creditsUsage';
import { useAppTheme } from '@/hooks/useAppTheme';

export type JournalLeaf = {
  id: string;
  created_at: string;
  title: string;
  amount: number;
  meta?: string;
  /** Gdy podane — pokazywane zamiast formatAmount(amount) (np. „−5 l”). */
  amountLabel?: string;
  /** Szczegóły faktury (pozycje) — widoczne po rozwinięciu dnia. */
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
  /** Rozwinięte pozycje faktury (produkty / ilości / kwoty). */
  const [openLeafId, setOpenLeafId] = useState<string | null>(null);

  const tree: UsageTree = useMemo(() => buildUsageTree(toPseudoUsage(items) as any), [items]);
  const years = Array.from(tree.keys()).sort((a, b) => b - a);

  React.useEffect(() => {
    if (years.length && openYear === null) setOpenYear(years[0]);
  }, [years, openYear]);

  if (!items.length) {
    return (
      <View style={styles.empty}>
        <Text style={{ color: t.textMuted, fontSize: 13 }}>{emptyText}</Text>
      </View>
    );
  }

  const leafById = useMemo(() => {
    const m = new Map<string, JournalLeaf>();
    items.forEach((i) => m.set(i.id, i));
    return m;
  }, [items]);

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
                                          !!leaf.detailLines && leaf.detailLines.length > 0;
                                        const leafOpen = openLeafId === leaf.id;
                                        const main = (
                                          <>
                                            <View style={{ flex: 1, minWidth: 0 }}>
                                              <Text style={[styles.leafTitle, { color: t.text }]}>
                                                {leaf.title}
                                              </Text>
                                              <Text style={{ color: t.textMuted, fontSize: 11 }}>
                                                {entry.time}
                                                {leaf.meta ? ` · ${leaf.meta}` : ''}
                                                {hasDetails && !leafOpen ? ' · dotknij → pozycje' : ''}
                                              </Text>
                                              {hasDetails && leafOpen ? (
                                                <View style={styles.detailBox}>
                                                  {leaf.detailLines!.map((line, i) => (
                                                    <Text
                                                      key={`${leaf.id}-d-${i}`}
                                                      style={[styles.detailLine, { color: t.textSecondary }]}
                                                    >
                                                      • {line}
                                                    </Text>
                                                  ))}
                                                </View>
                                              ) : null}
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
                                                onPress={() =>
                                                  setOpenLeafId(leafOpen ? null : leaf.id)
                                                }
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
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 44,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  leafTitle: { fontSize: 13, fontWeight: '600' },
  leafAmt: { fontSize: 13, fontWeight: '700', marginRight: 4 },
  detailBox: { marginTop: 6, gap: 3, paddingRight: 8 },
  detailLine: { fontSize: 11, lineHeight: 15, fontWeight: '500' },
});
