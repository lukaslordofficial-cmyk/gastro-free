import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Alert,
  DeviceEventEmitter,
} from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import type { FixedCost, RevenueEntry, VariableCostEntry } from '@/lib/types';
import * as financeService from '@/services/financeService';
import { FINANCE_CHANGED } from '@/lib/appRefresh';
import { useAuth } from '@/contexts/AuthContext';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';
import { CreditsUsageHistoryModal } from '@/components/CreditsUsageHistoryModal';
import { useThemeMode } from '@/contexts/ThemeModeContext';
import { PremiumFinanceScreen } from '@/components/premium/PremiumFinanceScreen';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { usePremiumAlert } from '@/components/PremiumAlert';
import {
  currentYearMonth,
  previousYearMonth,
  yearMonthLabelPl,
} from '@/components/finanse/constants';
import type { EditableCostKind, EditableCostRow, InvoicePreviewState } from '@/components/finanse/types';
import { AddRevenueModal } from '@/components/finanse/AddRevenueModal';
import { AddFixedCostModal } from '@/components/finanse/AddFixedCostModal';
import { AddVariableCostModal } from '@/components/finanse/AddVariableCostModal';
import { EditCostModal } from '@/components/finanse/EditCostModal';
import { ClassicFinanceScreen } from '@/components/finanse/ClassicFinanceScreen';

export default function FinanseScreen() {
  const router = useRouter();
  const { accountKey } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'panel' | 'raporty' | 'reklamy'>('panel');
  const [pdfOpen, setPdfOpen] = useState(false);
  const [invoicePreview, setInvoicePreview] = useState<InvoicePreviewState | null>(null);
  const [showUsageHistory, setShowUsageHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revenueEntries, setRevenueEntries] = useState<RevenueEntry[]>([]);
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
  const [variableEntries, setVariableEntries] = useState<VariableCostEntry[]>([]);
  const [chartRecords, setChartRecords] = useState<{
    id: string;
    year_month: string;
    revenue_pln: number;
    variable_costs_pln: number;
    fixed_costs_pln?: number;
    created_at: string;
  }[]>([]);
  const [criticalCount, setCriticalCount] = useState(0);
  const [criticalItems, setCriticalItems] = useState<
    {
      id: string;
      name: string;
      quantity: number;
      minQuantity: number;
      unit: string;
      isCritical?: boolean;
      isLow?: boolean;
      isCombo?: boolean;
    }[]
  >([]);
  const [inventorySnapshot, setInventorySnapshot] = useState<
    {
      id: string;
      name: string;
      quantity: number;
      minQuantity: number;
      unit: string;
      isCritical?: boolean;
      isLow?: boolean;
      isCombo?: boolean;
    }[]
  >([]);
  const { isPremiumUi } = useThemeMode();
  const { openProductCascade, documentScanRevision, lastDocumentScanKind } = useUiOverlay();
  const [revenueJournal, setRevenueJournal] = useState<RevenueEntry[]>([]);
  const [fixedCostsJournal, setFixedCostsJournal] = useState<FixedCost[]>([]);
  const [variableCostsJournal, setVariableCostsJournal] = useState<VariableCostEntry[]>([]);
  const [showAddRevenue, setShowAddRevenue] = useState(false);
  const [showAddFixed, setShowAddFixed] = useState(false);
  const [showAddVariable, setShowAddVariable] = useState(false);
  const [editCost, setEditCost] = useState<EditableCostRow | null>(null);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);
  const [financeSyncHint, setFinanceSyncHint] = useState(false);
  const { alert: premiumAlert } = usePremiumAlert();
  const hasFinanceDataRef = useRef(false);
  const scanRetryRef = useRef(0);
  const varCountBeforeScanRef = useRef(0);
  const fixedRolloverBusyRef = useRef(false);
  const fixedRolloverAskedYmRef = useRef<string | null>(null);

  const fetchData = useCallback(async (): Promise<{ variableCount: number } | null> => {
    try {
      const month = currentYearMonth();
      const rows = await financeService.fetchFinanceRows(accountKey, month);

      const safeRows = <T extends { year_month?: string | null; created_at?: string | null }>(list: T[] | null | undefined): T[] =>
        (list ?? []).filter((r) => {
          const ym = (r.year_month || '').trim();
          return /^\d{4}-\d{2}$/.test(ym);
        });

      const revMerged = safeRows(rows.revenueAll);
      let fixedMerged = safeRows(rows.fixedAll);
      const varMerged = safeRows(rows.variableAll);
      let fixedMonth = safeRows(rows.fixed);

      // Nowy miesiąc bez kosztów stałych → skopiuj z poprzedniego i zapytaj o edycję.
      const prevYm = previousYearMonth(month);
      if (
        prevYm &&
        fixedMonth.length === 0 &&
        !fixedRolloverBusyRef.current &&
        fixedRolloverAskedYmRef.current !== month &&
        accountKey &&
        accountKey !== 'default'
      ) {
        fixedRolloverBusyRef.current = true;
        try {
          const copied = await financeService.copyFixedCostsFromPreviousMonth(
            accountKey,
            month,
            prevYm,
          );
          if (copied.length > 0) {
            fixedMonth = copied;
            fixedMerged = [...copied, ...fixedMerged.filter((c) => c.year_month !== month)];
            fixedRolloverAskedYmRef.current = month;
            const first = copied[0];
            premiumAlert(
              'Koszty stałe',
              `Przepisano ${copied.length} kosztów stałych z ${yearMonthLabelPl(prevYm)}. Chcesz coś edytować?`,
              [
                { text: 'Nie', style: 'cancel' },
                {
                  text: 'Tak',
                  style: 'primary',
                  onPress: () => {
                    setView('panel');
                    setEditCost({
                      id: first.id,
                      name: first.name,
                      amount_pln: Number(first.amount_pln),
                      year_month: first.year_month || month,
                      kind: 'fixed',
                    });
                  },
                },
              ],
            );
          }
        } catch (e) {
          if (__DEV__) console.warn('[Finanse] fixed rollover', e);
        } finally {
          fixedRolloverBusyRef.current = false;
        }
      }

      setRevenueEntries(safeRows(rows.revenue));
      setRevenueJournal(revMerged.length ? revMerged : safeRows(rows.revenue));
      setFixedCosts(fixedMonth);
      setFixedCostsJournal(fixedMerged.length ? fixedMerged : fixedMonth);
      const varMonth = safeRows(rows.variableMonth);
      setVariableEntries(varMonth);
      setVariableCostsJournal(varMerged.length ? varMerged : varMonth);
      hasFinanceDataRef.current = true;

      const revH = rows.revenueHist;
      const varH = rows.variableHist;

      const toMonths = (list: { year_month: string | null }[]): string[] =>
        list.map((r) => r.year_month).filter((m): m is string => !!m);

      const allMonths = new Set<string>([
        ...toMonths(revMerged),
        ...toMonths(varMerged),
        ...toMonths(fixedMerged),
        ...toMonths(revH),
        ...toMonths(varH),
        month,
      ]);
      const sortedMonths = Array.from(allMonths).filter((m) => /^\d{4}-\d{2}$/.test(m)).sort();
      setChartRecords(
        sortedMonths.map((ym) => ({
          id: ym,
          year_month: ym,
          revenue_pln: revMerged
            .filter((r) => r.year_month === ym)
            .reduce((s, r) => s + Number(r.amount_pln), 0)
            || revH.filter((r) => r.year_month === ym).reduce((s, r) => s + Number(r.amount_pln), 0),
          variable_costs_pln: varMerged
            .filter((r) => r.year_month === ym)
            .reduce((s, r) => s + Number(r.amount_pln), 0)
            || varH.filter((r) => r.year_month === ym).reduce((s, r) => s + Number(r.amount_pln), 0),
          fixed_costs_pln: fixedMerged
            .filter((r) => r.year_month === ym)
            .reduce((s, r) => s + Number(r.amount_pln), 0),
          created_at: `${ym}-01T12:00:00`,
        }))
      );

      if (rows.inventory) {
        const invRows = rows.inventory.map((i) => {
          const quantity = Number(i.quantity) || 0;
          const minQuantity = Number(i.min_quantity) || 0;
          const optimal = Number(i.optimal_quantity) || 0;
          const isCombo = Boolean(i.is_combo_polprodukt);
          // Jak w magazynie: krytyczny = qty ≤ min; niski = poniżej optymalnego (jeśli ustawiony).
          const isCritical = minQuantity > 0 && quantity <= minQuantity;
          const isLow = !isCritical && optimal > 0 && quantity < optimal;
          return {
            id: String(i.id),
            name: String(i.name || 'Składnik'),
            quantity,
            minQuantity,
            optimal,
            isCombo,
            isCritical,
            isLow,
            unit: String(i.unit || 'szt'),
          };
        });
        setInventorySnapshot(invRows);
        const needing = invRows.filter((i) => i.isCritical || i.isLow);
        setCriticalCount(needing.length);
        setCriticalItems(needing);
      }
      setError(null);
      setFinanceSyncHint(false);
      return { variableCount: varMonth.length };
    } catch (e: any) {
      if (__DEV__) console.warn('[Finanse] fetchData', e?.message ?? e);
      setFinanceSyncHint(true);
      if (!hasFinanceDataRef.current) {
        setError(e?.message ?? 'Nieznany błąd');
      } else {
        premiumAlert(
          'Odświeżanie…',
          'Koszty z faktury pojawią się za chwilę. Przeciągnij listę w dół, jeśli jeszcze ich nie widać.',
          [{ text: 'OK', style: 'primary' }],
        );
      }
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [premiumAlert, accountKey]);

  useEffect(() => {
    // Multi-tenant: nie ładuj współdzielonego „default"; odśwież po zmianie konta.
    if (!accountKey || accountKey === 'default') return;
    void fetchData();
  }, [fetchData, accountKey]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(FINANCE_CHANGED, () => {
      void fetchData();
    });
    return () => sub.remove();
  }, [fetchData]);

  // Po powrocie na Finanse — zawsze dograj świeże dane (koszty z dostaw / skanów).
  useFocusEffect(
    useCallback(() => {
      if (!accountKey || accountKey === 'default') return;
      void fetchData();
    }, [accountKey, fetchData]),
  );

  // Po skanie FAKTURY — auto-odśwież koszty zmienne z retry.
  // Skan menu / oferty / sprzedaży: osobna ścieżka (bez alertu „Koszty z faktury”).
  useEffect(() => {
    if (documentScanRevision <= 0) return;
    if (lastDocumentScanKind === 'menu' || lastDocumentScanKind === 'offer') return;
    if (lastDocumentScanKind === 'sales') {
      void fetchData();
      return;
    }
    let cancelled = false;
    varCountBeforeScanRef.current = variableEntries.length;
    scanRetryRef.current = 0;
    setFinanceSyncHint(true);

    const run = async () => {
      setRefreshing(true);
      const result = await fetchData();
      if (cancelled) return;
      if ((result?.variableCount ?? 0) > varCountBeforeScanRef.current) {
        setFinanceSyncHint(false);
        return;
      }
      if (scanRetryRef.current >= 3) {
        premiumAlert(
          'Koszty z faktury',
          'Zapis może być jeszcze synchronizowany. Odśwież listę za chwilę (przeciągnij w dół) — pozycja powinna się pojawić.',
          [{ text: 'OK', style: 'primary' }],
        );
        return;
      }
      scanRetryRef.current += 1;
      setTimeout(() => {
        if (!cancelled) void run();
      }, 1800);
    };
    void run();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentScanRevision, lastDocumentScanKind]);

  function toggleNote(id: string, currentNote: string | null | undefined) {
    if (expandedNoteId === id) {
      setExpandedNoteId(null);
    } else {
      setExpandedNoteId(id);
      setNoteText(currentNote ?? '');
    }
  }

  function openEditCost(id: string, kind: EditableCostKind) {
    const pool =
      kind === 'fixed'
        ? (fixedCostsJournal.length ? fixedCostsJournal : fixedCosts)
        : (variableCostsJournal.length ? variableCostsJournal : variableEntries);
    const row = pool.find((c) => c.id === id);
    if (!row) return;
    setEditCost({
      id: row.id,
      name: row.name,
      amount_pln: Number(row.amount_pln),
      year_month: row.year_month || currentYearMonth(),
      kind,
    });
  }

  async function saveNote(id: string, table: 'fixed' | 'variable' | 'revenue') {
    setNoteSaving(true);
    try {
      const tableName = table === 'fixed' ? 'fixed_costs' : table === 'variable' ? 'variable_cost_entries' : 'revenue_entries';
      await financeService.updateNote(tableName, id, noteText.trim() || null);
      const saved = noteText.trim() || null;
      if (table === 'fixed') {
        setFixedCosts((prev) => prev.map((c) => (c.id === id ? { ...c, note: saved } : c)));
        setFixedCostsJournal((prev) => prev.map((c) => (c.id === id ? { ...c, note: saved } : c)));
      } else if (table === 'variable') {
        setVariableEntries((prev) => prev.map((e) => (e.id === id ? { ...e, note: saved } : e)));
        setVariableCostsJournal((prev) => prev.map((e) => (e.id === id ? { ...e, note: saved } : e)));
      } else {
        setRevenueEntries((prev) => prev.map((e) => (e.id === id ? { ...e, note: saved } : e)));
      }
      setRevenueJournal((prev) => prev.map((e) => (e.id === id ? { ...e, note: saved } : e)));
      setExpandedNoteId(null);
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie udało się zapisać notatki.');
    } finally {
      setNoteSaving(false);
    }
  }

  function handleDelete(id: string, table: 'fixed' | 'variable' | 'revenue') {
    premiumAlert('Usuń pozycję', 'Czy na pewno chcesz usunąć tę pozycję?', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: async () => {
          const tableName = table === 'fixed' ? 'fixed_costs' : table === 'variable' ? 'variable_cost_entries' : 'revenue_entries';
          try {
            await financeService.deleteCost(tableName, id);
          } catch (e) {
            premiumAlert('Błąd', e instanceof Error ? e.message : 'Nie udało się usunąć.');
            return;
          }
          if (table === 'fixed') {
            setFixedCosts((prev) => prev.filter((c) => c.id !== id));
            setFixedCostsJournal((prev) => prev.filter((c) => c.id !== id));
          } else if (table === 'variable') {
            setVariableEntries((prev) => prev.filter((e) => e.id !== id));
            setVariableCostsJournal((prev) => prev.filter((e) => e.id !== id));
          } else {
            setRevenueEntries((prev) => prev.filter((e) => e.id !== id));
            setRevenueJournal((prev) => prev.filter((e) => e.id !== id));
          }
          if (expandedNoteId === id) setExpandedNoteId(null);
        },
      },
    ]);
  }

  if (loading) return <LoadingScreen />;
  // Tylko przy pierwszym nieudanym loadzie — nie wywalaj UI przy odświeżeniu (wygląda jak crash).
  if (error && !hasFinanceDataRef.current) return <ErrorScreen message={error} />;

  const financeModals = (
    <>
      <AddRevenueModal visible={showAddRevenue} onClose={() => setShowAddRevenue(false)} onSaved={fetchData} />
      <AddFixedCostModal visible={showAddFixed} onClose={() => setShowAddFixed(false)} onSaved={fetchData} />
      <AddVariableCostModal
        visible={showAddVariable}
        onClose={() => setShowAddVariable(false)}
        onSaved={fetchData}
      />
      <EditCostModal
        visible={!!editCost}
        cost={editCost}
        onClose={() => setEditCost(null)}
        onSaved={fetchData}
      />
      <CreditsUsageHistoryModal visible={showUsageHistory} onClose={() => setShowUsageHistory(false)} />
    </>
  );

  if (isPremiumUi) {
    return (
      <>
        <PremiumFinanceScreen
          currentMonth={currentYearMonth()}
          revenueEntries={revenueEntries}
          revenueJournal={revenueJournal}
          fixedCosts={fixedCosts}
          fixedCostsJournal={fixedCostsJournal}
          variableEntries={variableEntries}
          variableCostsJournal={variableCostsJournal}
          chartRecords={chartRecords}
          criticalCount={criticalCount}
          criticalItems={criticalItems}
          refreshing={refreshing}
          syncHint={financeSyncHint}
          onRefresh={() => {
            setRefreshing(true);
            void fetchData();
          }}
          onOpenMagazyn={() => router.push('/(tabs)/magazyn')}
          onOpenCriticalCascade={() =>
            openProductCascade({
              title: 'Alerty niskiego stanu',
              subtitle: `${criticalItems.length} produktów wymaga uzupełnienia`,
              mode: 'critical',
              items: criticalItems,
            })
          }
          onOpenCriticalProduct={(id, name) =>
            router.push({
              pathname: '/(tabs)/magazyn',
              params: { focusProductId: id, focusProductName: name },
            })
          }
          onAddRevenue={() => setShowAddRevenue(true)}
          onAddFixed={() => setShowAddFixed(true)}
          onAddVariable={() => setShowAddVariable(true)}
          onEditCost={openEditCost}
          onDelete={handleDelete}
          expandedNoteId={expandedNoteId}
          noteText={noteText}
          noteSaving={noteSaving}
          onToggleNote={toggleNote}
          onNoteChange={setNoteText}
          onSaveNote={saveNote}
          onOpenUsageHistory={() => setShowUsageHistory(true)}
          onFetchApplied={fetchData}
        />
        {financeModals}
      </>
    );
  }

  return (
    <>
      <ClassicFinanceScreen
        view={view}
        onViewChange={setView}
        refreshing={refreshing}
        onRefresh={() => {
          setRefreshing(true);
          fetchData();
        }}
        onFetchApplied={fetchData}
        criticalCount={criticalCount}
        revenueEntries={revenueEntries}
        revenueJournal={revenueJournal}
        fixedCosts={fixedCosts}
        variableEntries={variableEntries}
        chartRecords={chartRecords}
        expandedNoteId={expandedNoteId}
        noteText={noteText}
        noteSaving={noteSaving}
        onToggleNote={toggleNote}
        onNoteChange={setNoteText}
        onSaveNote={saveNote}
        onAddRevenue={() => setShowAddRevenue(true)}
        onAddFixed={() => setShowAddFixed(true)}
        onAddVariable={() => setShowAddVariable(true)}
        onEditCost={openEditCost}
        onDelete={handleDelete}
        onOpenUsageHistory={() => setShowUsageHistory(true)}
        pdfOpen={pdfOpen}
        onPdfOpen={() => setPdfOpen(true)}
        onPdfClose={() => setPdfOpen(false)}
        invoicePreview={invoicePreview}
        onInvoicePreview={setInvoicePreview}
      />
      {financeModals}
    </>
  );
}
