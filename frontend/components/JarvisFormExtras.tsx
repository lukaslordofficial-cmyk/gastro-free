/**
 * Dodatkowe formularze Jarvis (legenda / review) — dark premium.
 */
import React, { useEffect, useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { Check, Plus, X, Upload } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { getAccountKey } from '@/lib/accountKey';
import { DS } from '@/constants/premiumTheme';
import { bestProductMatch, rankCatalogForTyping, rankProductMatches } from '@/lib/fuzzyProductMatch';
import { inventoryDisplayName } from '@/lib/inventoryLabel';
import {
  type DealHunterSearchScope,
  DEAL_HUNTER_SEARCH_SCOPE_OPTIONS,
  DEFAULT_DEAL_HUNTER_SEARCH_SCOPE,
} from '@/lib/dealHunterSearchScope';

const GREEN = DS.color.greenEnd;
const CTA_TEXT = '#0A0A0A';

type Patch = (p: Record<string, any>) => void;

function SearchScopePicker({
  value,
  onChange,
}: {
  value?: string | null;
  onChange: (v: DealHunterSearchScope) => void;
}) {
  const current = (value || DEFAULT_DEAL_HUNTER_SEARCH_SCOPE) as DealHunterSearchScope;
  return (
    <View style={{ marginTop: 10, marginBottom: 4 }}>
      <Text style={styles.label}>Gdzie szukać ofert?</Text>
      <View style={styles.pillRow}>
        {DEAL_HUNTER_SEARCH_SCOPE_OPTIONS.map((o) => {
          const on = current === o.key;
          return (
            <TouchableOpacity
              key={o.key}
              style={[styles.pill, on && styles.pillOn]}
              onPress={() => onChange(o.key)}
              testID={`voice-search-scope-${o.key}`}
            >
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export function JarvisSuggestBox({
  query,
  onChangeQuery,
  suggestions,
  loading,
  onPick,
  placeholder,
  accepted,
  testID,
}: {
  query: string;
  onChangeQuery: (v: string) => void;
  suggestions: { id?: string; name: string; hint?: string }[];
  loading?: boolean;
  onPick: (s: { id?: string; name: string }) => void;
  placeholder?: string;
  accepted?: boolean;
  testID?: string;
}) {
  return (
    <View>
      <TextInput
        style={[
          styles.input,
          accepted && { borderColor: GREEN, backgroundColor: 'rgba(0,255,120,0.08)' },
        ]}
        value={query}
        onChangeText={onChangeQuery}
        placeholder={placeholder}
        placeholderTextColor="#777"
        testID={testID}
      />
      {loading ? <ActivityIndicator color={GREEN} style={{ marginTop: 8 }} /> : null}
      {!accepted && suggestions.length > 0 ? (
        <View style={styles.suggestBox}>
          {suggestions.map((s) => (
            <TouchableOpacity
              key={`${s.id || s.name}`}
              style={styles.suggestRow}
              onPress={() => onPick(s)}
              activeOpacity={0.75}
            >
              <Text style={styles.suggestName}>{s.name}</Text>
              {s.hint ? <Text style={styles.suggestHint}>{s.hint}</Text> : null}
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function NavigateScreenEditor({
  edited,
  patch,
}: {
  edited: Record<string, any>;
  patch: Patch;
}) {
  const tabs: { key: string; label: string }[] = [
    { key: 'index', label: 'Start' },
    { key: 'menu', label: 'Menu' },
    { key: 'magazyn', label: 'Magazyn' },
    { key: 'dostawcy', label: 'Dostawcy' },
    { key: 'ustawienia', label: 'Ustawienia' },
  ];
  return (
    <View style={styles.card}>
      <Text style={styles.hint}>Wybierz zakładkę do otwarcia:</Text>
      <View style={styles.pillRow}>
        {tabs.map((t) => {
          const on = edited.screen === t.key;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.pill, on && styles.pillOn]}
              onPress={() => patch({ screen: t.key })}
              activeOpacity={0.8}
            >
              {on ? <Check size={12} color={CTA_TEXT} strokeWidth={3} /> : null}
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export function BulkPriceEditor({
  edited,
  patch,
  menuCategories,
}: {
  edited: Record<string, any>;
  patch: Patch;
  menuCategories: string[];
}) {
  const mode = edited.price_mode === 'fixed' ? 'fixed' : 'percent';
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Tryb zmiany</Text>
      <View style={styles.pillRow}>
        {[
          { key: 'percent', label: 'o %' },
          { key: 'fixed', label: 'o zł' },
        ].map((m) => {
          const on = mode === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              style={[styles.pill, on && styles.pillOn]}
              onPress={() => patch({ price_mode: m.key })}
            >
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{m.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.label, { marginTop: 10 }]}>Kierunek</Text>
      <View style={styles.pillRow}>
        {[
          { key: 'increase', label: 'Podnieś' },
          { key: 'decrease', label: 'Obniż' },
        ].map((m) => {
          const on = (edited.action || 'increase') === m.key;
          return (
            <TouchableOpacity
              key={m.key}
              style={[styles.pill, on && styles.pillOn]}
              onPress={() => patch({ action: m.key })}
            >
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{m.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {mode === 'percent' ? (
        <View style={{ marginTop: 10 }}>
          <Text style={styles.label}>Procent (%)</Text>
          <TextInput
            style={styles.input}
            value={edited.percentage == null ? '' : String(edited.percentage)}
            onChangeText={(v) => patch({ percentage: v === '' ? null : Number(v.replace(',', '.')) })}
            keyboardType="decimal-pad"
            placeholder="np. 10"
            placeholderTextColor="#777"
          />
        </View>
      ) : (
        <View style={{ marginTop: 10 }}>
          <Text style={styles.label}>Kwota (zł)</Text>
          <TextInput
            style={styles.input}
            value={edited.amount == null ? '' : String(edited.amount)}
            onChangeText={(v) => patch({ amount: v === '' ? null : Number(v.replace(',', '.')) })}
            keyboardType="decimal-pad"
            placeholder="np. 2.50"
            placeholderTextColor="#777"
          />
        </View>
      )}
      <Text style={[styles.label, { marginTop: 12 }]}>Kategoria menu (opcjonalnie)</Text>
      <View style={styles.pillRow}>
        <TouchableOpacity
          style={[styles.pill, !(edited.category || '').trim() && styles.pillOn]}
          onPress={() => patch({ category: '' })}
        >
          <Text style={[styles.pillText, !(edited.category || '').trim() && styles.pillTextOn]}>
            Wszystkie
          </Text>
        </TouchableOpacity>
        {menuCategories.map((c) => {
          const on = (edited.category || '').toLowerCase() === c.toLowerCase();
          return (
            <TouchableOpacity
              key={c}
              style={[styles.pill, on && styles.pillOn]}
              onPress={() => patch({ category: c })}
            >
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{c}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export function MenuCategorySuggest({
  value,
  onChange,
  categories,
}: {
  value: string;
  onChange: (v: string) => void;
  categories: string[];
}) {
  const q = (value || '').trim().toLowerCase();
  const hits = !q
    ? categories.slice(0, 8)
    : categories.filter((c) => c.toLowerCase().includes(q)).slice(0, 8);
  return (
    <View>
      <Text style={styles.label}>Kategoria menu</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder="np. Sałatki"
        placeholderTextColor="#777"
      />
      {hits.length > 0 ? (
        <View style={styles.suggestBox}>
          {hits.map((c) => (
            <TouchableOpacity key={c} style={styles.suggestRow} onPress={() => onChange(c)}>
              <Text style={styles.suggestName}>{c}</Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function IngredientNameSuggest({
  value,
  onChange,
  onPickUnit,
  onPickItem,
}: {
  value: string;
  onChange: (v: string) => void;
  onPickUnit?: (unit: string) => void;
  /** Gdy użytkownik wybierze podpowiedź — pełny rekord (id + nazwa + odmiana). */
  onPickItem?: (item: {
    id: string;
    name: string;
    unit?: string;
    variant?: string | null;
    label?: string;
  }) => void;
}) {
  const [catalog, setCatalog] = useState<
    { id: string; name: string; unit?: string; variant?: string | null; label: string }[]
  >([]);
  const [suggestions, setSuggestions] = useState<
    { id: string; name: string; unit?: string; variant?: string | null; label: string }[]
  >([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let { data, error } = await supabase
          .from('inventory_items')
          .select('id, name, variant, unit')
          .eq('is_active', true)
          .order('name')
          .limit(2000);
        if (error && /variant/i.test(error.message ?? '')) {
          const retry = await supabase
            .from('inventory_items')
            .select('id, name, unit')
            .eq('is_active', true)
            .order('name')
            .limit(2000);
          data = retry.data;
        }
        if (!cancelled) {
          const rows = ((data as any[]) ?? []).map((r) => {
            const name = String(r.name || '');
            const variant = r.variant != null && String(r.variant).trim() ? String(r.variant).trim() : null;
            return {
              id: String(r.id),
              name,
              variant,
              unit: r.unit ? String(r.unit) : undefined,
              label: inventoryDisplayName(name, variant),
            };
          }).filter((row) => row.name.trim());
          setCatalog(rows);
        }
      } catch {
        if (!cancelled) setCatalog([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const q = value.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      const ranked = rankCatalogForTyping(
        q,
        catalog,
        (c) => `${c.name} ${c.variant || ''} ${c.label}`,
        { limit: 10 },
      );
      setSuggestions(ranked.map((r) => r.item));
      setLoading(false);
    }, 80);
    return () => clearTimeout(t);
  }, [value, catalog]);

  return (
    <JarvisSuggestBox
      query={value}
      onChangeQuery={onChange}
      suggestions={suggestions.map((s) => ({
        id: s.id,
        name: s.label,
        hint: s.variant
          ? `odmiana · ${s.variant}${s.unit ? ` · ${s.unit}` : ''}`
          : s.unit
            ? `magazyn · ${s.unit}`
            : 'magazyn',
      }))}
      loading={loading}
      placeholder="Nazwa składnika z magazynu"
      onPick={(s) => {
        const hit = suggestions.find((x) => x.id === s.id) || suggestions.find((x) => x.label === s.name);
        const label = hit?.label || s.name;
        onChange(label);
        if (hit?.unit && onPickUnit) onPickUnit(hit.unit);
        if (hit && onPickItem) {
          onPickItem({
            id: hit.id,
            name: hit.name,
            unit: hit.unit,
            variant: hit.variant,
            label: hit.label,
          });
        }
      }}
    />
  );
}

export function DishPickEditor({
  edited,
  patch,
  priceField,
  title,
}: {
  edited: Record<string, any>;
  patch: Patch;
  priceField?: boolean;
  title: string;
}) {
  const seedName = String(edited.dish_name_resolved || edited.dish_name || '');
  const [query, setQuery] = useState(seedName);
  const [suggestions, setSuggestions] = useState<{ id: string; name: string; price_pln?: number }[]>([]);
  const [loading, setLoading] = useState(false);
  const accepted = edited.dish_accepted === true && !!edited.dish_id;
  const didFuzzyPrefill = React.useRef(false);

  // Prefill: wyszukaj w menu najbardziej podobną nazwę do tego, co użytkownik wymienił.
  useEffect(() => {
    if (accepted || didFuzzyPrefill.current) return;
    const seed = String(edited.dish_name_resolved || edited.dish_name || '').trim();
    if (seed.length < 2) return;
    let cancelled = false;
    void (async () => {
      try {
        let { data, error } = await supabase
          .from('menu_items')
          .select('id, name, price_pln')
          .eq('is_active', true)
          .limit(2000);
        if (error) {
          const retry = await supabase
            .from('menu_items')
            .select('id, name, price_pln')
            .limit(2000);
          data = retry.data;
        }
        const rows = (data as { id: string; name: string; price_pln?: number }[]) ?? [];
        if (!rows.length || cancelled) return;
        const best = bestProductMatch(seed, rows, (r) => r.name, 58);
        if (!best) {
          setQuery(seed);
          return;
        }
        didFuzzyPrefill.current = true;
        setQuery(best.item.name);
        patch({
          dish_name: best.item.name,
          dish_name_resolved: best.item.name,
          dish_id: null,
          dish_accepted: false,
        });
        const ranked = rankProductMatches(seed, rows, (r) => r.name, { threshold: 50, limit: 8 });
        setSuggestions(ranked.map((r) => r.item));
      } catch {
        if (!cancelled) setQuery(seed);
      }
    })();
    return () => {
      cancelled = true;
    };
    // tylko przy nowym seedzie z głosu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edited.dish_name, edited.dish_name_resolved, accepted]);

  useEffect(() => {
    if (accepted) {
      setSuggestions([]);
      return;
    }
    const q = query.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        let { data, error } = await supabase
          .from('menu_items')
          .select('id, name, price_pln')
          .eq('is_active', true)
          .limit(2000);
        if (error) {
          const retry = await supabase
            .from('menu_items')
            .select('id, name, price_pln')
            .limit(2000);
          data = retry.data;
        }
        const rows = (data as { id: string; name: string; price_pln?: number }[]) ?? [];
        const ranked = rankProductMatches(q, rows, (r) => r.name, { threshold: 45, limit: 8 });
        if (!cancelled) {
          if (ranked.length) setSuggestions(ranked.map((r) => r.item));
          else {
            const { data: ilike } = await supabase
              .from('menu_items')
              .select('id, name, price_pln')
              .ilike('name', `%${q}%`)
              .limit(8);
            setSuggestions((ilike as any[]) ?? []);
          }
        }
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, accepted]);

  return (
    <View style={styles.card}>
      <Text style={styles.hint}>{title}</Text>
      <Text style={styles.label}>Danie z menu</Text>
      <JarvisSuggestBox
        query={query}
        accepted={accepted}
        loading={loading}
        placeholder="Wpisz i wybierz z listy"
        suggestions={suggestions.map((s) => ({
          id: s.id,
          name: s.name,
          hint: s.price_pln != null ? `${s.price_pln} zł` : undefined,
        }))}
        onChangeQuery={(v) => {
          didFuzzyPrefill.current = true;
          setQuery(v);
          patch({
            dish_name: v,
            dish_name_resolved: v,
            dish_id: null,
            dish_accepted: false,
          });
        }}
        onPick={(s) => {
          setQuery(s.name);
          patch({
            dish_name: s.name,
            dish_name_resolved: s.name,
            dish_id: s.id,
            dish_accepted: true,
          });
        }}
      />
      {accepted ? (
        <Text style={styles.okHint}>Wybrane: {edited.dish_name_resolved || edited.dish_name}</Text>
      ) : (
        <Text style={styles.warnHint}>Kliknij propozycję z listy — samo wpisanie nie wystarczy.</Text>
      )}
      {priceField ? (
        <View style={{ marginTop: 12 }}>
          <Text style={styles.label}>Nowa cena (PLN)</Text>
          <TextInput
            style={styles.input}
            value={edited.new_price == null ? '' : String(edited.new_price)}
            onChangeText={(v) => patch({ new_price: v === '' ? null : Number(v.replace(',', '.')) })}
            keyboardType="decimal-pad"
            placeholder="0.00"
            placeholderTextColor="#777"
          />
        </View>
      ) : null}
    </View>
  );
}

export function OrderProductEditor({
  edited,
  patch,
}: {
  edited: Record<string, any>;
  patch: Patch;
}) {
  const items: any[] = Array.isArray(edited.items) ? edited.items : [];
  const update = (idx: number, changes: Record<string, any>) => {
    patch({ items: items.map((it, i) => (i === idx ? { ...it, ...changes } : it)) });
  };
  return (
    <View style={styles.card}>
      <Text style={styles.hint}>
        Wpisz produkty do zamówienia. Po literkach pojawią się propozycje z magazynu — możesz też zostawić
        wpisaną nazwę. Łowca Okazji znajdzie oferty w wybranym zakresie (hurtownicy / lokalni / oba).
      </Text>
      <SearchScopePicker
        value={edited.search_scope}
        onChange={(v) => patch({ search_scope: v })}
      />
      {items.map((it, idx) => (
        <OrderLine
          key={idx}
          item={it}
          onChange={(c) => update(idx, c)}
          onRemove={() => patch({ items: items.filter((_, i) => i !== idx) })}
        />
      ))}
      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => patch({ items: [...items, { product_name: '', quantity: 1, unit: 'szt' }] })}
      >
        <Plus size={14} color={CTA_TEXT} strokeWidth={2.5} />
        <Text style={styles.addBtnText}>Dodaj produkt</Text>
      </TouchableOpacity>
    </View>
  );
}

function OrderLine({
  item,
  onChange,
  onRemove,
}: {
  item: any;
  onChange: (c: Record<string, any>) => void;
  onRemove: () => void;
}) {
  const [suggestions, setSuggestions] = useState<{
    id: string;
    name: string;
    unit?: string;
    unit_weight_volume?: number | null;
    weight_volume_unit?: string | null;
  }[]>([]);
  const [loading, setLoading] = useState(false);
  const [accepted, setAccepted] = useState(!!item?.inventory_id);
  const name = String(item.product_name || '');
  const unitStr = String(item.unit || '').trim().toLowerCase();
  const isPieces = /^(szt|sztuka|sztuki|szt\.)$/i.test(unitStr);

  useEffect(() => {
    const q = name.trim();
    if (q.length < 1 || accepted) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        let { data, error } = await supabase
          .from('inventory_items')
          .select('id, name, unit, unit_weight_volume, weight_volume_unit')
          .eq('is_active', true)
          .ilike('name', `%${q}%`)
          .order('name')
          .limit(20);
        if (error && /unit_weight_volume|weight_volume_unit|is_active/.test(error.message ?? '')) {
          const retry = await supabase
            .from('inventory_items')
            .select('id, name, unit')
            .ilike('name', `%${q}%`)
            .order('name')
            .limit(20);
          data = retry.data;
        }
        const seen = new Set<string>();
        const deduped = ((data as any[]) ?? []).filter((row) => {
          const k = String(row.name || '')
            .trim()
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '');
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        }).slice(0, 8);
        if (!cancelled) setSuggestions(deduped);
      } catch {
        if (!cancelled) setSuggestions([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [name, accepted]);

  return (
    <View style={styles.ingCard}>
      <View style={styles.ingHead}>
        <Text style={styles.label}>Produkt</Text>
        <TouchableOpacity onPress={onRemove} hitSlop={8}>
          <X size={14} color="#F87171" strokeWidth={2.5} />
        </TouchableOpacity>
      </View>
      <JarvisSuggestBox
        query={name}
        loading={loading}
        accepted={accepted}
        placeholder="np. Bakłażan"
        suggestions={suggestions.map((s) => ({
          id: s.id,
          name: s.name,
          hint: s.unit || undefined,
        }))}
        onChangeQuery={(v) => {
          setAccepted(false);
          onChange({ product_name: v, inventory_id: null });
        }}
        onPick={(s) => {
          const hit = suggestions.find((x) => x.name === s.name || x.id === s.id);
          setAccepted(true);
          setSuggestions([]);
          onChange({
            product_name: s.name,
            inventory_id: hit?.id || s.id || null,
            unit: hit?.unit || item.unit || 'szt',
            unit_weight_volume: hit?.unit_weight_volume ?? item.unit_weight_volume ?? null,
            weight_volume_unit: hit?.weight_volume_unit ?? item.weight_volume_unit ?? null,
          });
        }}
      />
      <View style={styles.twoCol}>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Ilość</Text>
          <TextInput
            style={styles.input}
            value={item.quantity == null || item.quantity === '' ? '' : String(item.quantity)}
            onChangeText={(v) => onChange({ quantity: v === '' ? null : Number(v.replace(',', '.')) })}
            keyboardType="decimal-pad"
            placeholder="opt."
            placeholderTextColor="#777"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Jednostka</Text>
          <TextInput
            style={styles.input}
            value={item.unit || ''}
            onChangeText={(v) => onChange({ unit: v })}
            placeholder="szt"
            placeholderTextColor="#777"
          />
        </View>
      </View>
      {isPieces ? (
        <View style={{ marginTop: 8 }}>
          <Text style={styles.label}>Gramatura 1 sztuki</Text>
          <View style={styles.twoCol}>
            <View style={{ flex: 1 }}>
              <TextInput
                style={styles.input}
                value={
                  item.unit_weight_volume == null || item.unit_weight_volume === ''
                    ? ''
                    : String(item.unit_weight_volume)
                }
                onChangeText={(v) =>
                  onChange({
                    unit_weight_volume: v === '' ? null : Number(v.replace(',', '.')),
                  })
                }
                keyboardType="decimal-pad"
                placeholder="np. 200"
                placeholderTextColor="#777"
                testID="voice-order-piece-mass"
              />
            </View>
            <View style={{ flex: 1 }}>
              <TextInput
                style={styles.input}
                value={item.weight_volume_unit || 'g'}
                onChangeText={(v) => onChange({ weight_volume_unit: v })}
                placeholder="g"
                placeholderTextColor="#777"
              />
            </View>
          </View>
          <Text style={[styles.hint, { marginTop: 4, marginBottom: 0 }]}>
            Łowca szuka opakowań dostawcy o zbliżonej masie.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

export function CriticalOrderEditor({
  edited,
  patch,
  categories,
}: {
  edited: Record<string, any>;
  patch: Patch;
  categories: { id: string; name: string }[];
}) {
  const selected: string[] = Array.isArray(edited.categories) ? edited.categories : [];
  const items: any[] = Array.isArray(edited.items) ? edited.items : [];
  const allOn = selected.includes('all');
  const target = edited.stock_target === 'optimal' ? 'optimal' : 'critical';
  const objective = String(edited.cart_objective || '').trim() || null;
  const objectives: { key: string; label: string }[] = [
    { key: 'fast_delivery', label: 'szybki czas dostawy' },
    { key: 'min_deliveries', label: 'minimalna liczba dostaw' },
    { key: 'lowest_price', label: 'najniższa cena' },
  ];

  const toggle = (name: string) => {
    if (name === 'all') {
      patch({ categories: allOn ? [] : ['all'] });
      return;
    }
    const lower = name.toLowerCase();
    let next = selected.filter((x) => x !== 'all');
    if (next.some((x) => x.toLowerCase() === lower)) {
      next = next.filter((x) => x.toLowerCase() !== lower);
    } else {
      next = [...next, name];
    }
    patch({ categories: next });
  };

  const updateItem = (idx: number, changes: Record<string, unknown>) => {
    patch({
      items: items.map((it, i) => (i === idx ? { ...it, ...changes } : it)),
    });
  };

  return (
    <View style={styles.card}>
      <Text style={styles.hint}>
        Zaznacz kategorie braków (np. Warzywa) i/lub dodaj konkretne produkty z nazwy
        (np. ser kozi). Po zatwierdzeniu Łowca Okazji, zbuduje dla Ciebie koszyk zakupowy.
      </Text>
      <SearchScopePicker
        value={edited.search_scope}
        onChange={(v) => patch({ search_scope: v })}
      />
      <Text style={styles.label}>Kategorie braków</Text>
      <View style={styles.pillRow}>
        <TouchableOpacity style={[styles.pill, allOn && styles.pillOn]} onPress={() => toggle('all')}>
          <Text style={[styles.pillText, allOn && styles.pillTextOn]}>Wszystkie</Text>
        </TouchableOpacity>
        {categories.map((c) => {
          const on = !allOn && selected.some((x) => x.toLowerCase() === c.name.toLowerCase());
          return (
            <TouchableOpacity
              key={c.id}
              style={[styles.pill, on && styles.pillOn]}
              onPress={() => toggle(c.name)}
            >
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{c.name}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <Text style={[styles.label, { marginTop: 12 }]}>Zakres zamówienia w kategorii</Text>
      <View style={styles.pillRow}>
        <TouchableOpacity
          style={[styles.pill, target === 'critical' && styles.pillOn]}
          onPress={() => patch({ stock_target: 'critical' })}
          testID="voice-order-scope-critical"
        >
          <Text style={[styles.pillText, target === 'critical' && styles.pillTextOn]}>
            Tylko z poziomem krytycznym
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.pill, target === 'optimal' && styles.pillOn]}
          onPress={() => patch({ stock_target: 'optimal' })}
          testID="voice-order-scope-optimal"
        >
          <Text style={[styles.pillText, target === 'optimal' && styles.pillTextOn]}>
            Wszystkie poniżej optymalnego
          </Text>
        </TouchableOpacity>
      </View>
      <Text style={[styles.label, { marginTop: 12 }]}>Preferencja koszyka</Text>
      <View style={styles.pillRow}>
        {objectives.map((o) => {
          const on = objective === o.key;
          return (
            <TouchableOpacity
              key={o.key}
              style={[styles.pill, on && styles.pillOn]}
              onPress={() => patch({ cart_objective: o.key })}
              testID={`voice-order-objective-${o.key}`}
            >
              <Text style={[styles.pillText, on && styles.pillTextOn]}>{o.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      {!objective ? (
        <Text style={[styles.warnHint, { marginTop: 4 }]}>
          Wybierz strategię — szybka dostawa, mało dostawców albo najniższa cena.
        </Text>
      ) : null}
      <Text style={[styles.label, { marginTop: 14 }]}>Zamów dodatkowe produkty (z nazwy)</Text>
      <Text style={[styles.hint, { marginBottom: 8 }]}>
        Np. „ser kozi”, „filet z kurczaka” — zawsze trafią do koszyka, nawet gdy nie są krytyczne.
      </Text>
      {items.map((it, idx) => (
        <OrderLine
          key={idx}
          item={it}
          onChange={(c) => updateItem(idx, c)}
          onRemove={() => patch({ items: items.filter((_, i) => i !== idx) })}
        />
      ))}
      <TouchableOpacity
        style={styles.addBtn}
        onPress={() => patch({ items: [...items, { product_name: '', quantity: null, unit: 'szt' }] })}
      >
        <Plus size={14} color={CTA_TEXT} strokeWidth={2.5} />
        <Text style={styles.addBtnText}>Dodaj produkt</Text>
      </TouchableOpacity>
    </View>
  );
}

export function SupplierWithCatalogEditor({
  edited,
  patch,
  onUploadCatalog,
}: {
  edited: Record<string, any>;
  patch: Patch;
  onUploadCatalog: () => void;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.label}>Nazwa</Text>
      <TextInput
        style={styles.input}
        value={edited.supplier_name ?? ''}
        onChangeText={(v) => patch({ supplier_name: v })}
        placeholder="np. Fresh Food"
        placeholderTextColor="#777"
      />
      <Text style={styles.label}>Osoba kontaktowa</Text>
      <TextInput
        style={styles.input}
        value={edited.contact_person ?? ''}
        onChangeText={(v) => patch({ contact_person: v })}
        placeholder="opcjonalnie"
        placeholderTextColor="#777"
      />
      <Text style={styles.label}>Telefon</Text>
      <TextInput
        style={styles.input}
        value={edited.phone ?? ''}
        onChangeText={(v) => patch({ phone: v })}
        keyboardType="phone-pad"
        placeholder="500 100 200"
        placeholderTextColor="#777"
      />
      <Text style={styles.label}>E-mail</Text>
      <TextInput
        style={styles.input}
        value={edited.email ?? ''}
        onChangeText={(v) => patch({ email: v })}
        keyboardType="email-address"
        placeholder="opcjonalnie"
        placeholderTextColor="#777"
      />
      <Text style={styles.label}>Kategoria dostawcy</Text>
      <TextInput
        style={styles.input}
        value={edited.supplier_category ?? ''}
        onChangeText={(v) => patch({ supplier_category: v })}
        placeholder="np. Warzywa"
        placeholderTextColor="#777"
      />
      <Text style={styles.label}>NIP</Text>
      <TextInput
        style={styles.input}
        value={edited.nip ?? ''}
        onChangeText={(v) => patch({ nip: v })}
        keyboardType="number-pad"
        placeholder="opcjonalnie"
        placeholderTextColor="#777"
      />
      <TouchableOpacity style={styles.addBtn} onPress={onUploadCatalog} activeOpacity={0.85}>
        <Upload size={14} color={CTA_TEXT} strokeWidth={2.5} />
        <Text style={styles.addBtnText}>Wgraj katalog dostawcy</Text>
      </TouchableOpacity>
      <Text style={styles.hint}>
        Po zapisaniu dostawcy możesz od razu wgrać ofertę/katalog — otworzy się skaner dokumentów.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: DS.color.bgTertiary,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    gap: 4,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: DS.color.muted,
    marginTop: 8,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  input: {
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: DS.color.heading,
    backgroundColor: DS.color.bgPrimary,
  },
  hint: { fontSize: 12, color: DS.color.muted, lineHeight: 17, marginBottom: 8 },
  okHint: { fontSize: 12, color: GREEN, marginTop: 6, fontWeight: '600' },
  warnHint: { fontSize: 12, color: '#FBBF24', marginTop: 6 },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    backgroundColor: DS.color.bgPrimary,
  },
  pillOn: { backgroundColor: GREEN, borderColor: GREEN },
  pillText: { fontSize: 12, fontWeight: '700', color: DS.color.heading },
  pillTextOn: { color: CTA_TEXT },
  optimalBtn: {
    marginTop: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
    borderRadius: 12,
    paddingVertical: 14,
    minHeight: 48,
  },
  optimalBtnText: { fontSize: 15, fontWeight: '800', color: CTA_TEXT },
  suggestBox: {
    marginTop: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    backgroundColor: DS.color.bgPrimary,
    overflow: 'hidden',
  },
  suggestRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DS.color.borderSubtle,
  },
  suggestName: { fontSize: 13, fontWeight: '700', color: DS.color.heading },
  suggestHint: { fontSize: 11, color: DS.color.muted, marginTop: 2 },
  addBtn: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: GREEN,
    borderRadius: 12,
    paddingVertical: 12,
  },
  addBtnText: { fontSize: 13, fontWeight: '800', color: CTA_TEXT },
  ingCard: {
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: DS.color.bgPrimary,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
  },
  ingHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  twoCol: { flexDirection: 'row', gap: 8, marginTop: 8 },
});
