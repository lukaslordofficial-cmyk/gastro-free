/**
 * PremiumFinanceScreen — pełny Pro Dark Dashboard (styl banera),
 * z treścią 1:1 jak w Free: portfel, KPI, dziennik, koszty, wykres, raporty, subskrypcja.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Dimensions,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import {
  Plus,
  Trash2,
  Pencil,
  MessageSquare,
  TrendingUp,
  Mic,
  ChevronDown,
  ChevronRight,
  X,
  TriangleAlert,
  FileDown,
} from 'lucide-react-native';
import { FinancePdfExportModal } from '@/components/FinancePdfExportModal';
import { PremiumColors, PremiumTokens } from '@/constants/premiumTheme';
import { PremiumScreenBackground } from '@/components/premium/PremiumScreenBackground';
import {
  AiWaveOrb,
  AnimatedCounter,
  GlitchTyping,
} from '@/components/premium/premiumAnimations';
import { PremiumJarvisCard, PremiumAlertBanner } from '@/components/premium/PremiumUI';
import { DS } from '@/constants/premiumTheme';
import { ExpandableDateJournal } from '@/components/ExpandableDateJournal';
import { CreditsWalletCard } from '@/components/CreditsWalletCard';
import { AlertBanner } from '@/components/AlertBanner';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { ReportsArchive } from '@/components/ReportsArchive';
import { SubscriptionPanel } from '@/components/SubscriptionPanel';
import { AdBannerFooter } from '@/components/ads/AdBannerFooter';
import type { FixedCost, RevenueEntry, VariableCostEntry } from '@/lib/types';
import { formatInvoiceLineLabel, parseInvoiceCostNote } from '@/lib/invoiceCostNote';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { ChartYAxis, GreenAreaLineChart } from '@/components/GreenAreaLineChart';

const LOGO = require('@/assets/premium/gastro-manager-logo.webp');
const { width: SCREEN_W } = Dimensions.get('window');
const WEEKDAYS_PL = ['niedz.', 'pon.', 'wt.', 'śr.', 'czw.', 'pt.', 'sob.'];

function formatPLN(n: number): string {
  return Math.round(n).toLocaleString('pl-PL', { maximumFractionDigits: 0 }) + ' PLN';
}

type ChartRecord = {
  year_month: string;
  revenue_pln: number;
  variable_costs_pln?: number;
  fixed_costs_pln?: number;
};

type Props = {
  currentMonth: string;
  revenueEntries: RevenueEntry[];
  revenueJournal: RevenueEntry[];
  fixedCosts: FixedCost[];
  fixedCostsJournal: FixedCost[];
  variableEntries: VariableCostEntry[];
  variableCostsJournal: VariableCostEntry[];
  chartRecords: ChartRecord[];
  criticalCount: number;
  criticalItems: {
    id: string;
    name: string;
    quantity: number;
    minQuantity: number;
    unit: string;
  }[];
  refreshing: boolean;
  onRefresh: () => void;
  onOpenMagazyn: () => void;
  onOpenCriticalCascade: () => void;
  onOpenCriticalProduct: (id: string, name: string) => void;
  onAddRevenue: () => void;
  onAddFixed: () => void;
  onAddVariable: () => void;
  onEditCost?: (id: string, table: 'fixed' | 'variable') => void;
  onDelete: (id: string, table: 'fixed' | 'variable' | 'revenue') => void;
  expandedNoteId: string | null;
  noteText: string;
  noteSaving: boolean;
  onToggleNote: (id: string, note?: string | null) => void;
  onNoteChange: (t: string) => void;
  onSaveNote: (id: string, table: 'fixed' | 'variable' | 'revenue') => void;
  onOpenUsageHistory: () => void;
  onFetchApplied: () => void;
  /** Hint po skanie faktury — koszty mogą pojawić się z lekkim opóźnieniem. */
  syncHint?: boolean;
};

const MONTH_SHORT: Record<string, string> = {
  '01': 'Sty', '02': 'Lut', '03': 'Mar', '04': 'Kwi',
  '05': 'Maj', '06': 'Cze', '07': 'Lip', '08': 'Sie',
  '09': 'Wrz', '10': 'Paź', '11': 'Lis', '12': 'Gru',
};

/** Kompaktowa kwota na dolną oś / chipy (musi mieścić się w wąskim boxie). */
function compactAxisAmount(n: number): string {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs >= 100000) return `${sign}${Math.round(abs / 1000)}k`;
  if (abs >= 10000) return `${sign}${Math.round(abs / 1000)}k`;
  if (abs >= 1000) return `${sign}${(abs / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return `${sign}${Math.round(abs)}`;
}

function BarChart({
  points,
  onBarPress,
  metricLabel,
}: {
  points: { label: string; value: number; dateKey?: string; weekday?: string }[];
  onBarPress?: (p: { label: string; value: number; dateKey?: string; weekday?: string }) => void;
  metricLabel?: string;
}) {
  const values = points.map((r) => Number(r.value) || 0);

  if (!values.length) {
    return (
      <View style={{ height: 140, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: PremiumColors.textMuted, fontSize: 12 }}>
          Brak danych sprzedaży — dodaj przychody, a wykres się zaktualizuje.
        </Text>
      </View>
    );
  }

  const total = values.reduce((a, b) => a + b, 0);
  const mid = Math.floor(values.length / 2) || 1;
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  const first = firstHalf.reduce((a, b) => a + b, 0) / mid;
  const second = secondHalf.reduce((a, b) => a + b, 0) / Math.max(secondHalf.length, 1);
  const trendPct = Math.abs(first) > 1e-6 ? ((second - first) / Math.abs(first)) * 100 : null;
  const lineColor = total < 0 ? '#FF5252' : PremiumColors.neon;

  // Dolna oś SVG = kwoty. Nie używaj weekday.slice(0,3) — dla miesięcy/lat
  // weekday bywało „2026-01” / „2026” i dawało „202” na każdym ticku.
  const chartPts = points.map((p) => {
    const value = Number(p.value) || 0;
    return { label: compactAxisAmount(value), value };
  });

  const slot = Math.max(56, Math.min(72, Math.floor((SCREEN_W - 64) / Math.min(points.length, 7))));
  const chipW = Math.max(56, slot - 6);
  const chipGap = 6;
  // Szerokość musi uwzględniać gap między chipami — inaczej ostatnie dni miesiąca są obcinane (~27 zamiast 28–31).
  const plotW = Math.max(
    SCREEN_W - 88,
    points.length * chipW + Math.max(0, points.length - 1) * chipGap + 8,
  );
  const chartH = 170;

  return (
    <View>
      {/* Stały nagłówek — nie scrolluje się z wykresem */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: PremiumColors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>
            {metricLabel ?? 'Sprzedaż'}
          </Text>
          <Text style={{ color: lineColor, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 }}>
            {formatPLN(total)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {trendPct != null && Number.isFinite(trendPct) ? (
            <View style={{ backgroundColor: `${lineColor}22`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
              <Text style={{ color: lineColor, fontSize: 11, fontWeight: '800' }}>
                {trendPct >= 0 ? '+' : ''}{trendPct.toFixed(1)}%
              </Text>
            </View>
          ) : null}
          <Text style={{ color: PremiumColors.textMuted, fontSize: 11, fontWeight: '600' }}>
            {points.length} pkt
          </Text>
        </View>
      </View>

      {/* Stała oś Y + scroll tylko wykresu i dolnej osi dat */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <ChartYAxis points={chartPts} height={chartH} dark />
        <ScrollView horizontal showsHorizontalScrollIndicator decelerationRate="fast" style={{ flex: 1 }}>
          <View style={{ width: plotW }}>
            <GreenAreaLineChart
              points={chartPts}
              color={lineColor}
              height={chartH}
              hideHeader
              hideYAxis
              dark
              width={plotW}
            />
            <View style={{ flexDirection: 'row', gap: chipGap, marginTop: 4, paddingLeft: 4, width: plotW }}>
              {points.map((r, i) => {
                const v = values[i];
                const neg = v < 0;
                return (
                  <TouchableOpacity
                    key={`${r.label}-${i}`}
                    onPress={() => onBarPress?.(r)}
                    activeOpacity={0.8}
                    style={{
                      backgroundColor: neg ? 'rgba(255,82,82,0.12)' : 'rgba(0,230,118,0.12)',
                      borderRadius: 10,
                      paddingHorizontal: 6,
                      paddingVertical: 8,
                      minWidth: chipW,
                      width: chipW,
                      alignItems: 'center',
                      overflow: 'visible',
                    }}
                    testID={`premium-bar-${r.dateKey || i}`}
                  >
                    <Text
                      style={{ color: PremiumColors.textMuted, fontSize: 10, fontWeight: '700' }}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.75}
                    >
                      {r.label}
                    </Text>
                    <Text
                      style={{
                        color: neg ? '#FF5252' : PremiumColors.neon,
                        fontSize: 11,
                        fontWeight: '800',
                        marginTop: 2,
                        width: '100%',
                        textAlign: 'center',
                      }}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                      allowFontScaling={false}
                    >
                      {compactAxisAmount(v)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </View>
      <Text style={{ color: PremiumColors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 8 }}>
        Przesuń wykres · dotknij punkt → raport
      </Text>
    </View>
  );
}

function CollapsibleTile({
  title,
  summary,
  open,
  onToggle,
  right,
  children,
}: {
  title: string;
  summary?: string;
  open: boolean;
  onToggle: () => void;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.card}>
      <TouchableOpacity style={styles.collapseHead} onPress={onToggle} activeOpacity={0.8}>
        {open ? (
          <ChevronDown size={16} color={PremiumColors.neon} strokeWidth={2.5} />
        ) : (
          <ChevronRight size={16} color={PremiumColors.textMuted} strokeWidth={2.5} />
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{title}</Text>
          {summary ? <Text style={styles.kpiSub}>{summary}</Text> : null}
        </View>
        {right}
      </TouchableOpacity>
      {open ? <View style={{ marginTop: 10 }}>{children}</View> : null}
    </View>
  );
}

export function PremiumFinanceScreen(props: Props) {
  const [pdfOpen, setPdfOpen] = useState(false);
  const [view, setView] = useState<'panel' | 'raporty' | 'subskrypcja'>('panel');
  const [openRevenue, setOpenRevenue] = useState(true);
  const [openFixed, setOpenFixed] = useState(false);
  const [openVariable, setOpenVariable] = useState(false);
  const [chartGrain, setChartGrain] = useState<'day' | 'month' | 'year'>('month');
  const [chartMetric, setChartMetric] = useState<'revenue' | 'profit'>('revenue');
  const [chartYear, setChartYear] = useState(() => {
    const y = Number(String(props.currentMonth || '').slice(0, 4));
    return Number.isFinite(y) && y > 2000 ? y : new Date().getFullYear();
  });
  const [chartMonthYm, setChartMonthYm] = useState(
    () => props.currentMonth || `${new Date().getFullYear()}-01`,
  );
  const [dayReport, setDayReport] = useState<{
    label: string;
    value: number;
    dateKey?: string;
    weekday?: string;
    entries: RevenueEntry[];
  } | null>(null);

  const totalRevenue = props.revenueEntries.reduce((s, e) => s + Number(e.amount_pln), 0);
  const totalFixed = props.fixedCosts.reduce((s, c) => s + Number(c.amount_pln), 0);
  const totalVariable = props.variableEntries.reduce((s, e) => s + Number(e.amount_pln), 0);
  const totalCosts = totalFixed + totalVariable;
  const netProfit = totalRevenue - totalCosts;

  /** Panel KPI → te same drzewa ExpandableDateJournal co w zakładce Raporty. */
  const openRaportyRevenueTree = () => {
    setView('raporty');
    setOpenRevenue(true);
    setOpenFixed(false);
    setOpenVariable(false);
  };
  const openRaportyCostsTrees = () => {
    setView('raporty');
    setOpenRevenue(false);
    setOpenFixed(true);
    setOpenVariable(true);
  };

  const availableYears = useMemo(() => {
    const nowY = new Date().getFullYear();
    const ys = new Set<number>([nowY]);
    const cy = Number(String(props.currentMonth || '').slice(0, 4));
    if (Number.isFinite(cy) && cy > 2000) ys.add(cy);
    for (const r of props.chartRecords) {
      const y = Number(String(r.year_month).slice(0, 4));
      if (Number.isFinite(y) && y > 2000) ys.add(y);
    }
    for (const e of props.revenueJournal || []) {
      const y = Number(String(e.year_month || '').slice(0, 4));
      if (Number.isFinite(y) && y > 2000) ys.add(y);
    }
    return Array.from(ys).filter((y) => y !== 2025).sort((a, b) => a - b);
  }, [props.chartRecords, props.revenueJournal, props.currentMonth]);

  const monthsInChartYear = useMemo(() => {
    const set = new Set<string>();
    for (const r of props.chartRecords) {
      if (String(r.year_month).startsWith(String(chartYear))) set.add(r.year_month);
    }
    for (const e of props.revenueJournal || []) {
      const ym = e.year_month;
      if (ym && ym.startsWith(String(chartYear))) set.add(ym);
    }
    for (let m = 1; m <= 12; m++) set.add(`${chartYear}-${String(m).padStart(2, '0')}`);
    return Array.from(set).sort();
  }, [props.chartRecords, props.revenueJournal, chartYear]);

  const salesChartPoints = useMemo(() => {
    const journal = props.revenueJournal?.length ? props.revenueJournal : props.revenueEntries;
    const varJ = props.variableCostsJournal?.length ? props.variableCostsJournal : props.variableEntries;
    const fixedJ = props.fixedCostsJournal?.length ? props.fixedCostsJournal : props.fixedCosts;

    const dayKey = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    const revByDay = new Map<string, number>();
    const fixedByMonth = new Map<string, number>();
    const revByMonth = new Map<string, number>();
    const varByMonth = new Map<string, number>();

    for (const e of journal) {
      const ym = e.year_month || '';
      if (ym) revByMonth.set(ym, (revByMonth.get(ym) || 0) + Number(e.amount_pln));
      const iso = String(e.created_at || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso) && (!ym || iso.startsWith(ym))) {
        revByDay.set(iso, (revByDay.get(iso) || 0) + Number(e.amount_pln));
      } else if (ym) {
        const d = new Date(e.created_at);
        if (!Number.isNaN(d.getTime())) {
          const k = `${ym}-${String(d.getDate()).padStart(2, '0')}`;
          revByDay.set(k, (revByDay.get(k) || 0) + Number(e.amount_pln));
        }
      }
    }
    for (const e of varJ) {
      const ym = e.year_month || '';
      if (ym) varByMonth.set(ym, (varByMonth.get(ym) || 0) + Number(e.amount_pln));
    }
    for (const e of fixedJ) {
      const ym = e.year_month || '';
      fixedByMonth.set(ym, (fixedByMonth.get(ym) || 0) + Number(e.amount_pln));
    }
    for (const rec of props.chartRecords) {
      const ym = rec.year_month;
      if ((revByMonth.get(ym) || 0) <= 0 && Number(rec.revenue_pln) > 0) {
        revByMonth.set(ym, Number(rec.revenue_pln));
      }
      if ((varByMonth.get(ym) || 0) <= 0 && Number(rec.variable_costs_pln || 0) > 0) {
        varByMonth.set(ym, Number(rec.variable_costs_pln));
      }
      if ((fixedByMonth.get(ym) || 0) <= 0 && Number(rec.fixed_costs_pln || 0) > 0) {
        fixedByMonth.set(ym, Number(rec.fixed_costs_pln));
      }
    }
    // Bieżący miesiąc panelu — uzupełnij żywymi sumami
    if (props.currentMonth) {
      revByMonth.set(props.currentMonth, Math.max(revByMonth.get(props.currentMonth) || 0, totalRevenue));
      fixedByMonth.set(props.currentMonth, Math.max(fixedByMonth.get(props.currentMonth) || 0, totalFixed));
      varByMonth.set(props.currentMonth, Math.max(varByMonth.get(props.currentMonth) || 0, totalVariable));
    }

    const metricVal = (rev: number, fixed: number, variable: number) =>
      chartMetric === 'revenue' ? rev : rev - fixed - variable;

    if (chartGrain === 'day') {
      const ym = chartMonthYm || `${chartYear}-01`;
      const [yy, mm] = ym.split('-').map(Number);
      const dim = new Date(yy, mm, 0).getDate();
      const monthFixed = fixedByMonth.get(ym) || 0;
      const monthVar = varByMonth.get(ym) || 0;
      // Jak koszty stałe: rozkładamy sumę miesiąca / dni — wtedy dodanie kosztu zmiennego
      // przesuwa całą linię zysku (wcześniej tylko jeden dzień z created_at).
      const dailyFixed = monthFixed / Math.max(dim, 1);
      const dailyVar = monthVar / Math.max(dim, 1);
      const pts: { label: string; value: number; dateKey?: string; weekday?: string }[] = [];
      for (let day = 1; day <= dim; day++) {
        const key = `${ym}-${String(day).padStart(2, '0')}`;
        const rev = revByDay.get(key) || 0;
        const d = new Date(key + 'T12:00:00');
        // Zysk dzienny: przychód − fixed/dni − variable/dni
        let value = 0;
        if (chartMetric === 'revenue') {
          value = rev;
        } else {
          value = rev - dailyFixed - dailyVar;
        }
        pts.push({
          label: String(day).padStart(2, '0'),
          value,
          dateKey: key,
          weekday: WEEKDAYS_PL[d.getDay()] ?? '',
        });
      }
      return pts;
    }

    if (chartGrain === 'month') {
      const pts: { label: string; value: number; dateKey?: string; weekday?: string }[] = [];
      for (let m = 1; m <= 12; m++) {
        const key = `${chartYear}-${String(m).padStart(2, '0')}`;
        const rev = revByMonth.get(key) || 0;
        const vc = varByMonth.get(key) || 0;
        const fc = fixedByMonth.get(key) || 0;
        pts.push({
          label: MONTH_SHORT[String(m).padStart(2, '0')] ?? key,
          value: metricVal(rev, fc, vc),
          dateKey: `${key}-01`,
        });
      }
      return pts;
    }

    // year — jeden punkt na rok
    const years = availableYears.length ? availableYears : [chartYear];
    return years.map((y) => {
      let rev = 0;
      let vc = 0;
      let fc = 0;
      for (let m = 1; m <= 12; m++) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        rev += revByMonth.get(key) || 0;
        vc += varByMonth.get(key) || 0;
        fc += fixedByMonth.get(key) || 0;
      }
      return {
        label: String(y),
        value: metricVal(rev, fc, vc),
        dateKey: `${y}-01-01`,
      };
    });
  }, [
    props.revenueJournal,
    props.revenueEntries,
    props.variableCostsJournal,
    props.variableEntries,
    props.fixedCostsJournal,
    props.fixedCosts,
    props.chartRecords,
    props.currentMonth,
    chartGrain,
    chartMetric,
    chartYear,
    chartMonthYm,
    availableYears,
    totalFixed,
    totalRevenue,
    totalVariable,
  ]);

  const jarvisMsg = useMemo(() => {
    if (props.criticalCount > 0) {
      return `Clyde online. Wykryto ${props.criticalCount} braki magazynowe — kliknij baner alertów.`;
    }
    if (netProfit >= 0) {
      return `Clyde online. Zysk netto ${formatPLN(netProfit)} w tym miesiącu. Trend sprzedażowy stabilny.`;
    }
    return `Clyde online. Wynik ujemny ${formatPLN(netProfit)} — warto przejrzeć koszty zmienne.`;
  }, [props.criticalCount, netProfit]);

  const revenueNoteEditor =
    props.expandedNoteId && props.revenueJournal.some((r) => r.id === props.expandedNoteId) ? (
      <View style={styles.noteBox}>
        <TextInput
          style={styles.noteInput}
          value={props.noteText}
          onChangeText={props.onNoteChange}
          placeholder="Dodaj notatkę..."
          placeholderTextColor={PremiumColors.textMuted}
          multiline
        />
        <TouchableOpacity
          style={styles.noteSave}
          onPress={() => props.onSaveNote(props.expandedNoteId!, 'revenue')}
          disabled={props.noteSaving}
        >
          {props.noteSaving ? (
            <ActivityIndicator color="#000" size="small" />
          ) : (
            <Text style={styles.noteSaveText}>Zapisz</Text>
          )}
        </TouchableOpacity>
      </View>
    ) : null;

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <PremiumScreenBackground style={{ flex: 1 }}>
      <ScrollView
        refreshControl={
          <RefreshControl
            refreshing={props.refreshing}
            onRefresh={props.onRefresh}
            tintColor={PremiumColors.neon}
          />
        }
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(450)} style={styles.header}>
          <Image source={LOGO} style={styles.logo} contentFit="contain" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.brand} numberOfLines={1} adjustsFontSizeToFit>
              GASTRO-MANAGER
            </Text>
            <Text style={styles.brandSub}>PRO DARK · JARVIS VOICE</Text>
            <Text style={styles.monthLabel}>Panel finansowy · {props.currentMonth}</Text>
          </View>
        </Animated.View>

        <View style={styles.metaRow}>
          <View style={styles.voiceStatus}>
            <Mic size={12} color={PremiumColors.neon} strokeWidth={2.5} />
            <Text style={styles.voiceStatusText}>Voice AI · Online</Text>
          </View>
        </View>

        <View style={styles.reportBtnWrap}>
          <ReportInfoButton
            contextHint="Finanse"
            onApplied={props.onFetchApplied}
            testID="finanse-report-info-premium"
            centered
            darkText
          />
        </View>

        {props.syncHint ? (
          <View style={styles.syncHint}>
            <Text style={styles.syncHintTitle}>Synchronizacja kosztów…</Text>
            <Text style={styles.syncHintBody}>
              Po fakturze koszty zmienne pojawią się za chwilę. Jeśli ich nie widać — przeciągnij listę w dół.
            </Text>
          </View>
        ) : null}

        <View style={styles.segment}>
          {(['panel', 'raporty', 'subskrypcja'] as const).map((key) => (
            <TouchableOpacity
              key={key}
              style={[styles.segmentBtn, view === key && styles.segmentBtnActive]}
              onPress={() => setView(key)}
            >
              <Text style={[styles.segmentText, view === key && styles.segmentTextActive]}>
                {key === 'panel' ? 'Panel' : key === 'raporty' ? 'Raporty' : 'Subskrypcja'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {view === 'raporty' && (
          <>
            <TouchableOpacity
              style={styles.pdfExportBtn}
              onPress={() => setPdfOpen(true)}
              activeOpacity={0.85}
              testID="finance-pdf-export-open"
            >
              <FileDown size={16} color={PremiumColors.neon} strokeWidth={2.4} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.pdfExportTitle}>Pobierz raport (PDF / Excel)</Text>
                <Text style={styles.pdfExportSub}>
                  Zbiorczy, zyski lub dostawy · wybór zakresu dat
                </Text>
              </View>
              <ChevronRight size={16} color={PremiumColors.textMuted} />
            </TouchableOpacity>

            <CollapsibleTile
              title="Dziennik przychodów"
              summary={`${props.revenueJournal.length} wpisów · ${formatPLN(totalRevenue)}`}
              open={openRevenue}
              onToggle={() => setOpenRevenue((v) => !v)}
              right={
                <TouchableOpacity style={styles.sectionAdd} onPress={props.onAddRevenue}>
                  <Plus size={14} color={PremiumColors.neon} />
                </TouchableOpacity>
              }
            >
              <ExpandableDateJournal
                items={props.revenueJournal.map((e) => ({
                  id: e.id,
                  created_at: e.created_at,
                  title: e.description || 'Przychód',
                  amount: Number(e.amount_pln),
                  meta: (e as any).note ?? undefined,
                }))}
                emptyText="Brak przychodów — kliknij +"
                formatAmount={formatPLN}
                amountPositive
                renderActions={(item) => (
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TouchableOpacity
                      onPress={() => {
                        const entry = props.revenueJournal.find((r) => r.id === item.id);
                        props.onToggleNote(item.id, (entry as any)?.note);
                      }}
                      style={styles.iconBtn}
                    >
                      <MessageSquare
                        size={13}
                        color={
                          props.expandedNoteId === item.id
                            ? PremiumColors.neon
                            : PremiumColors.textMuted
                        }
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => props.onDelete(item.id, 'revenue')}
                      style={styles.iconBtn}
                    >
                      <Trash2 size={13} color={PremiumColors.alert} />
                    </TouchableOpacity>
                  </View>
                )}
              />
              {revenueNoteEditor}
            </CollapsibleTile>

            <CollapsibleTile
              title="Koszty stałe"
              summary={`${(props.fixedCostsJournal?.length ? props.fixedCostsJournal : props.fixedCosts).length} pozycji · ${formatPLN(
                (props.fixedCostsJournal?.length ? props.fixedCostsJournal : props.fixedCosts).reduce(
                  (s, c) => s + Number(c.amount_pln),
                  0,
                ),
              )}`}
              open={openFixed}
              onToggle={() => setOpenFixed((v) => !v)}
              right={
                <TouchableOpacity style={styles.sectionAdd} onPress={props.onAddFixed}>
                  <Plus size={14} color={PremiumColors.neon} />
                </TouchableOpacity>
              }
            >
              <ExpandableDateJournal
                items={(props.fixedCostsJournal?.length ? props.fixedCostsJournal : props.fixedCosts).map((c) => ({
                  id: c.id,
                  created_at: c.created_at || `${c.year_month}-01T12:00:00`,
                  title: c.name,
                  amount: Number(c.amount_pln),
                  meta: c.year_month,
                }))}
                emptyText="Brak kosztów stałych — kliknij +"
                formatAmount={formatPLN}
                renderActions={(item) => (
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {props.onEditCost ? (
                      <TouchableOpacity onPress={() => props.onEditCost!(item.id, 'fixed')} style={styles.iconBtn}>
                        <Pencil size={13} color={PremiumColors.textMuted} />
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity onPress={() => props.onDelete(item.id, 'fixed')} style={styles.iconBtn}>
                      <Trash2 size={13} color={PremiumColors.alert} />
                    </TouchableOpacity>
                  </View>
                )}
              />
            </CollapsibleTile>

            <CollapsibleTile
              title="Koszty zmienne"
              summary={`${(props.variableCostsJournal?.length ? props.variableCostsJournal : props.variableEntries).length} pozycji · ${formatPLN(
                (props.variableCostsJournal?.length ? props.variableCostsJournal : props.variableEntries).reduce(
                  (s, e) => s + Number(e.amount_pln),
                  0,
                ),
              )}`}
              open={openVariable}
              onToggle={() => setOpenVariable((v) => !v)}
              right={
                <TouchableOpacity style={styles.sectionAdd} onPress={props.onAddVariable}>
                  <Plus size={14} color={PremiumColors.alert} />
                </TouchableOpacity>
              }
            >
              <ExpandableDateJournal
                items={(props.variableCostsJournal?.length ? props.variableCostsJournal : props.variableEntries).map((e) => {
                  const invoice = parseInvoiceCostNote(e.note);
                  return {
                    id: e.id,
                    created_at: e.created_at || `${e.year_month}-01T12:00:00`,
                    title: e.name,
                    amount: Number(e.amount_pln),
                    meta: invoice?.supplier_name
                      ? `${e.year_month} · ${invoice.supplier_name}`
                      : e.year_month,
                    detailLines: invoice
                      ? invoice.lines.map(formatInvoiceLineLabel)
                      : undefined,
                  };
                })}
                emptyText="Brak kosztów zmiennych — kliknij +"
                formatAmount={formatPLN}
                renderActions={(item) => (
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    {props.onEditCost ? (
                      <TouchableOpacity onPress={() => props.onEditCost!(item.id, 'variable')} style={styles.iconBtn}>
                        <Pencil size={13} color={PremiumColors.textMuted} />
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity onPress={() => props.onDelete(item.id, 'variable')} style={styles.iconBtn}>
                      <Trash2 size={13} color={PremiumColors.alert} />
                    </TouchableOpacity>
                  </View>
                )}
              />
            </CollapsibleTile>

            <ReportsArchive onClosedDay={props.onFetchApplied} />
          </>
        )}
        {view === 'subskrypcja' && <SubscriptionPanel />}

        {view === 'panel' && (
          <>
            <CreditsWalletCard onPress={props.onOpenUsageHistory} testID="panel-wallet-premium" />
            {props.criticalCount > 0 ? (
              <PremiumAlertBanner
                title={`${props.criticalCount} produktów wymaga uzupełnienia`}
                subtitle="Kliknij, aby zobaczyć produkty w kaskadzie."
                onPress={props.onOpenCriticalCascade}
                icon={<TriangleAlert size={20} color={DS.color.warning} strokeWidth={2} />}
              />
            ) : null}

            <PremiumJarvisCard
              subtitle={jarvisMsg}
              orb={<AiWaveOrb listening />}
            />

            <Text style={styles.sectionLabel}>Wyniki bieżącego miesiąca</Text>
            <View style={styles.kpiRow}>
              <Animated.View entering={FadeInDown.delay(120).duration(400)} style={styles.kpi}>
                <TouchableOpacity
                  style={styles.kpiTap}
                  onPress={openRaportyRevenueTree}
                  activeOpacity={0.85}
                  testID="kpi-przychod-open-tree"
                >
                  <Text style={styles.kpiTitle}>Przychód</Text>
                  <AnimatedCounter value={totalRevenue} formatValue={formatPLN} style={styles.kpiValue} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.kpiAdd} onPress={props.onAddRevenue}>
                  <Plus size={14} color={PremiumColors.neon} strokeWidth={2.5} />
                </TouchableOpacity>
              </Animated.View>
              <Animated.View entering={FadeInDown.delay(180).duration(400)} style={styles.kpi}>
                <TouchableOpacity
                  style={styles.kpiTap}
                  onPress={openRaportyCostsTrees}
                  activeOpacity={0.85}
                  testID="kpi-koszty-open-trees"
                >
                  <Text style={styles.kpiTitle}>Koszty łącznie</Text>
                  <AnimatedCounter value={totalCosts} formatValue={formatPLN} style={styles.kpiValue} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.kpiAdd} onPress={props.onAddFixed}>
                  <Plus size={14} color={PremiumColors.neon} strokeWidth={2.5} />
                </TouchableOpacity>
              </Animated.View>
            </View>
            <Animated.View
              entering={FadeInDown.delay(220).duration(400)}
              style={[styles.kpi, { marginBottom: 12, alignItems: 'center' }]}
            >
              <Text style={[styles.kpiTitle, { textAlign: 'center' }]}>Zysk netto</Text>
              <AnimatedCounter
                value={Math.abs(netProfit)}
                formatValue={(n) => (netProfit >= 0 ? '+' : '−') + formatPLN(n)}
                style={[
                  styles.kpiValue,
                  { color: netProfit >= 0 ? PremiumColors.neon : PremiumColors.alert, textAlign: 'center' },
                ]}
              />
              <Text style={[styles.kpiSub, { textAlign: 'center' }]}>
                {netProfit >= 0 ? 'Rentowność pozytywna' : 'Wynik ujemny — wymaga reakcji'}
              </Text>
            </Animated.View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Przegląd sprzedaży</Text>
              <View style={styles.chartTabs}>
                {([
                  ['revenue', 'Przychód'],
                  ['profit', 'Zysk'],
                ] as const).map(([id, label]) => (
                  <TouchableOpacity
                    key={id}
                    style={[styles.chartTab, chartMetric === id && styles.chartTabActive]}
                    onPress={() => setChartMetric(id)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.chartTabText, chartMetric === id && styles.chartTabTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              <View style={styles.chartTabs}>
                {([
                  ['day', 'Dni'],
                  ['month', 'Miesiące'],
                  ['year', 'Lata'],
                ] as const).map(([id, label]) => (
                  <TouchableOpacity
                    key={id}
                    style={[styles.chartTab, chartGrain === id && styles.chartTabActive]}
                    onPress={() => setChartGrain(id)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.chartTabText, chartGrain === id && styles.chartTabTextActive]}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {availableYears.length > 0 && chartGrain !== 'year' ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {availableYears.map((y) => (
                      <TouchableOpacity
                        key={y}
                        style={[
                          styles.chartTab,
                          chartYear === y && styles.chartTabActive,
                          { flex: 0, paddingHorizontal: 12 },
                        ]}
                        onPress={() => {
                          setChartYear(y);
                          const prefer =
                            props.currentMonth?.startsWith(String(y))
                              ? props.currentMonth
                              : `${y}-01`;
                          setChartMonthYm(prefer);
                        }}
                      >
                        <Text style={[styles.chartTabText, chartYear === y && styles.chartTabTextActive]}>
                          {y}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              ) : null}
              {chartGrain === 'day' ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 8 }}>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {monthsInChartYear.map((ym) => {
                      const mm = ym.slice(5, 7);
                      const active = chartMonthYm === ym;
                      return (
                        <TouchableOpacity
                          key={ym}
                          style={[
                            styles.chartTab,
                            active && styles.chartTabActive,
                            { flex: 0, paddingHorizontal: 12 },
                          ]}
                          onPress={() => setChartMonthYm(ym)}
                        >
                          <Text style={[styles.chartTabText, active && styles.chartTabTextActive]}>
                            {MONTH_SHORT[mm] ?? mm}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>
              ) : null}
              <Text style={styles.kpiSub}>
                {chartMetric === 'revenue' ? 'Przychody' : 'Zysk / strata'} ·{' '}
                {chartGrain === 'day' ? chartMonthYm : chartGrain === 'month' ? chartYear : 'lata'}
              </Text>
              <BarChart
                points={salesChartPoints}
                metricLabel={chartMetric === 'revenue' ? 'Przychód łącznie' : 'Zysk / strata łącznie'}
                onBarPress={(p) => {
                  const key = p.dateKey || '';
                  const entries = (props.revenueJournal || []).filter((e) => {
                    const d = new Date(e.created_at);
                    if (Number.isNaN(d.getTime()) || !key) return false;
                    const dk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                    if (chartGrain === 'day') return dk === key;
                    if (chartGrain === 'year') return (e.year_month || dk).startsWith(key.slice(0, 4));
                    return (e.year_month || dk.slice(0, 7)) === key.slice(0, 7);
                  });
                  setDayReport({ ...p, entries });
                }}
              />
            </View>
          </>
        )}

        <View style={{ height: 16 }} />
        <AdBannerFooter />
      </ScrollView>

      <Modal visible={!!dayReport} animationType="slide" transparent onRequestClose={() => setDayReport(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' }}>
          <View
            style={{
              backgroundColor: PremiumColors.card,
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              padding: 18,
              paddingBottom: 32,
              maxHeight: '75%',
              borderWidth: 1,
              borderColor: PremiumColors.border,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <TrendingUp size={18} color={PremiumColors.neon} strokeWidth={2.2} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: PremiumColors.text, fontSize: 16, fontWeight: '800' }}>
                  Raport sprzedaży
                </Text>
                <Text style={{ color: PremiumColors.textMuted, fontSize: 12, marginTop: 2 }}>
                  {dayReport?.weekday} · {dayReport?.label} {dayReport?.dateKey ? `(${dayReport.dateKey})` : ''}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setDayReport(null)} hitSlop={10}>
                <X size={22} color={PremiumColors.textMuted} />
              </TouchableOpacity>
            </View>
            <View
              style={{
                backgroundColor: PremiumColors.neonSoft,
                borderRadius: 12,
                padding: 14,
                marginBottom: 12,
              }}
            >
              <Text style={{ color: PremiumColors.textMuted, fontSize: 11, fontWeight: '600' }}>
                {chartMetric === 'profit' ? 'Zysk / strata' : 'Przychód'}
              </Text>
              <Text
                style={{
                  color: (dayReport?.value ?? 0) < 0 ? '#FF5252' : PremiumColors.neon,
                  fontSize: 22,
                  fontWeight: '900',
                  marginTop: 2,
                }}
              >
                {formatPLN(dayReport?.value ?? 0)}
              </Text>
              <Text style={{ color: PremiumColors.textMuted, fontSize: 11, marginTop: 4 }}>
                {(dayReport?.entries.length ?? 0)} wpisów
              </Text>
            </View>
            <ScrollView style={{ maxHeight: 280 }}>
              {(dayReport?.entries.length ?? 0) === 0 ? (
                <Text style={{ color: PremiumColors.textMuted, fontSize: 13, lineHeight: 19 }}>
                  Brak szczegółowych wpisów w dzienniku dla tego okresu.
                </Text>
              ) : (
                dayReport!.entries.map((e) => (
                  <View
                    key={e.id}
                    style={{
                      flexDirection: 'row',
                      paddingVertical: 10,
                      borderBottomWidth: 1,
                      borderBottomColor: PremiumColors.border,
                      gap: 10,
                    }}
                  >
                    <Text style={{ flex: 1, color: PremiumColors.text, fontWeight: '600' }}>
                      {e.description || 'Przychód'}
                    </Text>
                    <Text style={{ color: PremiumColors.neon, fontWeight: '800' }}>
                      {formatPLN(Number(e.amount_pln))}
                    </Text>
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <FinancePdfExportModal
        visible={pdfOpen}
        onClose={() => setPdfOpen(false)}
        defaultMonth={props.currentMonth}
      />
      </PremiumScreenBackground>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: PremiumColors.bg },
  content: { padding: PremiumTokens.space.screen, paddingBottom: 56 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: PremiumTokens.space.headerGap },
  logo: { width: 72, height: 72 },
  brand: {
    color: PremiumColors.neon,
    fontSize: 17,
    fontWeight: '800',
    letterSpacing: 1.2,
  },
  brandSub: {
    color: PremiumTokens.color.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 1.4,
    marginTop: 4,
  },
  monthLabel: { color: PremiumColors.textSecondary, fontSize: 13, marginTop: 6 },
  devToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: PremiumColors.card,
    borderRadius: PremiumTokens.radius.md,
    borderWidth: 1,
    borderColor: PremiumColors.border,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  devToggleText: { color: PremiumColors.neon, fontSize: 12, fontWeight: '700' },
  metaRow: {
    marginBottom: PremiumTokens.space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  voiceStatus: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  voiceStatusText: { color: PremiumColors.neon, fontSize: 12, fontWeight: '600' },
  reportBtnWrap: { alignItems: 'center', marginBottom: PremiumTokens.space.lg },
  pdfExportBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: PremiumTokens.color.card,
    borderRadius: PremiumTokens.radius.lg,
    borderWidth: 1,
    borderColor: PremiumTokens.color.neonLine,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: PremiumTokens.space.md,
  },
  pdfExportTitle: { color: PremiumColors.text, fontSize: 14, fontWeight: '700' },
  pdfExportSub: { color: PremiumColors.textMuted, fontSize: 11, marginTop: 2 },
  collapseHead: { flexDirection: 'row', alignItems: 'center', gap: PremiumTokens.icon.gap },
  segment: {
    flexDirection: 'row',
    backgroundColor: PremiumTokens.color.bgMid,
    borderRadius: PremiumTokens.radius.lg,
    padding: 5,
    marginBottom: PremiumTokens.space.lg,
    borderWidth: 1,
    borderColor: PremiumColors.border,
  },
  segmentBtn: { flex: 1, paddingVertical: 11, borderRadius: 14, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: PremiumColors.cardElevated },
  segmentText: { fontSize: 13, fontWeight: '600', color: PremiumColors.textMuted },
  segmentTextActive: { color: PremiumColors.neon },
  jarvisCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PremiumColors.card,
    borderRadius: PremiumTokens.radius.xl,
    padding: PremiumTokens.space.cardPad,
    borderWidth: 1,
    borderColor: PremiumColors.border,
    marginBottom: PremiumTokens.space.cardGap,
    shadowColor: '#00FF88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
  },
  jarvisText: { color: PremiumColors.textSecondary, fontSize: 15, lineHeight: 22, marginTop: 6 },
  sectionLabel: {
    color: PremiumColors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.4,
    marginBottom: PremiumTokens.space.headerGap,
    textTransform: 'uppercase',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: PremiumTokens.space.headerGap,
  },
  sectionAdd: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: PremiumColors.neonSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiRow: { flexDirection: 'row', gap: PremiumTokens.space.cardGap, marginBottom: PremiumTokens.space.cardGap },
  kpi: {
    flex: 1,
    backgroundColor: PremiumColors.card,
    borderRadius: PremiumTokens.radius.xl,
    padding: PremiumTokens.space.cardPad,
    borderWidth: 1,
    borderColor: PremiumColors.border,
  },
  kpiTitle: { color: PremiumColors.textMuted, fontSize: 11, fontWeight: '500', marginBottom: 6 },
  kpiValue: { color: PremiumColors.text, fontSize: 18, fontWeight: '700', letterSpacing: -0.4 },
  kpiSub: { color: PremiumColors.textSecondary, fontSize: 12, marginTop: 6 },
  kpiTap: { paddingRight: 28 },
  kpiAdd: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: PremiumColors.neonSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    backgroundColor: PremiumColors.card,
    borderRadius: PremiumTokens.radius.xl,
    padding: PremiumTokens.space.cardPad,
    borderWidth: 1,
    borderColor: PremiumColors.border,
    marginBottom: PremiumTokens.space.cardGap,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 6,
  },
  cardTitle: {
    color: PremiumColors.text,
    fontSize: PremiumTokens.type.cardTitle.fontSize,
    fontWeight: PremiumTokens.type.cardTitle.fontWeight,
    marginBottom: 12,
  },
  cardHeadRow: { flexDirection: 'row', alignItems: 'center', gap: PremiumTokens.icon.gap, marginBottom: 6 },
  seeAll: { color: PremiumColors.neon, fontSize: 13, fontWeight: '700' },
  chartTabs: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
    marginBottom: 12,
  },
  chartTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: PremiumTokens.radius.md,
    backgroundColor: PremiumTokens.color.bgMid,
    borderWidth: 1,
    borderColor: PremiumColors.border,
    alignItems: 'center',
  },
  chartTabActive: {
    borderColor: PremiumColors.neon,
    backgroundColor: PremiumColors.neonSoft,
  },
  chartTabText: { color: PremiumColors.textMuted, fontSize: 12, fontWeight: '600' },
  chartTabTextActive: { color: PremiumColors.neon },
  customRangeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  dateInput: {
    flex: 1,
    backgroundColor: '#0E0E0E',
    borderWidth: 1,
    borderColor: PremiumColors.border,
    borderRadius: 8,
    color: PremiumColors.text,
    fontSize: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  costRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: PremiumColors.border,
  },
  costName: { color: PremiumColors.text, fontSize: 13, fontWeight: '600' },
  costAmt: { color: PremiumColors.textSecondary, fontSize: 13, fontWeight: '700' },
  iconBtn: { padding: 4 },
  empty: { color: PremiumColors.textMuted, fontSize: 13, textAlign: 'center', padding: 12 },
  noteBox: { marginTop: 8, gap: 8 },
  noteInput: {
    backgroundColor: '#0F0F0F',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: PremiumColors.border,
    color: PremiumColors.text,
    padding: 10,
    minHeight: 56,
    textAlignVertical: 'top',
  },
  noteSave: {
    alignSelf: 'flex-end',
    backgroundColor: PremiumColors.neon,
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  noteSaveText: { color: '#0A0A0A', fontWeight: '800', fontSize: 12 },
  syncHint: {
    marginBottom: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: 'rgba(0,255,120,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,255,120,0.22)',
  },
  syncHintTitle: { color: PremiumColors.text, fontSize: 13, fontWeight: '700' },
  syncHintBody: { color: PremiumColors.textMuted, fontSize: 12, marginTop: 4, lineHeight: 17 },
  lowRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  lowBadge: {
    backgroundColor: PremiumColors.alertSoft,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  lowBadgeText: { color: PremiumColors.alert, fontSize: 10, fontWeight: '800' },
});
