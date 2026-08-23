/**
 * WasteReportModal — ręczne zgłaszanie strat + logi pogrupowane okresami.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ExpandableDateJournal } from '@/components/ExpandableDateJournal';
import { ProduceSizePicker } from '@/components/ProduceSizePicker';
import { Trash2, X, Plus, Check, Search } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { PremiumTokens } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { supabase } from '@/lib/supabase';
import { apiJsonHeaders } from '@/lib/apiHeaders';
import {
  findProduceConverter,
  piecesToKg,
  type ProduceSizeKey,
} from '@/lib/produceSizeConverter';
import { rankProductMatches } from '@/lib/fuzzyProductMatch';

const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ??
  process.env.REACT_APP_BACKEND_URL ??
  '';

type PeriodTab = 'day' | 'week' | 'month' | 'year';

type SuggestItem = {
  id: string;
  name: string;
  kind: 'dish' | 'ingredient';
  unit?: string;
  score?: number;
};

type CatalogRow = { id: string; name: string; unit?: string };

type WasteLogRow = {
  id: string;
  item_name: string;
  quantity: number;
  unit: string;
  reason: string | null;
  created_at: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved?: () => void;
};

const PERIOD_TABS: { key: PeriodTab; label: string }[] = [
  { key: 'day', label: 'Dni' },
  { key: 'week', label: 'Tygodnie' },
  { key: 'month', label: 'Miesiące' },
  { key: 'year', label: 'Lata' },
];

function periodKey(iso: string, tab: PeriodTab): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  if (tab === 'year') return String(y);
  if (tab === 'month') {
    return d.toLocaleDateString('pl-PL', { month: 'long', year: 'numeric' });
  }
  if (tab === 'week') {
    const tmp = new Date(d);
    const dow = (tmp.getDay() + 6) % 7; // Mon=0
    tmp.setDate(tmp.getDate() - dow);
    const end = new Date(tmp);
    end.setDate(tmp.getDate() + 6);
    const fmt = (x: Date) =>
      x.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' });
    return `${fmt(tmp)} – ${fmt(end)} · ${y}`;
  }
  return d.toLocaleDateString('pl-PL', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function formatLogTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('pl-PL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

export function WasteReportModal({ visible, onClose, onSaved }: Props) {
  const theme = useAppTheme();
  const accent = theme.isPremium ? theme.accent : Colors.accent;
  const [mode, setMode] = useState<'list' | 'add'>('list');
  const [period, setPeriod] = useState<PeriodTab>('day');
  const [logs, setLogs] = useState<WasteLogRow[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const [itemType, setItemType] = useState<'dish' | 'ingredient'>('ingredient');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SuggestItem | null>(null);
  const [suggestions, setSuggestions] = useState<SuggestItem[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [quantity, setQuantity] = useState('');
  const [unit, setUnit] = useState('szt');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [produceSize, setProduceSize] = useState<ProduceSizeKey | null>(null);
  const [convertedKg, setConvertedKg] = useState<number | null>(null);
  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);

  const produceConverter = useMemo(() => {
    if (itemType !== 'ingredient') return null;
    return findProduceConverter(selected?.name || query);
  }, [itemType, selected?.name, query]);

  /** Podświetlenie fragmentu nazwy pasującego do zapytania (lub całość przy fuzzy). */
  function renderHighlightedName(name: string, q: string, baseColor: string, hiColor: string) {
    const trimmed = q.trim();
    if (!trimmed) {
      return <Text style={[styles.suggestName, { color: baseColor }]}>{name}</Text>;
    }
    const lower = name.toLowerCase();
    const ql = trimmed.toLowerCase();
    let idx = lower.indexOf(ql);
    let len = trimmed.length;
    if (idx < 0) {
      // odmiana: bataty → batat
      const stem = ql.length >= 4 ? ql.slice(0, Math.max(4, ql.length - 1)) : ql;
      idx = lower.indexOf(stem);
      len = stem.length;
    }
    if (idx < 0) {
      return (
        <Text style={[styles.suggestName, { color: hiColor, fontWeight: '800' }]}>{name}</Text>
      );
    }
    return (
      <Text style={[styles.suggestName, { color: baseColor }]}>
        {name.slice(0, idx)}
        <Text style={{ color: hiColor, fontWeight: '800', backgroundColor: 'rgba(0,200,120,0.18)' }}>
          {name.slice(idx, idx + len)}
        </Text>
        {name.slice(idx + len)}
      </Text>
    );
  }

  const fetchLogs = useCallback(async () => {
    setLoadingLogs(true);
    try {
      const { data, error: err } = await supabase
        .from('waste_logs')
        .select('id, item_name, quantity, unit, reason, created_at')
        .order('created_at', { ascending: false })
        .limit(300);
      if (err) throw err;
      setLogs((data as WasteLogRow[]) ?? []);
    } catch {
      setLogs([]);
    } finally {
      setLoadingLogs(false);
    }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setMode('list');
    setError(null);
    setOkMsg(null);
    void fetchLogs();
  }, [visible, fetchLogs]);

  // Katalog raz przy wejściu w formularz — fuzzy PL (bataty→Batat) lokalnie.
  useEffect(() => {
    if (mode !== 'add') {
      setCatalog([]);
      return;
    }
    let cancelled = false;
    (async () => {
      setCatalogLoading(true);
      try {
        if (itemType === 'ingredient') {
          const { data } = await supabase
            .from('inventory_items')
            .select('id, name, unit')
            .order('name')
            .limit(2000);
          if (!cancelled) {
            setCatalog(
              ((data as any[]) ?? []).map((r) => ({
                id: String(r.id),
                name: String(r.name || ''),
                unit: r.unit || 'szt',
              })),
            );
          }
        } else {
          let { data, error: err } = await supabase
            .from('menu_items')
            .select('id, name')
            .eq('is_active', true)
            .order('name')
            .limit(1000);
          if (err) {
            const retry = await supabase
              .from('menu_items')
              .select('id, name')
              .order('name')
              .limit(1000);
            data = retry.data;
          }
          if (!cancelled) {
            setCatalog(
              ((data as any[]) ?? []).map((r) => ({
                id: String(r.id),
                name: String(r.name || ''),
                unit: 'porcja',
              })),
            );
          }
        }
      } catch {
        if (!cancelled) setCatalog([]);
      } finally {
        if (!cancelled) setCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, itemType]);

  useEffect(() => {
    if (mode !== 'add' || selected) {
      setSuggestions([]);
      return;
    }
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    setSuggestLoading(catalogLoading);
    const ranked = rankProductMatches(q, catalog, (c) => c.name, {
      threshold: 52,
      limit: 8,
    });
    setSuggestions(
      ranked.map(({ item, score }) => ({
        id: item.id,
        name: item.name,
        kind: itemType,
        unit: item.unit || (itemType === 'dish' ? 'porcja' : 'szt'),
        score,
      })),
    );
    setSuggestLoading(false);
  }, [query, itemType, mode, selected, catalog, catalogLoading]);

  const grouped = useMemo(() => {
    const map = new Map<string, WasteLogRow[]>();
    for (const log of logs) {
      const key = periodKey(log.created_at, period);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(log);
    }
    return Array.from(map.entries());
  }, [logs, period]);

  function resetForm() {
    setQuery('');
    setSelected(null);
    setSuggestions([]);
    setQuantity('');
    setUnit(itemType === 'dish' ? 'porcja' : 'szt');
    setReason('');
    setError(null);
    setOkMsg(null);
    setProduceSize(null);
    setConvertedKg(null);
  }

  function pickSuggestion(s: SuggestItem) {
    setSelected(s);
    setQuery(s.name);
    setSuggestions([]);
    setProduceSize(null);
    setConvertedKg(null);
    // Produce often stored in kg but counted as pieces — prefer szt for converter
    if (findProduceConverter(s.name)) {
      setUnit('szt');
    } else if (s.unit) {
      setUnit(s.unit);
    }
  }

  async function handleSave() {
    setError(null);
    setOkMsg(null);
    const name = (selected?.name || query).trim();
    const qty = parseFloat(quantity.replace(',', '.'));
    if (!name) {
      setError('Wpisz nazwę potrawy lub składnika.');
      return;
    }
    if (!selected?.id) {
      setError('Wybierz pozycję z podpowiedzi (po pierwszej literze).');
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Podaj poprawną ilość.');
      return;
    }

    // Size→kg: when user picked visual size for produce in pieces, deduct kg
    let saveQty = qty;
    let saveUnit = unit;
    if (produceConverter && produceSize && (unit === 'szt' || unit === 'op')) {
      const tier = produceConverter.sizes.find((s) => s.key === produceSize);
      if (tier) {
        const conv = piecesToKg(qty, tier);
        saveQty = conv.kg;
        saveUnit = 'kg';
      }
    } else if (produceSize && convertedKg != null && convertedKg > 0) {
      saveQty = convertedKg;
      saveUnit = 'kg';
    }

    setSaving(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/actions/apply`, {
        method: 'POST',
        headers: await apiJsonHeaders(),
        body: JSON.stringify({
          intent: 'waste',
          source: 'manual',
          payload: {
            item_type: itemType,
            item_name: name,
            related_id: selected.id,
            quantity: saveQty,
            unit: saveUnit,
            reason_text: reason.trim() || 'Strata ręczna',
            ...(produceSize
              ? {
                  produce_size: produceSize,
                  produce_pieces: qty,
                  produce_converter_id: produceConverter?.id,
                }
              : {}),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.detail || data.message || `Błąd (${res.status})`);
      }
      const detail =
        data.detail ||
        (produceSize && saveUnit === 'kg'
          ? `Strata zapisana — odjęto ${saveQty} kg (${qty} szt. rozmiar ${produceSize}).`
          : 'Strata zapisana — składniki odjęte z magazynu.');
      setOkMsg(detail);
      resetForm();
      await fetchLogs();
      onSaved?.();
      setTimeout(() => setMode('list'), 500);
    } catch (e: any) {
      setError(e?.message ?? 'Nie udało się zapisać straty.');
    } finally {
      setSaving(false);
    }
  }

  const dishUnits = ['porcja', 'l', 'kg', 'g', 'ml'];
  const ingUnits = ['szt', 'op', 'l', 'ml', 'g', 'kg'];
  const units = itemType === 'dish' ? dishUnits : ingUnits;

  const bg = theme.isPremium ? PremiumTokens.color.bg : Colors.background;
  const card = theme.isPremium ? PremiumTokens.color.card : Colors.card;
  const border = theme.isPremium ? PremiumTokens.color.border : Colors.border;
  const text = theme.isPremium ? PremiumTokens.color.text : Colors.textPrimary;
  const muted = theme.isPremium ? PremiumTokens.color.textMuted : Colors.textSecondary;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: bg }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: text }]}>
              {mode === 'add' ? 'Dodaj stratę' : 'Zgłoś straty'}
            </Text>
            <Text style={[styles.sub, { color: muted }]}>
              {mode === 'add'
                ? 'Potrawa z menu lub składnik z magazynu'
                : `${logs.length} wpisów · sortowanie okresowe`}
            </Text>
          </View>
          <TouchableOpacity style={styles.closeBtn} onPress={onClose} hitSlop={10}>
            <X size={20} color={muted} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {mode === 'list' ? (
          <>
            <View style={styles.toolbar}>
              <TouchableOpacity
                style={[styles.addBtn, { backgroundColor: accent }, theme.isPremium && styles.addBtnGlow]}
                onPress={() => {
                  resetForm();
                  setMode('add');
                }}
                activeOpacity={0.85}
                testID="waste-add-open"
              >
                <Plus size={16} color={theme.isPremium ? '#0F172A' : Colors.white} strokeWidth={2.5} />
                <Text style={[styles.addBtnText, theme.isPremium && { color: '#0F172A' }]}>
                  Dodaj stratę
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
              {loadingLogs ? (
                <ActivityIndicator color={accent} style={{ marginTop: 40 }} />
              ) : logs.length === 0 ? (
                <View style={styles.empty}>
                  <Trash2 size={32} color={muted} strokeWidth={1.5} />
                  <Text style={[styles.emptyTitle, { color: text }]}>Brak logów strat</Text>
                  <Text style={[styles.emptySub, { color: muted }]}>
                    Kliknij „Dodaj stratę”, aby zgłosić wyrzut potrawy lub składnika.
                  </Text>
                </View>
              ) : (
                <ExpandableDateJournal
                  items={logs.map((log) => ({
                    id: log.id,
                    created_at: log.created_at,
                    title: log.item_name,
                    amount: Number(log.quantity),
                    meta: log.reason ? String(log.reason) : undefined,
                    amountLabel: `−${Number(log.quantity) % 1 === 0 ? Number(log.quantity) : Number(log.quantity).toFixed(1)} ${log.unit || ''}`.trim(),
                  }))}
                  emptyText="Brak logów strat"
                  formatAmount={(n) => `−${n % 1 === 0 ? n : n.toFixed(1)}`}
                />
              )}
              <View style={{ height: 40 }} />
            </ScrollView>
          </>
        ) : (
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <ScrollView
              contentContainerStyle={styles.formContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.fieldLabel, { color: muted }]}>Typ</Text>
              <View style={styles.typeRow}>
                {(
                  [
                    { key: 'ingredient' as const, label: 'Składnik z magazynu' },
                    { key: 'dish' as const, label: 'Potrawa z menu' },
                  ] as const
                ).map((t) => {
                  const active = itemType === t.key;
                  return (
                    <TouchableOpacity
                      key={t.key}
                      style={[
                        styles.typePill,
                        { borderColor: border },
                        active && { backgroundColor: accent, borderColor: accent },
                      ]}
                      onPress={() => {
                        setItemType(t.key);
                        setSelected(null);
                        setQuery('');
                        setUnit(t.key === 'dish' ? 'porcja' : 'szt');
                      }}
                      activeOpacity={0.8}
                    >
                      <Text
                        style={[
                          styles.typePillText,
                          { color: active ? (theme.isPremium ? '#0F172A' : Colors.white) : text },
                        ]}
                      >
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.fieldLabel, { color: muted }]}>Nazwa</Text>
              <View style={[styles.inputWrap, { backgroundColor: card, borderColor: border }]}>
                <Search size={16} color={muted} strokeWidth={2} />
                <TextInput
                  style={[styles.input, { color: text }]}
                  value={query}
                  onChangeText={(v) => {
                    setQuery(v);
                    setSelected(null);
                  }}
                  placeholder={itemType === 'dish' ? 'np. Krem z dyni' : 'np. Awokado'}
                  placeholderTextColor={muted}
                  autoCorrect={false}
                  testID="waste-name-input"
                />
              </View>
              {suggestLoading || catalogLoading ? (
                <ActivityIndicator size="small" color={accent} style={{ marginVertical: 8 }} />
              ) : null}
              {!selected && query.trim().length >= 1 && suggestions.length === 0 && !suggestLoading && !catalogLoading ? (
                <Text style={{ color: muted, fontSize: 12, marginTop: 8, fontWeight: '600' }}>
                  Brak pasujących pozycji — dopisz literę lub sprawdź, czy produkt jest w magazynie.
                </Text>
              ) : null}
              {!selected && suggestions.length > 0 && (
                <View
                  style={[
                    styles.suggestBox,
                    {
                      backgroundColor: card,
                      borderColor: accent,
                      borderWidth: 2,
                    },
                  ]}
                >
                  <Text style={[styles.suggestHint, { color: muted }]}>
                    Wybierz pozycję (podświetlone dopasowanie):
                  </Text>
                  {suggestions.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.suggestRow, { borderBottomColor: border }]}
                      onPress={() => pickSuggestion(s)}
                      activeOpacity={0.75}
                      testID={`waste-suggest-${s.id}`}
                    >
                      {renderHighlightedName(s.name, query, text, accent)}
                      <Text style={[styles.suggestMeta, { color: muted }]}>
                        {s.kind === 'dish' ? 'menu' : 'magazyn'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              {selected ? (
                <View style={[styles.selectedBanner, { backgroundColor: theme.isPremium ? PremiumTokens.color.neonSoft : Colors.accentLight }]}>
                  <Check size={14} color={accent} strokeWidth={2.5} />
                  <Text style={[styles.selectedText, { color: accent }]}>
                    Wybrano: {selected.name}
                  </Text>
                  <TouchableOpacity
                    onPress={() => {
                      setSelected(null);
                    }}
                    hitSlop={8}
                    style={{ marginLeft: 'auto' }}
                  >
                    <Text style={{ color: muted, fontSize: 12, fontWeight: '700' }}>Zmień</Text>
                  </TouchableOpacity>
                </View>
              ) : null}

              <View style={styles.qtyRow}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: muted }]}>Ilość</Text>
                  <TextInput
                    style={[styles.inputSolo, { backgroundColor: card, borderColor: border, color: text }]}
                    value={quantity}
                    onChangeText={(v) => {
                      setQuantity(v);
                      if (produceConverter && produceSize) {
                        const tier = produceConverter.sizes.find((s) => s.key === produceSize);
                        const pcs = parseFloat(v.replace(',', '.'));
                        if (tier && Number.isFinite(pcs) && pcs > 0) {
                          setConvertedKg(piecesToKg(pcs, tier).kg);
                        }
                      }
                    }}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={muted}
                    testID="waste-qty-input"
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.fieldLabel, { color: muted }]}>Jednostka</Text>
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.unitRow}>
                    {units.map((u) => {
                      const active = unit === u;
                      return (
                        <TouchableOpacity
                          key={u}
                          style={[
                            styles.unitPill,
                            { borderColor: border },
                            active && { backgroundColor: accent, borderColor: accent },
                          ]}
                          onPress={() => setUnit(u)}
                        >
                          <Text
                            style={{
                              fontSize: 12,
                              fontWeight: '700',
                              color: active ? (theme.isPremium ? '#0F172A' : Colors.white) : text,
                            }}
                          >
                            {u}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>

              {produceConverter && (unit === 'szt' || unit === 'op' || unit === 'kg') ? (
                <ProduceSizePicker
                  converter={produceConverter}
                  pieceCount={parseFloat(quantity.replace(',', '.')) || 0}
                  selectedSize={produceSize}
                  onSelectSize={(size, tier, kg) => {
                    setProduceSize(size);
                    setConvertedKg(kg);
                    setUnit('szt');
                  }}
                />
              ) : null}
              {produceConverter && (unit === 'szt' || unit === 'op') && !produceSize ? (
                <Text style={[styles.hint, { color: theme.isPremium ? PremiumTokens.color.warning : Colors.warning, marginTop: 8 }]}>
                  Wybierz rozmiar S/M/L, żeby odjąć kilogramy z magazynu (np. 4×L marchewki = 1 kg).
                </Text>
              ) : null}

              <Text style={[styles.fieldLabel, { color: muted }]}>Powód (opcjonalnie)</Text>
              <TextInput
                style={[
                  styles.inputSolo,
                  styles.reasonInput,
                  { backgroundColor: card, borderColor: border, color: text },
                ]}
                value={reason}
                onChangeText={setReason}
                placeholder="np. zepsute, pomyłka kuchni"
                placeholderTextColor={muted}
                multiline
              />

              <Text style={[styles.hint, { color: muted }]}>
                Po zapisaniu system automatycznie odejmie składniki z magazynu
                {itemType === 'dish' ? ' według receptury potrawy' : ''}.
              </Text>

              {error ? (
                <View style={[styles.msgBox, { backgroundColor: theme.isPremium ? PremiumTokens.color.alertSoft : Colors.dangerLight }]}>
                  <Text style={{ color: theme.isPremium ? PremiumTokens.color.alert : Colors.danger, fontSize: 13 }}>
                    {error}
                  </Text>
                </View>
              ) : null}
              {okMsg ? (
                <View style={[styles.msgBox, { backgroundColor: theme.isPremium ? PremiumTokens.color.neonSoft : Colors.successLight }]}>
                  <Text style={{ color: accent, fontSize: 13 }}>{okMsg}</Text>
                </View>
              ) : null}

              <View style={styles.formActions}>
                <TouchableOpacity
                  style={[styles.secondaryBtn, { borderColor: border }]}
                  onPress={() => {
                    resetForm();
                    setMode('list');
                  }}
                >
                  <Text style={{ color: muted, fontWeight: '700', fontSize: 13 }}>Anuluj</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.primaryBtn,
                    { backgroundColor: accent },
                    theme.isPremium && styles.addBtnGlow,
                    saving && { opacity: 0.6 },
                  ]}
                  onPress={handleSave}
                  disabled={saving}
                  activeOpacity={0.85}
                  testID="waste-save"
                >
                  {saving ? (
                    <ActivityIndicator color={theme.isPremium ? '#0F172A' : Colors.white} />
                  ) : (
                    <>
                      <Check size={16} color={theme.isPremium ? '#0F172A' : Colors.white} strokeWidth={2.5} />
                      <Text style={[styles.primaryBtnText, theme.isPremium && { color: '#0F172A' }]}>
                        Zapisz stratę
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
              <View style={{ height: 48 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: PremiumTokens.space.screen,
    paddingVertical: PremiumTokens.space.md,
    borderBottomWidth: 1,
    gap: 12,
  },
  title: { fontSize: 22, fontWeight: '700', letterSpacing: -0.3 },
  sub: { fontSize: 13, marginTop: 4 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbar: {
    paddingHorizontal: PremiumTokens.space.screen,
    paddingTop: PremiumTokens.space.md,
    paddingBottom: PremiumTokens.space.sm,
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: PremiumTokens.radius.lg,
  },
  addBtnGlow: {
    shadowColor: '#00FF88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
  addBtnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },
  periodRow: {
    flexDirection: 'row',
    marginHorizontal: PremiumTokens.space.screen,
    borderRadius: PremiumTokens.radius.md,
    padding: 4,
    gap: 4,
    marginBottom: PremiumTokens.space.md,
  },
  periodTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  periodTabText: { fontSize: 12, fontWeight: '700' },
  listContent: {
    paddingHorizontal: PremiumTokens.space.screen,
    paddingBottom: 24,
  },
  group: { marginBottom: PremiumTokens.space.lg },
  groupLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'capitalize',
    marginBottom: 10,
  },
  logCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: PremiumTokens.radius.xl,
    borderWidth: 1,
    padding: PremiumTokens.space.cardPad,
    marginBottom: 12,
    gap: 12,
  },
  logName: { fontSize: 16, fontWeight: '600' },
  logReason: { fontSize: 13, marginTop: 4 },
  logDate: { fontSize: 12, marginTop: 6 },
  logQty: { fontSize: 15, fontWeight: '700' },
  empty: { alignItems: 'center', paddingVertical: 56, gap: 10 },
  emptyTitle: { fontSize: 17, fontWeight: '700' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 19, paddingHorizontal: 24 },
  formContent: {
    paddingHorizontal: PremiumTokens.space.screen,
    paddingTop: PremiumTokens.space.md,
  },
  fieldLabel: { fontSize: 13, fontWeight: '600', marginBottom: 8, marginTop: 12 },
  typeRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  typePill: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: PremiumTokens.radius.pill,
    borderWidth: 1,
  },
  typePillText: { fontSize: 12, fontWeight: '700' },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: PremiumTokens.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  input: { flex: 1, fontSize: 15, fontWeight: '500', padding: 0 },
  inputSolo: {
    borderWidth: 1,
    borderRadius: PremiumTokens.radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontWeight: '500',
  },
  reasonInput: { minHeight: 72, textAlignVertical: 'top' },
  suggestBox: {
    borderWidth: 1,
    borderRadius: PremiumTokens.radius.md,
    marginTop: 8,
    overflow: 'hidden',
  },
  suggestHint: {
    fontSize: 11,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 4,
    letterSpacing: 0.2,
  },
  suggestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  suggestName: { fontSize: 14, fontWeight: '600', flex: 1 },
  suggestMeta: { fontSize: 11, fontWeight: '600', marginLeft: 8 },
  selectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
  },
  selectedText: { fontSize: 13, fontWeight: '700', flexShrink: 1 },
  qtyRow: { flexDirection: 'row', gap: 12, marginTop: 4 },
  unitRow: { gap: 6, paddingVertical: 4 },
  unitPill: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  hint: { fontSize: 13, lineHeight: 19, marginTop: 16 },
  msgBox: { marginTop: 12, padding: 12, borderRadius: 14 },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 20 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderRadius: PremiumTokens.radius.lg,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtn: {
    flex: 1.4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: PremiumTokens.radius.lg,
    paddingVertical: 14,
  },
  primaryBtnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },
});
