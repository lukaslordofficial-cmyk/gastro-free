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

import type { Intent, Interpretation } from './types';
import { MONTHS_PL_PREVIEW, PERIOD_INTENTS, VOICE_CATEGORY_SYNONYMS, VOICE_CAT_STOP } from './constants';

export function stripPlPreview(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .trim();
}

export function previewPeriodLabel(edited: Record<string, any>): string {
  if (Array.isArray(edited.selected_periods) && edited.selected_periods.length > 0) {
    return labelForSelections(edited.selected_periods);
  }
  if (edited.period_2) {
    return `${edited.period_1 || '?'} vs ${edited.period_2}`;
  }
  const hint = String(edited.period_1 || edited.note || '').trim();
  if (/^\d{4}-\d{1,2}$/.test(hint)) return hint;
  const key = stripPlPreview(hint);
  if (key && MONTHS_PL_PREVIEW[key]) {
    const now = new Date();
    const names = Object.values(MONTHS_PL_PREVIEW);
    // find month index roughly
    const order = ['styczeń','luty','marzec','kwiecień','maj','czerwiec','lipiec','sierpień','wrzesień','październik','listopad','grudzień'];
    const mo = order.indexOf(MONTHS_PL_PREVIEW[key]) + 1;
    let y = now.getFullYear();
    if (mo > now.getMonth() + 1) y -= 1;
    return `${MONTHS_PL_PREVIEW[key]} ${y}`;
  }
  const pt = String(edited.period_type || 'week');
  const days = edited.limit_days != null ? Number(edited.limit_days) : null;
  if (days && days > 0) return `ostatnie ${days} dni`;
  return ({ day: 'ostatni dzień', week: 'ostatni tydzień', month: 'ostatnie ~30 dni', year: 'ostatni rok', custom: 'okres niestandardowy' } as Record<string, string>)[pt] || pt;
}

export function numOrNull(v: string): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v.replace(',', '.'));
  return isFinite(n) ? n : null;
}

export function stripPlIntent(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l');
}

/** Korekta po stronie FE — działa nawet gdy stary backend nadal zwraca compare. */
export function correctPeriodIntentFromTranscript(
  transcript: string,
  data: Interpretation,
): Interpretation {
  const t = stripPlIntent(transcript);
  const hasCompare = /\b(porownaj|porownanie|porownac|zestaw|zestawienie|versus|\bvs\b|roznic)/.test(t);
  const months = t.match(
    /\b(stycznia|styczen|lutego|luty|marca|marzec|kwietnia|kwiecien|maja|maj|czerwca|czerwiec|lipca|lipiec|sierpnia|sierpien|wrzesnia|wrzesien|pazdziernika|pazdziernik|listopada|listopad|grudnia|grudzien)\b/g,
  );
  const monthHits = months?.length ?? 0;
  const finance = /\b(zysk|zyski|przychod|przychody|utarg|podsumuj|analiz|dane|raport|sprzedaz)\b/.test(t);

  let intent = data.intent;
  let payload = { ...(data.payload || {}) };
  let reason = data.reason || '';

  if (finance && monthHits <= 1 && !hasCompare) {
    intent = 'summarize_custom_period';
    reason = `${reason} | FE: pokazanie danych jednego okresu`.trim();
    if (!payload.period_1) payload.period_1 = transcript.trim();
    payload.period_type = payload.period_type || 'month';
    delete payload.period_2;
  } else if (data.intent === 'compare_two_periods' && !hasCompare && monthHits <= 1) {
    intent = 'summarize_custom_period';
    reason = `${reason} | FE: skorygowano compare→analiza`.trim();
    if (!payload.period_1 && payload.period_2) payload.period_1 = payload.period_2;
    delete payload.period_2;
  }

  // FE: „wgraj menu” nie może iść do oferty dostawcy
  if (/\b(wgraj|zeskanuj|skanuj)\b.{0,40}\bmenu\b/.test(t) || /\bmenu\b.{0,40}\b(wgraj|zeskanuj|skanuj)\b/.test(t)) {
    if (intent === 'upload_offer' || intent === 'upload_document' || intent === 'upload_invoice' || intent === 'unknown') {
      intent = 'upload_menu';
      reason = `${reason} | FE: upload_menu`.trim();
    }
  }
  if (/\b(przywroc|cofnij)\b/.test(t) && /\b(magazyn|produkt|skladnik)/.test(t) && !/\b(menu|danie|potraw)/.test(t)) {
    intent = 'restore_deleted_inventory';
    reason = `${reason} | FE: restore_inventory`.trim();
  }

  const alts = data.alternate_intents?.length
    ? data.alternate_intents
    : [
        { intent: 'summarize_custom_period' as Intent, label: 'Pokazanie danych / zysków z okresu' },
        { intent: 'compare_two_periods' as Intent, label: 'Porównanie dwóch okresów' },
      ];

  return {
    ...data,
    intent,
    payload,
    reason,
    alternate_intents: finance || intent === 'summarize_custom_period' || intent === 'compare_two_periods'
      ? alts
      : data.alternate_intents,
  };
}

/**
 * Sanitize AI-returned payload before showing editable form.
 * AI returns 0 for numeric fields it couldn't recognise (price, amount, quantity).
 * Convert those 0s to null so the TextInput shows placeholder — makes the user
 * notice they must fill it in instead of silently saving zero.
 */
export function extractAmountFromText(text: string): number | null {
  if (!text) return null;
  // Prefer jawne kwoty przy słowach finansowych; inaczej ostatnia sensowna liczba w tekście.
  const normalized = text.replace(/\u00a0/g, ' ').replace(/(\d)\s+(\d{3})\b/g, '$1$2');
  const moneyNear = normalized.match(
    /(?:przych[oó]d|utarg|wpłat|kwot|zł|pln|koszt|pensj|wynagrodzeni)[^\d]{0,24}(\d+(?:[.,]\d{1,2})?)/i,
  );
  const raw = moneyNear?.[1]
    ?? [...normalized.matchAll(/\b(\d{2,6}(?:[.,]\d{1,2})?)\b/g)].map((m) => m[1]).pop();
  if (!raw) return null;
  const n = Number(String(raw).replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function normPlVoice(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Synonimy kategorii magazynowych (mirrors backend _CATEGORY_SYNONYMS — bez nazw produktów). */
export function resolveVoiceCategories(raw: string[]): { matched: string[]; unmatched: string[] } {
  const matched: string[] = [];
  const unmatched: string[] = [];
  const synIndex = new Map<string, string>();
  for (const [canon, syns] of Object.entries(VOICE_CATEGORY_SYNONYMS)) {
    synIndex.set(normPlVoice(canon), canon);
    for (const s of syns) synIndex.set(normPlVoice(s), canon);
  }
  const catTokensFor = (canon: string): Set<string> => {
    const toks = new Set<string>([normPlVoice(canon)]);
    for (const syn of VOICE_CATEGORY_SYNONYMS[canon] || []) {
      const n = normPlVoice(syn);
      toks.add(n);
      for (const p of n.split(' ')) if (p) toks.add(p);
    }
    for (const p of normPlVoice(canon).split(' ')) if (p) toks.add(p);
    return toks;
  };

  for (const r of raw) {
    const s = String(r || '').trim();
    if (!s) continue;
    if (s.toLowerCase() === 'all') return { matched: ['all'], unmatched: [] };
    const key = normPlVoice(s);
    if (synIndex.has(key)) {
      const canon = synIndex.get(key)!;
      if (!matched.includes(canon)) matched.push(canon);
      continue;
    }
    const tokens = key
      .replace(/[,+]/g, ' ')
      .split(/\s+/)
      .filter((t) => t && !VOICE_CAT_STOP.has(t));
    // Wszystkie kategorie w frazie („mięso i nabiał”), nie tylko pierwsza.
    const foundCats: string[] = [];
    for (const t of tokens) {
      const hit = synIndex.get(t);
      if (hit && !foundCats.includes(hit)) foundCats.push(hit);
    }
    if (foundCats.length) {
      for (const found of foundCats) {
        if (!matched.includes(found)) matched.push(found);
      }
      const catToks = new Set<string>();
      for (const found of foundCats) {
        for (const x of catTokensFor(found)) catToks.add(x);
      }
      const leftover = tokens.filter((t) => !catToks.has(t));
      if (leftover.length) unmatched.push(leftover.join(' '));
      continue;
    }
    unmatched.push(s);
  }
  return { matched, unmatched };
}

/** Wyłuskaj nazwy produktów z categories[] (LLM MIX) → items. */
export function peelNamedFromCategories(cats: string[]): { categories: string[]; named: string[] } {
  const { matched, unmatched } = resolveVoiceCategories(cats);
  const named: string[] = [];
  for (const u of unmatched) {
    const key = normPlVoice(u);
    if (!key || ['inne', 'all', 'wszystko', 'braki'].includes(key)) continue;
    // „ser kozi i borowiki” → spróbuj rozdzielić po „i”
    const parts = u.split(/\s+(?:i|oraz|,)\s+/i).map((x) => x.trim()).filter(Boolean);
    if (parts.length > 1) named.push(...parts);
    else named.push(u.trim());
  }
  return { categories: matched, named };
}

/** Wyłuskaj nazwę dania z komendy głosowej gdy LLM nie wypełnił dish_name. */
export function cleanSpokenDishQuery(raw: string): string {
  return String(raw || '')
    .trim()
    .replace(/[.?!,;]+$/g, '')
    .replace(/\s+z\s+menu\s*$/i, '')
    .replace(/\s+z\s+karty\s*$/i, '')
    .replace(/\s+z\s+kart[ye]\s+da[nń]\s*$/i, '')
    .replace(/^(?:danie|pozycj[eę])\s+/i, '')
    .trim();
}

export function guessDishNameFromTranscript(transcript: string, intent: Intent): string {
  const t = String(transcript || '').trim();
  if (!t) return '';
  const patterns: RegExp[] =
    intent === 'delete_menu_item'
      ? [
          /(?:usuń|usun|skasuj|wyrzuć|wyrzuc)\s+(?:z\s+menu\s+)?(?:danie\s+)?(.+)$/i,
          /(?:usuń|usun|skasuj)\s+(.+?)\s+z\s+menu/i,
        ]
      : [
          /(?:zmień|zmien|ustaw)\s+cen[ęe]\s+(?:dania\s+)?(.+?)(?:\s+na\s+[\d.,]+)?$/i,
          /(?:cena|cenę)\s+(?:dania\s+)?(.+?)(?:\s+na\s+[\d.,]+)?$/i,
        ];
  for (const re of patterns) {
    const m = t.match(re);
    const raw = cleanSpokenDishQuery(m?.[1] || '');
    if (raw.length >= 2) return raw;
  }
  return '';
}

export function seedPayload(
  intent: Intent,
  payload: Record<string, any>,
  opts?: { transcript?: string; fromLegend?: boolean },
): Record<string, any> {
  const p = { ...payload };
  const NUMERIC_ZERO_TO_NULL = [
    'price_pln', 'amount_pln', 'quantity', 'min_quantity', 'optimal_quantity',
    'new_price', 'current_quantity', 'safety_buffer_percent', 'max_budget',
    'percentage', 'amount',
  ];
  for (const k of NUMERIC_ZERO_TO_NULL) {
    if (p[k] === 0) p[k] = null;
  }
  // Menu item: also clean ingredient quantities so 0 → null
  if (intent === 'add_menu_item' && Array.isArray(p.ingredients)) {
    p.ingredients = p.ingredients.map((ing: any) => ({
      ingredient_name: ing?.ingredient_name ?? '',
      quantity: ing?.quantity === 0 ? null : ing?.quantity ?? null,
      unit: ing?.unit ?? 'g',
    }));
  }
  if (intent === 'add_menu_item' && (!Array.isArray(p.ingredients) || p.ingredients.length === 0)) {
    p.ingredients = [{ ingredient_name: '', quantity: null, unit: 'g' }];
  }
  // Zbiorcze zamówienie braków (+ opcjonalnie nazwiane produkty MIX)
  if (intent === 'order_critical_items_by_category') {
    const raw = p.categories;
    let cats: string[] = [];
    if (Array.isArray(raw)) cats = raw.filter((x) => typeof x === 'string' && x.trim());
    else if (typeof raw === 'string' && raw.trim()) cats = [raw.trim()];
    // Z legendy: użytkownik sam zaznacza kategorie (nie zgaduj „all”)
    if (opts?.fromLegend) cats = [];

    // MIX: „ser kozi + warzywa” — LLM często wrzuca nazwy produktów do categories[].
    // Rozdziel: prawdziwe kategorie vs nazwane produkty → items[].
    const peeled = peelNamedFromCategories(cats);
    cats = peeled.categories;
    p.categories = cats;

    // „Brakujące / krytyczne” = critical. Optimal tylko gdy LLM/UI jawnie poda.
    // NIE nadpisuj critical→optimal — to wciągało produkty poza zakresem braków.
    const st = String(p.stock_target || '').trim().toLowerCase();
    if (st !== 'optimal' && st !== 'critical') {
      p.stock_target = 'critical';
    } else {
      p.stock_target = st;
    }
    // MIX: „ser kozi + brakujące warzywa” — zachowaj items[] z interpretacji
    if (!Array.isArray(p.items)) p.items = [];
    else {
      p.items = p.items
        .filter((it: any) => it && String(it.product_name || it.name || '').trim())
        .map((it: any) => {
          const rawQty = Number(it.quantity);
          const unit = String(it.unit || 'szt').trim() || 'szt';
          // Voice często wstawia „1 szt” bez sensu — zostaw puste pod „Stan optymalny”
          const isPlaceholderSzt =
            Number.isFinite(rawQty) && rawQty === 1 && /^(szt|sztuka|sztuki|opak|op)$/i.test(unit);
          const qty =
            Number.isFinite(rawQty) && rawQty > 0 && !isPlaceholderSzt ? rawQty : null;
          let uwv: number | null = null;
          if (it.unit_weight_volume != null && it.unit_weight_volume !== '') {
            const n = Number(it.unit_weight_volume);
            uwv = Number.isFinite(n) && n > 0 ? n : null;
          }
          return {
            product_name: String(it.product_name || it.name || '').trim(),
            quantity: qty,
            unit,
            unit_weight_volume: uwv,
            weight_volume_unit: it.weight_volume_unit
              ? String(it.weight_volume_unit).trim()
              : null,
            inventory_id: it.inventory_id || null,
          };
        });
    }
    // Dołącz produkty wyłuskane z categories[] (bez duplikatów)
    const existingKeys = new Set(
      p.items.map((it: any) => normPlVoice(String(it.product_name || ''))).filter(Boolean),
    );
    for (const name of peeled.named) {
      const key = normPlVoice(name);
      if (!key || existingKeys.has(key)) continue;
      existingKeys.add(key);
      p.items.push({
        product_name: name,
        quantity: null,
        unit: 'szt',
        unit_weight_volume: null,
        weight_volume_unit: null,
      });
    }
    const obj = String(p.cart_objective || '').trim().toLowerCase();
    const objMap: Record<string, string> = {
      fast_delivery: 'fast_delivery',
      min_deliveries: 'min_deliveries',
      lowest_price: 'lowest_price',
      'szybki czas dostawy': 'fast_delivery',
      'minimalna liczba dostaw': 'min_deliveries',
      'najniższa cena': 'lowest_price',
      'najnizsza cena': 'lowest_price',
    };
    p.cart_objective = objMap[obj] || null;
  }
  if (intent === 'order_product' || intent === 'order_critical_items_by_category') {
    if (!p.search_scope) p.search_scope = 'suppliers_only';
  }
  if (intent === 'order_product') {
    if (!Array.isArray(p.items) || p.items.length === 0) {
      p.items = [{ product_name: '', quantity: null, unit: 'szt' }];
    }
  }
  if (intent === 'bulk_edit_menu_prices_percentage' || intent === 'bulk_edit_menu_prices_fixed') {
    if (!p.price_mode) {
      p.price_mode = intent === 'bulk_edit_menu_prices_fixed' ? 'fixed' : 'percent';
    }
    if (!p.action) p.action = 'increase';
    if (opts?.fromLegend) {
      p.percentage = null;
      p.amount = null;
      p.category = '';
    }
  }
  if (intent === 'edit_menu_item_price' || intent === 'delete_menu_item') {
    if (opts?.fromLegend) {
      p.dish_accepted = false;
      p.dish_id = null;
      p.dish_name = '';
      p.dish_name_resolved = '';
      if (intent === 'edit_menu_item_price') p.new_price = null;
    } else {
      // Zawsze wymagaj kliknięcia podpowiedzi; w polu → najlepsza nazwa z menu (nie surowy transcript).
      const resolved = cleanSpokenDishQuery(String(p.dish_name_resolved || ''));
      const raw = cleanSpokenDishQuery(String(p.dish_name || ''));
      const fromTranscript = guessDishNameFromTranscript(String(opts?.transcript || ''), intent);
      const spoken = resolved || raw || fromTranscript;
      if (spoken) {
        p.dish_name = spoken;
        p.dish_name_resolved = resolved || spoken;
      }
      p.dish_accepted = false;
      p.dish_id = null;
      if (intent === 'edit_menu_item_price' && p.new_price === 0) p.new_price = null;
    }
  }
  if (intent === 'navigate_screen' && opts?.fromLegend) {
    p.screen = null;
  }
  // Kalkulator / wyłączanie dania — wymagają kliknięcia podpowiedzi
  if (intent === 'scale_recipe' || intent === 'toggle_menu_item_availability') {
    p.dish_accepted = false;
    if (intent === 'toggle_menu_item_availability' && p.available == null) {
      p.available = false;
    }
  }
  // Analizy okresu
  if (PERIOD_INTENTS.has(intent)) {
    const transcriptHint = String(opts?.transcript || p._transcript || '').trim();
    // Z legendy: puste drzewko — użytkownik sam wybiera okres
    if (opts?.fromLegend) {
      p.selected_periods = [];
      p.period_1 = '';
      p.period_2 = '';
      p.note = '';
      p.period_type = 'month';
    } else {
      if (!p.period_1 && typeof p.note === 'string' && p.note.trim()) {
        p.period_1 = p.note.trim();
      }
      if (!p.period_1 && transcriptHint) {
        p.period_1 = transcriptHint;
      }
      if (!p.period_type) {
        p.period_type = p.period_1 ? 'month' : 'year';
      }
      if (!Array.isArray(p.selected_periods) || p.selected_periods.length === 0) {
        const sels: PeriodSelection[] = [];
        const preferYear = new Date().getFullYear();
        const a = parsePeriodHintToSelection(String(p.period_1 || transcriptHint || ''), { preferYear });
        if (a) sels.push(a);
        if (intent === 'compare_two_periods') {
          const b = parsePeriodHintToSelection(String(p.period_2 || ''), { preferYear });
          if (b) sels.push(b);
        }
        if (!sels.length) {
          sels.push({ kind: 'year', year: preferYear });
        }
        if (sels.length) {
          p.selected_periods = sels;
          p.period_1 = labelForSelections(intent === 'compare_two_periods' && sels[0] ? [sels[0]] : sels);
          if (intent === 'compare_two_periods' && sels[1]) {
            p.period_2 = labelForSelections([sels[1]]);
          }
        }
      } else {
        const hintSrc = String(transcriptHint || p.period_1 || '');
        const yInHint = hintSrc.match(/\b(20\d{2})\b/);
        if (yInHint) {
          const yWanted = Number(yInHint[1]);
          const fixed = (p.selected_periods as PeriodSelection[]).map((s) =>
            s.year !== yWanted ? { ...s, year: yWanted } : s,
          );
          const parsed = parsePeriodHintToSelection(hintSrc, { preferYear: yWanted });
          p.selected_periods = parsed ? [parsed] : fixed;
          p.period_1 = labelForSelections(p.selected_periods);
        }
      }
    }
    if ((intent === 'rank_menu_sales' || intent === 'rank_inventory_usage') && !p.rank) {
      p.rank = 'best';
    }
    if ((intent === 'rank_menu_sales' || intent === 'rank_inventory_usage' || intent === 'rank_waste_cost' || intent === 'rank_dead_menu') && p.top_n == null) {
      p.top_n = intent === 'rank_dead_menu' ? 8 : 5;
    }
  }
  if (intent === 'list_expiring_soon') {
    if (p.limit_days == null) p.limit_days = 3650; // pełna drabina
    if (p.top_n == null) p.top_n = 100;
  }
  if (intent === 'rank_supplier_spend' && p.top_n == null) p.top_n = 5;
  if (intent === 'haccp_tip' && !p.item_name && p.product_name) p.item_name = p.product_name;
  if (intent === 'add_expiration_batch') {
    if (!Array.isArray(p.batches) || p.batches.length === 0) {
      p.batches = [
        {
          quantity: p.quantity ?? null,
          expiration_date: p.expiration_date ?? '',
        },
      ];
    }
    if (!Array.isArray(p.alert_days) || p.alert_days.length === 0) {
      p.alert_days = [7, 3, 1];
    }
    p.increase_stock = false;
  }
  return p;
}

// ────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────
