import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Platform, ScrollView, TextInput,
} from 'react-native';
import { Mic, Square, X, Check, AlertTriangle, RefreshCw, Send, Info, Plus, Trash2, ShieldAlert } from 'lucide-react-native';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  getJarvisWakeWord,
  setJarvisWakeWord,
  setJarvisWakeListenEnabled,
  transcriptContainsWakeWord,
  stripWakeWord,
} from '@/lib/jarvisWakeWord';
import { DealHunterModal } from '../DealHunterModal';
import { ExpirationVoiceForm } from '../ExpirationVoiceForm';
import { PeriodPickerTree, labelForSelections, parsePeriodHintToSelection, type PeriodSelection } from '../PeriodPickerTree';
import {
  BulkPriceEditor,
  CriticalOrderEditor,
  DishPickEditor,
  IngredientNameSuggest,
  JarvisSuggestBox,
  MenuCategorySuggest,
  NavigateScreenEditor,
  OrderProductEditor,
  SupplierWithCatalogEditor,
} from '../JarvisFormExtras';
import { type OptimizeResult, normalizeOptimizeResult } from '@/lib/bargainHunter';
import {
  buildExpiryTipsForItem,
  EXPIRY_TIPS_LEGAL_DISCLAIMER,
} from '@/lib/expiryTipsCatalog';
import { fetchJson } from '@/lib/safeFetch';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { usePremiumAlert } from '@/components/PremiumAlert';
import {
  DEAL_HUNTER_GATE_MESSAGE,
  DEAL_HUNTER_GATE_TITLE,
  isDealHunterIntent,
} from '@/lib/dealHunterGate';
import { ProduceSizePicker } from '@/components/ProduceSizePicker';
import {
  findProduceConverter,
  piecesToKg,
  type ProduceSizeKey,
} from '@/lib/produceSizeConverter';
import { useAuth } from '@/contexts/AuthContext';

import type { Intent } from './types';
import { INTENT_META } from './constants';
import { numOrNull, previewPeriodLabel } from './helpers';
import { Card, EditRow, FieldLabel } from './fields';
import { styles } from './styles';

export function PeriodConfirmEditor({
  intent,
  edited,
  patch,
  categories = [],
  menuCategories = [],
}: {
  intent: Intent;
  edited: Record<string, any>;
  patch: (p: Record<string, any>) => void;
  categories?: string[];
  menuCategories?: string[];
}) {
  const preview = previewPeriodLabel(edited);
  const selected: PeriodSelection[] = Array.isArray(edited.selected_periods)
    ? edited.selected_periods
    : [];
  const showTree = intent !== 'list_expiring_soon' && intent !== 'haccp_tip';
  const prefer = parsePeriodHintToSelection(String(edited.period_1 || edited.note || ''));
  const [supplierNames, setSupplierNames] = useState<string[]>([]);

  useEffect(() => {
    if (intent !== 'rank_supplier_spend' || !isSupabaseConfigured) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('suppliers')
          .select('name')
          .eq('is_active', true)
          .order('name')
          .limit(200);
        if (cancelled) return;
        const names = (data || [])
          .map((r: any) => String(r?.name || '').trim())
          .filter(Boolean);
        setSupplierNames(names);
      } catch {
        if (!cancelled) setSupplierNames([]);
      }
    })();
    return () => { cancelled = true; };
  }, [intent]);

  const onTreeChange = (next: PeriodSelection[]) => {
    const label = next.length ? labelForSelections(next) : edited.period_1;
    if (intent === 'compare_two_periods') {
      const p1 = next[0] ? labelForSelections([next[0]]) : edited.period_1;
      const p2 = next[1] ? labelForSelections([next[1]]) : edited.period_2;
      patch({
        selected_periods: next.slice(0, 2),
        period_1: p1,
        period_2: p2,
        note: label,
      });
      return;
    }
    patch({
      selected_periods: next,
      period_1: label,
      note: label,
      period_type: next.some((s) => s.kind === 'year')
        ? 'year'
        : next.some((s) => s.kind === 'day')
          ? 'custom'
          : 'month',
    });
  };

  return (
    <Card>
      <View style={styles.supplierActionInfo} testID={`voice-period-confirm-${intent}`}>
        <Text style={styles.supplierActionTitle}>{INTENT_META[intent].label}</Text>
        <View style={styles.periodConfirmBox}>
          <Text style={styles.periodConfirmWarn}>
            {intent === 'compare_two_periods'
              ? 'Zaznacz w drzewie dokładnie 2 okresy (checkboxy), potem kliknij Analizuj.'
              : 'Wybierz w drzewie rok / miesiąc / tydzień / dzień — możesz zaznaczyć kilka okresów.'}
          </Text>
          <Text style={styles.periodConfirmPreview} testID="voice-period-preview">
            Wybrany okres: {selected.length ? preview : 'brak — zaznacz w drzewie poniżej'}
          </Text>
        </View>

        {intent === 'compare_two_periods' ? (
          <View style={{ gap: 8, marginBottom: 10 }}>
            <View style={styles.compareTile}>
              <Text style={styles.compareTileLabel}>Okres 1 (usłyszane)</Text>
              <Text style={styles.compareTileValue}>{edited.period_1 || '—'}</Text>
            </View>
            <View style={styles.compareTile}>
              <Text style={styles.compareTileLabel}>Okres 2 (usłyszane)</Text>
              <Text style={styles.compareTileValue}>{edited.period_2 || '—'}</Text>
            </View>
            <Text style={styles.editHint2}>
              Zaznacz w drzewie 2 okresy (np. Lipiec i Sierpień) — nadpiszą kafelki.
            </Text>
          </View>
        ) : null}

        {showTree ? (
          <PeriodPickerTree
            value={selected}
            onChange={onTreeChange}
            preferYear={prefer?.year ?? new Date().getFullYear()}
            preferMonth={prefer?.month}
          />
        ) : null}

        {(intent === 'rank_menu_sales' || intent === 'rank_inventory_usage') && (
          <>
            <FieldLabel text={intent === 'rank_menu_sales' ? 'Ranking sprzedaży' : 'Ranking zużycia'} />
            <View style={styles.pillRow}>
              {[
                { key: 'best', label: intent === 'rank_inventory_usage' ? 'Najwięcej' : 'Najlepiej' },
                { key: 'worst', label: intent === 'rank_inventory_usage' ? 'Najmniej' : 'Najsłabiej' },
              ].map((r) => {
                const active = (edited.rank || 'best') === r.key;
                return (
                  <TouchableOpacity
                    key={r.key}
                    style={[styles.pill, active && { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd }]}
                    onPress={() => patch({ rank: r.key })}
                    activeOpacity={0.7}
                    testID={`voice-rank-${r.key}`}
                  >
                    <Text style={[styles.pillText, active && { color: '#0A0A0A', fontWeight: '700' }]}>{r.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <EditRow
                  label="Ile pozycji (TOP)"
                  value={edited.top_n == null ? '' : String(edited.top_n)}
                  onChangeText={(v) => patch({ top_n: numOrNull(v) })}
                  keyboardType="number-pad"
                  placeholder="5"
                  hint="Puste = 5 · lub użyj − / +"
                  testID="voice-top-n"
                />
              </View>
              <TouchableOpacity
                style={[styles.unitPill, { marginBottom: 18 }]}
                onPress={() => patch({ top_n: Math.max(1, Number(edited.top_n) || 5) - 1 })}
                testID="voice-top-n-dec"
              >
                <Text style={styles.unitPillText}>−</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.unitPill, styles.unitPillActive, { marginBottom: 18 }]}
                onPress={() => patch({ top_n: Math.min(20, (Number(edited.top_n) || 5) + 1) })}
                testID="voice-top-n-inc"
              >
                <Text style={[styles.unitPillText, styles.unitPillTextActive]}>+</Text>
              </TouchableOpacity>
            </View>
            <FieldLabel text={intent === 'rank_menu_sales' ? 'Kategoria menu (opcjonalnie)' : 'Kategoria magazynu (opcjonalnie)'} />
            <View style={styles.pillRow}>
              {(intent === 'rank_menu_sales' ? menuCategories : categories).map((c) => {
                const active = String(edited.category || edited.category_name || '').toLowerCase() === c.toLowerCase();
                return (
                  <TouchableOpacity
                    key={c}
                    style={[styles.pill, active && { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd }]}
                    onPress={() => patch({ category: active ? '' : c, category_name: active ? '' : c })}
                    testID={`voice-rank-cat-${c}`}
                  >
                    <Text style={[styles.pillText, active && { color: '#0A0A0A', fontWeight: '700' }]}>{c}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        {(intent === 'rank_waste_cost' || intent === 'rank_dead_menu') && (
          <>
            <FieldLabel text={intent === 'rank_waste_cost' ? 'Straty w złotówkach' : 'Najsłabiej sprzedające się dania'} />
            <EditRow
              label="Ile pozycji (TOP)"
              value={edited.top_n == null ? '' : String(edited.top_n)}
              onChangeText={(v) => patch({ top_n: numOrNull(v) })}
              keyboardType="number-pad"
              placeholder={intent === 'rank_dead_menu' ? '8' : '5'}
              hint={intent === 'rank_dead_menu' ? 'Puste = 8 (tylko dania ze sprzedażą > 0)' : 'Puste = 5 pozycji'}
              testID="voice-waste-top-n"
            />
            {intent === 'rank_dead_menu' ? (
              <>
                <FieldLabel text="Kategoria menu — kliknij kafelek" />
                <View style={styles.pillRow}>
                  {menuCategories.map((c) => {
                    const active = String(edited.category || edited.category_name || '').toLowerCase() === c.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={c}
                        style={[styles.pill, active && { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd }]}
                        onPress={() => patch({ category: active ? '' : c, category_name: active ? '' : c })}
                        testID={`voice-dead-cat-${c}`}
                      >
                        <Text style={[styles.pillText, active && { color: '#0A0A0A', fontWeight: '700' }]}>{c}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            ) : null}
          </>
        )}

        {intent === 'list_expiring_soon' && (
          <>
            <FieldLabel text="Drabina dat ważności" />
            <EditRow
              label="Horyzont (dni)"
              value={edited.limit_days == null ? '3' : String(edited.limit_days)}
              onChangeText={(v) => patch({ limit_days: numOrNull(v) })}
              keyboardType="number-pad"
              placeholder="3"
              hint="np. 3 = produkty kończące się dziś, jutro i pojutrze"
              testID="voice-expiry-horizon"
            />
            <EditRow
              label="Max pozycji"
              value={edited.top_n == null ? '' : String(edited.top_n)}
              onChangeText={(v) => patch({ top_n: numOrNull(v) })}
              keyboardType="number-pad"
              placeholder="20"
              hint="Puste = 20 pozycji"
              testID="voice-expiry-top-n"
            />
          </>
        )}

        {(intent === 'rank_supplier_spend' || intent === 'manager_core_alerts') && (
          <>
            <FieldLabel text={intent === 'rank_supplier_spend' ? 'Wydatki u dostawców' : 'Alerty korelacji CORE'} />
            {intent === 'rank_supplier_spend' ? (
              <>
                <FieldLabel text="Dostawca — kliknij kafelek lub wpisz" />
                <View style={styles.pillRow}>
                  {supplierNames.map((name) => {
                    const active = String(edited.supplier_name || '').toLowerCase() === name.toLowerCase();
                    return (
                      <TouchableOpacity
                        key={name}
                        style={[styles.pill, active && { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd }]}
                        onPress={() => patch({ supplier_name: active ? '' : name })}
                        testID={`voice-supplier-chip-${name}`}
                      >
                        <Text style={[styles.pillText, active && { color: '#0A0A0A', fontWeight: '700' }]} numberOfLines={1}>
                          {name}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <EditRow
                  label="Lub wpisz nazwę dostawcy"
                  value={edited.supplier_name ?? ''}
                  onChangeText={(v) => patch({ supplier_name: v })}
                  placeholder="np. Makro"
                />
                <EditRow
                  label="Ile pozycji (TOP)"
                  value={edited.top_n == null ? '' : String(edited.top_n)}
                  onChangeText={(v) => patch({ top_n: numOrNull(v) })}
                  keyboardType="number-pad"
                  placeholder="5"
                  hint="Puste = 5 pozycji"
                />
              </>
            ) : null}
          </>
        )}
      </View>
    </Card>
  );
}
