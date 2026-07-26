/**
 * CreditsUsageHistoryModal — historia zużycia kredytów (dark premium gdy isPremium).
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View, Text, Modal, TouchableOpacity, ScrollView, ActivityIndicator, StyleSheet,
} from 'react-native';
import { X, ChevronRight, ChevronDown, History, RefreshCw } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import {
  buildUsageTree,
  fmtDayLabel,
  formatCreditsCharge,
  MONTHS_PL,
  normalizeUsageItems,
  type UsageEntry,
} from '@/lib/creditsUsage';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function CreditsUsageHistoryModal({ visible, onClose }: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const accent = prem ? DS.color.greenEnd : Colors.accent;
  const bg = prem ? DS.color.bgSecondary : Colors.background;
  const card = prem ? DS.color.bgTertiary : Colors.card;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const tertiary = prem ? DS.color.muted : Colors.textTertiary;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const danger = prem ? DS.color.danger : Colors.danger;

  const [items, setItems] = useState<UsageEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [openYear, setOpenYear] = useState<number | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null);
  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/subscription/usage-history?limit=500`, {
        headers: await (await import('@/lib/apiHeaders')).apiJsonHeaders(),
      });
      const d = await r.json();
      if (d.needs_migration) {
        setNeedsMigration(true);
        setItems([]);
      } else {
        setNeedsMigration(false);
        const normalized = normalizeUsageItems(d.items ?? []);
        setItems(normalized);
        if (normalized.length && openYear === null) {
          const first = normalized[0];
          const y = new Date(first.created_at).getFullYear();
          setOpenYear(y);
        }
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [openYear]);

  useEffect(() => {
    if (visible) fetchHistory();
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  const tree = useMemo(() => buildUsageTree(items), [items]);
  const years = Array.from(tree.keys()).sort((a, b) => b - a);
  const totalCredits = items.reduce((s, i) => s + i.credits, 0);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: bg }]}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={[styles.headerIcon, { backgroundColor: accent }]}>
                <History size={18} color={prem ? '#0A0A0A' : Colors.white} strokeWidth={2.2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: text }]}>Historia zużycia kredytów</Text>
                <Text style={[styles.subtitle, { color: tertiary }]}>
                  {items.length > 0
                    ? `${items.length} akcji · łącznie ${formatCreditsCharge(totalCredits)}`
                    : 'Rejestr akcji AI zużywających kredyty'}
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} testID="usage-history-close">
              <X size={22} color={muted} strokeWidth={2.2} />
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.refreshBtn} onPress={fetchHistory} testID="usage-history-refresh">
            <RefreshCw size={15} color={accent} strokeWidth={2.2} />
            <Text style={[styles.refreshText, { color: accent }]}>Odśwież</Text>
          </TouchableOpacity>

          {needsMigration && (
            <View style={[styles.migrationBox, { backgroundColor: card, borderColor: border }]} testID="usage-history-migration">
              <Text style={[styles.migrationTitle, { color: text }]}>Brak tabeli historii</Text>
              <Text style={[styles.migrationText, { color: muted }]}>
                Uruchom migrację ADD_VOICE_CRUD_BOTTLENECK_TOKENS.sql w Supabase SQL Editor.
              </Text>
            </View>
          )}

          {loading ? (
            <ActivityIndicator size="large" color={accent} style={{ marginTop: 40 }} />
          ) : items.length === 0 && !needsMigration ? (
            <View style={styles.emptyBox}>
              <History size={32} color={tertiary} strokeWidth={1.6} />
              <Text style={[styles.emptyText, { color: tertiary }]}>
                Brak zarejestrowanych transakcji. Użyj funkcji AI, aby zobaczyć historię zużycia.
              </Text>
            </View>
          ) : (
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>
              <View style={styles.tree}>
                {years.map((year) => {
                  const yearOpen = openYear === year;
                  const months = Array.from(tree.get(year)!.keys()).sort((a, b) => b - a);
                  return (
                    <View key={year} style={styles.node}>
                      <TouchableOpacity
                        style={styles.rowL1}
                        onPress={() => setOpenYear(yearOpen ? null : year)}
                        testID={`usage-year-${year}`}
                      >
                        {yearOpen
                          ? <ChevronDown size={18} color={text} />
                          : <ChevronRight size={18} color={muted} />}
                        <Text style={[styles.l1Text, { color: text }]}>{year}</Text>
                      </TouchableOpacity>

                      {yearOpen && months.map((month) => {
                        const mKey = `${year}-${month}`;
                        const mOpen = openMonth === mKey;
                        const weeks = Array.from(tree.get(year)!.get(month)!.keys()).sort((a, b) => b - a);
                        return (
                          <View key={mKey}>
                            <TouchableOpacity
                              style={styles.rowL2}
                              onPress={() => setOpenMonth(mOpen ? null : mKey)}
                              testID={`usage-month-${mKey}`}
                            >
                              {mOpen
                                ? <ChevronDown size={16} color={text} />
                                : <ChevronRight size={16} color={muted} />}
                              <Text style={[styles.l2Text, { color: text }]}>{MONTHS_PL[month - 1]}</Text>
                            </TouchableOpacity>

                            {mOpen && weeks.map((week) => {
                              const wKey = `${year}-${month}-${week}`;
                              const wOpen = openWeek === wKey;
                              const days = tree.get(year)!.get(month)!.get(week)!
                                .slice().sort((a, b) => b.date.localeCompare(a.date));
                              const weekCredits = days.reduce(
                                (s, d) => s + d.items.reduce((ss, i) => ss + i.credits, 0), 0,
                              );
                              return (
                                <View key={wKey}>
                                  <TouchableOpacity
                                    style={styles.rowL3}
                                    onPress={() => setOpenWeek(wOpen ? null : wKey)}
                                    testID={`usage-week-${wKey}`}
                                  >
                                    {wOpen
                                      ? <ChevronDown size={15} color={text} />
                                      : <ChevronRight size={15} color={muted} />}
                                    <Text style={[styles.l3Text, { color: text }]}>Tydzień {week}</Text>
                                    <Text style={[styles.l3Meta, { color: danger }]}>{formatCreditsCharge(weekCredits)}</Text>
                                  </TouchableOpacity>

                                  {wOpen && days.map((dayGroup) => {
                                    const dKey = dayGroup.date;
                                    const dOpen = openDay === dKey;
                                    const dayCredits = dayGroup.items.reduce((s, i) => s + i.credits, 0);
                                    return (
                                      <View key={dKey}>
                                        <TouchableOpacity
                                          style={styles.rowL4}
                                          onPress={() => setOpenDay(dOpen ? null : dKey)}
                                          testID={`usage-day-${dKey}`}
                                        >
                                          {dOpen
                                            ? <ChevronDown size={14} color={text} />
                                            : <ChevronRight size={14} color={muted} />}
                                          <Text style={[styles.l4Text, { color: muted }]}>{fmtDayLabel(dKey)}</Text>
                                          <Text style={[styles.l4Meta, { color: danger }]}>{formatCreditsCharge(dayCredits)}</Text>
                                        </TouchableOpacity>

                                        {dOpen && dayGroup.items.map((entry) => (
                                          <View
                                            key={entry.id}
                                            style={[styles.txRow, { borderTopColor: border }]}
                                            testID={`usage-tx-${entry.id}`}
                                          >
                                            <View style={[styles.txDot, { backgroundColor: accent }]} />
                                            <View style={{ flex: 1 }}>
                                              <Text style={[styles.txAction, { color: text }]}>{entry.action_label}</Text>
                                              <Text style={[styles.txMeta, { color: tertiary }]}>{entry.time} · {entry.model}</Text>
                                            </View>
                                            <Text style={[styles.txCredits, { color: danger }]}>{formatCreditsCharge(entry.credits)}</Text>
                                          </View>
                                        ))}
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
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '90%' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  headerIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '900' },
  subtitle: { fontSize: 12, marginTop: 2 },
  closeBtn: { padding: 4 },
  refreshBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-end', marginBottom: 12 },
  refreshText: { fontSize: 13, fontWeight: '700' },
  migrationBox: { borderRadius: 12, borderWidth: 1, padding: 16, marginBottom: 12 },
  migrationTitle: { fontSize: 14, fontWeight: '800', marginBottom: 4 },
  migrationText: { fontSize: 12.5, lineHeight: 18 },
  emptyBox: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 13.5, textAlign: 'center', lineHeight: 20, paddingHorizontal: 20 },
  tree: { gap: 2 },
  node: { marginBottom: 4 },
  rowL1: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  l1Text: { fontSize: 16, fontWeight: '900' },
  rowL2: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingLeft: 20 },
  l2Text: { fontSize: 14.5, fontWeight: '800' },
  rowL3: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingLeft: 36 },
  l3Text: { fontSize: 13.5, fontWeight: '700', flex: 1 },
  l3Meta: { fontSize: 12, fontWeight: '700' },
  rowL4: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7, paddingLeft: 52 },
  l4Text: { fontSize: 13, fontWeight: '600', flex: 1 },
  l4Meta: { fontSize: 11.5, fontWeight: '700' },
  txRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingLeft: 72, paddingRight: 4, borderTopWidth: 1 },
  txDot: { width: 6, height: 6, borderRadius: 3 },
  txAction: { fontSize: 13.5, fontWeight: '700' },
  txMeta: { fontSize: 11, marginTop: 2 },
  txCredits: { fontSize: 14, fontWeight: '900' },
});
