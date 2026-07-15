/**
 * ReportsArchive — cyfrowe archiwum raportów dobowych (End-of-Day Reports).
 * Wielopoziomowe drzewo: Rok → Miesiąc → Tydzień → Dzień, z podglądem dokumentu
 * (Przychód / Koszty / Zysk netto + Podsumowanie Managerskie AI „Jarvis").
 * Renderowane jako blok wewnątrz ScrollView Panelu Finansowego.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, Modal, ScrollView } from 'react-native';
import {
  ChevronRight, ChevronDown, FileText, Sparkles, CalendarClock, RefreshCw,
  BarChart3, CalendarRange, TrendingUp, TrendingDown, X, LineChart,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';

const BACKEND_URL_TREND = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

type Aggregates = {
  total_revenue: number; total_waste_cost: number; total_invoice_cost: number;
  net_profit: number; days_count: number;
};
type TrendResult = {
  ok: boolean;
  period_label?: string;
  reports_count?: number;
  aggregates?: Aggregates;
  best_day?: { date: string; net: number };
  worst_day?: { date: string; net: number };
  assistant_speech: string;
  needs_migration?: boolean;
};

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

type DailyReport = {
  id: string;
  date: string;
  total_revenue: number;
  total_waste_cost: number;
  total_invoice_cost: number;
  ai_summary: string | null;
  year: number;
  month: number;
  week_of_month: number;
};

const MONTHS_PL = ['Styczeń', 'Luty', 'Marzec', 'Kwiecień', 'Maj', 'Czerwiec',
  'Lipiec', 'Sierpień', 'Wrzesień', 'Październik', 'Listopad', 'Grudzień'];
const DOW_PL = ['Niedziela', 'Poniedziałek', 'Wtorek', 'Środa', 'Czwartek', 'Piątek', 'Sobota'];

const fmtPLN = (n: number) =>
  (Number(n) || 0).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' zł';

function fmtDayLabel(iso: string) {
  const d = new Date(iso + 'T00:00:00');
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()} — ${DOW_PL[d.getDay()]}`;
}

export function ReportsArchive({ onClosedDay }: { onClosedDay?: () => void }) {
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [closing, setClosing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ── Analiza Trendów AI ──────────────────────────────────────────────────
  const [trendLoading, setTrendLoading] = useState<'week' | 'month' | null>(null);
  const [trendResult, setTrendResult] = useState<TrendResult | null>(null);
  const [trendOpen, setTrendOpen] = useState(false);

  const runTrend = useCallback(async (periodType: 'week' | 'month') => {
    setTrendLoading(periodType);
    try {
      const r = await fetch(`${BACKEND_URL_TREND}/api/reports/analyze-period`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ period_type: periodType }),
      });
      const d: TrendResult = await r.json();
      setTrendResult(d);
      setTrendOpen(true);
    } catch {
      setTrendResult({
        ok: false,
        assistant_speech: 'Nie udało się wygenerować analizy trendu. Spróbuj ponownie.',
      });
      setTrendOpen(true);
    } finally {
      setTrendLoading(null);
    }
  }, []);

  const [openYear, setOpenYear] = useState<number | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null); // `${year}-${month}`
  const [openWeek, setOpenWeek] = useState<string | null>(null);    // `${year}-${month}-${week}`
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchReports = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BACKEND_URL}/api/reports/daily`);
      const d = await r.json();
      const list: DailyReport[] = d.reports ?? [];
      setReports(list);
      setNeedsMigration(!!d.needs_migration);
      if (list.length && openYear === null) setOpenYear(list[0].year);
    } catch {
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, [openYear]);

  useEffect(() => { fetchReports(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const closeDay = useCallback(async () => {
    setClosing(true);
    setMsg(null);
    try {
      const r = await fetch(`${BACKEND_URL}/api/pos/close-day`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const d = await r.json();
      if (d.needs_migration) {
        setNeedsMigration(true);
        setMsg(d.message ?? 'Wymagana migracja bazy.');
      } else {
        setMsg(d.message ?? 'Raport zapisany.');
        await fetchReports();
        onClosedDay?.();
      }
    } catch {
      setMsg('Nie udało się zamknąć dnia.');
    } finally {
      setClosing(false);
    }
  }, [fetchReports, onClosedDay]);

  // Build tree Year → Month → Week → Days
  const tree = useMemo(() => {
    const byYear = new Map<number, Map<number, Map<number, DailyReport[]>>>();
    for (const rep of reports) {
      if (!byYear.has(rep.year)) byYear.set(rep.year, new Map());
      const months = byYear.get(rep.year)!;
      if (!months.has(rep.month)) months.set(rep.month, new Map());
      const weeks = months.get(rep.month)!;
      if (!weeks.has(rep.week_of_month)) weeks.set(rep.week_of_month, []);
      weeks.get(rep.week_of_month)!.push(rep);
    }
    return byYear;
  }, [reports]);

  const selected = reports.find((r) => r.id === selectedId) || null;

  const years = Array.from(tree.keys()).sort((a, b) => b - a);

  return (
    <View style={styles.wrap} testID="reports-archive">
      {/* ── Analiza Trendów AI ── */}
      <View style={styles.trendSection} testID="trend-analysis-section">
        <View style={styles.trendHeader}>
          <LineChart size={16} color={Colors.accent} strokeWidth={2.4} />
          <Text style={styles.trendTitle}>Analiza Trendów AI</Text>
        </View>
        <Text style={styles.trendSub}>
          Skonsolidowane podsumowanie managerskie z raportów dobowych.
        </Text>
        <View style={styles.trendBtnRow}>
          <TouchableOpacity
            style={[styles.trendBtn, styles.trendBtnWeek, trendLoading === 'week' && { opacity: 0.6 }]}
            onPress={() => runTrend('week')}
            disabled={trendLoading !== null}
            activeOpacity={0.85}
            testID="trend-weekly-btn"
          >
            {trendLoading === 'week'
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <BarChart3 size={16} color={Colors.white} strokeWidth={2.4} />}
            <Text style={styles.trendBtnText}>Raport tygodniowy</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.trendBtn, styles.trendBtnMonth, trendLoading === 'month' && { opacity: 0.6 }]}
            onPress={() => runTrend('month')}
            disabled={trendLoading !== null}
            activeOpacity={0.85}
            testID="trend-monthly-btn"
          >
            {trendLoading === 'month'
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <CalendarRange size={16} color={Colors.white} strokeWidth={2.4} />}
            <Text style={styles.trendBtnText}>Raport miesięczny</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.topRow}>
        <Text style={styles.sectionLabel}>Archiwum raportów dobowych</Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={fetchReports} testID="reports-refresh">
          <RefreshCw size={15} color={Colors.accent} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.closeDayBtn, closing && { opacity: 0.6 }]}
        onPress={closeDay}
        disabled={closing}
        activeOpacity={0.85}
        testID="reports-close-day"
      >
        {closing
          ? <ActivityIndicator size="small" color={Colors.white} />
          : <CalendarClock size={16} color={Colors.white} strokeWidth={2.3} />}
        <Text style={styles.closeDayText}>Zamknij dzień i wygeneruj raport AI</Text>
      </TouchableOpacity>

      {msg && <Text style={styles.msg} testID="reports-msg">{msg}</Text>}

      {needsMigration && (
        <View style={styles.migrationBox} testID="reports-migration-box">
          <Text style={styles.migrationTitle}>⚙️ Wymagana jednorazowa migracja</Text>
          <Text style={styles.migrationText}>
            Aby raporty były zapisywane, uruchom w Supabase (SQL Editor) skrypt{'\n'}
            <Text style={styles.mono}>supabase_migrations/ADD_DAILY_REPORTS.sql</Text>.
          </Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator size="small" color={Colors.accent} style={{ marginTop: 20 }} />
      ) : reports.length === 0 ? (
        <View style={styles.emptyBox}>
          <FileText size={28} color={Colors.textTertiary} strokeWidth={1.6} />
          <Text style={styles.emptyText}>
            Brak raportów. Zamknij dzień, aby wygenerować pierwszy raport managerski.
          </Text>
        </View>
      ) : (
        <View style={styles.tree}>
          {years.map((year) => {
            const yearOpen = openYear === year;
            const months = Array.from(tree.get(year)!.keys()).sort((a, b) => b - a);
            return (
              <View key={year} style={styles.node}>
                <TouchableOpacity
                  style={styles.rowL1}
                  onPress={() => setOpenYear(yearOpen ? null : year)}
                  testID={`report-year-${year}`}
                >
                  {yearOpen ? <ChevronDown size={18} color={Colors.textPrimary} /> : <ChevronRight size={18} color={Colors.textSecondary} />}
                  <Text style={styles.l1Text}>{year}</Text>
                </TouchableOpacity>

                {yearOpen && months.map((month) => {
                  const mKey = `${year}-${month}`;
                  const mOpen = openMonth === mKey;
                  const weeks = Array.from(tree.get(year)!.get(month)!.keys()).sort((a, b) => a - b);
                  return (
                    <View key={mKey}>
                      <TouchableOpacity
                        style={styles.rowL2}
                        onPress={() => setOpenMonth(mOpen ? null : mKey)}
                        testID={`report-month-${mKey}`}
                      >
                        {mOpen ? <ChevronDown size={16} color={Colors.textPrimary} /> : <ChevronRight size={16} color={Colors.textSecondary} />}
                        <Text style={styles.l2Text}>{MONTHS_PL[month - 1]}</Text>
                      </TouchableOpacity>

                      {mOpen && weeks.map((week) => {
                        const wKey = `${year}-${month}-${week}`;
                        const wOpen = openWeek === wKey;
                        const days = tree.get(year)!.get(month)!.get(week)!
                          .slice().sort((a, b) => a.date.localeCompare(b.date));
                        return (
                          <View key={wKey}>
                            <TouchableOpacity
                              style={styles.rowL3}
                              onPress={() => setOpenWeek(wOpen ? null : wKey)}
                              testID={`report-week-${wKey}`}
                            >
                              {wOpen ? <ChevronDown size={15} color={Colors.textPrimary} /> : <ChevronRight size={15} color={Colors.textSecondary} />}
                              <Text style={styles.l3Text}>Tydzień {week}</Text>
                            </TouchableOpacity>

                            {wOpen && days.map((rep) => (
                              <TouchableOpacity
                                key={rep.id}
                                style={styles.rowL4}
                                onPress={() => setSelectedId(rep.id)}
                                testID={`report-day-${rep.date}`}
                              >
                                <View style={styles.dot} />
                                <Text style={styles.l4Text}>{fmtDayLabel(rep.date)}</Text>
                                <Text style={[styles.l4Net, {
                                  color: (rep.total_revenue - rep.total_waste_cost - rep.total_invoice_cost) >= 0
                                    ? Colors.success : Colors.danger,
                                }]}>
                                  {fmtPLN(rep.total_revenue - rep.total_waste_cost - rep.total_invoice_cost)}
                                </Text>
                              </TouchableOpacity>
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
      )}

      {/* Podgląd dokumentu wybranego dnia */}
      {selected && (
        <View style={styles.doc} testID="report-doc">
          <View style={styles.docHeader}>
            <FileText size={18} color={Colors.accent} strokeWidth={2.2} />
            <Text style={styles.docDate}>{fmtDayLabel(selected.date)}</Text>
            <TouchableOpacity onPress={() => setSelectedId(null)} testID="report-doc-close">
              <Text style={styles.docClose}>Zamknij</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.docGrid}>
            <View style={styles.docCell}>
              <Text style={styles.docCellLabel}>Przychód</Text>
              <Text style={[styles.docCellVal, { color: Colors.accent }]}>{fmtPLN(selected.total_revenue)}</Text>
            </View>
            <View style={styles.docCell}>
              <Text style={styles.docCellLabel}>Koszty</Text>
              <Text style={[styles.docCellVal, { color: Colors.danger }]}>
                {fmtPLN(selected.total_waste_cost + selected.total_invoice_cost)}
              </Text>
              <Text style={styles.docCellSub}>
                straty {fmtPLN(selected.total_waste_cost)} · faktury {fmtPLN(selected.total_invoice_cost)}
              </Text>
            </View>
          </View>

          <View style={styles.docNetRow}>
            <Text style={styles.docNetLabel}>Zysk netto</Text>
            <Text style={[styles.docNetVal, {
              color: (selected.total_revenue - selected.total_waste_cost - selected.total_invoice_cost) >= 0
                ? Colors.success : Colors.danger,
            }]}>
              {fmtPLN(selected.total_revenue - selected.total_waste_cost - selected.total_invoice_cost)}
            </Text>
          </View>

          <View style={styles.aiBox}>
            <View style={styles.aiHeader}>
              <Sparkles size={15} color={Colors.accentDark} strokeWidth={2.2} />
              <Text style={styles.aiTitle}>Podsumowanie Managerskie AI (Jarvis)</Text>
            </View>
            <Text style={styles.aiText}>{selected.ai_summary || 'Brak podsumowania.'}</Text>
          </View>
        </View>
      )}

      {/* ── Modal: wynik Analizy Trendów AI ── */}
      <Modal
        visible={trendOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setTrendOpen(false)}
      >
        <View style={styles.trendModalOverlay}>
          <View style={styles.trendModalSheet} testID="trend-result-modal">
            <View style={styles.trendModalHeader}>
              <View style={styles.trendModalTitleWrap}>
                <View style={styles.trendModalIcon}>
                  <LineChart size={18} color={Colors.white} strokeWidth={2.4} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.trendModalTitle}>Analiza Trendów AI</Text>
                  {!!trendResult?.period_label && (
                    <Text style={styles.trendModalPeriod}>
                      {trendResult.period_label}
                      {trendResult.reports_count ? ` · ${trendResult.reports_count} dni` : ''}
                    </Text>
                  )}
                </View>
              </View>
              <TouchableOpacity onPress={() => setTrendOpen(false)} testID="trend-result-close" hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <X size={22} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 8 }}>
              {trendResult?.aggregates && (
                <>
                  <View style={styles.trendGrid}>
                    <View style={styles.trendCell}>
                      <Text style={styles.trendCellLabel}>Utarg</Text>
                      <Text style={[styles.trendCellVal, { color: Colors.accent }]}>
                        {fmtPLN(trendResult.aggregates.total_revenue)}
                      </Text>
                    </View>
                    <View style={styles.trendCell}>
                      <Text style={styles.trendCellLabel}>Zysk netto</Text>
                      <Text style={[styles.trendCellVal, {
                        color: trendResult.aggregates.net_profit >= 0 ? Colors.success : Colors.danger,
                      }]}>
                        {fmtPLN(trendResult.aggregates.net_profit)}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.trendGrid}>
                    <View style={[styles.trendCell, styles.trendCellLoss]}>
                      <Text style={styles.trendCellLabel}>Straty (waste)</Text>
                      <Text style={[styles.trendCellVal, styles.trendValSmall, { color: Colors.danger }]}>
                        −{fmtPLN(trendResult.aggregates.total_waste_cost)}
                      </Text>
                    </View>
                    <View style={[styles.trendCell, styles.trendCellLoss]}>
                      <Text style={styles.trendCellLabel}>Koszty faktur</Text>
                      <Text style={[styles.trendCellVal, styles.trendValSmall, { color: Colors.danger }]}>
                        −{fmtPLN(trendResult.aggregates.total_invoice_cost)}
                      </Text>
                    </View>
                  </View>

                  {(trendResult.best_day || trendResult.worst_day) && (
                    <View style={styles.trendDaysRow}>
                      {trendResult.best_day && (
                        <View style={[styles.trendDayCard, styles.trendDayGain]}>
                          <TrendingUp size={14} color={Colors.success} strokeWidth={2.4} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.trendDayLabel}>Najlepszy dzień</Text>
                            <Text style={styles.trendDayDate}>{trendResult.best_day.date}</Text>
                          </View>
                          <Text style={[styles.trendDayNet, { color: Colors.success }]}>
                            {fmtPLN(trendResult.best_day.net)}
                          </Text>
                        </View>
                      )}
                      {trendResult.worst_day && (
                        <View style={[styles.trendDayCard, styles.trendDayLoss]}>
                          <TrendingDown size={14} color={Colors.danger} strokeWidth={2.4} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.trendDayLabel}>Największa strata</Text>
                            <Text style={styles.trendDayDate}>{trendResult.worst_day.date}</Text>
                          </View>
                          <Text style={[styles.trendDayNet, { color: Colors.danger }]}>
                            {fmtPLN(trendResult.worst_day.net)}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </>
              )}

              <View style={styles.trendAiBox}>
                <View style={styles.trendAiHeader}>
                  <Sparkles size={15} color={Colors.accentDark} strokeWidth={2.2} />
                  <Text style={styles.trendAiTitle}>Rekomendacja Dyrektora Finansowego (AI)</Text>
                </View>
                <Text style={styles.trendAiText} testID="trend-result-speech">
                  {trendResult?.assistant_speech || 'Brak danych do analizy.'}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
  trendSection: { backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 16, marginBottom: 16 },
  trendHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  trendTitle: { fontSize: 15, fontWeight: '900', color: Colors.textPrimary, letterSpacing: 0.2 },
  trendSub: { fontSize: 12, color: Colors.textTertiary, marginTop: 4, marginBottom: 12, lineHeight: 17 },
  trendBtnRow: { flexDirection: 'row', gap: 10 },
  trendBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 12 },
  trendBtnWeek: { backgroundColor: Colors.accent },
  trendBtnMonth: { backgroundColor: Colors.accentDark },
  trendBtnText: { color: Colors.white, fontSize: 12.5, fontWeight: '800' },
  trendModalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  trendModalSheet: { backgroundColor: Colors.background, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '88%' },
  trendModalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  trendModalTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  trendModalIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  trendModalTitle: { fontSize: 17, fontWeight: '900', color: Colors.textPrimary },
  trendModalPeriod: { fontSize: 12, color: Colors.textTertiary, marginTop: 1, textTransform: 'capitalize' },
  trendGrid: { flexDirection: 'row', gap: 10, marginBottom: 10 },
  trendCell: { flex: 1, backgroundColor: Colors.card, borderRadius: 12, borderWidth: 1, borderColor: Colors.border, padding: 13 },
  trendCellLoss: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  trendCellLabel: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  trendCellVal: { fontSize: 19, fontWeight: '900', marginTop: 5 },
  trendValSmall: { fontSize: 16 },
  trendDaysRow: { gap: 8, marginTop: 2, marginBottom: 4 },
  trendDayCard: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, borderWidth: 1, padding: 12 },
  trendDayGain: { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' },
  trendDayLoss: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  trendDayLabel: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.3 },
  trendDayDate: { fontSize: 13, fontWeight: '700', color: Colors.textPrimary, marginTop: 1 },
  trendDayNet: { fontSize: 15, fontWeight: '900' },
  trendAiBox: { marginTop: 12, backgroundColor: Colors.accentLight, borderRadius: 14, padding: 15 },
  trendAiHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 8 },
  trendAiTitle: { fontSize: 12.5, fontWeight: '800', color: Colors.accentDark, flex: 1 },
  trendAiText: { fontSize: 14, color: Colors.textPrimary, lineHeight: 22 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  sectionLabel: { fontSize: 13, fontWeight: '800', color: Colors.textSecondary, letterSpacing: 0.3, textTransform: 'uppercase' },
  refreshBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  closeDayBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.accent, borderRadius: 14, paddingVertical: 14, marginBottom: 10 },
  closeDayText: { color: Colors.white, fontSize: 14, fontWeight: '800' },
  msg: { fontSize: 12.5, color: Colors.textSecondary, marginBottom: 10, lineHeight: 18 },
  migrationBox: { backgroundColor: Colors.warningLight, borderColor: '#FDE68A', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  migrationTitle: { fontSize: 13, fontWeight: '800', color: Colors.warning, marginBottom: 4 },
  migrationText: { fontSize: 12, color: '#92400E', lineHeight: 18 },
  mono: { fontWeight: '800', color: '#7C2D12' },
  emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 30, backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border },
  emptyText: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center', paddingHorizontal: 24, lineHeight: 19 },
  tree: { backgroundColor: Colors.card, borderRadius: 14, borderWidth: 1, borderColor: Colors.border, paddingVertical: 4, overflow: 'hidden' },
  node: {},
  rowL1: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 13, paddingHorizontal: 14 },
  l1Text: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary },
  rowL2: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingLeft: 30, paddingRight: 14, backgroundColor: Colors.borderLight },
  l2Text: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  rowL3: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingLeft: 46, paddingRight: 14 },
  l3Text: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  rowL4: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingLeft: 62, paddingRight: 14, borderTopWidth: 1, borderTopColor: Colors.borderLight },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: Colors.accent },
  l4Text: { flex: 1, fontSize: 13, color: Colors.textPrimary, fontWeight: '500' },
  l4Net: { fontSize: 13, fontWeight: '800' },
  doc: { marginTop: 14, backgroundColor: Colors.card, borderRadius: 16, borderWidth: 1, borderColor: Colors.border, padding: 16 },
  docHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  docDate: { flex: 1, fontSize: 15, fontWeight: '800', color: Colors.textPrimary },
  docClose: { fontSize: 13, color: Colors.accent, fontWeight: '700' },
  docGrid: { flexDirection: 'row', gap: 10 },
  docCell: { flex: 1, backgroundColor: Colors.borderLight, borderRadius: 12, padding: 12 },
  docCellLabel: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.4 },
  docCellVal: { fontSize: 18, fontWeight: '900', marginTop: 4 },
  docCellSub: { fontSize: 10.5, color: Colors.textSecondary, marginTop: 3, lineHeight: 15 },
  docNetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.border },
  docNetLabel: { fontSize: 14, fontWeight: '800', color: Colors.textPrimary },
  docNetVal: { fontSize: 22, fontWeight: '900' },
  aiBox: { marginTop: 14, backgroundColor: Colors.accentLight, borderRadius: 12, padding: 14 },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 },
  aiTitle: { fontSize: 12.5, fontWeight: '800', color: Colors.accentDark },
  aiText: { fontSize: 13.5, color: Colors.textPrimary, lineHeight: 21 },
});
