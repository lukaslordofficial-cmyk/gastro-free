/**
 * Formularz dat ważności (głos) — TYLKO produkty już w magazynie.
 * Kalendarz zamiast ręcznego wpisywania daty.
 * Kafelki przypomnień: zielone tło → czarna czcionka.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { Plus, Trash2, Bell, Package } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import { requireTenantAccountKey } from '@/lib/tenantScope';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { secureId } from '@/lib/secureId';
import { ExpiryDateField } from '@/components/ExpiryDateField';
import { usePremiumAlert } from '@/components/PremiumAlert';

const ALERT_PRESETS = [14, 7, 5, 3, 1];
const CHIP_ON_TEXT = '#0A0A0A';

type InvRow = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
};

type BatchRow = {
  key: string;
  quantity: string;
  expiration_date: string;
};

type Props = {
  edited: Record<string, any>;
  patch: (p: Record<string, any>) => void;
  Card: React.ComponentType<{ children: React.ReactNode }>;
  UnitField: React.ComponentType<{ value: string; onChange: (v: string) => void }>;
  JarvisMatchBanner: React.ComponentType<{
    label: string;
    matched?: string;
    question?: string;
  }>;
};

function newKey() {
  return secureId('expv');
}

function normalizeBatches(edited: Record<string, any>): BatchRow[] {
  if (Array.isArray(edited.batches) && edited.batches.length) {
    return edited.batches.map((b: any, i: number) => ({
      key: b.key || `b-${i}`,
      quantity: b.quantity == null || b.quantity === '' ? '' : String(b.quantity),
      expiration_date: String(b.expiration_date || ''),
    }));
  }
  return [
    {
      key: newKey(),
      quantity: edited.quantity == null || edited.quantity === '' ? '' : String(edited.quantity),
      expiration_date: String(edited.expiration_date || ''),
    },
  ];
}

export function ExpirationVoiceForm({
  edited,
  patch,
  Card,
  UnitField,
  JarvisMatchBanner,
}: Props) {
  const theme = useAppTheme();
  const { alert } = usePremiumAlert();
  const [inv, setInv] = useState<InvRow[]>([]);
  const [loadingInv, setLoadingInv] = useState(true);
  const [showSuggest, setShowSuggest] = useState(false);

  const productName = String(
    edited.item_name_resolved ?? edited.item_name ?? edited.product_name ?? '',
  );
  const batches = useMemo(() => normalizeBatches(edited), [edited]);
  const alertDays: number[] =
    Array.isArray(edited.alert_days) && edited.alert_days.length
      ? edited.alert_days.map(Number).filter((n) => n > 0)
      : [7, 3, 1];
  const selectedId = edited.inventory_id ? String(edited.inventory_id) : null;
  const selected = inv.find((i) => i.id === selectedId) ?? null;
  const stockQty = selected?.quantity ?? Number(edited.current_stock) ?? 0;

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingInv(true);
      try {
        const { data } = await supabase
          .from('inventory_items')
          .select('id, name, quantity, unit')
          .eq('account_key', requireTenantAccountKey())
          .order('name')
          .limit(2000);
        if (!alive) return;
        setInv(
          (data ?? []).map((i: any) => ({
            id: String(i.id),
            name: String(i.name || ''),
            quantity: Number(i.quantity) || 0,
            unit: String(i.unit || 'szt'),
          })),
        );
      } finally {
        if (alive) setLoadingInv(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Komenda ustawiania daty — nigdy nie dodaje stanu / nowych produktów
  useEffect(() => {
    if (edited.increase_stock !== false) {
      patch({ increase_stock: false });
    }
  }, []);

  const suggestions = useMemo(() => {
    const q = productName.trim().toLowerCase();
    if (q.length < 1) return inv.slice(0, 8);
    return inv.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8);
  }, [inv, productName]);

  const setBatches = useCallback(
    (next: BatchRow[]) => {
      const mapped = next.map((b) => ({
        key: b.key,
        quantity: b.quantity === '' ? null : Number(String(b.quantity).replace(',', '.')),
        expiration_date: b.expiration_date,
      }));
      const first = mapped[0];
      patch({
        batches: mapped,
        quantity: first?.quantity ?? null,
        expiration_date: first?.expiration_date ?? '',
        increase_stock: false,
      });
    },
    [patch],
  );

  const selectProduct = (row: InvRow) => {
    setShowSuggest(false);
    if ((row.quantity || 0) <= 0) {
      alert(
        'Brak produktu na stanie',
        `„${row.name}” ma stan 0 w magazynie. Najpierw dodaj produkt na stan (Magazyn / faktura), a potem ustaw daty ważności.`,
        [{ text: 'OK', style: 'primary' }],
      );
    }
    const nextBatches = [
      {
        key: newKey(),
        quantity: row.quantity > 0 ? String(row.quantity) : '',
        expiration_date: batches[0]?.expiration_date || '',
      },
    ];
    patch({
      inventory_id: row.id,
      item_name: row.name,
      item_name_resolved: row.name,
      product_name: row.name,
      unit: row.unit || 'szt',
      current_stock: row.quantity,
      increase_stock: false,
      batches: nextBatches.map((b) => ({
        key: b.key,
        quantity: b.quantity === '' ? null : Number(b.quantity),
        expiration_date: b.expiration_date,
      })),
      quantity: nextBatches[0].quantity === '' ? null : Number(nextBatches[0].quantity),
      expiration_date: nextBatches[0].expiration_date,
    });
  };

  const onNameChange = (v: string) => {
    setShowSuggest(true);
    patch({
      item_name: v,
      item_name_resolved: v,
      product_name: v,
      inventory_id: null,
      current_stock: null,
      increase_stock: false,
    });
  };

  const toggleAlert = (day: number) => {
    const has = alertDays.includes(day);
    const next = has
      ? alertDays.filter((d) => d !== day)
      : [...alertDays, day].sort((a, b) => b - a);
    patch({ alert_days: next.length ? next : [7, 3, 1] });
  };

  const batchSum = batches.reduce(
    (s, b) => s + (parseFloat(String(b.quantity).replace(',', '.')) || 0),
    0,
  );

  const accent = theme.isPremium ? DS.color.greenEnd : Colors.accent;
  const soft = theme.isPremium ? 'rgba(0,255,120,0.18)' : Colors.accentLight;
  const border = theme.isPremium ? DS.color.borderSubtle : Colors.border;
  const text = theme.isPremium ? DS.color.heading : Colors.textPrimary;
  const muted = theme.isPremium ? DS.color.muted : Colors.textSecondary;
  const chipOnBg = theme.isPremium ? DS.color.greenEnd : Colors.accent;

  return (
    <Card>
      <JarvisMatchBanner
        label="produkt w magazynie"
        matched={selected ? selected.name : undefined}
        question="Wybierz produkt z magazynu i ustaw daty ważności."
      />

      <View style={styles.field}>
        <Text style={[styles.label, { color: muted }]}>Produkt (z magazynu)</Text>
        <TextInput
          style={[
            styles.input,
            {
              color: text,
              borderColor: border,
              backgroundColor: theme.isPremium ? DS.color.bgTertiary : Colors.card,
            },
          ]}
          value={productName}
          onChangeText={onNameChange}
          onFocus={() => setShowSuggest(true)}
          placeholder="Szukaj w magazynie…"
          placeholderTextColor={Colors.textTertiary}
          autoCorrect={false}
          testID="voice-expiry-product"
        />
        {loadingInv ? (
          <ActivityIndicator size="small" color={accent} style={{ marginTop: 8 }} />
        ) : null}
        {showSuggest && suggestions.length > 0 ? (
          <View
            style={[
              styles.suggestBox,
              {
                borderColor: border,
                backgroundColor: theme.isPremium ? DS.color.surfaceCard : Colors.card,
              },
            ]}
          >
            {suggestions.map((s) => (
              <TouchableOpacity
                key={s.id}
                style={styles.suggestRow}
                onPress={() => selectProduct(s)}
                activeOpacity={0.75}
              >
                <Package size={14} color={accent} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.suggestName, { color: text }]} numberOfLines={1}>
                    {s.name}
                  </Text>
                  <Text style={[styles.suggestMeta, { color: muted }]}>
                    Stan: {s.quantity} {s.unit}
                  </Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
        {selected ? (
          <Text style={[styles.hint, { color: muted }]}>
            Wybrano · stan {stockQty} {selected.unit}
          </Text>
        ) : (
          <Text style={[styles.hint, { color: Colors.danger }]}>
            Musisz wybrać produkt z listy magazynu. Nowe produkty dodaj w Magazynie / fakturą.
          </Text>
        )}
        {selected && stockQty <= 0 ? (
          <Text style={[styles.warn, { color: Colors.danger, marginTop: 8 }]}>
            Ten produkt ma stan 0 — najpierw dodaj go na magazyn, zanim ustawisz daty ważności.
          </Text>
        ) : null}
      </View>

      {selected && stockQty > 0 ? (
        <TouchableOpacity
          style={[styles.quickBtn, { borderColor: chipOnBg, backgroundColor: soft }]}
          onPress={() =>
            setBatches([
              {
                key: newKey(),
                quantity: String(stockQty),
                expiration_date: batches[0]?.expiration_date || '',
              },
            ])
          }
          activeOpacity={0.85}
        >
          <Text style={[styles.quickText, { color: CHIP_ON_TEXT }]} numberOfLines={2}>
            Cały stan ({stockQty} {selected.unit}) — jedna data
          </Text>
        </TouchableOpacity>
      ) : null}

      <UnitField
        value={edited.unit ?? selected?.unit ?? 'szt'}
        onChange={(v) => patch({ unit: v })}
      />

      <Text style={[styles.section, { color: text }]}>Partie / daty ważności</Text>
      {batches.map((b, idx) => (
        <View key={b.key} style={[styles.batchCard, { borderColor: border }]}>
          <View style={styles.batchRow}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.label, { color: muted }]}>Ilość</Text>
              <TextInput
                style={[
                  styles.input,
                  {
                    color: text,
                    borderColor: border,
                    backgroundColor: theme.isPremium ? DS.color.bgTertiary : Colors.card,
                  },
                ]}
                value={b.quantity}
                onChangeText={(v) => {
                  const next = batches.map((x) => (x.key === b.key ? { ...x, quantity: v } : x));
                  const sum = next.reduce(
                    (s, x) => s + (parseFloat(String(x.quantity).replace(',', '.')) || 0),
                    0,
                  );
                  if (selected && stockQty > 0 && sum > stockQty + 0.001) {
                    alert(
                      'Za dużo sztuk',
                      `W magazynie jest tylko ${stockQty} ${selected.unit}. Nie możesz ustawić dat ważności dla większej liczby.`,
                      [{ text: 'OK', style: 'primary' }],
                    );
                    return;
                  }
                  setBatches(next);
                }}
                keyboardType="decimal-pad"
                placeholder="0"
                placeholderTextColor={Colors.textTertiary}
                editable={!(selected && stockQty <= 0)}
              />
            </View>
            <View style={{ flex: 1.6 }}>
              <ExpiryDateField
                value={b.expiration_date}
                onChange={(iso) => {
                  const next = batches.map((x) =>
                    x.key === b.key ? { ...x, expiration_date: iso } : x,
                  );
                  setBatches(next);
                }}
                textColor={text}
                mutedColor={muted}
                borderColor={border}
                bgColor={theme.isPremium ? DS.color.bgTertiary : Colors.card}
                accentColor={accent}
                testID={`voice-expiry-date-${idx}`}
              />
            </View>
            {batches.length > 1 ? (
              <TouchableOpacity
                onPress={() => setBatches(batches.filter((x) => x.key !== b.key))}
                style={styles.delBtn}
                hitSlop={8}
              >
                <Trash2 size={16} color={Colors.danger} strokeWidth={2} />
              </TouchableOpacity>
            ) : (
              <View style={{ width: 28 }} />
            )}
          </View>
          <Text style={[styles.batchHint, { color: muted }]}>
            Wariant {idx + 1}
            {selected ? ` · suma ${batchSum} / stan ${stockQty}` : ''}
          </Text>
        </View>
      ))}

      <TouchableOpacity
        style={[styles.addBatch, { borderColor: chipOnBg, backgroundColor: soft }]}
        onPress={() => {
          if (selected && stockQty <= 0) {
            alert(
              'Brak produktu na stanie',
              'Nie ma już tego produktu w magazynie. Najpierw dodaj go na stan.',
              [{ text: 'OK', style: 'primary' }],
            );
            return;
          }
          setBatches([...batches, { key: newKey(), quantity: '', expiration_date: '' }]);
        }}
        activeOpacity={0.85}
      >
        <Plus size={14} color={CHIP_ON_TEXT} strokeWidth={2.5} />
        <Text style={[styles.addBatchText, { color: CHIP_ON_TEXT }]} numberOfLines={2}>
          Produkt ma różne daty ważności
        </Text>
      </TouchableOpacity>

      {selected && stockQty > 0 && batchSum > stockQty + 0.001 ? (
        <Text style={[styles.warn, { color: Colors.danger }]}>
          Suma partii ({batchSum}) przekracza stan ({stockQty}). Zmniejsz ilości.
        </Text>
      ) : selected && stockQty > 0 && Math.abs(batchSum - stockQty) > 0.01 && batchSum > 0 ? (
        <Text style={[styles.warn, { color: Colors.danger }]}>
          Suma partii ({batchSum}) ≠ stan ({stockQty}). Dopasuj ilości.
        </Text>
      ) : null}

      <View style={styles.alertHead}>
        <Bell size={14} color={accent} strokeWidth={2.2} />
        <Text style={[styles.section, { color: text, marginTop: 0, marginBottom: 0 }]}>
          Przypomnij mi
        </Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {ALERT_PRESETS.map((day) => {
          const on = alertDays.includes(day);
          return (
            <TouchableOpacity
              key={day}
              style={[
                styles.chip,
                {
                  borderColor: on ? chipOnBg : border,
                  backgroundColor: on
                    ? chipOnBg
                    : theme.isPremium
                      ? DS.color.bgTertiary
                      : Colors.card,
                },
              ]}
              onPress={() => toggleAlert(day)}
              activeOpacity={0.8}
            >
              <Text
                style={[styles.chipText, { color: on ? CHIP_ON_TEXT : muted }]}
                numberOfLines={1}
              >
                {day} dni
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </Card>
  );
}

const styles = StyleSheet.create({
  field: { marginBottom: 10 },
  label: { fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  hint: { fontSize: 11, marginTop: 6, lineHeight: 15 },
  suggestBox: {
    marginTop: 6,
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(128,128,128,0.25)',
  },
  suggestName: { fontSize: 13, fontWeight: '700' },
  suggestMeta: { fontSize: 11, marginTop: 1 },
  quickBtn: {
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 10,
    justifyContent: 'center',
    minHeight: 44,
  },
  quickText: { fontSize: 12, fontWeight: '800', textAlign: 'center' },
  section: { fontSize: 13, fontWeight: '800', marginTop: 8, marginBottom: 8 },
  batchCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  batchRow: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  batchHint: { fontSize: 10, marginTop: 6 },
  delBtn: { paddingBottom: 10, paddingHorizontal: 4 },
  addBatch: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    marginBottom: 8,
    minHeight: 44,
  },
  addBatchText: { fontSize: 12, fontWeight: '800', flexShrink: 1, textAlign: 'center' },
  warn: { fontSize: 11, fontWeight: '600', marginBottom: 8 },
  alertHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    marginBottom: 8,
  },
  chipRow: { flexDirection: 'row', gap: 8, paddingBottom: 4 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  chipText: { fontSize: 12, fontWeight: '800' },
});
