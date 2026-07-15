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
  TrendingUp,
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
  const [error, setError] = useState<string | null>(null);
  const [revenueEntries, setRevenueEntries] = useState<RevenueEntry[]>([]);
  const [fixedCosts, setFixedCosts] = useState<FixedCost[]>([]);
  const [variableEntries, setVariableEntries] = useState<VariableCostEntry[]>([]);
  const [chartRecords, setChartRecords] = useState<{ id: string; year_month: string; revenue_pln: number; variable_costs_pln: number; created_at: string }[]>([]);
  const [criticalCount, setCriticalCount] = useState(0);
  const [showAddRevenue, setShowAddRevenue] = useState(false);
  const [showAddFixed, setShowAddFixed] = useState(false);
  const [showAddVariable, setShowAddVariable] = useState(false);
  const [expandedNoteId, setExpandedNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [noteSaving, setNoteSaving] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [revRes, fixedRes, varRes, revHistRes, varHistRes, inventoryRes] = await Promise.all([
        supabase.from('revenue_entries').select('*').eq('year_month', CURRENT_MONTH).order('created_at'),
        supabase.from('fixed_costs').select('*').eq('year_month', CURRENT_MONTH).order('type'),
        supabase.from('variable_cost_entries').select('*').eq('year_month', CURRENT_MONTH).order('created_at'),
        supabase.from('revenue_entries').select('year_month, amount_pln').order('year_month').limit(60),
        supabase.from('variable_cost_entries').select('year_month, amount_pln').order('year_month').limit(60),
        supabase.from('inventory_items').select('id, quantity, min_quantity'),
      ]);
      if (revRes.error) throw revRes.error;
      if (fixedRes.error) throw fixedRes.error;
      if (varRes.error) throw varRes.error;

      setRevenueEntries((revRes.data ?? []) as RevenueEntry[]);
      setFixedCosts((fixedRes.data ?? []) as FixedCost[]);
      setVariableEntries((varRes.data ?? []) as VariableCostEntry[]);

      const revH = revHistRes.data ?? [];
      const varH = varHistRes.data ?? [];
      const allMonths = new Set([...revH.map((r) => r.year_month), ...varH.map((r) => r.year_month)]);
      const sortedMonths = Array.from(allMonths).sort().slice(-6);
      setChartRecords(
        sortedMonths.map((month) => ({
          id: month,
          year_month: month,
          revenue_pln: revH.filter((r) => r.year_month === month).reduce((s, r) => s + Number(r.amount_pln), 0),
          variable_costs_pln: varH.filter((r) => r.year_month === month).reduce((s, r) => s + Number(r.amount_pln), 0),
          created_at: month,
        }))
      );

      const critical = (inventoryRes.data ?? []).filter(
        (i: Pick<InventoryItem, 'id' | 'quantity' | 'min_quantity'>) => i.quantity <= i.min_quantity
      );
      setCriticalCount(critical.length);
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
          else setRevenueEntries((prev) => prev.filter((e) => e.id !== id));
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

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchData(); }} tintColor={Colors.accent} />}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.restaurantName}>Gastro Manager</Text>
            <Text style={styles.subtitle}>{'Panel Finansowy · ' + CURRENT_MONTH}</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <View style={styles.headerBadge}>
              <TrendingUp size={16} color={Colors.accent} strokeWidth={2} />
            </View>
          </View>
        </View>

        <View style={{ marginTop: 4, marginBottom: 16 }}>
          <ReportInfoButton contextHint="Finanse" onApplied={fetchData} testID="finanse-report-info" />
        </View>

        <View style={styles.segment} testID="finance-segment">
          <TouchableOpacity
            style={[styles.segmentBtn, view === 'panel' && styles.segmentBtnActive]}
            onPress={() => setView('panel')}
            testID="segment-panel"
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentText, view === 'panel' && styles.segmentTextActive]}>Panel</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, view === 'raporty' && styles.segmentBtnActive]}
            onPress={() => setView('raporty')}
            testID="segment-raporty"
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentText, view === 'raporty' && styles.segmentTextActive]}>Raporty</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.segmentBtn, view === 'subskrypcja' && styles.segmentBtnActive]}
            onPress={() => setView('subskrypcja')}
            testID="segment-subskrypcja"
            activeOpacity={0.85}
          >
            <Text style={[styles.segmentText, view === 'subskrypcja' && styles.segmentTextActive]}>Subskrypcja</Text>
          </TouchableOpacity>
        </View>

        {view === 'raporty' && <ReportsArchive onClosedDay={fetchData} />}

        {view === 'subskrypcja' && <SubscriptionPanel />}

        {view === 'panel' && (<>
        <AlertBanner count={criticalCount} onPress={() => router.push('/(tabs)/magazyn')} />

        <Text style={styles.sectionLabel}>Wyniki bieżącego miesiąca</Text>
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
            label="Zysk Netto"
            value={(netProfit >= 0 ? '+' : '') + formatPLN(netProfit)}
            subLabel={netProfit >= 0 ? 'Rentowność pozytywna' : 'Wynik ujemny — wymaga reakcji'}
            variant={netProfit >= 0 ? 'success' : 'danger'}
            wide
          />
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>{'Przychody — ' + CURRENT_MONTH}</Text>
        </View>
        <View style={styles.card}>
          {revenueEntries.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>Brak przychodów — kliknij + na kafelku Przychód</Text>
            </View>
          ) : (
            revenueEntries.map((entry, idx) => {
              const isLast = idx === revenueEntries.length - 1;
              const isExpanded = expandedNoteId === entry.id;
              return (
                <View key={entry.id}>
                  <View style={[styles.costRow, isLast && !isExpanded && styles.costRowLast]}>
                    <View style={[styles.costIcon, { backgroundColor: Colors.accentLight }]}>
                      <TrendingUp size={18} color={Colors.accent} strokeWidth={2} />
                    </View>
                    <View style={styles.costNameCol}>
                      <Text style={styles.costName}>{entry.description || 'Przychód'}</Text>
                      {(entry as any).note && !isExpanded ? <Text style={styles.notePreview} numberOfLines={1}>{(entry as any).note}</Text> : null}
                    </View>
                    <TouchableOpacity onPress={() => toggleNote(entry.id, (entry as any).note)} style={styles.rowIconBtn}>
                      <MessageSquare size={13} color={isExpanded ? Colors.accent : ((entry as any).note ? Colors.accent : Colors.textTertiary)} strokeWidth={2} />
                    </TouchableOpacity>
                    <Text style={[styles.costAmount, { color: Colors.accent }]}>{'+' + formatPLN(Number(entry.amount_pln))}</Text>
                    <TouchableOpacity onPress={() => handleDelete(entry.id, 'revenue')} style={styles.rowIconBtn}>
                      <Trash2 size={13} color={Colors.danger} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                  {isExpanded && (
                    <View style={[styles.noteExpanded, isLast && styles.noteExpandedLast]}>
                      <TextInput
                        style={styles.noteInput}
                        value={noteText}
                        onChangeText={setNoteText}
                        placeholder="Dodaj notatkę..."
                        placeholderTextColor={Colors.textTertiary}
                        multiline
                        numberOfLines={2}
                        autoFocus
                      />
                      <TouchableOpacity style={styles.noteSaveBtn} onPress={() => saveNote(entry.id, 'revenue')} disabled={noteSaving}>
                        {noteSaving ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.noteSaveBtnText}>Zapisz</Text>}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}
          {revenueEntries.length > 0 && (
            <View style={styles.costTotalRow}>
              <Text style={styles.costTotalLabel}>Suma przychodów</Text>
              <Text style={[styles.costTotalValue, { color: Colors.accent }]}>{formatPLN(totalRevenue)}</Text>
            </View>
          )}
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>{'Koszty stałe — ' + CURRENT_MONTH}</Text>
          <TouchableOpacity style={styles.sectionAddBtn} onPress={() => setShowAddFixed(true)} activeOpacity={0.75}>
            <Plus size={15} color={Colors.accent} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          {fixedCosts.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>Brak kosztów stałych — kliknij + aby dodać</Text>
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
                      <Text style={styles.costName}>{cost.name}</Text>
                      {(cost as any).note && !isExpanded ? <Text style={styles.notePreview} numberOfLines={1}>{(cost as any).note}</Text> : null}
                    </View>
                    <TouchableOpacity onPress={() => toggleNote(cost.id, (cost as any).note)} style={styles.rowIconBtn}>
                      <MessageSquare size={13} color={isExpanded ? Colors.accent : ((cost as any).note ? Colors.accent : Colors.textTertiary)} strokeWidth={2} />
                    </TouchableOpacity>
                    <Text style={styles.costAmount}>{formatPLN(Number(cost.amount_pln))}</Text>
                    <TouchableOpacity onPress={() => handleDelete(cost.id, 'fixed')} style={styles.rowIconBtn}>
                      <Trash2 size={13} color={Colors.danger} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                  {isExpanded && (
                    <View style={[styles.noteExpanded, isLast && styles.noteExpandedLast]}>
                      <TextInput
                        style={styles.noteInput}
                        value={noteText}
                        onChangeText={setNoteText}
                        placeholder="Dodaj notatkę..."
                        placeholderTextColor={Colors.textTertiary}
                        multiline
                        numberOfLines={2}
                        autoFocus
                      />
                      <TouchableOpacity style={styles.noteSaveBtn} onPress={() => saveNote(cost.id, 'fixed')} disabled={noteSaving}>
                        {noteSaving ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.noteSaveBtnText}>Zapisz</Text>}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}
          <View style={styles.costTotalRow}>
            <Text style={styles.costTotalLabel}>Suma kosztów</Text>
            <Text style={styles.costTotalValue}>{formatPLN(totalFixed)}</Text>
          </View>
        </View>

        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionLabel}>{'Koszty zmienne — ' + CURRENT_MONTH}</Text>
          <TouchableOpacity style={[styles.sectionAddBtn, { backgroundColor: Colors.dangerLight, borderColor: '#FECACA' }]} onPress={() => setShowAddVariable(true)} activeOpacity={0.75}>
            <Plus size={15} color={Colors.danger} strokeWidth={2.5} />
          </TouchableOpacity>
        </View>
        <View style={styles.card}>
          {variableEntries.length === 0 ? (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>Brak kosztów zmiennych — kliknij + aby dodać</Text>
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
                      <Text style={styles.costName}>{entry.name}</Text>
                      {(entry as any).note && !isExpanded ? <Text style={styles.notePreview} numberOfLines={1}>{(entry as any).note}</Text> : null}
                    </View>
                    <TouchableOpacity onPress={() => toggleNote(entry.id, (entry as any).note)} style={styles.rowIconBtn}>
                      <MessageSquare size={13} color={isExpanded ? Colors.accent : ((entry as any).note ? Colors.accent : Colors.textTertiary)} strokeWidth={2} />
                    </TouchableOpacity>
                    <Text style={styles.costAmount}>{formatPLN(Number(entry.amount_pln))}</Text>
                    <TouchableOpacity onPress={() => handleDelete(entry.id, 'variable')} style={styles.rowIconBtn}>
                      <Trash2 size={13} color={Colors.danger} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                  {isExpanded && (
                    <View style={[styles.noteExpanded, isLast && styles.noteExpandedLast]}>
                      <TextInput
                        style={styles.noteInput}
                        value={noteText}
                        onChangeText={setNoteText}
                        placeholder="Dodaj notatkę..."
                        placeholderTextColor={Colors.textTertiary}
                        multiline
                        numberOfLines={2}
                        autoFocus
                      />
                      <TouchableOpacity style={styles.noteSaveBtn} onPress={() => saveNote(entry.id, 'variable')} disabled={noteSaving}>
                        {noteSaving ? <ActivityIndicator size="small" color={Colors.white} /> : <Text style={styles.noteSaveBtnText}>Zapisz</Text>}
                      </TouchableOpacity>
                    </View>
                  )}
                </View>
              );
            })
          )}
          <View style={styles.costTotalRow}>
            <Text style={styles.costTotalLabel}>Suma kosztów</Text>
            <Text style={styles.costTotalValue}>{formatPLN(totalVariable)}</Text>
          </View>
        </View>

        <Text style={styles.sectionLabel}>Analityka przychodów</Text>
        {chartRecords.length === 0 ? (
          <View style={[styles.card, { padding: 16 }]}>
            <Text style={styles.emptyText}>Brak danych — dodaj przychody, aby zobaczyć wykres trendu</Text>
          </View>
        ) : (
          <RevenueChart records={chartRecords} />
        )}
        </>)}

        <View style={{ height: 16 }} />
      </ScrollView>

      <AddRevenueModal visible={showAddRevenue} onClose={() => setShowAddRevenue(false)} onSaved={fetchData} />
      <AddFixedCostModal visible={showAddFixed} onClose={() => setShowAddFixed(false)} onSaved={fetchData} />
      <AddVariableCostModal visible={showAddVariable} onClose={() => setShowAddVariable(false)} onSaved={fetchData} />
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
