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
import { styles } from './styles';

export function IntentDoneSummary({
  intent,
  extras,
  onExtrasChange,
}: {
  intent: Intent;
  extras: any;
  onExtrasChange?: (next: any) => void;
}) {
  if (intent === 'waste' && Array.isArray(extras?.deductions) && extras.deductions.length > 0) {
    return (
      <>
        <Text style={styles.sectionLabel}>Odjęto z magazynu ({extras.deductions.length})</Text>
        {extras.deductions.map((d: any, i: number) => (
          <View key={i} style={styles.deductRow}>
            <Text style={styles.deductName}>{d.name}</Text>
            <Text style={styles.deductQty}>−{Number(d.deducted).toFixed(2)} {d.unit}</Text>
          </View>
        ))}
      </>
    );
  }
  if (intent === 'scale_recipe' && Array.isArray(extras?.ingredients)) {
    const portions = Number(extras.portions) || 1;
    const setPortions = (next: number) => {
      const p = Math.max(1, Math.round(next));
      const ingredients = (extras.ingredients as any[]).map((s) => {
        const per = Number(s.per_portion) || 0;
        const total = Math.round(per * p * 100) / 100;
        const have = s.in_stock != null ? Number(s.in_stock) : null;
        return {
          ...s,
          total_needed: total,
          enough: have != null ? have >= total : s.enough,
        };
      });
      const missing = ingredients.filter((s) => !s.enough).map((s) => s.ingredient_name);
      onExtrasChange?.({
        ...extras,
        portions: p,
        ingredients,
        missing,
        message: `Przeliczono „${extras.dish_name || 'danie'}” na ${p} porcji (${ingredients.length} składników).`
          + (missing.length ? ` Braki: ${missing.join(', ')}` : ''),
      });
    };
    return (
      <>
        <Text style={styles.sectionLabel}>Kalkulator porcji — {extras.dish_name || 'danie'}</Text>
        <View style={styles.portionStepper}>
          <TouchableOpacity
            style={styles.portionBtn}
            onPress={() => setPortions(portions - 1)}
            activeOpacity={0.8}
            testID="voice-scale-portion-minus"
          >
            <Text style={styles.portionBtnText}>−</Text>
          </TouchableOpacity>
          <TextInput
            style={styles.portionInput}
            value={String(portions)}
            onChangeText={(v) => {
              const n = parseFloat(v.replace(',', '.'));
              if (!isNaN(n) && n > 0) setPortions(n);
            }}
            keyboardType="number-pad"
            testID="voice-scale-portion-input"
          />
          <TouchableOpacity
            style={styles.portionBtn}
            onPress={() => setPortions(portions + 1)}
            activeOpacity={0.8}
            testID="voice-scale-portion-plus"
          >
            <Text style={styles.portionBtnText}>+</Text>
          </TouchableOpacity>
          <Text style={styles.portionLabel}>porcji</Text>
        </View>
        {extras.message ? <Text style={styles.doneMessage}>{extras.message}</Text> : null}
        <Text style={styles.sectionLabel}>Składniki na {portions} porcji</Text>
        {extras.ingredients.map((s: any, i: number) => (
          <View key={i} style={styles.deductRow}>
            <Text style={styles.deductName}>{s.ingredient_name}</Text>
            <Text style={[styles.deductQty, { color: s.enough ? '#059669' : Colors.danger }]}>
              {Number(s.total_needed).toFixed(2)} {s.unit}{s.enough ? ' ✓' : ' ⚠︎'}
            </Text>
          </View>
        ))}
      </>
    );
  }
  if (Array.isArray(extras?.changes) && extras.changes.length > 0) {
    return (
      <>
        {extras.message ? <Text style={styles.doneMessage}>{extras.message}</Text> : null}
        <Text style={styles.sectionLabel}>Zmiany ({extras.affected})</Text>
        {extras.changes.map((c: any, i: number) => (
          <View key={i} style={styles.deductRow}>
            <Text style={styles.deductName}>{c.name}</Text>
            <Text style={styles.deductQty}>{Number(c.old).toFixed(2)} → {Number(c.new).toFixed(2)}</Text>
          </View>
        ))}
      </>
    );
  }
  if (intent === 'order_critical_items_by_category') {
    // Tylko skrót — lista produktów i braki ofert są wyłącznie w Łowcy Okazji.
    const cats = Array.isArray(extras?.matched_categories) ? extras.matched_categories : [];
    const critical = Number(extras?.critical_count ?? 0);
    const found = Number(extras?.found_in_offers_count ?? 0);
    return (
      <>
        <Text style={styles.doneMessage} testID="voice-done-critical-short">
          Otworzono Łowcę Okazji — tam jest rozpiska znalezionych pozycji i koszyki dostawców.
        </Text>
        {cats.length > 0 ? (
          <View style={styles.deductRow}>
            <Text style={styles.deductName}>Kategorie</Text>
            <Text style={styles.deductQty} numberOfLines={2}>{cats.join(', ')}</Text>
          </View>
        ) : null}
        <View style={styles.deductRow}>
          <Text style={styles.deductName}>Pozycje / w ofertach</Text>
          <Text style={[styles.deductQty, { color: Colors.success }]}>
            {found} / {critical}
          </Text>
        </View>
      </>
    );
  }
  if (
    intent === 'rank_menu_sales' || intent === 'rank_inventory_usage' || intent === 'rank_waste_cost'
    || intent === 'rank_dead_menu' || intent === 'list_expiring_soon' || intent === 'rank_supplier_spend'
    || intent === 'manager_core_alerts' || intent === 'haccp_tip'
  ) {
    const periodBlocks: { label: string; items: any[]; total_cost_pln?: number }[] =
      Array.isArray(extras?.periods) && extras.periods.length > 0
        ? extras.periods.map((p: any) => ({
            label: String(p.label || p.period_label || 'Okres'),
            items: Array.isArray(p.items) ? p.items : [],
            total_cost_pln: p.total_cost_pln,
          }))
        : [{
            label: extras?.period_label ? String(extras.period_label) : '',
            items: Array.isArray(extras?.items) ? extras.items : [],
            total_cost_pln: extras?.total_cost_pln ?? extras?.total_spend_pln,
          }];

    const renderExpiryLadder = (items: any[], blockKey: string) => {
      if (!items.length) {
        return (
          <Text key={`${blockKey}-empty`} style={[styles.doneMessage, { color: DS.color.muted }]}>
            Brak pozycji w tym horyzoncie.
          </Text>
        );
      }
      const builtRows = items.map((row: any, idx: number) => {
        const daysLeft = Number(row.days_left);
        const urgent = Number.isFinite(daysLeft) && daysLeft >= 0 && daysLeft < 7;
        const ladder = String(row.ladder || (Number.isFinite(daysLeft)
          ? (daysLeft <= 0 ? 'dziś' : daysLeft === 1 ? 'jutro' : `za ${daysLeft} dni`)
          : ''));
        const built = buildExpiryTipsForItem({
          daysLeft: Number.isFinite(daysLeft) ? daysLeft : 3,
          productName: row.name || row.product_name,
          qty: row.qty,
          unit: row.unit,
          inventoryCategoryName: row.category_name || row.inventory_category,
          menuCategory: row.menu_category,
          limit: 3,
          includeGames: true,
        });
        const fallbackTip = !built.tips.length && row.tip ? String(row.tip) : null;
        return { row, idx, daysLeft, urgent, ladder, built, fallbackTip };
      });
      const anyGameOrLegal = builtRows.some((r) => r.built.showLegalDisclaimer);
      return (
        <>
          {builtRows.map(({ row, idx, urgent, ladder, built, fallbackTip }) => (
            <View
              key={`${blockKey}-${row.id || row.name || idx}`}
              style={styles.expiryItemCard}
              testID={`voice-expiry-item-${idx}`}
            >
              <View style={styles.deductRow}>
                <Text style={[styles.deductName, urgent && { color: '#F87171' }]} numberOfLines={3}>
                  {idx + 1}. {row.name || row.inventory_name || row.ingredient_name}
                  {ladder ? ` · ${ladder}` : ''}
                </Text>
                <Text style={[styles.deductQty, urgent && { color: '#F87171', fontWeight: '800' }]}>
                  {`${row.qty ?? 0} ${row.unit || ''} · do ${row.expiration_date || '?'}`.trim()}
                </Text>
              </View>
              {built.tips.map((tip) => (
                <View
                  key={tip.id}
                  style={[
                    styles.expiryTipRow,
                    tip.kind === 'game_safe' && styles.expiryTipGame,
                  ]}
                  testID={`voice-expiry-tip-${tip.id}`}
                >
                  <Text style={styles.expiryTipKind}>
                    {tip.kind === 'game_safe'
                      ? 'Gra'
                      : tip.kind === 'social'
                        ? 'Social'
                        : tip.kind === 'marketing'
                          ? 'Marketing'
                          : tip.kind === 'kitchen'
                            ? 'Kuchnia'
                            : 'Operacje'}
                  </Text>
                  <Text style={styles.expiryTipTitle}>{tip.title}</Text>
                  <Text style={styles.expiryTipBody}>{tip.body}</Text>
                  {tip.cta_label ? (
                    <Text style={styles.expiryTipCta}>{tip.cta_label}</Text>
                  ) : null}
                </View>
              ))}
              {!built.tips.length && !fallbackTip ? (
                <Text style={[styles.expiryTipBody, { marginTop: 4, opacity: 0.75 }]}>
                  {built.phase
                    ? 'Brak tipów Zero Waste dla tej pozycji.'
                    : 'Tipy Zero Waste: horyzont T−3…T−1 (za 1–3 dni / dziś).'}
                </Text>
              ) : null}
              {fallbackTip ? (
                <Text style={[styles.expiryTipBody, { marginTop: 4 }]}>{fallbackTip}</Text>
              ) : null}
            </View>
          ))}
          {anyGameOrLegal ? (
            <View style={styles.expiryLegalBox} testID="voice-expiry-legal-disclaimer">
              <Text style={styles.expiryLegalText}>{EXPIRY_TIPS_LEGAL_DISCLAIMER}</Text>
            </View>
          ) : null}
        </>
      );
    };

    const renderPlainItems = (items: any[], blockKey: string) => (
      items.length === 0 ? (
        <Text key={`${blockKey}-empty`} style={[styles.doneMessage, { color: DS.color.muted }]}>
          Brak pozycji dla tego okresu.
        </Text>
      ) : (
        items.map((row: any, idx: number) => (
          <View key={`${blockKey}-${row.menu_item_id || row.id || row.name || idx}`} style={styles.deductRow}>
            <Text style={styles.deductName} numberOfLines={3}>
              {idx + 1}. {row.name || row.inventory_name || row.ingredient_name}
            </Text>
            <Text style={styles.deductQty}>
              {intent === 'rank_waste_cost'
                ? `${row.qty ?? 0} ${row.unit || ''} · ${Math.round(Number(row.cost_pln || 0))} zł`.trim()
                : intent === 'rank_supplier_spend'
                  ? `${Math.round(Number(row.spend_pln || 0))} zł · ${row.invoice_count ?? 0} fakt.`
                  : intent === 'manager_core_alerts' || intent === 'haccp_tip'
                    ? String(row.detail || row.tip || row.opportunity || '').slice(0, 90)
                    : `${row.qty_used ?? 0} ${row.unit || ''}`.trim()}
            </Text>
          </View>
        ))
      )
    );

    /** Ranking sprzedaży / najsłabsze: osobno sztuki i utarg (bez ściany tekstu). */
    const renderSalesDual = (items: any[], blockKey: string) => {
      if (!items.length) {
        return (
          <Text key={`${blockKey}-empty`} style={[styles.doneMessage, { color: DS.color.muted }]}>
            Brak pozycji dla tego okresu.
          </Text>
        );
      }
      const byQty = [...items].sort((a, b) => Number(b.qty_sold || 0) - Number(a.qty_sold || 0));
      const byRev = [...items].sort((a, b) => Number(b.revenue_pln || 0) - Number(a.revenue_pln || 0));
      // dla najsłabszych — sort rosnąco
      if (intent === 'rank_dead_menu' || extras?.rank === 'worst') {
        byQty.sort((a, b) => Number(a.qty_sold || 0) - Number(b.qty_sold || 0));
        byRev.sort((a, b) => Number(a.revenue_pln || 0) - Number(b.revenue_pln || 0));
      }
      const list = (rows: any[], suffix: string, fmt: (r: any) => string) =>
        rows.map((row: any, idx: number) => (
          <View key={`${blockKey}-${suffix}-${row.menu_item_id || row.name || idx}`} style={styles.deductRow}>
            <Text style={styles.deductName} numberOfLines={2}>
              {idx + 1}. {row.name}
            </Text>
            <Text style={styles.deductQty}>{fmt(row)}</Text>
          </View>
        ));
      return (
        <>
          <Text style={[styles.sectionLabel, { marginTop: 4 }]}>Według sztuki</Text>
          {list(byQty, 'qty', (r) => `${r.qty_sold ?? 0} szt`)}
          <Text style={[styles.sectionLabel, { marginTop: 10 }]}>Według utargu</Text>
          {list(byRev, 'rev', (r) => `${Math.round(Number(r.revenue_pln || 0))} zł`)}
        </>
      );
    };

    return (
      <>
        {periodBlocks.map((block, bi) => (
          <View
            key={`rank-block-${bi}`}
            style={{
              marginBottom: 14,
              padding: 12,
              borderRadius: 12,
              backgroundColor: DS.color.bgPrimary,
              borderWidth: 1,
              borderColor: DS.color.borderSubtle,
            }}
          >
            {block.label ? (
              <Text style={[styles.sectionLabel, { marginBottom: 8 }]} testID={`voice-done-period-${bi}`}>
                {block.label}
              </Text>
            ) : null}
            {block.total_cost_pln != null ? (
              <View style={styles.deductRow}>
                <Text style={styles.deductName}>
                  {intent === 'rank_supplier_spend' ? 'Suma wydatków' : 'Suma strat'}
                </Text>
                <Text style={[styles.deductQty, { color: Colors.danger }]}>
                  {Math.round(Number(block.total_cost_pln)).toLocaleString('pl-PL')} zł
                </Text>
              </View>
            ) : null}
            {intent === 'rank_menu_sales' || intent === 'rank_dead_menu'
              ? renderSalesDual(block.items, `b${bi}`)
              : intent === 'list_expiring_soon'
                ? renderExpiryLadder(block.items, `b${bi}`)
                : renderPlainItems(block.items, `b${bi}`)}
          </View>
        ))}
      </>
    );
  }
  if (intent === 'summarize_custom_period' || intent === 'compare_two_periods') {
    const periods = Array.isArray(extras?.periods) ? extras.periods : [];
    if (intent === 'compare_two_periods' && extras?.period_1 && extras?.period_2) {
      periods.length = 0;
      periods.push(extras.period_1, extras.period_2);
    }
    const money = (n: unknown) => Math.round(Number(n) || 0).toLocaleString('pl-PL');
    const row = (label: string, val: unknown, color?: string) =>
      val != null ? (
        <View style={styles.deductRow} key={label}>
          <Text style={styles.deductName}>{label}</Text>
          <Text style={[styles.deductQty, color ? { color } : null]}>{money(val)} zł</Text>
        </View>
      ) : null;
    const renderAgg = (a: any, title?: string) => (
      <View
        style={{
          gap: 4,
          marginBottom: 12,
          padding: 12,
          borderRadius: 12,
          backgroundColor: DS.color.bgPrimary,
          borderWidth: 1,
          borderColor: DS.color.borderSubtle,
        }}
        key={title || 'agg'}
      >
        {title ? <Text style={styles.sectionLabel}>{title}</Text> : null}
        {a?.since && a?.until ? (
          <Text style={[styles.doneMessage, { color: DS.color.muted }]}>
            {a.since} → {a.until}
            {a.revenue_source ? ` · ${a.revenue_source}` : ''}
          </Text>
        ) : null}
        {row('Przychód (utarg)', a.total_revenue, DS.color.heading)}
        {row('Koszty stałe (proporcja dni)', a.fixed_costs_allocated, DS.color.muted)}
        {row('Straty produktowe', a.total_waste_cost, Colors.danger)}
        {row(
          'Koszty zmienne (po odjęciu strat)',
          a.variable_costs_net ?? Math.max(0, Number(a.variable_costs_allocated || 0) - Number(a.total_waste_cost || 0)),
          DS.color.muted,
        )}
        {row(
          'Koszty zmienne brutto (zakupy)',
          a.variable_costs_gross ?? a.variable_costs_allocated,
          DS.color.muted,
        )}
        {row('Zysk', a.net_profit, Number(a.net_profit) >= 0 ? DS.color.greenEnd : Colors.danger)}
      </View>
    );
    return (
      <>
        {periods.length > 0
          ? periods.map((p: any, i: number) => renderAgg(p.aggregates, p.label || `Okres ${i + 1}`))
          : extras?.aggregates
            ? renderAgg(extras.aggregates)
            : null}
      </>
    );
  }
  if (typeof extras?.message === 'string' && extras.message) {
    return <Text style={styles.doneMessage} testID="voice-done-message">{extras.message}</Text>;
  }
  return null;
}
