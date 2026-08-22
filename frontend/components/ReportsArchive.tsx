/**
 * ReportsArchive — cyfrowe archiwum raportów dobowych (End-of-Day Reports).
 * Wielopoziomowe drzewo: Rok → Miesiąc → Tydzień → Dzień, z podglądem dokumentu
 * (Przychód / Koszty / Zysk netto + Podsumowanie Managerskie AI „Jarvis").
 * Renderowane jako blok wewnątrz ScrollView Panelu Finansowego.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator, StyleSheet, AppState } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  ChevronRight, ChevronDown, FileText, Sparkles, CalendarClock, RefreshCw,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { DS } from '@/constants/premiumTheme';
import { apiJsonHeaders } from '@/lib/apiHeaders';

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
  const theme = useAppTheme();
  const styles = useMemo(() => makeArchiveStyles(theme), [theme.isPremium]);
  const accent = theme.accent;
  const [reports, setReports] = useState<DailyReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [closing, setClosing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const [openYear, setOpenYear] = useState<number | null>(null);
  const [openMonth, setOpenMonth] = useState<string | null>(null); // `${year}-${month}`
  const [openWeek, setOpenWeek] = useState<string | null>(null);    // `${year}-${month}-${week}`
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const fetchReports = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setLoading(true);
    try {
      const headers = await apiJsonHeaders();
      const r = await fetch(`${BACKEND_URL}/api/reports/daily`, { headers });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (!opts?.silent) {
          setReports([]);
          setMsg(typeof d.detail === 'string' ? d.detail : 'Nie udało się pobrać raportów (zaloguj się).');
        }
        return;
      }
      const list: DailyReport[] = d.reports ?? [];
      setReports(list);
      setNeedsMigration(!!d.needs_migration);
      if (list.length && openYear === null) setOpenYear(list[0].year);
      if (Array.isArray(d.auto_closed_dates) && d.auto_closed_dates.length) {
        setMsg(`Auto-zamknięto raporty: ${d.auto_closed_dates.join(', ')}`);
        onClosedDay?.();
      }
    } catch {
      if (!opts?.silent) setReports([]);
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [openYear, onClosedDay]);

  useEffect(() => { fetchReports(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Foreground → ponów GET (backend auto-zamyka raporty dobowe po ≥25h od poprzedniego).
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') fetchReports({ silent: true });
    });
    return () => sub.remove();
  }, [fetchReports]);

  const closeDay = useCallback(async () => {
    setClosing(true);
    setMsg(null);
    try {
      const headers = await apiJsonHeaders();
      const r = await fetch(`${BACKEND_URL}/api/pos/close-day`, {
        method: 'POST',
        headers,
        body: JSON.stringify({}),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) {
        setMsg(
          typeof d.detail === 'string'
            ? d.detail
            : d.message || `Nie udało się zamknąć dnia (${r.status}).`,
        );
        return;
      }
      if (d.needs_migration) {
        setNeedsMigration(true);
        setMsg(d.message ?? 'Wymagana migracja bazy.');
      } else if (d.ok === false) {
        setMsg(d.message ?? 'Nie zapisano raportu.');
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
      <View style={styles.topRow}>
        <Text style={styles.sectionLabel}>Archiwum raportów dobowych</Text>
        <TouchableOpacity style={styles.refreshBtn} onPress={fetchReports} testID="reports-refresh">
          <RefreshCw size={15} color={accent} strokeWidth={2.2} />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        style={[styles.closeDayBtnWrap, closing && { opacity: 0.6 }, theme.isPremium && DS.shadow.greenGlow]}
        onPress={closeDay}
        disabled={closing}
        activeOpacity={0.85}
        testID="reports-close-day"
      >
        <LinearGradient
          colors={theme.isPremium ? [...DS.gradient.green] : [Colors.accent, Colors.accentDark]}
          start={{ x: 0, y: 0.2 }}
          end={{ x: 1, y: 0.8 }}
          style={styles.closeDayBtn}
        >
          {closing
            ? <ActivityIndicator size="small" color="#0A0A0A" />
            : <CalendarClock size={16} color="#0A0A0A" strokeWidth={2.3} />}
          <Text style={styles.closeDayText} allowFontScaling={false}>Zamknij dzień i wygeneruj raport AI</Text>
        </LinearGradient>
      </TouchableOpacity>

      {msg && <Text style={styles.msg} testID="reports-msg">{msg}</Text>}

      {needsMigration && (
        <View style={styles.migrationBox} testID="reports-migration-box">
          <Text style={styles.migrationTitle}>⚙️ Wymagana jednorazowa migracja</Text>
          <Text style={styles.migrationText}>
            Aby raporty były zapisywane, odśwież aplikację po aktualizacji serwera albo skontaktuj się z supportem.
          </Text>
        </View>
      )}

      {loading ? (
        <ActivityIndicator size="small" color={accent} style={{ marginTop: 20 }} />
      ) : reports.length === 0 ? (
        <View style={styles.emptyBox}>
          <FileText size={28} color={theme.textMuted} strokeWidth={1.6} />
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
                  {yearOpen ? <ChevronDown size={18} color={theme.text} /> : <ChevronRight size={18} color={theme.textSecondary} />}
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
                        {mOpen ? <ChevronDown size={16} color={theme.text} /> : <ChevronRight size={16} color={theme.textSecondary} />}
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
                              {wOpen ? <ChevronDown size={15} color={theme.text} /> : <ChevronRight size={15} color={theme.textSecondary} />}
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


    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 4 },
});

function makeArchiveStyles(theme: ReturnType<typeof useAppTheme>) {
  const card = theme.isPremium ? DS.color.surfaceCard : Colors.card;
  const border = theme.isPremium ? DS.color.borderSubtle : Colors.border;
  const text = theme.isPremium ? DS.color.heading : Colors.textPrimary;
  const muted = theme.isPremium ? DS.color.muted : Colors.textTertiary;
  const body = theme.isPremium ? DS.color.body : Colors.textSecondary;
  const soft = theme.isPremium ? DS.color.bgTertiary : Colors.borderLight;
  const accent = theme.accent;
  const accentSoft = theme.isPremium ? 'rgba(0,255,120,0.12)' : Colors.accentLight;
  const neonBtn = theme.isPremium ? DS.color.greenEnd : Colors.accent;
  const neonDeep = theme.isPremium ? DS.color.greenStart : Colors.accentDark;
  const bg = theme.isPremium ? DS.color.bgPrimary : Colors.background;

  return StyleSheet.create({
    wrap: { marginTop: 4 },

    topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
    sectionLabel: { fontSize: 13, fontWeight: '800', color: body, letterSpacing: 0.3, textTransform: 'uppercase' },
    refreshBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: accentSoft, alignItems: 'center', justifyContent: 'center' },
    closeDayBtnWrap: { borderRadius: 14, marginBottom: 10 },
    closeDayBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 14, paddingVertical: 14 },
    closeDayText: { color: '#0A0A0A', fontSize: 14, fontWeight: '800' },
    msg: { fontSize: 12.5, color: body, marginBottom: 10, lineHeight: 18 },
    migrationBox: { backgroundColor: theme.isPremium ? DS.color.warningSoft : Colors.warningLight, borderColor: theme.isPremium ? DS.color.warningBorder : '#FDE68A', borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
    migrationTitle: { fontSize: 13, fontWeight: '800', color: theme.warning, marginBottom: 4 },
    migrationText: { fontSize: 12, color: theme.isPremium ? DS.color.warning : '#92400E', lineHeight: 18 },
    mono: { fontWeight: '800', color: theme.isPremium ? DS.color.warning : '#7C2D12' },
    emptyBox: { alignItems: 'center', gap: 10, paddingVertical: 30, backgroundColor: card, borderRadius: 14, borderWidth: 1, borderColor: border },
    emptyText: { fontSize: 13, color: muted, textAlign: 'center', paddingHorizontal: 24, lineHeight: 19 },
    tree: { backgroundColor: card, borderRadius: 14, borderWidth: 1, borderColor: border, paddingVertical: 4, overflow: 'visible' },
    node: {},
    rowL1: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 13, paddingHorizontal: 14 },
    l1Text: { fontSize: 16, fontWeight: '800', color: text },
    rowL2: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, paddingLeft: 30, paddingRight: 14, backgroundColor: soft },
    l2Text: { fontSize: 14, fontWeight: '700', color: text },
    rowL3: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingLeft: 46, paddingRight: 14 },
    l3Text: { fontSize: 13, fontWeight: '600', color: body },
    rowL4: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingLeft: 62, paddingRight: 14, borderTopWidth: 1, borderTopColor: border },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: accent },
    l4Text: { flex: 1, fontSize: 13, color: text, fontWeight: '500' },
    l4Net: { fontSize: 13, fontWeight: '800' },
    doc: { marginTop: 14, backgroundColor: card, borderRadius: 16, borderWidth: 1, borderColor: border, padding: 16 },
    docHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    docDate: { flex: 1, fontSize: 15, fontWeight: '800', color: text },
    docClose: { fontSize: 13, color: accent, fontWeight: '700' },
    docGrid: { flexDirection: 'row', gap: 10 },
    docCell: { flex: 1, backgroundColor: soft, borderRadius: 12, padding: 12 },
    docCellLabel: { fontSize: 11, fontWeight: '700', color: muted, textTransform: 'uppercase', letterSpacing: 0.4 },
    docCellVal: { fontSize: 18, fontWeight: '900', marginTop: 4, color: text },
    docCellSub: { fontSize: 10.5, color: body, marginTop: 3, lineHeight: 15 },
    docNetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: border },
    docNetLabel: { fontSize: 14, fontWeight: '800', color: text },
    docNetVal: { fontSize: 22, fontWeight: '900' },
    aiBox: { marginTop: 14, backgroundColor: accentSoft, borderRadius: 12, padding: 14 },
    aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 7 },
    aiTitle: { fontSize: 12.5, fontWeight: '800', color: accent },
    aiText: { fontSize: 13.5, color: text, lineHeight: 21 },
  });
}
