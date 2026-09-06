/**
 * PremiumFinanceScreen — pełny Pro Dark Dashboard (styl banera),
 * z treścią 1:1 jak w Free: portfel, KPI, dziennik, koszty, wykres, raporty, subskrypcja.
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import {
  Plus,
  Trash2,
  Mic,
  ChevronRight,
  X,
  TriangleAlert,
  FileDown,
  TrendingUp,
} from 'lucide-react-native';
import { FinancePdfExportModal } from '@/components/FinancePdfExportModal';
import { PremiumColors } from '@/constants/premiumTheme';
import { PremiumScreenBackground } from '@/components/premium/PremiumScreenBackground';
import {
  AiWaveOrb,
  AnimatedCounter,
} from '@/components/premium/premiumAnimations';
import { PremiumJarvisCard, PremiumAlertBanner } from '@/components/premium/PremiumUI';
import { DS } from '@/constants/premiumTheme';
import { CreditsWalletCard } from '@/components/CreditsWalletCard';
import { FinanceHeaderActions } from '@/components/FinanceHeaderActions';
import { ReportsArchive } from '@/components/ReportsArchive';
import { SubscriptionPanel } from '@/components/SubscriptionPanel';
import { AdBannerFooter } from '@/components/ads/AdBannerFooter';
import type { FixedCost, RevenueEntry, VariableCostEntry } from '@/lib/types';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { PremiumFinanceBarChart } from '@/components/premium/PremiumFinanceBarChart';
import { formatPLN, MONTH_SHORT, WEEKDAYS_PL } from '@/components/premium/premiumFinanceHelpers';
import { premiumFinanceStyles as styles } from '@/components/premium/premiumFinanceStyles';
import { PremiumFinanceKpiStrip } from '@/components/premium/PremiumFinanceKpiStrip';
import { PremiumFinanceJournals } from '@/components/premium/PremiumFinanceJournals';

const LOGO = require('@/assets/premium/gastro-manager-logo.webp');

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
    costEntries: VariableCostEntry[];
    variableCost: number;
    fixedShare: number;
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
    const varByDay = new Map<string, number>();
    for (const e of varJ) {
      const ym = e.year_month || '';
      if (ym) varByMonth.set(ym, (varByMonth.get(ym) || 0) + Number(e.amount_pln));
      const iso = String(e.created_at || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
        // Koszt zmienny (np. dostawa) spada na dzień zapisu — nie rozkładamy na cały miesiąc.
        varByDay.set(iso, (varByDay.get(iso) || 0) + Number(e.amount_pln));
      } else if (ym) {
        const d = new Date(e.created_at);
        if (!Number.isNaN(d.getTime())) {
          const k = `${ym}-${String(d.getDate()).padStart(2, '0')}`;
          varByDay.set(k, (varByDay.get(k) || 0) + Number(e.amount_pln));
        }
      }
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
      // Stałe: udział dzienny. Zmienne: pełna kwota w dniu created_at (dostawa / skan).
      const dailyFixed = monthFixed / Math.max(dim, 1);
      const pts: {
        label: string;
        value: number;
        dateKey?: string;
        weekday?: string;
        hasVariableCost?: boolean;
        variableCost?: number;
        fixedShare?: number;
      }[] = [];
      for (let day = 1; day <= dim; day++) {
        const key = `${ym}-${String(day).padStart(2, '0')}`;
        const rev = revByDay.get(key) || 0;
        const dayVar = varByDay.get(key) || 0;
        const d = new Date(key + 'T12:00:00');
        let value = 0;
        if (chartMetric === 'revenue') {
          value = rev;
        } else {
          value = rev - dailyFixed - dayVar;
        }
        pts.push({
          label: String(day).padStart(2, '0'),
          value,
          dateKey: key,
          weekday: WEEKDAYS_PL[d.getDay()] ?? '',
          hasVariableCost: dayVar > 0,
          variableCost: dayVar,
          fixedShare: dailyFixed,
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
          <FinanceHeaderActions
            onApplied={props.onFetchApplied}
            reportTestID="finanse-report-info-premium"
            notificationsTestID="finanse-notifications-premium"
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

            <PremiumFinanceJournals
              revenueJournal={props.revenueJournal}
              fixedCosts={props.fixedCosts}
              fixedCostsJournal={props.fixedCostsJournal}
              variableEntries={props.variableEntries}
              variableCostsJournal={props.variableCostsJournal}
              totalRevenue={totalRevenue}
              openRevenue={openRevenue}
              openFixed={openFixed}
              openVariable={openVariable}
              setOpenRevenue={setOpenRevenue}
              setOpenFixed={setOpenFixed}
              setOpenVariable={setOpenVariable}
              expandedNoteId={props.expandedNoteId}
              noteText={props.noteText}
              noteSaving={props.noteSaving}
              onToggleNote={props.onToggleNote}
              onNoteChange={props.onNoteChange}
              onSaveNote={props.onSaveNote}
              onAddRevenue={props.onAddRevenue}
              onAddFixed={props.onAddFixed}
              onAddVariable={props.onAddVariable}
              onEditCost={props.onEditCost}
              onDelete={props.onDelete}
              revenueNoteEditor={revenueNoteEditor}
            />


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

            <PremiumFinanceKpiStrip
              totalRevenue={totalRevenue}
              totalCosts={totalCosts}
              netProfit={netProfit}
              onOpenRevenueTree={openRaportyRevenueTree}
              onOpenCostsTrees={openRaportyCostsTrees}
              onAddRevenue={props.onAddRevenue}
              onAddFixed={props.onAddFixed}
            />


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
              <PremiumFinanceBarChart
                points={salesChartPoints}
                metricLabel={chartMetric === 'revenue' ? 'Przychód łącznie' : 'Zysk / strata łącznie'}
                onBarPress={(p) => {
                  const key = p.dateKey || '';
                  const entries = (props.revenueJournal || []).filter((e) => {
                    const iso = String(e.created_at || '').slice(0, 10);
                    if (chartGrain === 'day') return !!key && iso === key;
                    if (chartGrain === 'year') return (e.year_month || iso).startsWith(key.slice(0, 4));
                    return (e.year_month || iso.slice(0, 7)) === key.slice(0, 7);
                  });
                  const costEntries =
                    chartGrain === 'day' && key
                      ? (props.variableCostsJournal || []).filter(
                          (e) => String(e.created_at || '').slice(0, 10) === key,
                        )
                      : [];
                  setDayReport({
                    ...p,
                    entries,
                    costEntries,
                    variableCost: Number(p.variableCost || 0),
                    fixedShare: Number(p.fixedShare || 0),
                  });
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
                {(dayReport?.entries.length ?? 0)} przychodów
                {(dayReport?.costEntries.length ?? 0) > 0
                  ? ` · ${dayReport!.costEntries.length} kosztów zmiennych`
                  : ''}
              </Text>
              {chartMetric === 'profit' && (dayReport?.dateKey || '').length >= 10 ? (
                <Text style={{ color: PremiumColors.textMuted, fontSize: 11, marginTop: 6, lineHeight: 16 }}>
                  {dayReport!.fixedShare > 0
                    ? `Udział kosztów stałych: −${formatPLN(dayReport!.fixedShare)}`
                    : null}
                  {dayReport!.variableCost > 0
                    ? `${dayReport!.fixedShare > 0 ? ' · ' : ''}Koszty zmienne: −${formatPLN(dayReport!.variableCost)}`
                    : null}
                </Text>
              ) : null}
            </View>
            <ScrollView style={{ maxHeight: 280 }}>
              {(dayReport?.entries.length ?? 0) === 0 && (dayReport?.costEntries.length ?? 0) === 0 ? (
                <Text style={{ color: PremiumColors.textMuted, fontSize: 13, lineHeight: 19 }}>
                  Brak szczegółowych wpisów w dzienniku dla tego okresu.
                </Text>
              ) : (
                <>
                  {dayReport!.entries.map((e) => (
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
                  ))}
                  {dayReport!.costEntries.map((e) => (
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
                        {e.name || 'Koszt zmienny'}
                      </Text>
                      <Text style={{ color: '#FF5252', fontWeight: '800' }}>
                        −{formatPLN(Number(e.amount_pln))}
                      </Text>
                    </View>
                  ))}
                </>
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

