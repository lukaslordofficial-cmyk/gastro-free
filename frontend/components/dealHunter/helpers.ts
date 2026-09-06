import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
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
  Alert,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import {
  X,
  Sparkles,
  Truck,
  Mail,
  Copy,
  Check,
  ChevronRight,
  ChevronDown,
  Store,
  Phone,
  Send,
  CircleAlert,
  Minus,
  Plus,
  Trash2,
  Search,
  ShoppingCart,
  Package,
  CreditCard,
  Landmark,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAuth } from '@/contexts/AuthContext';
import { DEAL_HUNTER_GATE_MESSAGE, DEAL_HUNTER_GATE_TITLE } from '@/lib/dealHunterGate';
import { rankProductMatches } from '@/lib/fuzzyProductMatch';
import { formatPln } from '@/lib/format';
import {
  checkSupplierMinOrder,
  minOrderAlertCopy,
} from '@/lib/supplierMinOrder';
import { ASSISTANT_FROM_EMAIL } from '@/components/OrderEmailComposer';
import { stripAssistantOrderFooter } from '@/lib/orderEmailFooter';
import { openMailInBrowser } from '@/lib/openMailCompose';
import * as supplierOrdersService from '@/services/supplierOrdersService';
import {
  type OptimizeResult,
  type OfferItem,
  type SupplierGroup,
  initQuantities,
  normalizeOptimizeResult,
  recalcFromMatrix,
  recalcLineTotal,
  toSupplierGroups,
} from '@/lib/bargainHunter';
import { supabase } from '@/lib/supabase';
import { getAccountKey } from '@/lib/accountKey';
import { apiJsonHeaders } from '@/lib/apiHeaders';
import {
  type DealHunterSearchScope,
  DEAL_HUNTER_SEARCH_SCOPE_OPTIONS,
  DEFAULT_DEAL_HUNTER_SEARCH_SCOPE,
} from '@/lib/dealHunterSearchScope';
import { LocalProducerCheckoutSheet } from '@/components/dealHunter/LocalProducerCheckoutSheet';
import {
  ManualBankPaymentSheet,
  type ManualPaymentOrder,
} from '@/components/dealHunter/ManualBankPaymentSheet';

import type { InvStock, ProductLike, SelectedOption } from './types';

export function resolveSelectionFromCompare(compare: OptimizeResult): {
  option: SelectedOption;
  tiedId: string | null;
} {
  const rec = String(compare.recommended_scenario_id || '').trim();
  if (compare.is_multivariable) {
    const scenarios = (compare.scenarios?.length
      ? compare.scenarios
      : [compare.scenario_split_max, compare.scenario_monolith].filter(Boolean)
    ) as NonNullable<OptimizeResult['scenarios']>;
    const withBaskets = (id: string) => {
      const sc = scenarios.find((s) => s.id === id)
        ?? (id === 'split_max' ? compare.scenario_split_max : null)
        ?? (id === 'monolith' ? compare.scenario_monolith : null);
      return (sc?.suppliers ?? []).filter((g) => (g.items?.length ?? 0) > 0).length;
    };
    // smart_hybrid pomijamy — zostają tylko najniższa cena vs wygoda
    let recNorm = rec === 'smart_hybrid' ? 'split_max' : rec;
    if (
      (recNorm === 'monolith')
      && withBaskets('split_max') > withBaskets(recNorm)
      && withBaskets('split_max') >= 2
    ) {
      return { option: 'split_max', tiedId: null };
    }
    if (recNorm === 'split_max' || recNorm === 'monolith') {
      return { option: recNorm, tiedId: null };
    }
    if (recNorm && recNorm !== 'smart_hybrid') {
      return { option: recNorm as SelectedOption, tiedId: null };
    }
    const first =
      scenarios.find((s) => s.id !== 'smart_hybrid' && ((s.suppliers?.length ?? 0) > 0 || (s.missing?.length ?? 0) > 0))
      ?? scenarios.find((s) => s.id !== 'smart_hybrid')
      ?? scenarios[0];
    if (first?.id && first.id !== 'smart_hybrid') {
      return { option: first.id as SelectedOption, tiedId: null };
    }
    if (withBaskets('split_max') > 0) return { option: 'split_max', tiedId: null };
    if (withBaskets('monolith') > 0) return { option: 'monolith', tiedId: null };
  }
  if (compare.is_optimized) {
    // Preferuj rozbicie gdy ma ≥2 koszyki — inaczej giną zamówienia u drugiego dostawcy
    const splitN = (compare.variant_split?.suppliers ?? []).filter((g) => g.items?.length).length;
    if (splitN >= 2) return { option: 'optimized', tiedId: null };
    return {
      option: compare.cheaper_variant === 'split' ? 'optimized' : 'all_one',
      tiedId: null,
    };
  }
  const tied = compare.tied_suppliers ?? [];
  const tiedId =
    tied.length > 0
      ? tied[0].supplier_id
      : (compare.best_option?.supplier_id ?? null);
  return { option: 'single', tiedId };
}

export function suggestQty(p: ProductLike): number {
  const cur = Number(p.current_qty) || 0;
  const opt = Number(p.optimal_threshold) || 0;
  if (opt > 0) {
    const need = Math.round((opt - cur) * 100) / 100;
    return need > 0 ? need : 1;
  }
  const crit = Number(p.critical_threshold) || 0;
  if (crit > 0) {
    // Najmniejsza ilość, która wyprowadza powyżej progu krytycznego (qty > min)
    const unitStep = 1;
    const target = crit + unitStep;
    const need = Math.round((target - cur) * 100) / 100;
    return need > 0 ? need : unitStep;
  }
  const base = cur > 0 ? cur * 1.5 : 1;
  const rounded = Math.round(base * 100) / 100;
  return rounded > 0 ? rounded : 1;
}

export function recalcGroup(g: SupplierGroup): SupplierGroup {
  const items = g.items.map((it) => ({
    ...it,
    line_total: recalcLineTotal(it.unit_price_base, it.quantity, it.unit),
  }));
  const subtotal = Math.round(items.reduce((s, it) => s + it.line_total, 0) * 100) / 100;
  const minVal = g.min_order_value ?? 0;
  const gap = minVal > 0 ? Math.max(0, Math.round((minVal - subtotal) * 100) / 100) : 0;
  return {
    ...g,
    items,
    subtotal_pln: subtotal,
    meets_minimum_order: !minVal || minVal <= 0 || subtotal >= minVal,
    gap_to_minimum_pln: gap,
  };
}

export function sortCatalogMenuFirst<T extends { in_menu: boolean; name: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.in_menu !== b.in_menu) return a.in_menu ? -1 : 1;
    return a.name.localeCompare(b.name, 'pl');
  });
}

export function findWarehouseStock(inv: InvStock[], productName: string): InvStock | null {
  const n = (productName || '').toLowerCase().trim();
  if (!n) return null;
  let best: InvStock | null = null;
  let bestScore = 0;
  for (const i of inv) {
    const iname = (i.name || '').toLowerCase().trim();
    if (!iname) continue;
    if (iname === n) return i;
    let score = 0;
    if (iname.includes(n) || n.includes(iname)) {
      score = Math.min(iname.length, n.length) / Math.max(iname.length, n.length);
    } else {
      const at = new Set(iname.split(/\s+/).filter(Boolean));
      const bt = n.split(/\s+/).filter(Boolean);
      const hit = bt.filter((t) => at.has(t) || [...at].some((a) => a.includes(t) || t.includes(a))).length;
      if (bt.length) score = hit / bt.length;
    }
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return bestScore >= 0.45 ? best : null;
}
