import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  Platform,
  Modal,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Building2,
  Zap,
  Users,
  Plus,
  X,
  Package,
  Trash2,
  MoreHorizontal,
  Check,
  MessageSquare,
  Tag,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import type { FixedCost, InventoryItem, RevenueEntry, VariableCostEntry } from '@/lib/types';
import { KPICard } from '@/components/KPICard';
import { AlertBanner } from '@/components/AlertBanner';
import { RevenueChart } from '@/components/RevenueChart';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';
import { Colors } from '@/constants/colors';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { ReportsArchive } from '@/components/ReportsArchive';
import { SubscriptionPanel } from '@/components/SubscriptionPanel';
import { CreditsWalletCard } from '@/components/CreditsWalletCard';
import { CreditsUsageHistoryModal } from '@/components/CreditsUsageHistoryModal';
import { AdBannerFooter } from '@/components/ads/AdBannerFooter';
import { useThemeMode } from '@/contexts/ThemeModeContext';
import { useAppTheme } from '@/hooks/useAppTheme';
import { AppScreenHeader } from '@/components/premium/AppScreenHeader';
import { ExpandableDateJournal } from '@/components/ExpandableDateJournal';
import { PremiumFinanceScreen } from '@/components/premium/PremiumFinanceScreen';
import { useUiOverlay } from '@/contexts/UiOverlayContext';

const _now = new Date();
const CURRENT_MONTH = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, '0')}`;

function formatPLN(value: number): string {
  return value.toLocaleString('pl-PL', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' PLN';
}

function getFixedIcon(type: string) {
  switch (type) {
    case 'rent': return <Building2 size={18} color={Colors.accent} strokeWidth={2} />;
    case 'media': return <Zap size={18} color={Colors.warning} strokeWidth={2} />;
    case 'payroll': return <Users size={18} color={Colors.success} strokeWidth={2} />;
    default: return <Tag size={18} color="#7C3AED" strokeWidth={2} />;
  }
}

function getFixedColor(type: string): string {
  switch (type) {
    case 'rent': return Colors.accentLight;
    case 'media': return Colors.warningLight;
    case 'payroll': return Colors.successLight;
    default: return '#EDE9FE';
  }
}

function getVarIcon(type: string) {
  switch (type) {
    case 'materials': return <Package size={18} color={Colors.accent} strokeWidth={2} />;
    case 'waste': return <Trash2 size={18} color={Colors.danger} strokeWidth={2} />;
    default: return <Tag size={18} color="#7C3AED" strokeWidth={2} />;
  }
}

function getVarColor(type: string): string {
  switch (type) {
    case 'materials': return Colors.accentLight;
    case 'waste': return Colors.dangerLight;
    default: return '#EDE9FE';
  }
}

// --- Add Revenue Modal ---

function AddRevenueModal({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [desc, setDesc] = useState('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    const val = parseFloat(amount.replace(',', '.'));
    if (isNaN(val) || val <= 0) { Alert.alert('Błąd', 'Podaj poprawną kwotę.'); return; }
    setSaving(true);
    try {
      const { error } = await supabase.from('revenue_entries').insert({
        year_month: CURRENT_MONTH,
        description: desc.trim() || null,
        amount_pln: val,
      });
      if (error) throw error;
      setDesc(''); setAmount('');
      onSaved(); onClose();
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie udało się zapisać.');
    } finally { setSaving(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <KeyboardAvoidingView style={ms.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={ms.sheet}>
          <View style={ms.header}>
            <Text style={ms.title}>Dodaj przychód</Text>
            <TouchableOpacity onPress={onClose}><X size={20} color={Colors.textSecondary} strokeWidth={2} /></TouchableOpacity>
          </View>
          <Text style={ms.label}>Opis (opcjonalnie)</Text>
          <TextInput style={ms.input} value={desc} onChangeText={setDesc} placeholder="np. Utarg dzienny" placeholderTextColor={Colors.textTertiary} />
          <Text style={ms.label}>Kwota (PLN) *</Text>
          <TextInput style={ms.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={Colors.textTertiary} />
          <TouchableOpacity style={[ms.saveBtn, saving && ms.saveBtnDisabled]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
            {saving ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={ms.saveBtnText}>Zapisz przychód</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- Add Fixed Cost Modal ---

const BASE_FIXED_TYPES = [
  { key: 'rent' as const, label: 'Czynsz lokalu' },
  { key: 'media' as const, label: 'Media' },
  { key: 'payroll' as const, label: 'Wynagrodzenia' },
];

function AddFixedCostModal({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [selectedKey, setSelectedKey] = useState<string>('rent');
  const selectedKeyRef = useRef('rent');
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const newCatValueRef = useRef('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  function selectKey(key: string) {
    setSelectedKey(key);
    selectedKeyRef.current = key;
    setShowNewInput(false);
  }

  function confirmNewCategory() {
    const trimmed = newCatValueRef.current.trim();
    if (!trimmed) return;
    if (!customCategories.includes(trimmed)) {
      setCustomCategories((prev) => [...prev, trimmed]);
    }
    setSelectedKey(trimmed);
    selectedKeyRef.current = trimmed;
    newCatValueRef.current = '';
    setNewCatName('');
    setShowNewInput(false);
  }

  async function handleSave() {
    const val = parseFloat(amount.replace(',', '.'));
    if (isNaN(val) || val <= 0) { Alert.alert('Błąd', 'Podaj poprawną kwotę.'); return; }

    let type: FixedCost['type'];
    let name: string;

    if (showNewInput) {
      const catName = newCatValueRef.current.trim();
      if (!catName) { Alert.alert('Błąd', 'Wpisz nazwę nowej kategorii.'); return; }
      type = 'other';
      name = catName;
    } else {
      const key = selectedKeyRef.current;
      const base = BASE_FIXED_TYPES.find((t) => t.key === key);
      type = base ? (base.key as FixedCost['type']) : 'other';
      name = base ? base.label : key;
      if (!name) { Alert.alert('Błąd', 'Wybierz lub utwórz kategorię.'); return; }
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('fixed_costs').insert({ year_month: CURRENT_MONTH, type, name, amount_pln: val });
      if (error) throw error;
      setAmount('');
      setNewCatName('');
      newCatValueRef.current = '';
      setShowNewInput(false);
      onSaved(); onClose();
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie udało się zapisać.');
    } finally { setSaving(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <KeyboardAvoidingView style={ms.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={ms.sheet}>
          <View style={ms.header}>
            <Text style={ms.title}>Dodaj koszt stały</Text>
            <TouchableOpacity onPress={onClose}><X size={20} color={Colors.textSecondary} strokeWidth={2} /></TouchableOpacity>
          </View>
          <Text style={ms.label}>Kategoria</Text>
          <View style={ms.typeRow}>
            {BASE_FIXED_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[ms.pill, selectedKey === t.key && !showNewInput && ms.pillActive]}
                onPress={() => selectKey(t.key)}
              >
                <Text style={[ms.pillText, selectedKey === t.key && !showNewInput && ms.pillTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
            {customCategories.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[ms.pill, selectedKey === cat && !showNewInput && ms.pillActive]}
                onPress={() => selectKey(cat)}
              >
                <Text style={[ms.pillText, selectedKey === cat && !showNewInput && ms.pillTextActive]}>{cat}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[ms.pill, showNewInput && ms.pillActive]} onPress={() => setShowNewInput((v) => !v)}>
              <Plus size={13} color={showNewInput ? Colors.accent : Colors.textSecondary} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
          {showNewInput && (
            <View style={ms.newCatRow}>
              <TextInput
                style={[ms.input, { flex: 1, marginBottom: 0 }]}
                value={newCatName}
                onChangeText={(text) => { setNewCatName(text); newCatValueRef.current = text; }}
                placeholder="Nazwa kategorii..."
                placeholderTextColor={Colors.textTertiary}
                autoFocus
                onSubmitEditing={confirmNewCategory}
              />
              <TouchableOpacity style={ms.newCatConfirm} onPress={confirmNewCategory}>
                <Check size={16} color={Colors.white} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          )}
          <Text style={ms.label}>Kwota (PLN) *</Text>
          <TextInput style={ms.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={Colors.textTertiary} />
          <TouchableOpacity style={[ms.saveBtn, saving && ms.saveBtnDisabled]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
            {saving ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={ms.saveBtnText}>Zapisz koszt</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- Add Variable Cost Modal ---

const BASE_VAR_TYPES = [
  { key: 'materials' as const, label: 'Surowce' },
  { key: 'waste' as const, label: 'Straty' },
];

function AddVariableCostModal({ visible, onClose, onSaved }: { visible: boolean; onClose: () => void; onSaved: () => void }) {
  const [selectedKey, setSelectedKey] = useState<string>('materials');
  const selectedKeyRef = useRef('materials');
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const newCatValueRef = useRef('');
  const [amount, setAmount] = useState('');
  const [saving, setSaving] = useState(false);

  function selectKey(key: string) {
    setSelectedKey(key);
    selectedKeyRef.current = key;
    setShowNewInput(false);
  }

  function confirmNewCategory() {
    const trimmed = newCatValueRef.current.trim();
    if (!trimmed) return;
    if (!customCategories.includes(trimmed)) {
      setCustomCategories((prev) => [...prev, trimmed]);
    }
    setSelectedKey(trimmed);
    selectedKeyRef.current = trimmed;
    newCatValueRef.current = '';
    setNewCatName('');
    setShowNewInput(false);
  }

  async function handleSave() {
    const val = parseFloat(amount.replace(',', '.'));
    if (isNaN(val) || val <= 0) { Alert.alert('Błąd', 'Podaj poprawną kwotę.'); return; }

    let type: VariableCostEntry['type'];
    let name: string;

    if (showNewInput) {
      const catName = newCatValueRef.current.trim();
      if (!catName) { Alert.alert('Błąd', 'Wpisz nazwę nowej kategorii.'); return; }
      type = 'other';
      name = catName;
    } else {
      const key = selectedKeyRef.current;
      const base = BASE_VAR_TYPES.find((t) => t.key === key);
      type = base ? (base.key as VariableCostEntry['type']) : 'other';
      name = base ? base.label : key;
    }

    setSaving(true);
    try {
      const { error } = await supabase.from('variable_cost_entries').insert({ year_month: CURRENT_MONTH, type, name, amount_pln: val });
      if (error) throw error;
      setAmount('');
      setNewCatName('');
      newCatValueRef.current = '';
      setShowNewInput(false);
      onSaved(); onClose();
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie udało się zapisać.');
    } finally { setSaving(false); }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <KeyboardAvoidingView style={ms.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={ms.sheet}>
          <View style={ms.header}>
            <Text style={ms.title}>Dodaj koszt zmienny</Text>
            <TouchableOpacity onPress={onClose}><X size={20} color={Colors.textSecondary} strokeWidth={2} /></TouchableOpacity>
          </View>
          <Text style={ms.label}>Kategoria</Text>
          <View style={ms.typeRow}>
            {BASE_VAR_TYPES.map((t) => (
              <TouchableOpacity
                key={t.key}
                style={[ms.pill, selectedKey === t.key && !showNewInput && ms.pillActive]}
                onPress={() => selectKey(t.key)}
              >
                <Text style={[ms.pillText, selectedKey === t.key && !showNewInput && ms.pillTextActive]}>{t.label}</Text>
              </TouchableOpacity>
            ))}
            {customCategories.map((cat) => (
              <TouchableOpacity
                key={cat}
                style={[ms.pill, selectedKey === cat && !showNewInput && ms.pillActive]}
                onPress={() => selectKey(cat)}
              >
                <Text style={[ms.pillText, selectedKey === cat && !showNewInput && ms.pillTextActive]}>{cat}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={[ms.pill, showNewInput && ms.pillActive]} onPress={() => setShowNewInput((v) => !v)}>
              <Plus size={13} color={showNewInput ? Colors.accent : Colors.textSecondary} strokeWidth={2.5} />
            </TouchableOpacity>
          </View>
          {showNewInput && (
            <View style={ms.newCatRow}>
              <TextInput
                style={[ms.input, { flex: 1, marginBottom: 0 }]}
                value={newCatName}
                onChangeText={(text) => { setNewCatName(text); newCatValueRef.current = text; }}
                placeholder="Nazwa kategorii..."
                placeholderTextColor={Colors.textTertiary}
                autoFocus
                onSubmitEditing={confirmNewCategory}
              />
              <TouchableOpacity style={ms.newCatConfirm} onPress={confirmNewCategory}>
                <Check size={16} color={Colors.white} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
          )}
          <Text style={ms.label}>Kwota (PLN) *</Text>
          <TextInput style={ms.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0.00" placeholderTextColor={Colors.textTertiary} />
          <TouchableOpacity style={[ms.saveBtn, saving && ms.saveBtnDisabled]} onPress={handleSave} disabled={saving} activeOpacity={0.85}>
            {saving ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={ms.saveBtnText}>Zapisz koszt</Text>}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// --- FinanseScreen ---

export default function FinanseScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [view, setView] = useState<'panel' | 'raporty' | 'subskrypcja'>('panel');
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
    { id: string; name: string; quantity: number; minQuantity: number; unit: string }[]
  >([]);
  const [inventorySnapshot, setInventorySnapshot] = useState<
    { id: string; name: string; quantity: number; minQuantity: number; unit: string }[]
  >([]);
  const { isPremiumUi } = useThemeMode();
  const { openProductCascade } = useUiOverlay();
  const theme = useAppTheme();
  const [revenueJournal, setRevenueJournal] = useState<RevenueEntry[]>([]);
  const [fixedCostsJournal, setFixedCostsJournal] = useState<FixedCost[]>([]);
  const [variableCostsJournal, setVariableCostsJournal] = useState<VariableCostEntry[]>([]);
  const [showAddRevenue, setShowAddRevenue] = useState(false);
  const [showAddFixed, setShowAddFixed] = useState(false);
  const [showAddVariable, setShowAddVariable] = useState(false);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const { getAccountKey } = await import('@/lib/accountKey');
      const ak = getAccountKey();
      const [
        revRes, fixedRes, varRes, revHistRes, varHistRes, inventoryRes,
        revAllRes, fixedAllRes, varAllRes,
      ] = await Promise.all([
        supabase.from('revenue_entries').select('*').eq('year_month', CURRENT_MONTH).order('created_at'),
        supabase.from('fixed_costs').select('*').eq('year_month', CURRENT_MONTH).order('type'),
        supabase.from('variable_cost_entries').select('*').eq('year_month', CURRENT_MONTH).order('created_at'),
        supabase.from('revenue_entries').select('year_month, amount_pln').order('year_month').limit(2000),
        supabase.from('variable_cost_entries').select('year_month, amount_pln').order('year_month').limit(2000),
        supabase.from('inventory_items').select('id, name, quantity, min_quantity, unit').eq('account_key', ak),
        supabase.from('revenue_entries').select('*').order('created_at', { ascending: false }).limit(1500),
        supabase.from('fixed_costs').select('*').order('created_at', { ascending: false }).limit(1000),
        supabase.from('variable_cost_entries').select('*').order('created_at', { ascending: false }).limit(1500),
      ]);
      if (revRes.error) throw revRes.error;
      if (fixedRes.error) throw fixedRes.error;
      if (varRes.error) throw varRes.error;

      const revMerged = (revAllRes.data ?? []) as RevenueEntry[];
      const fixedMerged = (fixedAllRes.data ?? []) as FixedCost[];
      const varMerged = (varAllRes.data ?? []) as VariableCostEntry[];

      setRevenueEntries((revRes.data ?? []) as RevenueEntry[]);
      setRevenueJournal(revMerged.length ? revMerged : ((revRes.data ?? []) as RevenueEntry[]));
      setFixedCosts((fixedRes.data ?? []) as FixedCost[]);
      setFixedCostsJournal(fixedMerged.length ? fixedMerged : ((fixedRes.data ?? []) as FixedCost[]));
      setVariableEntries((varRes.data ?? []) as VariableCostEntry[]);
      setVariableCostsJournal(varMerged.length ? varMerged : ((varRes.data ?? []) as VariableCostEntry[]));

      const revH = revHistRes.data ?? [];
      const varH = varHistRes.data ?? [];

      const allMonths = new Set<string>([
        ...revMerged.map((r) => r.year_month).filter(Boolean),
        ...varMerged.map((r) => r.year_month).filter(Boolean),
        ...fixedMerged.map((r) => r.year_month).filter(Boolean),
        ...revH.map((r) => r.year_month).filter(Boolean),
        ...varH.map((r) => r.year_month).filter(Boolean),
        CURRENT_MONTH,
      ]);
      const sortedMonths = Array.from(allMonths).sort();
      setChartRecords(
        sortedMonths.map((month) => ({
          id: month,
          year_month: month,
          revenue_pln: revMerged
            .filter((r) => r.year_month === month)
            .reduce((s, r) => s + Number(r.amount_pln), 0)
            || revH.filter((r) => r.year_month === month).reduce((s, r) => s + Number(r.amount_pln), 0),
          variable_costs_pln: varMerged
            .filter((r) => r.year_month === month)
            .reduce((s, r) => s + Number(r.amount_pln), 0)
            || varH.filter((r) => r.year_month === month).reduce((s, r) => s + Number(r.amount_pln), 0),
          fixed_costs_pln: fixedMerged
            .filter((r) => r.year_month === month)
            .reduce((s, r) => s + Number(r.amount_pln), 0),
          created_at: month,
        }))
      );

      const invRows = (inventoryRes.data ?? []).map((i: any) => ({
        id: String(i.id),
        name: String(i.name || 'Składnik'),
        quantity: Number(i.quantity) || 0,
        minQuantity: Number(i.min_quantity) || 0,
        unit: String(i.unit || 'szt'),
      }));
      setInventorySnapshot(invRows);

      const critical = invRows.filter((i) => i.quantity <= i.minQuantity);
      setCriticalCount(critical.length);
      setCriticalItems(critical);
    } catch (e: any) {
      setError(e.message ?? 'Nieznany błąd');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  function toggleNote(id: string, currentNote: string | null | undefined) {
    if (expandedNoteId === id) {
      setExpandedNoteId(null);
    } else {
      setExpandedNoteId(id);
      setNoteText(currentNote ?? '');
    }
  }

  async function saveNote(id: string, table: 'fixed' | 'variable' | 'revenue') {
    setNoteSaving(true);
    try {
      const tableName = table === 'fixed' ? 'fixed_costs' : table === 'variable' ? 'variable_cost_entries' : 'revenue_entries';
      const { error: updateErr } = await supabase.from(tableName).update({ note: noteText.trim() || null }).eq('id', id);
      if (updateErr) throw updateErr;
      const saved = noteText.trim() || null;
      if (table === 'fixed') setFixedCosts((prev) => prev.map((c) => c.id === id ? { ...c, note: saved } : c));
      else if (table === 'variable') setVariableEntries((prev) => prev.map((e) => e.id === id ? { ...e, note: saved } : e));
      else setRevenueEntries((prev) => prev.map((e) => e.id === id ? { ...e, note: saved } : e));
      setRevenueJournal((prev) => prev.map((e) => e.id === id ? { ...e, note: saved } : e));
      setExpandedNoteId(null);
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie udało się zapisać notatki.');
    } finally {
      setNoteSaving(false);
    }
  }

  function handleDelete(id: string, table: 'fixed' | 'variable' | 'revenue') {
    Alert.alert('Usuń pozycję', 'Czy na pewno chcesz usunąć tę pozycję?', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: async () => {
          const tableName = table === 'fixed' ? 'fixed_costs' : table === 'variable' ? 'variable_cost_entries' : 'revenue_entries';
          const { error: delErr } = await supabase.from(tableName).delete().eq('id', id);
          if (delErr) { Alert.alert('Błąd', delErr.message); return; }
          if (table === 'fixed') setFixedCosts((prev) => prev.filter((c) => c.id !== id));
          else if (table === 'variable') setVariableEntries((prev) => prev.filter((e) => e.id !== id));
          else {
            setRevenueEntries((prev) => prev.filter((e) => e.id !== id));
            setRevenueJournal((prev) => prev.filter((e) => e.id !== id));
          }
          if (expandedNoteId === id) setExpandedNoteId(null);
        },
      },
    ]);
  }

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;

  const totalRevenue = revenueEntries.reduce((s, e) => s + Number(e.amount_pln), 0);
  const totalFixed = fixedCosts.reduce((s, c) => s + Number(c.amount_pln), 0);
  const totalVariable = variableEntries.reduce((s, e) => s + Number(e.amount_pln), 0);
  const totalCosts = totalFixed + totalVariable;
  const netProfit = totalRevenue - totalCosts;

  if (isPremiumUi) {
    return (
      <>
        <PremiumFinanceScreen
          currentMonth={CURRENT_MONTH}
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
          onRefresh={() => {
            setRefreshing(true);
            fetchData();
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
        <AddRevenueModal visible={showAddRevenue} onClose={() => setShowAddRevenue(false)} onSaved={fetchData} />
        <AddFixedCostModal visible={showAddFixed} onClose={() => setShowAddFixed(false)} onSaved={fetchData} />
        <AddVariableCostModal
          visible={showAddVariable}
          onClose={() => setShowAddVariable(false)}
          onSaved={fetchData}
        />
        <CreditsUsageHistoryModal visible={showUsageHistory} onClose={() => setShowUsageHistory(false)} />
      </>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              fetchData();
            }}
            tintColor={theme.accent}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {!theme.isPremium ? (
          <View style={{ marginTop: 8, marginBottom: 16, alignItems: 'center' }}>
            <AppScreenHeader
              title="Gastro Manager"
              subtitle={`Panel finansowy · ${CURRENT_MONTH}`}
              showDevToggle
              centered
            />
            <View style={{ marginTop: 12, alignItems: 'center', alignSelf: 'stretch' }}>
              <ReportInfoButton
                contextHint="Finanse"
                onApplied={fetchData}
                centered
                testID="finanse-report-info"
              />
            </View>
          </View>
        ) : (
          <>
            <AppScreenHeader
              title="Gastro Manager"
              subtitle={`Panel finansowy · ${CURRENT_MONTH}`}
              showDevToggle
            />
            <View style={{ marginTop: 4, marginBottom: 16 }}>
              <ReportInfoButton contextHint="Finanse" onApplied={fetchData} testID="finanse-report-info" />
            </View>
          </>
        )}

        <View style={[styles.segment, { backgroundColor: theme.segmentBg }]} testID="finance-segment">
          <TouchableOpacity
            style={[
              styles.segmentBtn,
              view === 'panel' && [styles.segmentBtnActive, { backgroundColor: theme.segmentActive }],
            ]}
            onPress={() => setView('panel')}
            testID="segment-panel"
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.segmentText,
                { color: theme.textMuted },
                view === 'panel' && { color: theme.text },
              ]}
            >
              Panel
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segmentBtn,
              view === 'raporty' && [styles.segmentBtnActive, { backgroundColor: theme.segmentActive }],
            ]}
            onPress={() => setView('raporty')}
            testID="segment-raporty"
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.segmentText,
                { color: theme.textMuted },
                view === 'raporty' && { color: theme.text },
              ]}
            >
              Raporty
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.segmentBtn,
              view === 'subskrypcja' && [styles.segmentBtnActive, { backgroundColor: theme.segmentActive }],
            ]}
            onPress={() => setView('subskrypcja')}
            testID="segment-subskrypcja"
            activeOpacity={0.85}
          >
            <Text
              style={[
                styles.segmentText,
                { color: theme.textMuted },
                view === 'subskrypcja' && { color: theme.text },
              ]}
            >
              Subskrypcja
            </Text>
          </TouchableOpacity>
        </View>

        {view === 'raporty' && <ReportsArchive onClosedDay={fetchData} />}

        {view === 'subskrypcja' && <SubscriptionPanel />}

        {view === 'panel' && (
          <>
            <CreditsWalletCard onPress={() => setShowUsageHistory(true)} testID="panel-wallet-widget" />
            <AlertBanner count={criticalCount} onPress={() => router.push('/(tabs)/magazyn')} />

            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              Wyniki bieżącego miesiąca
            </Text>
            <View style={styles.kpiRow}>
              <KPICard
                label="Przychód"
                value={formatPLN(totalRevenue)}
                subLabel="Ten miesiąc"
                variant="accent"
                wide
                onAdd={() => setShowAddRevenue(true)}
              />
              <KPICard
                label="Koszty łącznie"
                value={formatPLN(totalCosts)}
                subLabel="Stałe + zmienne"
                variant={totalCosts > totalRevenue && totalRevenue > 0 ? 'danger' : 'default'}
                wide
                onAdd={() => setShowAddFixed(true)}
              />
            </View>
            <View style={styles.kpiRowSingle}>
              <KPICard
                label="Zysk netto"
                value={(netProfit >= 0 ? '+' : '') + formatPLN(netProfit)}
                subLabel={
                  netProfit >= 0 ? 'Rentowność pozytywna' : 'Wynik ujemny — wymaga reakcji'
                }
                variant={netProfit >= 0 ? 'success' : 'danger'}
                wide
              />
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                Dziennik przychodów
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
                  title: e.description || 'Przychód',
                  amount: Number(e.amount_pln),
                  meta: (e as any).note ?? undefined,
                }))}
                emptyText="Brak przychodów — kliknij + na kafelku Przychód"
                formatAmount={formatPLN}
                amountPositive
                renderActions={(item) => (
                  <View style={{ flexDirection: 'row', gap: 4 }}>
                    <TouchableOpacity
                      onPress={() => {
                        const entry = revenueJournal.find((r) => r.id === item.id);
                        toggleNote(item.id, (entry as any)?.note);
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
                      onPress={() => handleDelete(item.id, 'revenue')}
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
                    onChangeText={setNoteText}
                    placeholder="Dodaj notatkę..."
                    placeholderTextColor={theme.textMuted}
                    multiline
                    numberOfLines={2}
                  />
                  <TouchableOpacity
                    style={[styles.noteSaveBtn, theme.isPremium && { backgroundColor: theme.accent }]}
                    onPress={() => saveNote(expandedNoteId, 'revenue')}
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
                    Suma przychodów (ten miesiąc)
                  </Text>
                  <Text style={[styles.costTotalValue, { color: theme.accent }]}>
                    {formatPLN(totalRevenue)}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                {'Koszty stałe — ' + CURRENT_MONTH}
              </Text>
              <TouchableOpacity
                style={[
                  styles.sectionAddBtn,
                  theme.isPremium && { backgroundColor: theme.accentSoft, borderColor: theme.border },
                ]}
                onPress={() => setShowAddFixed(true)}
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
                    Brak kosztów stałych — kliknij + aby dodać
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
                          onPress={() => toggleNote(cost.id, (cost as any).note)}
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
                          onPress={() => handleDelete(cost.id, 'fixed')}
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
                            onChangeText={setNoteText}
                            placeholder="Dodaj notatkę..."
                            placeholderTextColor={theme.textMuted}
                            multiline
                            numberOfLines={2}
                            autoFocus
                          />
                          <TouchableOpacity
                            style={styles.noteSaveBtn}
                            onPress={() => saveNote(cost.id, 'fixed')}
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
                <Text style={[styles.costTotalLabel, { color: theme.textSecondary }]}>Suma kosztów</Text>
                <Text style={[styles.costTotalValue, { color: theme.text }]}>{formatPLN(totalFixed)}</Text>
              </View>
            </View>

            <View style={styles.sectionHeaderRow}>
              <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
                {'Koszty zmienne — ' + CURRENT_MONTH}
              </Text>
              <TouchableOpacity
                style={[styles.sectionAddBtn, { backgroundColor: Colors.dangerLight, borderColor: '#FECACA' }]}
                onPress={() => setShowAddVariable(true)}
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
                    Brak kosztów zmiennych — kliknij + aby dodać
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
                          <Text style={[styles.costName, { color: theme.text }]}>{entry.name}</Text>
                          {(entry as any).note && !isExpanded ? (
                            <Text style={styles.notePreview} numberOfLines={1}>
                              {(entry as any).note}
                            </Text>
                          ) : null}
                        </View>
                        <TouchableOpacity
                          onPress={() => toggleNote(entry.id, (entry as any).note)}
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
                          onPress={() => handleDelete(entry.id, 'variable')}
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
                            onChangeText={setNoteText}
                            placeholder="Dodaj notatkę..."
                            placeholderTextColor={theme.textMuted}
                            multiline
                            numberOfLines={2}
                            autoFocus
                          />
                          <TouchableOpacity
                            style={styles.noteSaveBtn}
                            onPress={() => saveNote(entry.id, 'variable')}
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
                <Text style={[styles.costTotalLabel, { color: theme.textSecondary }]}>Suma kosztów</Text>
                <Text style={[styles.costTotalValue, { color: theme.text }]}>
                  {formatPLN(totalVariable)}
                </Text>
              </View>
            </View>

            <Text style={[styles.sectionLabel, { color: theme.textSecondary }]}>
              Analityka przychodów
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
                  Brak danych — dodaj przychody, aby zobaczyć wykres trendu
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

      <AddRevenueModal visible={showAddRevenue} onClose={() => setShowAddRevenue(false)} onSaved={fetchData} />
      <AddFixedCostModal visible={showAddFixed} onClose={() => setShowAddFixed(false)} onSaved={fetchData} />
      <AddVariableCostModal
        visible={showAddVariable}
        onClose={() => setShowAddVariable(false)}
        onSaved={fetchData}
      />
      <CreditsUsageHistoryModal visible={showUsageHistory} onClose={() => setShowUsageHistory(false)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 32 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, paddingTop: 4 },
  segment: { flexDirection: 'row', backgroundColor: Colors.borderLight, borderRadius: 12, padding: 4, marginBottom: 18 },
  segmentBtn: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  segmentBtnActive: { backgroundColor: Colors.card, shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.08, shadowRadius: 3, elevation: 2 },
  segmentText: { fontSize: 14, fontWeight: '700', color: Colors.textTertiary },
  segmentTextActive: { color: Colors.textPrimary },
  restaurantName: { fontSize: 22, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.5 },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 2, fontWeight: '500' },
  headerBadge: { width: 40, height: 40, borderRadius: 20, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  sectionLabel: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.6, marginBottom: 0 },
  sectionHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 4 },
  sectionAddBtn: { width: 28, height: 28, borderRadius: 8, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#BFDBFE' },
  kpiRow: { flexDirection: 'row', gap: 12, marginBottom: 12, marginTop: 10 },
  kpiRowSingle: { marginBottom: 20 },
  card: { backgroundColor: Colors.card, borderRadius: 12, padding: 4, marginBottom: 12, shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
  costRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 12, gap: 10, borderBottomWidth: 1, borderBottomColor: Colors.borderLight },
  costRowLast: { borderBottomWidth: 0 },
  costIcon: { width: 34, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  costNameCol: { flex: 1 },
  costName: { fontSize: 14, color: Colors.textPrimary, fontWeight: '500' },
  notePreview: { fontSize: 11, color: Colors.textTertiary, marginTop: 2, fontStyle: 'italic' },
  rowIconBtn: { padding: 4 },
  costAmount: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  costTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: Colors.borderLight, borderBottomLeftRadius: 12, borderBottomRightRadius: 12, marginTop: 4 },
  costTotalLabel: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.4 },
  costTotalValue: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary },
  emptyRow: { paddingHorizontal: 14, paddingVertical: 16 },
  emptyText: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center', lineHeight: 18 },
  noteExpanded: { backgroundColor: Colors.borderLight, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: Colors.border, gap: 8 },
  noteExpandedLast: { borderBottomWidth: 0, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  noteInput: { backgroundColor: Colors.card, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, color: Colors.textPrimary, minHeight: 56, borderWidth: 1, borderColor: Colors.border, textAlignVertical: 'top' },
  noteSaveBtn: { backgroundColor: Colors.accent, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-end' },
  noteSaveBtnText: { color: Colors.white, fontSize: 13, fontWeight: '600' },
});

const ms = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: Platform.OS === 'ios' ? 36 : 20 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  label: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8, marginTop: 4 },
  input: { backgroundColor: Colors.borderLight, borderRadius: 10, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 10, fontSize: 14, color: Colors.textPrimary, marginBottom: 14, borderWidth: 1, borderColor: Colors.border },
  typeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
  pill: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: Colors.borderLight, borderWidth: 1.5, borderColor: 'transparent' },
  pillActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  pillText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  pillTextActive: { color: Colors.accent },
  newCatRow: { flexDirection: 'row', gap: 8, marginBottom: 14, alignItems: 'center' },
  newCatConfirm: { width: 44, height: 44, borderRadius: 10, backgroundColor: Colors.accent, alignItems: 'center', justifyContent: 'center' },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 13, alignItems: 'center', justifyContent: 'center', marginTop: 4 },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
