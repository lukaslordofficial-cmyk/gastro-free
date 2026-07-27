/**
 * Sekcja Magazyn → Naczynia (dark premium): lista, dodaj, edytuj pojemność, usuń.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Pencil, Trash2, X, Ruler, ChevronDown, ChevronUp, Lightbulb } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';
import { supabase } from '@/lib/supabase';
import { usePremiumAlert } from '@/components/PremiumAlert';
import {
  ensureDefaultKitchenUtensils,
  fetchKitchenUtensils,
  type KitchenUtensilRow,
} from '@/lib/kitchenUtensils';
import {
  KNIFE_GUIDE,
  MEASUREMENT_TIPS,
  POT_STICKER_CONCEPT,
  SHOP_AFFILIATE_NOTE,
  SHOP_PLACEHOLDER,
} from '@/lib/kitchenMeasurementTips';

type Props = {
  accountKey: string;
  /** Wywołaj po zmianach (np. odświeżenie meta). */
  onChanged?: () => void;
};

const TYPES = ['garnek', 'patelnia', 'pojemnik', 'miska', 'inne'] as const;

export function KitchenUtensilsSection({ accountKey, onChanged }: Props) {
  const { alert } = usePremiumAlert();
  const [rows, setRows] = useState<KitchenUtensilRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<KitchenUtensilRow | null>(null);
  const [name, setName] = useState('');
  const [utensilType, setUtensilType] = useState<string>('garnek');
  const [capacity, setCapacity] = useState('');
  const [capUnit, setCapUnit] = useState<'l' | 'ml'>('l');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tipsOpen, setTipsOpen] = useState(false);

  const load = useCallback(async () => {
    if (!accountKey || accountKey === 'default') {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    await ensureDefaultKitchenUtensils(supabase, accountKey);
    const { rows: list, error } = await fetchKitchenUtensils(supabase, accountKey);
    if (error) setErr(error);
    else setErr(null);
    setRows(list);
    setLoading(false);
  }, [accountKey]);

  useEffect(() => {
    void load();
  }, [load]);

  function openAdd() {
    setEditing(null);
    setName('');
    setUtensilType('garnek');
    setCapacity('');
    setCapUnit('l');
    setNotes('');
    setErr(null);
    setModalOpen(true);
  }

  function openEdit(u: KitchenUtensilRow) {
    setEditing(u);
    setName(u.name);
    setUtensilType(u.utensil_type || 'garnek');
    setCapacity(u.capacity_value != null ? String(u.capacity_value) : '');
    setCapUnit((u.capacity_unit === 'ml' ? 'ml' : 'l') as 'l' | 'ml');
    setNotes(u.notes || '');
    setErr(null);
    setModalOpen(true);
  }

  async function save() {
    const n = name.trim();
    const cap = Number(String(capacity).replace(',', '.'));
    if (!n) {
      setErr('Podaj nazwę naczynia.');
      return;
    }
    if (!Number.isFinite(cap) || cap <= 0) {
      setErr('Podaj pojemność > 0 (np. 8).');
      return;
    }
    if (!accountKey || accountKey === 'default') {
      setErr('Brak konta — zaloguj się ponownie.');
      return;
    }
    setSaving(true);
    setErr(null);
    const payload = {
      name: n,
      utensil_type: utensilType,
      capacity_value: cap,
      capacity_unit: capUnit,
      notes: notes.trim() || null,
      account_key: accountKey,
    };
    try {
      if (editing) {
        const { error } = await supabase
          .from('kitchen_utensils')
          .update(payload)
          .eq('id', editing.id)
          .eq('account_key', accountKey);
        if (error) throw error;
      } else {
        const { error } = await supabase.from('kitchen_utensils').insert(payload);
        if (error) throw error;
      }
      setModalOpen(false);
      await load();
      onChanged?.();
    } catch (e: any) {
      const msg = e?.message || 'Nie udało się zapisać.';
      if (/account_key|schema cache|column/i.test(msg)) {
        setErr(
          'Brak kolumny account_key — uruchom w Supabase: ADD_KITCHEN_UTENSILS_TENANT.sql',
        );
      } else {
        setErr(msg);
      }
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(u: KitchenUtensilRow) {
    alert('Usunąć naczynie?', `„${u.name}” zniknie z listy. Możesz dodać je później ponownie.`, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const { error } = await supabase
              .from('kitchen_utensils')
              .delete()
              .eq('id', u.id)
              .eq('account_key', accountKey);
            if (error) {
              alert('Błąd', error.message);
              return;
            }
            await load();
            onChanged?.();
          })();
        },
      },
    ]);
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Ruler size={16} color={DS.color.greenEnd} strokeWidth={2} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Naczynia kuchenne</Text>
          <Text style={styles.sub}>
            Sprzęt tej kuchni — edytuj litraż (np. 8 l zamiast 10 l). Seed to tylko punkt startowy.
          </Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd} activeOpacity={0.85}>
          <Plus size={16} color="#0A120E" strokeWidth={2.5} />
          <Text style={styles.addBtnText}>Dodaj</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <ActivityIndicator color={DS.color.greenEnd} style={{ marginVertical: 16 }} />
      ) : err && !rows.length ? (
        <Text style={styles.warn}>{err}</Text>
      ) : rows.length === 0 ? (
        <Text style={styles.empty}>Brak naczyń — dodaj garnek lub odśwież listę po migracji SQL.</Text>
      ) : (
        rows.map((u) => (
          <View key={u.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowName}>{u.name}</Text>
              <Text style={styles.rowMeta}>
                {u.utensil_type}
                {u.capacity_value != null
                  ? ` · ${u.capacity_value} ${u.capacity_unit || 'l'}`
                  : ''}
              </Text>
              {u.notes ? <Text style={styles.rowNotes}>{u.notes}</Text> : null}
            </View>
            <TouchableOpacity style={styles.iconBtn} onPress={() => openEdit(u)} hitSlop={8}>
              <Pencil size={16} color={DS.color.greenEnd} strokeWidth={2} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.iconBtn} onPress={() => confirmDelete(u)} hitSlop={8}>
              <Trash2 size={16} color={DS.color.alert} strokeWidth={2} />
            </TouchableOpacity>
          </View>
        ))
      )}

      <TouchableOpacity
        style={styles.tipsToggle}
        onPress={() => setTipsOpen((v) => !v)}
        activeOpacity={0.85}
        accessibilityRole="button"
        accessibilityState={{ expanded: tipsOpen }}
      >
        <Lightbulb size={15} color={DS.color.greenEnd} strokeWidth={2} />
        <Text style={styles.tipsToggleText}>Wskazówki pomiaru</Text>
        {tipsOpen ? (
          <ChevronUp size={16} color={DS.color.muted} strokeWidth={2} />
        ) : (
          <ChevronDown size={16} color={DS.color.muted} strokeWidth={2} />
        )}
      </TouchableOpacity>

      {tipsOpen ? (
        <View style={styles.tipsBody}>
          <Text style={styles.tipsSectionTitle}>Noże — który do czego</Text>
          {KNIFE_GUIDE.map((row) => (
            <View key={row.knife} style={styles.knifeRow}>
              <Text style={styles.knifeName}>{row.knife}</Text>
              <Text style={styles.knifeUse}>{row.use}</Text>
            </View>
          ))}

          <Text style={[styles.tipsSectionTitle, { marginTop: 14 }]}>{POT_STICKER_CONCEPT.title}</Text>
          <Text style={styles.tipsPara}>{POT_STICKER_CONCEPT.body}</Text>

          <Text style={[styles.tipsSectionTitle, { marginTop: 14 }]}>Pomiary w kuchni</Text>
          {MEASUREMENT_TIPS.map((tip) => (
            <Text key={tip} style={styles.tipBullet}>
              · {tip}
            </Text>
          ))}

          <Text style={styles.shopLine}>{SHOP_PLACEHOLDER}</Text>
          <Text style={styles.shopNote}>{SHOP_AFFILIATE_NOTE}</Text>
        </View>
      ) : null}

      <Modal visible={modalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setModalOpen(false)}>
        <SafeAreaView style={styles.modalSafe} edges={['top', 'bottom']}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>{editing ? 'Edytuj naczynie' : 'Nowe naczynie'}</Text>
            <TouchableOpacity onPress={() => setModalOpen(false)} style={styles.closeBtn}>
              <X size={20} color={DS.color.muted} strokeWidth={2} />
            </TouchableOpacity>
          </View>
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              <Text style={styles.label}>Nazwa</Text>
              <TextInput
                style={styles.input}
                value={name}
                onChangeText={setName}
                placeholder="np. Garnek 8 l"
                placeholderTextColor={DS.color.muted}
              />
              <Text style={styles.label}>Typ</Text>
              <View style={styles.chips}>
                {TYPES.map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.chip, utensilType === t && styles.chipOn]}
                    onPress={() => setUtensilType(t)}
                  >
                    <Text style={[styles.chipText, utensilType === t && styles.chipTextOn]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={styles.label}>Pojemność</Text>
              <View style={styles.capRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={capacity}
                  onChangeText={setCapacity}
                  keyboardType="decimal-pad"
                  placeholder="8"
                  placeholderTextColor={DS.color.muted}
                />
                <TouchableOpacity
                  style={[styles.unitBtn, capUnit === 'l' && styles.chipOn]}
                  onPress={() => setCapUnit('l')}
                >
                  <Text style={[styles.chipText, capUnit === 'l' && styles.chipTextOn]}>l</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.unitBtn, capUnit === 'ml' && styles.chipOn]}
                  onPress={() => setCapUnit('ml')}
                >
                  <Text style={[styles.chipText, capUnit === 'ml' && styles.chipTextOn]}>ml</Text>
                </TouchableOpacity>
              </View>
              <Text style={styles.label}>Notatka (opcjonalnie)</Text>
              <TextInput
                style={[styles.input, { minHeight: 64 }]}
                value={notes}
                onChangeText={setNotes}
                placeholder="np. tylko do sosów"
                placeholderTextColor={DS.color.muted}
                multiline
              />
              {err ? <Text style={styles.warn}>{err}</Text> : null}
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity style={styles.saveBtn} onPress={() => void save()} disabled={saving} activeOpacity={0.85}>
                {saving ? (
                  <ActivityIndicator color="#0A120E" />
                ) : (
                  <Text style={styles.saveText}>{editing ? 'Zapisz zmiany' : 'Dodaj naczynie'}</Text>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 20,
    marginHorizontal: 4,
    padding: 14,
    borderRadius: 16,
    backgroundColor: DS.color.surfaceCard,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
  },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  title: { fontSize: 16, fontWeight: '700', color: DS.color.heading },
  sub: { fontSize: 12, color: DS.color.muted, marginTop: 4, lineHeight: 17 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: DS.color.greenEnd,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addBtnText: { color: '#0A120E', fontWeight: '800', fontSize: 13 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: DS.color.borderSubtle,
    gap: 6,
  },
  rowName: { fontSize: 15, fontWeight: '600', color: DS.color.heading },
  rowMeta: { fontSize: 12, color: DS.color.greenEnd, marginTop: 2, textTransform: 'capitalize' },
  rowNotes: { fontSize: 12, color: DS.color.muted, marginTop: 2 },
  iconBtn: { padding: 8 },
  empty: { fontSize: 13, color: DS.color.muted, paddingVertical: 8 },
  warn: { fontSize: 13, color: DS.color.alert, marginTop: 8, lineHeight: 18 },
  tipsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: DS.color.borderSubtle,
  },
  tipsToggleText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    color: DS.color.heading,
  },
  tipsBody: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: DS.color.bgPrimary,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
  },
  tipsSectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: DS.color.greenEnd,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  knifeRow: {
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DS.color.borderSubtle,
  },
  knifeName: { fontSize: 13, fontWeight: '700', color: DS.color.heading },
  knifeUse: { fontSize: 12, color: DS.color.muted, marginTop: 2, lineHeight: 17 },
  tipsPara: { fontSize: 13, color: DS.color.body, lineHeight: 19 },
  tipBullet: { fontSize: 13, color: DS.color.body, lineHeight: 19, marginBottom: 4 },
  shopLine: {
    marginTop: 14,
    fontSize: 13,
    fontWeight: '700',
    color: DS.color.heading,
  },
  shopNote: { marginTop: 4, fontSize: 11, color: DS.color.muted, lineHeight: 16 },
  modalSafe: { flex: 1, backgroundColor: DS.color.bgPrimary },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: DS.space.screen,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.borderSubtle,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: DS.color.heading },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DS.color.surfaceCard,
  },
  form: { padding: DS.space.screen, paddingBottom: 24 },
  label: { fontSize: 13, fontWeight: '600', color: DS.color.muted, marginBottom: 6, marginTop: 12 },
  input: {
    backgroundColor: DS.color.surfaceCard,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: DS.color.heading,
    fontSize: 16,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    backgroundColor: DS.color.surfaceCard,
  },
  chipOn: { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd },
  chipText: { color: DS.color.heading, fontWeight: '600', fontSize: 13 },
  chipTextOn: { color: '#0A120E' },
  capRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  unitBtn: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    backgroundColor: DS.color.surfaceCard,
  },
  footer: {
    padding: DS.space.screen,
    borderTopWidth: 1,
    borderTopColor: DS.color.borderSubtle,
  },
  saveBtn: {
    backgroundColor: DS.color.greenEnd,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  saveText: { color: '#0A120E', fontWeight: '800', fontSize: 16 },
});
