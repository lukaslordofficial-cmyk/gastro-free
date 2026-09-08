import React from 'react';
import {
  View,
  Text,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Plus, Trash2, Pencil, MessageSquare, FileDown } from 'lucide-react-native';
import type { FixedCost, RevenueEntry, VariableCostEntry } from '@/lib/types';
import { KPICard } from '@/components/KPICard';
import { AlertBanner } from '@/components/AlertBanner';
import { RevenueChart } from '@/components/RevenueChart';
import { Colors } from '@/constants/colors';
import { FinanceHeaderActions } from '@/components/FinanceHeaderActions';
import { ReportsArchive } from '@/components/ReportsArchive';
import { CreditsWalletCard } from '@/components/CreditsWalletCard';
import { RewardedAdsSection } from '@/components/ads/RewardedAdsSection';
import { AdBannerFooter } from '@/components/ads/AdBannerFooter';
import { useAppTheme } from '@/hooks/useAppTheme';
import { AppScreenHeader } from '@/components/premium/AppScreenHeader';
import { ExpandableDateJournal } from '@/components/ExpandableDateJournal';
import { FinancePdfExportModal } from '@/components/FinancePdfExportModal';
import {
  humanizeInvoiceNotePreview,
  parseInvoiceCostNote,
} from '@/lib/invoiceCostNote';
import { InvoiceCostPreviewModal } from '@/components/InvoiceCostPreviewModal';
import { currentYearMonth } from '@/components/finanse/constants';
import {
  formatPLN,
  getFixedColor,
  getFixedIcon,
  getVarColor,
  getVarIcon,
} from '@/components/finanse/helpers';
import type { EditableCostKind, InvoicePreviewState } from '@/components/finanse/types';
import { styles } from '@/components/finanse/finanseScreenStyles';

type ChartRecord = {
  id: string;
  year_month: string;
  revenue_pln: number;
  variable_costs_pln: number;
  fixed_costs_pln?: number;
  created_at: string;
};

type FinanceView = 'panel' | 'raporty' | 'reklamy';

type Props = {
  view: FinanceView;
  onViewChange: (view: FinanceView) => void;
  refreshing: boolean;
  onRefresh: () => void;
  onFetchApplied: () => void;
  criticalCount: number;
  revenueEntries: RevenueEntry[];
  revenueJournal: RevenueEntry[];
  fixedCosts: FixedCost[];
  variableEntries: VariableCostEntry[];
  chartRecords: ChartRecord[];
  expandedNoteId: string | null;
  noteText: string;
  noteSaving: boolean;
  onToggleNote: (id: string, note?: string | null) => void;
  onNoteChange: (t: string) => void;
  onSaveNote: (id: string, table: 'fixed' | 'variable' | 'revenue') => void;
  onAddRevenue: () => void;
  onAddFixed: () => void;
  onAddVariable: () => void;
  onEditCost: (id: string, kind: EditableCostKind) => void;
  onDelete: (id: string, table: 'fixed' | 'variable' | 'revenue') => void;
  onOpenUsageHistory: () => void;
  pdfOpen: boolean;
  onPdfOpen: () => void;
  onPdfClose: () => void;
  invoicePreview: InvoicePreviewState | null;
  onInvoicePreview: (preview: InvoicePreviewState | null) => void;
};

export function ClassicFinanceScreen({
  view,
  onViewChange,
  refreshing,
  onRefresh,
  onFetchApplied,
  criticalCount,
  revenueEntries,
  revenueJournal,
  fixedCosts,
  variableEntries,
  chartRecords,
  expandedNoteId,
  noteText,
  noteSaving,
  onToggleNote,
  onNoteChange,
  onSaveNote,
  onAddRevenue,
  onAddFixed,
  onAddVariable,
  onEditCost,
  onDelete,
  onOpenUsageHistory,
  pdfOpen,
  onPdfOpen,
  onPdfClose,
  invoicePreview,
  onInvoicePreview,
}: Props) {
  const router = useRouter();
  const theme = useAppTheme();

  const totalRevenue = revenueEntries.reduce((s, e) => s + Number(e.amount_pln || 0), 0);
  const totalFixed = fixedCosts.reduce((s, c) => s + Number(c.amount_pln || 0), 0);
  const totalVariable = variableEntries.reduce((s, e) => s + Number(e.amount_pln || 0), 0);
  const totalCosts = totalFixed + totalVariable;
  const netProfit = totalRevenue - totalCosts;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {!theme.isPremium ? (
          <View style={{ marginTop: 8, marginBottom: 16, alignItems: 'center' }}>
            <AppScreenHeader
              title="Gastro Manager"
              subtitle={`Wyniki · ${currentYearMonth()}`}
              showDevToggle
              centered
            />
            <View style={{ marginTop: 12, alignItems: 'center', alignSelf: 'stretch' }}>
              <FinanceHeaderActions onApplied={onFetchApplied} centered />
            </View>
          </View>
        ) : (
          <>
            <AppScreenHeader
              title="Gastro Manager"
              subtitle={`Wyniki · ${currentYearMonth()}`}
              showDevToggle
            />
            <View style={{ marginTop: 4, marginBottom: 16 }}>
              <FinanceHeaderActions onApplied={onFetchApplied} />
            </View>
          </>
        )}

        <View style={[styles.segment, { backgroundColor: theme.segmentBg }]} testID="finance-segment">
          {(
            [
              ['panel', 'Panel'],
              ['raporty', 'Raporty'],
              ['reklamy', 'Reklamy'],
            ] as const
          ).map(([key, label]) => (
            <TouchableOpacity
              key={key}
              style={[
                styles.segmentBtn,
                view === key && [styles.segmentBtnActive, { backgroundColor: theme.segmentActive }],
              ]}
              onPress={() => onViewChange(key)}
              testID={`segment-${key}`}
              activeOpacity={0.85}
            >
              <Text
                style={[
                  styles.segmentText,
                  { color: theme.textMuted },
                  view === key && { color: theme.text },
                ]}
              >
                {label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {view === 'raporty' && (
          <>
            <TouchableOpacity
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                backgroundColor: theme.card,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: theme.border,
                padding: 14,
                marginBottom: 12,
              }}
              onPress={onPdfOpen}
              activeOpacity={0.85}
              testID="finance-pdf-export-open-free"
            >
              <FileDown size={18} color={Colors.accent} strokeWidth={2.4} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.text, fontWeight: '700', fontSize: 14 }}>
                  Pobierz raport (PDF / Excel)
                </Text>
                <Text style={{ color: theme.textMuted, fontSize: 12, marginTop: 2 }}>
                  Zbiorczy, zyski lub dostawy Â· zakres dat
                </Text>
              </View>
            </TouchableOpacity>
            <ReportsArchive onClosedDay={onFetchApplied} />
          </>
        )}

        {view === 'reklamy' && (
          <>
            <CreditsWalletCard onPress={onOpenUsageHistory} testID="reklamy-wallet-widget" />
            <RewardedAdsSection testID="panel-rewarded-credits" />
          </>
        )}

        {view === 'panel' && (
          <>
            <CreditsWalletCard onPress={onOpenUsageHistory} testID="panel-wallet-widget" />
            <AlertBanner count={criticalCount} onPress={() => router.push('/(tabs)/magazyn')} />

            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              Wyniki bieĹĽÄ…cego miesiÄ…ca
            </Text>
            <View style={styles.kpiRow}>
              <KPICard
                label="PrzychĂłd"
                value={formatPLN(totalRevenue)}
                subLabel="Ten miesiÄ…c"
                variant="accent"
                wide
                onAdd={onAddRevenue}
              />
              <KPICard
                label="Koszty Ĺ‚Ä…cznie"
                value={formatPLN(totalCosts)}
                subLabel="StaĹ‚e + zmienne"
                variant={totalCosts > totalRevenue && totalRevenue > 0 ? 'danger' : 'default'}
                wide
                onAdd={onAddFixed}
              />
            </View>
            <View style={styles.kpiRowSingle}>
              <KPICard
                label="Zysk netto"
                value={(netProfit >= 0 ? '+' : '') + formatPLN(netProfit)}
                subLabel={
                  netProfit >= 0 ? 'RentownoĹ›Ä‡ pozytywna' : 'Wynik ujemny â€” wymaga reakcji'
                }
                variant={netProfit >= 0 ? 'success' : 'danger'}
                wide
              />
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                Dziennik przychodĂłw
              </Text>
            </View>
            <View
              style={[
                styles.card,
                theme.isPremium && {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  borderWidth: 1,
                },
              ]}
            >
              <ExpandableDateJournal
                items={revenueJournal.map((e) => ({
                  id: e.id,
                  created_at: e.created_at,
                  title: e.description || 'PrzychĂłd',
                  amount: Number(e.amount_pln),
                  meta: (e as any).note ?? undefined,
                }))}
                emptyText="Brak przychodĂłw â€” kliknij + na kafelku PrzychĂłd"
                formatAmount={formatPLN}
                amountPositive
                renderActions={(item) => (
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TouchableOpacity
                      onPress={() => {
                        const entry = revenueJournal.find((r) => r.id === item.id);
                        onToggleNote(item.id, (entry as any)?.note);
                      }}
                      style={styles.rowIconBtn}
                    >
                      <MessageSquare
                        size={13}
                        color={expandedNoteId === item.id ? theme.accent : theme.textMuted}
                        strokeWidth={2}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => onDelete(item.id, 'revenue')}
                      style={styles.rowIconBtn}
                    >
                      <Trash2 size={13} color={theme.danger} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                )}
              />
              {expandedNoteId && revenueJournal.some((r) => r.id === expandedNoteId) ? (
                <View style={styles.noteExpanded}>
                  <TextInput
                    style={[
                      styles.noteInput,
                      theme.isPremium && {
                        backgroundColor: '#0F0F0F',
                        color: theme.text,
                        borderColor: theme.border,
                      },
                    ]}
                    value={noteText}
                    onChangeText={onNoteChange}
                    placeholder="Dodaj notatkÄ™..."
                    placeholderTextColor={theme.textMuted}
                    multiline
                    numberOfLines={2}
                  />
                  <TouchableOpacity
                    style={[styles.noteSaveBtn, theme.isPremium && { backgroundColor: theme.accent }]}
                    onPress={() => onSaveNote(expandedNoteId, 'revenue')}
                    disabled={noteSaving}
                  >
                    {noteSaving ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Text style={styles.noteSaveBtnText}>Zapisz</Text>
                    )}
                  </TouchableOpacity>
                </View>
              ) : null}
              {revenueEntries.length > 0 && (
                <View style={[styles.costTotalRow, theme.isPremium && { borderTopColor: theme.border }]}>
                  <Text style={[styles.costTotalLabel, { color: theme.textSecondary }]}>
                    Suma przychodĂłw (ten miesiÄ…c)
                  </Text>
                  <Text style={[styles.costTotalValue, { color: theme.accent }]}>
                    {formatPLN(totalRevenue)}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                {'Koszty stałe — ' + currentYearMonth()}
              </Text>
              <TouchableOpacity
                style={[
                  styles.sectionAddBtn,
                  theme.isPremium && { backgroundColor: theme.accentSoft, borderColor: theme.border },
                ]}
                onPress={onAddFixed}
                activeOpacity={0.75}
              >
                <Plus size={15} color={theme.accent} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
            <View
              style={[
                styles.card,
                theme.isPremium && {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  borderWidth: 1,
                },
              ]}
            >
              {fixedCosts.length === 0 ? (
                <View style={styles.emptyRow}>
                  <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                    Brak kosztĂłw staĹ‚ych â€” kliknij + aby dodaÄ‡
                  </Text>
                </View>
              ) : (
                fixedCosts.map((cost, idx) => {
                  const isLast = idx === fixedCosts.length - 1;
                  const isExpanded = expandedNoteId === cost.id;
                  return (
                    <View key={cost.id}>
                      <View style={[styles.costRow, isLast && !isExpanded && styles.costRowLast]}>
                        <View style={[styles.costIcon, { backgroundColor: getFixedColor(cost.type) }]}>
                          {getFixedIcon(cost.type)}
                        </View>
                        <View style={styles.costNameCol}>
                          <Text style={[styles.costName, { color: theme.text }]}>{cost.name}</Text>
                          {(cost as any).note && !isExpanded ? (
                            <Text style={styles.notePreview} numberOfLines={1}>
                              {(cost as any).note}
                            </Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          onPress={() => onToggleNote(cost.id, (cost as any).note)}
                          style={styles.rowIconBtn}
                        >
                          <MessageSquare
                            size={13}
                            color={
                              isExpanded
                                ? theme.accent
                                : (cost as any).note
                                  ? theme.accent
                                  : theme.textMuted
                            }
                            strokeWidth={2}
                          />
                        </TouchableOpacity>
                        <Text style={[styles.costAmount, { color: theme.text }]}>
                          {formatPLN(Number(cost.amount_pln))}
                        </Text>
                        <TouchableOpacity
                          onPress={() => onEditCost(cost.id, 'fixed')}
                          style={styles.rowIconBtn}
                        >
                          <Pencil size={13} color={theme.textMuted} strokeWidth={2} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => onDelete(cost.id, 'fixed')}
                          style={styles.rowIconBtn}
                        >
                          <Trash2 size={13} color={theme.danger} strokeWidth={2} />
                        </TouchableOpacity>
                      </View>
                      {isExpanded && (
                        <View style={[styles.noteExpanded, isLast && styles.noteExpandedLast]}>
                          <TextInput
                            style={styles.noteInput}
                            value={noteText}
                            onChangeText={onNoteChange}
                            placeholder="Dodaj notatkÄ™..."
                            placeholderTextColor={theme.textMuted}
                            multiline
                            numberOfLines={2}
                            autoFocus
                          />
                          <TouchableOpacity
                            style={styles.noteSaveBtn}
                            onPress={() => onSaveNote(cost.id, 'fixed')}
                            disabled={noteSaving}
                          >
                            {noteSaving ? (
                              <ActivityIndicator size="small" color={Colors.white} />
                            ) : (
                              <Text style={styles.noteSaveBtnText}>Zapisz</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
              <View style={styles.costTotalRow}>
                <Text style={[styles.costTotalLabel, { color: theme.textSecondary }]}>Suma kosztĂłw</Text>
                <Text style={[styles.costTotalValue, { color: theme.text }]}>{formatPLN(totalFixed)}</Text>
              </View>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                {'Koszty zmienne — ' + currentYearMonth()}
              </Text>
              <TouchableOpacity
                style={[styles.sectionAddBtn, { backgroundColor: Colors.dangerLight, borderColor: '#FECACA' }]}
                onPress={onAddVariable}
                activeOpacity={0.75}
              >
                <Plus size={15} color={theme.danger} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
            <View
              style={[
                styles.card,
                theme.isPremium && {
                  backgroundColor: theme.card,
                  borderColor: theme.border,
                  borderWidth: 1,
                },
              ]}
            >
              {variableEntries.length === 0 ? (
                <View style={styles.emptyRow}>
                  <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                    Brak kosztĂłw zmiennych â€” kliknij + aby dodaÄ‡
                  </Text>
                </View>
              ) : (
                variableEntries.map((entry, idx) => {
                  const isLast = idx === variableEntries.length - 1;
                  const isExpanded = expandedNoteId === entry.id;
                  return (
                    <View key={entry.id}>
                      <View style={[styles.costRow, isLast && !isExpanded && styles.costRowLast]}>
                        <View style={[styles.costIcon, { backgroundColor: getVarColor(entry.type) }]}>
                          {getVarIcon(entry.type)}
                        </View>
                        <View style={styles.costNameCol}>
                          <TouchableOpacity
                            activeOpacity={0.75}
                            onPress={() => {
                              const note = (entry as any).note as string | undefined;
                              const invoice = parseInvoiceCostNote(note);
                              if (invoice?.lines?.length) {
                                onInvoicePreview({
                                  title: entry.name,
                                  amount: Number(entry.amount_pln) || 0,
                                  note,
                                });
                              } else {
                                onToggleNote(entry.id, note);
                              }
                            }}
                          >
                            <Text style={[styles.costName, { color: theme.text }]}>{entry.name}</Text>
                            {!isExpanded ? (
                              <Text style={styles.notePreview} numberOfLines={1}>
                                {humanizeInvoiceNotePreview((entry as any).note)
                                  ?? ((entry as any).note ? String((entry as any).note) : 'Dotknij â†’ szczegĂłĹ‚y / notatka')}
                              </Text>
                            ) : null}
                          </TouchableOpacity>
                        </View>
                        <TouchableOpacity
                          onPress={() => onToggleNote(entry.id, (entry as any).note)}
                          style={styles.rowIconBtn}
                        >
                          <MessageSquare
                            size={13}
                            color={
                              isExpanded
                                ? theme.accent
                                : (entry as any).note
                                  ? theme.accent
                                  : theme.textMuted
                            }
                            strokeWidth={2}
                          />
                        </TouchableOpacity>
                        <Text style={[styles.costAmount, { color: theme.text }]}>
                          {formatPLN(Number(entry.amount_pln))}
                        </Text>
                        <TouchableOpacity
                          onPress={() => onEditCost(entry.id, 'variable')}
                          style={styles.rowIconBtn}
                        >
                          <Pencil size={13} color={theme.textMuted} strokeWidth={2} />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => onDelete(entry.id, 'variable')}
                          style={styles.rowIconBtn}
                        >
                          <Trash2 size={13} color={theme.danger} strokeWidth={2} />
                        </TouchableOpacity>
                      </View>
                      {isExpanded && (
                        <View style={[styles.noteExpanded, isLast && styles.noteExpandedLast]}>
                          {(() => {
                            const invoice = parseInvoiceCostNote((entry as any).note);
                            if (!invoice?.lines?.length) return null;
                            return (
                              <TouchableOpacity
                                onPress={() =>
                                  onInvoicePreview({
                                    title: entry.name,
                                    amount: Number(entry.amount_pln) || 0,
                                    note: (entry as any).note,
                                  })
                                }
                                style={{ marginBottom: 10 }}
                              >
                                <Text style={[styles.costName, { color: theme.accent }]}>
                                  OtwĂłrz podglÄ…d pozycji ({invoice.lines.length})
                                </Text>
                              </TouchableOpacity>
                            );
                          })()}
                          <TextInput
                            style={styles.noteInput}
                            value={noteText}
                            onChangeText={onNoteChange}
                            placeholder="Dodaj notatkÄ™..."
                            placeholderTextColor={theme.textMuted}
                            multiline
                            numberOfLines={2}
                            autoFocus
                          />
                          <TouchableOpacity
                            style={styles.noteSaveBtn}
                            onPress={() => onSaveNote(entry.id, 'variable')}
                            disabled={noteSaving}
                          >
                            {noteSaving ? (
                              <ActivityIndicator size="small" color={Colors.white} />
                            ) : (
                              <Text style={styles.noteSaveBtnText}>Zapisz</Text>
                            )}
                          </TouchableOpacity>
                        </View>
                      )}
                    </View>
                  );
                })
              )}
              <View style={styles.costTotalRow}>
                <Text style={[styles.costTotalLabel, { color: theme.textSecondary }]}>Suma kosztĂłw</Text>
                <Text style={[styles.costTotalValue, { color: theme.text }]}>
                  {formatPLN(totalVariable)}
                </Text>
              </View>
            </View>

            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              Analityka przychodĂłw
            </Text>
            {(!revenueJournal.length && chartRecords.length === 0) ? (
              <View
                style={[
                  styles.card,
                  { padding: 16 },
                  theme.isPremium && { backgroundColor: theme.card, borderColor: theme.border, borderWidth: 1 },
                ]}
              >
                <Text style={[styles.emptyText, { color: theme.textMuted }]}>
                  Brak danych â€” dodaj przychody, aby zobaczyÄ‡ wykres trendu
                </Text>
              </View>
            ) : (
              <RevenueChart journal={revenueJournal} records={chartRecords} days={14} />
            )}
          </>
        )}

        <View style={{ height: 16 }} />
        <AdBannerFooter />
      </ScrollView>

      <FinancePdfExportModal
        visible={pdfOpen}
        onClose={onPdfClose}
        defaultMonth={currentYearMonth()}
      />
      <InvoiceCostPreviewModal
        visible={!!invoicePreview}
        onClose={() => onInvoicePreview(null)}
        title={invoicePreview?.title || 'PodglÄ…d faktury'}
        amountPln={invoicePreview?.amount}
        note={invoicePreview?.note}
      />
    </SafeAreaView>
  );
}
