import React from 'react';
import { View, TextInput, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Plus, Trash2, Pencil, MessageSquare } from 'lucide-react-native';
import { PremiumColors } from '@/constants/premiumTheme';
import { ExpandableDateJournal } from '@/components/ExpandableDateJournal';
import type { FixedCost, RevenueEntry, VariableCostEntry } from '@/lib/types';
import { formatInvoiceLineLabel, parseInvoiceCostNote } from '@/lib/invoiceCostNote';
import { PremiumFinanceCollapsibleTile } from './PremiumFinanceCollapsibleTile';
import { formatPLN } from './premiumFinanceHelpers';
import { premiumFinanceStyles as styles } from './premiumFinanceStyles';

type Props = {
  revenueJournal: RevenueEntry[];
  fixedCosts: FixedCost[];
  fixedCostsJournal: FixedCost[];
  variableEntries: VariableCostEntry[];
  variableCostsJournal: VariableCostEntry[];
  totalRevenue: number;
  openRevenue: boolean;
  openFixed: boolean;
  openVariable: boolean;
  setOpenRevenue: (fn: (v: boolean) => boolean) => void;
  setOpenFixed: (fn: (v: boolean) => boolean) => void;
  setOpenVariable: (fn: (v: boolean) => boolean) => void;
  expandedNoteId: string | null;
  noteText: string;
  noteSaving: boolean;
  onToggleNote: (id: string, note?: string | null) => void;
  onNoteChange: (t: string) => void;
  onSaveNote: (id: string, table: 'fixed' | 'variable' | 'revenue') => void;
  onAddRevenue: () => void;
  onAddFixed: () => void;
  onAddVariable: () => void;
  onEditCost?: (id: string, table: 'fixed' | 'variable') => void;
  onDelete: (id: string, table: 'fixed' | 'variable' | 'revenue') => void;
  revenueNoteEditor: React.ReactNode;
};

export function PremiumFinanceJournals(props: Props) {
  const {
    revenueJournal,
    fixedCosts,
    fixedCostsJournal,
    variableEntries,
    variableCostsJournal,
    totalRevenue,
    openRevenue,
    openFixed,
    openVariable,
    setOpenRevenue,
    setOpenFixed,
    setOpenVariable,
    expandedNoteId,
    onToggleNote,
    onAddRevenue,
    onAddFixed,
    onAddVariable,
    onEditCost,
    onDelete,
    revenueNoteEditor,
  } = props;

  return (
    <>
            <PremiumFinanceCollapsibleTile
              title="Dziennik przychodów"
              summary={`${revenueJournal.length} wpisów · ${formatPLN(totalRevenue)}`}
              open={openRevenue}
              onToggle={() => setOpenRevenue((v) => !v)}
              right={
                <TouchableOpacity style={styles.sectionAdd} onPress={onAddRevenue}>
                  <Plus size={14} color={PremiumColors.neon} />
                </TouchableOpacity>
              }
            >
              <ExpandableDateJournal
                items={revenueJournal.map((e) => ({
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
                        const entry = revenueJournal.find((r) => r.id === item.id);
                        onToggleNote(item.id, (entry as any)?.note);
                      }}
                      style={styles.iconBtn}
                    >
                      <MessageSquare
                        size={13}
                        color={
                          expandedNoteId === item.id
                            ? PremiumColors.neon
                            : PremiumColors.textMuted
                        }
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => onDelete(item.id, 'revenue')}
                      style={styles.iconBtn}
                    >
                      <Trash2 size={13} color={PremiumColors.alert} />
                    </TouchableOpacity>
                  </View>
                )}
              />
              {revenueNoteEditor}
            </PremiumFinanceCollapsibleTile>

            <PremiumFinanceCollapsibleTile
              title="Koszty stałe"
              summary={`${(fixedCostsJournal?.length ? fixedCostsJournal : fixedCosts).length} pozycji · ${formatPLN(
                (fixedCostsJournal?.length ? fixedCostsJournal : fixedCosts).reduce(
                  (s, c) => s + Number(c.amount_pln),
                  0,
                ),
              )}`}
              open={openFixed}
              onToggle={() => setOpenFixed((v) => !v)}
              right={
                <TouchableOpacity style={styles.sectionAdd} onPress={onAddFixed}>
                  <Plus size={14} color={PremiumColors.neon} />
                </TouchableOpacity>
              }
            >
              <ExpandableDateJournal
                items={(fixedCostsJournal?.length ? fixedCostsJournal : fixedCosts).map((c) => ({
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
                    {onEditCost ? (
                      <TouchableOpacity onPress={() => onEditCost!(item.id, 'fixed')} style={styles.iconBtn}>
                        <Pencil size={13} color={PremiumColors.textMuted} />
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity onPress={() => onDelete(item.id, 'fixed')} style={styles.iconBtn}>
                      <Trash2 size={13} color={PremiumColors.alert} />
                    </TouchableOpacity>
                  </View>
                )}
              />
            </PremiumFinanceCollapsibleTile>

            <PremiumFinanceCollapsibleTile
              title="Koszty zmienne"
              summary={`${(variableCostsJournal?.length ? variableCostsJournal : variableEntries).length} pozycji · ${formatPLN(
                (variableCostsJournal?.length ? variableCostsJournal : variableEntries).reduce(
                  (s, e) => s + Number(e.amount_pln),
                  0,
                ),
              )}`}
              open={openVariable}
              onToggle={() => setOpenVariable((v) => !v)}
              right={
                <TouchableOpacity style={styles.sectionAdd} onPress={onAddVariable}>
                  <Plus size={14} color={PremiumColors.alert} />
                </TouchableOpacity>
              }
            >
              <ExpandableDateJournal
                items={(variableCostsJournal?.length ? variableCostsJournal : variableEntries).map((e) => {
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
                    {onEditCost ? (
                      <TouchableOpacity onPress={() => onEditCost!(item.id, 'variable')} style={styles.iconBtn}>
                        <Pencil size={13} color={PremiumColors.textMuted} />
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity onPress={() => onDelete(item.id, 'variable')} style={styles.iconBtn}>
                      <Trash2 size={13} color={PremiumColors.alert} />
                    </TouchableOpacity>
                  </View>
                )}
              />
            </PremiumFinanceCollapsibleTile>
    </>
  );
}
