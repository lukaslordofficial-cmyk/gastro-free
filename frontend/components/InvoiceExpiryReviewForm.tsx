/**
 * Formularz partii dat ważności po skanie faktury.
 * Każdy produkt → N wariantów (ilość + data) + chipy przypomnień 7/3/1…
 *
 * PÓŹNIEJ (Jarvis Mode): floating mic + OpenAI parser uzupełniający batches
 * komendą w stylu „Uzupełnimy Mleko 3,2%. Ilość 5, data 25.07.2026, przypomnij 5 i 3 dni przed”.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Platform,
} from 'react-native';
import {
  Plus,
  Trash2,
  CalendarClock,
  Bell,
  Check,
  Lightbulb,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { formatPln } from '@/lib/format';
import { ExpiryDateField } from '@/components/ExpiryDateField';

export type InvoiceLineIn = {
  product_name: string;
  quantity: number;
  price_netto: number;
  unit: string;
  category: string;
};

export type ExpiryBatchDraft = {
  key: string;
  quantity: string;
  expiration_date: string; // YYYY-MM-DD or DD.MM.YYYY while typing
};

export type ExpiryProductDraft = {
  key: string;
  product_name: string;
  unit: string;
  category: string;
  price_netto: number;
  invoice_quantity: number;
  batches: ExpiryBatchDraft[];
  alert_days: number[];
};

const ALERT_PRESETS = [14, 7, 5, 3, 1] as const;

function newKey() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Normalizuje datę do YYYY-MM-DD; zwraca null jeśli niepoprawna. */
export function normalizeExpiryDate(raw: string): string | null {
  const s = (raw || '').trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/;
  const pl = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/;
  let y: number, m: number, d: number;
  const mIso = s.match(iso);
  if (mIso) {
    y = Number(mIso[1]); m = Number(mIso[2]); d = Number(mIso[3]);
  } else {
    const mPl = s.match(pl);
    if (!mPl) return null;
    d = Number(mPl[1]); m = Number(mPl[2]); y = Number(mPl[3]);
  }
  if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  const dt = new Date(y, m - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function buildExpiryDrafts(products: InvoiceLineIn[]): ExpiryProductDraft[] {
  return products.map((p) => ({
    key: newKey(),
    product_name: p.product_name,
    unit: p.unit || 'szt',
    category: p.category || 'Inne',
    price_netto: Number(p.price_netto) || 0,
    invoice_quantity: Number(p.quantity) || 0,
    batches: [
      {
        key: newKey(),
        quantity: String(p.quantity ?? ''),
        expiration_date: '',
      },
    ],
    alert_days: [7, 3, 1],
  }));
}

export type CommitProduct = InvoiceLineIn & {
  batches: { quantity: number; expiration_date: string }[];
  alert_days: number[];
};

type Props = {
  drafts: ExpiryProductDraft[];
  onChange: (next: ExpiryProductDraft[]) => void;
  totalCost: number;
  onBack: () => void;
  onCommit: (products: CommitProduct[]) => void;
  committing?: boolean;
};

export function InvoiceExpiryReviewForm({
  drafts,
  onChange,
  totalCost,
  onBack,
  onCommit,
  committing,
}: Props) {
  const theme = useAppTheme();
  const [localError, setLocalError] = useState<string | null>(null);

  const c = useMemo(() => {
    if (theme.isPremium) {
      return {
        bg: theme.bg,
        card: theme.card,
        text: theme.text,
        muted: theme.textSecondary,
        tertiary: theme.textMuted,
        accent: theme.accent,
        soft: theme.accentSoft,
        border: theme.border,
        danger: theme.danger,
        warning: theme.warning,
      };
    }
    return {
      bg: Colors.background,
      card: Colors.card,
      text: Colors.textPrimary,
      muted: Colors.textSecondary,
      tertiary: Colors.textTertiary,
      accent: Colors.accent,
      soft: Colors.accentLight,
      border: Colors.border,
      danger: Colors.danger,
      warning: Colors.warning,
    };
  }, [theme]);

  const updateProduct = useCallback(
    (key: string, patch: Partial<ExpiryProductDraft>) => {
      onChange(drafts.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    },
    [drafts, onChange],
  );

  const updateBatch = useCallback(
    (productKey: string, batchKey: string, patch: Partial<ExpiryBatchDraft>) => {
      onChange(
        drafts.map((d) => {
          if (d.key !== productKey) return d;
          return {
            ...d,
            batches: d.batches.map((b) => (b.key === batchKey ? { ...b, ...patch } : b)),
          };
        }),
      );
    },
    [drafts, onChange],
  );

  const addBatch = useCallback(
    (productKey: string) => {
      onChange(
        drafts.map((d) => {
          if (d.key !== productKey) return d;
          return {
            ...d,
            batches: [...d.batches, { key: newKey(), quantity: '', expiration_date: '' }],
          };
        }),
      );
    },
    [drafts, onChange],
  );

  const removeBatch = useCallback(
    (productKey: string, batchKey: string) => {
      onChange(
        drafts.map((d) => {
          if (d.key !== productKey) return d;
          const next = d.batches.filter((b) => b.key !== batchKey);
          return {
            ...d,
            batches: next.length
              ? next
              : [{ key: newKey(), quantity: '', expiration_date: '' }],
          };
        }),
      );
    },
    [drafts, onChange],
  );

  const toggleAlert = useCallback(
    (productKey: string, day: number) => {
      onChange(
        drafts.map((d) => {
          if (d.key !== productKey) return d;
          const has = d.alert_days.includes(day);
          const alert_days = has
            ? d.alert_days.filter((x) => x !== day)
            : [...d.alert_days, day].sort((a, b) => b - a);
          return { ...d, alert_days };
        }),
      );
    },
    [drafts, onChange],
  );

  const handleCommit = useCallback(() => {
    setLocalError(null);
    const out: CommitProduct[] = [];
    for (const d of drafts) {
      const name = d.product_name.trim();
      if (!name) {
        setLocalError('Każdy produkt musi mieć nazwę.');
        return;
      }
      const batches: { quantity: number; expiration_date: string }[] = [];
      let hasPartial = false;
      for (const b of d.batches) {
        const qty = parseFloat(String(b.quantity).replace(',', '.'));
        const dateRaw = b.expiration_date.trim();
        if (!dateRaw && (!Number.isFinite(qty) || qty <= 0)) {
          continue; // pusta partia — pomiń
        }
        if (!dateRaw) {
          // ilość bez daty → pomiń partię (stan i tak z faktury)
          continue;
        }
        const dateNorm = normalizeExpiryDate(b.expiration_date);
        if (!dateNorm) {
          setLocalError(`„${name}”: podaj poprawną datę (RRRR-MM-DD lub DD.MM.RRRR).`);
          return;
        }
        if (!Number.isFinite(qty) || qty <= 0) {
          setLocalError(`„${name}”: ilość partii musi być > 0.`);
          return;
        }
        batches.push({ quantity: qty, expiration_date: dateNorm });
        hasPartial = true;
      }
      void hasPartial;
      const totalQty =
        batches.length > 0
          ? batches.reduce((s, b) => s + b.quantity, 0)
          : d.invoice_quantity;
      out.push({
        product_name: name,
        quantity: totalQty,
        price_netto: d.price_netto,
        unit: d.unit,
        category: d.category,
        batches,
        alert_days: d.alert_days.length ? d.alert_days : [7, 3, 1],
      });
    }
    onCommit(out);
  }, [drafts, onCommit]);

  return (
    <View style={{ flex: 1 }}>
      <View style={[styles.tip, { backgroundColor: c.soft, borderColor: c.accent }]}>
        <Lightbulb size={16} color={c.accent} strokeWidth={2.2} />
        <Text style={[styles.tipText, { color: c.muted }]}>
          Oszczędzaj kredyty: zamiast skanować każdy produkt Vision AI, uzupełnij daty tutaj
          (lub później głosem: „dodaj do twarogu datę ważności 20.08.2026, 4 sztuki”).
          Jedno skanowanie faktury = wszystkie pozycje.
        </Text>
      </View>

      {localError ? (
        <Text style={[styles.error, { color: c.danger }]}>{localError}</Text>
      ) : null}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {drafts.map((p) => {
          const batchSum = p.batches.reduce(
            (s, b) => s + (parseFloat(String(b.quantity).replace(',', '.')) || 0),
            0,
          );
          const mismatch =
            p.invoice_quantity > 0 &&
            batchSum > 0 &&
            Math.abs(batchSum - p.invoice_quantity) > 0.01;

          return (
            <View
              key={p.key}
              style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
            >
              <TextInput
                style={[styles.nameInput, { color: c.text, borderColor: c.border }]}
                value={p.product_name}
                onChangeText={(v) => updateProduct(p.key, { product_name: v })}
                placeholder="Nazwa produktu"
                placeholderTextColor={c.tertiary}
              />
              <Text style={[styles.meta, { color: c.muted }]}>
                Z faktury: {p.invoice_quantity} {p.unit} · {p.category}
                {mismatch ? ` · łącznie w partiach: ${batchSum}` : ''}
              </Text>
              {mismatch ? (
                <Text style={[styles.warn, { color: c.warning }]}>
                  Suma partii różni się od ilości z faktury — to OK, jeśli celowo dzielisz dostawę.
                </Text>
              ) : null}

              <View style={styles.sectionHead}>
                <CalendarClock size={14} color={c.accent} strokeWidth={2.2} />
                <Text style={[styles.sectionTitle, { color: c.text }]}>Partie / daty ważności</Text>
              </View>

              {p.batches.map((b, bi) => (
                <View key={b.key} style={[styles.batchRow, { borderColor: c.border }]}>
                  <View style={styles.batchFields}>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.label, { color: c.muted }]}>Ilość</Text>
                      <TextInput
                        style={[styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.bg }]}
                        value={b.quantity}
                        onChangeText={(v) => updateBatch(p.key, b.key, { quantity: v })}
                        keyboardType="decimal-pad"
                        placeholder="0"
                        placeholderTextColor={c.tertiary}
                      />
                    </View>
                    <View style={{ flex: 1.4 }}>
                      <ExpiryDateField
                        value={normalizeExpiryDate(b.expiration_date) || b.expiration_date}
                        onChange={(iso) => updateBatch(p.key, b.key, { expiration_date: iso })}
                        textColor={c.text}
                        mutedColor={c.muted}
                        borderColor={c.border}
                        bgColor={c.bg}
                        accentColor={c.accent}
                      />
                    </View>
                    <TouchableOpacity
                      onPress={() => removeBatch(p.key, b.key)}
                      style={styles.delBtn}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Trash2 size={16} color={c.danger} strokeWidth={2} />
                    </TouchableOpacity>
                  </View>
                  <Text style={[styles.batchHint, { color: c.tertiary }]}>
                    Wariant {bi + 1} · np. 20.08.2026
                  </Text>
                </View>
              ))}

              <TouchableOpacity
                style={[styles.addBatchBtn, { backgroundColor: c.soft, borderColor: c.accent }]}
                onPress={() => addBatch(p.key)}
                activeOpacity={0.85}
              >
                <Plus size={14} color={c.accent} strokeWidth={2.5} />
                <Text style={[styles.addBatchText, { color: c.accent }]}>
                  Dodaj wariant — produkt ma różne daty ważności
                </Text>
              </TouchableOpacity>

              <View style={styles.sectionHead}>
                <Bell size={14} color={c.accent} strokeWidth={2.2} />
                <Text style={[styles.sectionTitle, { color: c.text }]}>Przypomnij mi</Text>
              </View>
              <View style={styles.chipRow}>
                {ALERT_PRESETS.map((day) => {
                  const on = p.alert_days.includes(day);
                  return (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.chip,
                        {
                          borderColor: on ? c.accent : c.border,
                          backgroundColor: on ? c.accent : c.bg,
                        },
                      ]}
                      onPress={() => toggleAlert(p.key, day)}
                      activeOpacity={0.8}
                    >
                      <Text style={[styles.chipText, { color: on ? '#0A0A0A' : c.muted }]} numberOfLines={1}>
                        {day} dni
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          );
        })}
        <View style={{ height: 24 }} />
      </ScrollView>

      <View style={[styles.footer, { backgroundColor: c.card, borderTopColor: c.border }]}>
        <Text style={[styles.total, { color: c.text }]}>
          Suma faktury: {formatPln(totalCost)}
        </Text>
        <View style={styles.footerBtns}>
          <TouchableOpacity
            style={[styles.backBtn, { borderColor: c.border }]}
            onPress={onBack}
            disabled={committing}
          >
            <Text style={[styles.backText, { color: c.muted }]}>Wstecz</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.commitBtn, { backgroundColor: c.accent, opacity: committing ? 0.7 : 1 }]}
            onPress={handleCommit}
            disabled={committing}
            activeOpacity={0.85}
            testID="invoice-expiry-commit"
          >
            <Check size={17} color={theme.isPremium ? '#0A0A0A' : '#fff'} strokeWidth={2.5} />
            <Text style={[styles.commitText, theme.isPremium && { color: '#0A0A0A' }]}>Zapisz w magazynie</Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tip: {
    flexDirection: 'row',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 6,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  tipText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '500' },
  error: { marginHorizontal: 16, marginBottom: 6, fontSize: 13, fontWeight: '600' },
  scroll: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 16, gap: 12 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
    gap: 10,
    marginBottom: 4,
  },
  nameInput: {
    fontSize: 16,
    fontWeight: '800',
    borderBottomWidth: 1,
    paddingVertical: Platform.OS === 'ios' ? 8 : 4,
  },
  meta: { fontSize: 12, fontWeight: '500' },
  warn: { fontSize: 11, fontWeight: '600' },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  sectionTitle: { fontSize: 13, fontWeight: '800' },
  batchRow: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 10,
    gap: 4,
  },
  batchFields: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  label: { fontSize: 11, fontWeight: '700', marginBottom: 4 },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 14,
    fontWeight: '600',
  },
  delBtn: { paddingBottom: 10, paddingHorizontal: 4 },
  batchHint: { fontSize: 10 },
  addBatchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  addBatchText: { fontSize: 12, fontWeight: '700' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1.5,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  chipText: { fontSize: 12, fontWeight: '700' },
  footer: {
    borderTopWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 20 : 14,
    gap: 10,
  },
  total: { fontSize: 15, fontWeight: '800', textAlign: 'center' },
  footerBtns: { flexDirection: 'row', gap: 10 },
  backBtn: {
    flex: 1,
    borderWidth: 1.5,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  backText: { fontSize: 14, fontWeight: '700' },
  commitBtn: {
    flex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 14,
  },
  commitText: { color: '#fff', fontSize: 14, fontWeight: '800' },
});
