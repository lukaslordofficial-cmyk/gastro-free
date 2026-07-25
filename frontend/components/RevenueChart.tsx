import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
} from 'react-native';
import { X, TrendingUp } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import type { RevenueEntry } from '@/lib/types';
import { GreenAreaLineChart } from '@/components/GreenAreaLineChart';

interface DayPoint {
  dateKey: string;
  label: string;
  weekday: string;
  revenue: number;
  entries: RevenueEntry[];
}

interface RevenueChartProps {
  journal?: RevenueEntry[];
  records?: { year_month: string; revenue_pln: number; variable_costs_pln?: number }[];
  days?: number;
}

const WEEKDAYS = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];
const WEEKDAYS_SHORT = ['Nd', 'Pn', 'Wt', 'Śr', 'Cz', 'Pt', 'So'];

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatPLNFull(n: number): string {
  return `${Math.round(n).toLocaleString('pl-PL')} zł`;
}

export function RevenueChart({ journal, records, days = 14 }: RevenueChartProps) {
  const [selected, setSelected] = useState<DayPoint | null>(null);

  const points = useMemo(() => {
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const from = new Date(now);
    from.setDate(from.getDate() - (days - 1));
    from.setHours(0, 0, 0, 0);

    const byDay = new Map<string, RevenueEntry[]>();
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setDate(from.getDate() + i);
      byDay.set(dayKey(d), []);
    }

    const src = journal ?? [];
    for (const e of src) {
      const d = new Date(e.created_at);
      if (Number.isNaN(d.getTime())) continue;
      const key = dayKey(d);
      if (!byDay.has(key)) continue;
      byDay.get(key)!.push(e);
    }

    if (src.length === 0 && records?.length) {
      return records
        .slice(-Math.min(6, records.length))
        .map((r) => {
          const parts = r.year_month.split('-');
          return {
            dateKey: `${r.year_month}-01`,
            label: parts[1] ?? r.year_month,
            weekday: parts[0] ?? '',
            revenue: Number(r.revenue_pln) || 0,
            entries: [],
          } as DayPoint;
        });
    }

    return Array.from(byDay.entries()).map(([key, entries]) => {
      const d = new Date(key + 'T12:00:00');
      const revenue = entries.reduce((s, e) => s + Number(e.amount_pln), 0);
      const parts = key.split('-');
      return {
        dateKey: key,
        label: `${parts[2]}.${parts[1]}`,
        weekday: WEEKDAYS[d.getDay()] ?? '',
        revenue,
        entries,
      };
    });
  }, [journal, records, days]);

  if (!points.length) return null;

  const total = points.reduce((s, p) => s + p.revenue, 0);
  const avg = total / points.length;
  const best = points.reduce((a, b) => (b.revenue > a.revenue ? b : a), points[0]);
  const rangeLabel = `${points[0].label} – ${points[points.length - 1].label}`;

  // Trend: druga połowa vs pierwsza
  const mid = Math.floor(points.length / 2) || 1;
  const firstHalf = points.slice(0, mid).reduce((s, p) => s + p.revenue, 0) / mid;
  const secondHalf = points.slice(mid).reduce((s, p) => s + p.revenue, 0) / Math.max(points.length - mid, 1);
  const trendPct = firstHalf > 0 ? ((secondHalf - firstHalf) / firstHalf) * 100 : null;

  const chartPoints = points.map((p) => {
    const d = new Date(p.dateKey + 'T12:00:00');
    const short =
      points.length <= 8
        ? WEEKDAYS_SHORT[d.getDay()] ?? p.label
        : p.label;
    return { label: short, value: p.revenue };
  });

  return (
    <View style={styles.container}>
      <GreenAreaLineChart
        points={chartPoints}
        color={Colors.success}
        height={168}
        title="Sprzedaż dzienna"
        totalLabel={formatPLNFull(total)}
        trendPct={trendPct}
        periodLabel={`Ostatnie ${points.length} dni · ${rangeLabel}`}
      />

      <View style={styles.kpiRow}>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Średnia/dzień</Text>
          <Text style={styles.kpiVal}>{formatPLNFull(avg)}</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Szczyt</Text>
          <Text style={[styles.kpiVal, { color: Colors.success }]}>
            {best.label} · {Math.round(best.revenue).toLocaleString('pl-PL')}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.kpi}
          onPress={() => setSelected(best)}
          activeOpacity={0.8}
        >
          <Text style={styles.kpiLabel}>Szczegóły</Text>
          <Text style={[styles.kpiVal, { color: Colors.accent }]}>Otwórz →</Text>
        </TouchableOpacity>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayChips}>
        {points.map((p) => (
          <TouchableOpacity
            key={p.dateKey}
            style={styles.dayChip}
            onPress={() => setSelected(p)}
            activeOpacity={0.75}
            testID={`revenue-bar-${p.dateKey}`}
          >
            <Text style={styles.dayChipLabel}>{p.label}</Text>
            <Text style={styles.dayChipVal}>
              {p.revenue > 0 ? Math.round(p.revenue).toLocaleString('pl-PL') : '—'}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      <Text style={styles.hint}>Dotknij dzień, aby otworzyć raport</Text>

      <Modal visible={!!selected} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <TrendingUp size={18} color={Colors.accent} strokeWidth={2.2} />
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Raport sprzedaży</Text>
                <Text style={styles.modalSub}>
                  {selected?.weekday} · {selected?.label} ({selected?.dateKey})
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelected(null)} hitSlop={10}>
                <X size={22} color={Colors.textSecondary} />
              </TouchableOpacity>
            </View>

            <View style={styles.modalKpi}>
              <Text style={styles.modalKpiLabel}>Przychód dnia</Text>
              <Text style={styles.modalKpiVal}>{formatPLNFull(selected?.revenue ?? 0)}</Text>
              <Text style={styles.modalKpiSub}>
                {(selected?.entries.length ?? 0)} wpisów w dzienniku
              </Text>
            </View>

            <ScrollView style={{ maxHeight: 320 }} showsVerticalScrollIndicator={false}>
              {(selected?.entries.length ?? 0) === 0 ? (
                <Text style={styles.emptyDay}>
                  Brak szczegółowych wpisów przychodu tego dnia. Dodaj przychody w panelu Finanse.
                </Text>
              ) : (
                selected!.entries.map((e) => (
                  <View key={e.id} style={styles.entryRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.entryName}>{e.description || 'Przychód'}</Text>
                      {e.note ? <Text style={styles.entryNote}>{e.note}</Text> : null}
                    </View>
                    <Text style={styles.entryAmt}>{formatPLNFull(Number(e.amount_pln))}</Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    shadowColor: Colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  kpiRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 10 },
  kpi: {
    flex: 1,
    backgroundColor: Colors.borderLight,
    borderRadius: 10,
    padding: 8,
  },
  kpiLabel: { fontSize: 10, color: Colors.textTertiary, fontWeight: '600', marginBottom: 2 },
  kpiVal: { fontSize: 12, fontWeight: '800', color: Colors.textPrimary },
  dayChips: { gap: 6, paddingVertical: 4 },
  dayChip: {
    backgroundColor: Colors.borderLight,
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minWidth: 56,
    alignItems: 'center',
  },
  dayChipLabel: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary },
  dayChipVal: { fontSize: 11, fontWeight: '800', color: Colors.textPrimary, marginTop: 2 },
  hint: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 8,
    textAlign: 'center',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 18,
    paddingBottom: 28,
    maxHeight: '78%',
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  modalTitle: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary },
  modalSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  modalKpi: {
    backgroundColor: Colors.accentLight,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  modalKpiLabel: { fontSize: 11, fontWeight: '600', color: Colors.accentDark },
  modalKpiVal: { fontSize: 24, fontWeight: '900', color: Colors.accent, marginTop: 2 },
  modalKpiSub: { fontSize: 11, color: Colors.textSecondary, marginTop: 4 },
  emptyDay: { fontSize: 13, color: Colors.textSecondary, lineHeight: 19, paddingVertical: 8 },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderLight,
    gap: 10,
  },
  entryName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  entryNote: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  entryAmt: { fontSize: 14, fontWeight: '800', color: Colors.accent },
});
