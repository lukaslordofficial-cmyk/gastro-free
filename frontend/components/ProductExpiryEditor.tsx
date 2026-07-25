/**
 * Sekcja dat ważności w edycji produktu (Magazyn → produkt → Edycja).
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { Plus, Trash2, Bell, Save } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { ExpiryDateField } from '@/components/ExpiryDateField';
import { scheduleExpiryReminders } from '@/lib/pushNotifications';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { useAppTheme } from '@/hooks/useAppTheme';
import { DS } from '@/constants/premiumTheme';

const ALERT_PRESETS = [14, 7, 5, 3, 1];
const CHIP_ON_TEXT = '#0A0A0A';

type Batch = {
  key: string;
  id?: string;
  quantity: string;
  expiration_date: string;
};

type Props = {
  inventoryItemId: string;
  productName: string;
  unit: string;
};

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function statusOf(iso: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'fresh';
  const [y, m, d] = iso.split('-').map(Number);
  const exp = new Date(y, m - 1, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((exp.getTime() - today.getTime()) / 86400000);
  if (days < 0) return 'expired';
  if (days <= 7) return 'warning';
  return 'fresh';
}

export function ProductExpiryEditor({ inventoryItemId, productName, unit }: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const { alert } = usePremiumAlert();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [alertDays, setAlertDays] = useState<number[]>([7, 3, 1]);
  const [stockQty, setStockQty] = useState(0);

  const accent = prem ? DS.color.greenEnd : Colors.accent;
  const soft = prem ? 'rgba(0,255,120,0.14)' : Colors.accentLight;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const cardBg = prem ? DS.color.bgTertiary : Colors.card;
  const inputBg = prem ? DS.color.bgSecondary : Colors.card;
  const chipOffBg = prem ? DS.color.bgSecondary : Colors.card;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [{ data }, { data: inv }] = await Promise.all([
        supabase
          .from('warehouse_inventory')
          .select('id, quantity, expiration_date, alert_triggers')
          .eq('inventory_item_id', inventoryItemId)
          .order('expiration_date', { ascending: true }),
        supabase.from('inventory_items').select('quantity').eq('id', inventoryItemId).maybeSingle(),
      ]);
      setStockQty(Number(inv?.quantity) || 0);
      const rows = data ?? [];
      if (rows.length) {
        setBatches(
          rows.map((r: any) => ({
            key: String(r.id),
            id: String(r.id),
            quantity: String(r.quantity ?? ''),
            expiration_date: String(r.expiration_date || '').slice(0, 10),
          })),
        );
        const triggers = rows[0]?.alert_triggers;
        if (Array.isArray(triggers) && triggers.length) {
          setAlertDays(triggers.map(Number).filter((n: number) => n > 0));
        }
      } else {
        setBatches([{ key: newKey(), quantity: '', expiration_date: '' }]);
      }
    } finally {
      setLoading(false);
    }
  }, [inventoryItemId]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleAlert = (day: number) => {
    setAlertDays((prev) => {
      const has = prev.includes(day);
      const next = has ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => b - a);
      return next.length ? next : [7, 3, 1];
    });
  };

  const save = async () => {
    if (stockQty <= 0) {
      alert(
        'Brak produktu na stanie',
        'Nie ma już tego produktu w magazynie. Najpierw dodaj go na stan.',
        [{ text: 'OK', style: 'primary' }],
      );
      return;
    }
    const valid = batches.filter(
      (b) =>
        /^\d{4}-\d{2}-\d{2}$/.test(b.expiration_date) &&
        (parseFloat(String(b.quantity).replace(',', '.')) || 0) > 0,
    );
    if (!valid.length) {
      alert('Daty ważności', 'Dodaj co najmniej jedną partię (ilość + data z kalendarza).', [
        { text: 'OK', style: 'primary' },
      ]);
      return;
    }
    const sum = valid.reduce(
      (s, b) => s + (parseFloat(String(b.quantity).replace(',', '.')) || 0),
      0,
    );
    if (sum > stockQty + 0.001) {
      alert(
        'Za dużo sztuk',
        `W magazynie jest tylko ${stockQty} ${unit || 'szt'}. Nie możesz ustawić dat dla większej liczby.`,
        [{ text: 'OK', style: 'primary' }],
      );
      return;
    }
    setSaving(true);
    try {
      await supabase.from('warehouse_inventory').delete().eq('inventory_item_id', inventoryItemId);
      const payload = valid.map((b) => ({
        inventory_item_id: inventoryItemId,
        product_name: productName,
        quantity: Number(String(b.quantity).replace(',', '.')),
        unit: unit || 'szt',
        expiration_date: b.expiration_date,
        status: statusOf(b.expiration_date),
        alert_triggers: alertDays,
        source: 'manual_edit',
      }));
      const { error } = await supabase.from('warehouse_inventory').insert(payload);
      if (error) throw error;
      await scheduleExpiryReminders(
        productName,
        valid.map((b) => ({ expirationDate: b.expiration_date, alertDays })),
      );
      alert('Zapisano', 'Daty ważności i przypomnienia zostały ustawione.', [
        { text: 'OK', style: 'primary' },
      ]);
      await load();
    } catch (e: any) {
      alert('Błąd', e?.message || 'Nie udało się zapisać dat.', [{ text: 'OK', style: 'primary' }]);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={accent} />
        <Text style={[styles.loadingText, { color: muted }]}>Ładuję daty ważności…</Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.wrap,
        prem && {
          backgroundColor: DS.color.surfaceCard,
          borderColor: DS.color.borderSubtle,
          borderWidth: 1,
          borderRadius: 14,
          padding: 12,
        },
      ]}
    >
      <Text style={[styles.section, { color: text }]}>Daty ważności</Text>
      <Text style={[styles.hint, { color: muted }]}>
        Stan magazynu: {stockQty} {unit || 'szt'}. Wybierz datę z kalendarza.
      </Text>
      {stockQty <= 0 ? (
        <Text style={{ fontSize: 12, color: Colors.danger, marginBottom: 10, fontWeight: '600' }}>
          Brak produktu na stanie — najpierw dodaj go do magazynu.
        </Text>
      ) : null}

      {batches.map((b, idx) => (
        <View
          key={b.key}
          style={[
            styles.card,
            {
              backgroundColor: cardBg,
              borderColor: border,
            },
          ]}
        >
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: muted }]}>Ilość</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: text,
                    borderColor: border,
                    backgroundColor: inputBg,
                  },
                ]}
                value={b.quantity}
                onChangeText={(v) =>
                  setBatches((prev) =>
                    prev.map((x) => (x.key === b.key ? { ...x, quantity: v } : x)),
                  )
                }
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={muted}
              />
            </View>
            <View style={{ flex: 1.5 }}>
              <ExpiryDateField
                value={b.expiration_date}
                onChange={(iso) =>
                  setBatches((prev) =>
                    prev.map((x) => (x.key === b.key ? { ...x, expiration_date: iso } : x)),
                  )
                }
                textColor={text}
                mutedColor={muted}
                borderColor={border}
                bgColor={inputBg}
                accentColor={accent}
                sheetBgColor={prem ? DS.color.bgSecondary : Colors.card}
              />
            </View>
            {batches.length > 1 ? (
              <TouchableOpacity
                onPress={() => setBatches((prev) => prev.filter((x) => x.key !== b.key))}
                style={styles.del}
                hitSlop={8}
              >
                <Trash2 size={16} color={Colors.danger} strokeWidth={2} />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 28 }} />
            )}
          </View>
          <Text style={[styles.meta, { color: muted }]}>Partia {idx + 1}</Text>
        </View>
      ))}

      <TouchableOpacity
        style={[
          styles.addBtn,
          {
            backgroundColor: prem ? soft : Colors.accentLight,
            borderColor: accent,
          },
        ]}
        onPress={() => {
          if (stockQty <= 0) {
            alert(
              'Brak produktu na stanie',
              'Nie ma już tego produktu w magazynie. Najpierw dodaj go na stan.',
              [{ text: 'OK', style: 'primary' }],
            );
            return;
          }
          setBatches((prev) => [...prev, { key: newKey(), quantity: '', expiration_date: '' }]);
        }}
        activeOpacity={0.85}
      >
        <Plus size={14} color={prem ? accent : Colors.accent} strokeWidth={2.5} />
        <Text
          style={[styles.addText, { color: prem ? accent : Colors.accent }]}
          numberOfLines={2}
        >
          Produkt ma różne daty ważności
        </Text>
      </TouchableOpacity>

      <View style={styles.alertHead}>
        <Bell size={14} color={accent} strokeWidth={2.2} />
        <Text style={[styles.sectionInline, { color: text }]}>Przypomnij mi</Text>
      </View>
      <View style={styles.chipRow}>
        {ALERT_PRESETS.map((day) => {
          const on = alertDays.includes(day);
          return (
            <TouchableOpacity
              key={day}
              style={[
                styles.chip,
                {
                  borderColor: on ? accent : border,
                  backgroundColor: on ? accent : chipOffBg,
                },
              ]}
              onPress={() => toggleAlert(day)}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, { color: on ? CHIP_ON_TEXT : muted }]}>
                {day} dni
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <TouchableOpacity
        style={[
          styles.saveBtn,
          { backgroundColor: accent },
          saving && { opacity: 0.7 },
        ]}
        onPress={save}
        disabled={saving}
        activeOpacity={0.85}
      >
        <Save size={15} color={CHIP_ON_TEXT} strokeWidth={2.5} />
        <Text style={styles.saveText} numberOfLines={1}>
          {saving ? 'Zapisywanie…' : 'Zapisz daty ważności'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, marginBottom: 16 },
  loading: { paddingVertical: 16, alignItems: 'center', gap: 8 },
  loadingText: { fontSize: 12 },
  section: {
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
  },
  sectionInline: { fontSize: 13, fontWeight: '800' },
  hint: { fontSize: 11, marginBottom: 10, lineHeight: 15 },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  meta: { fontSize: 10, marginTop: 6 },
  del: { paddingBottom: 10, paddingHorizontal: 4 },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    minHeight: 44,
    marginBottom: 12,
  },
  addText: { fontSize: 12, fontWeight: '800' },
  alertHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
  },
  chipText: { fontSize: 12, fontWeight: '800' },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 14,
    minHeight: 48,
  },
  saveText: { fontSize: 13, fontWeight: '800', color: CHIP_ON_TEXT },
});
