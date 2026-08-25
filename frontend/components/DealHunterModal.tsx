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
  DeviceEventEmitter,
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
import { withAccountKey } from '@/lib/tenantScope';
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

import { BACKEND_URL, themedStyles, useDealColors } from './dealHunter/theme';
import type { CatalogRow, MessageCard, Props, SelectedOption, Step } from './dealHunter/types';
import { recalcGroup, resolveSelectionFromCompare, suggestQty } from './dealHunter/helpers';
import { MinOrderBadge, OfferLine } from './dealHunter/smallComponents';
import { SupplierCatalogPicker } from './dealHunter/SupplierCatalogPicker';
import { NewOrderBrowser } from './dealHunter/NewOrderBrowser';

export function DealHunterModal({
  visible,
  product,
  restaurantName,
  onClose,
  initialCompare,
  bulkContextLabel,
}: Props) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);
  const { alert: premiumAlert } = usePremiumAlert();
  const { user, profile: authProfile } = useAuth();
  const accountMail = (user?.email || authProfile?.email || '').trim();
  const { dealHunterUnlocked } = useSubscription();
  const lastDraftFpRef = useRef<string | null>(null);
  const compareScrollRef = useRef<ScrollView>(null);
  const [draftSavedInfo, setDraftSavedInfo] = useState<string | null>(null);
  const [step, setStep] = useState<Step>('qty');
  const [qty, setQty] = useState('1');
  const [searchScope, setSearchScope] = useState<DealHunterSearchScope>(
    DEFAULT_DEAL_HUNTER_SEARCH_SCOPE,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState<OptimizeResult | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [selectedOption, setSelectedOption] = useState<SelectedOption | null>(null);
  const [tiedSupplierId, setTiedSupplierId] = useState<string | null>(null);
  const [creditsNotice, setCreditsNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageCard[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendStatus, setSendStatus] = useState<Record<string, 'sending' | 'sent' | 'error'>>({});
  const [bodyText, setBodyText] = useState<Record<string, string>>({});
  const [subjectText, setSubjectText] = useState<Record<string, string>>({});
  const [fromEmails, setFromEmails] = useState<Record<string, string>>({});
  const [toEmails, setToEmails] = useState<Record<string, string>>({});
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [manualCart, setManualCart] = useState<SupplierGroup[] | null>(null);
  const [catalogPicker, setCatalogPicker] = useState<{ id: string; name: string } | null>(null);
  const [pendingGroups, setPendingGroups] = useState<SupplierGroup[] | null>(null);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [lpPayGroup, setLpPayGroup] = useState<SupplierGroup | null>(null);
  const [manualPayOrder, setManualPayOrder] = useState<ManualPaymentOrder | null>(null);

  const isBulkMode = !!initialCompare;

  const patchSupplierNamesInResult = useCallback(async (normalized: OptimizeResult) => {
    const ids = new Set<string>();
    const collect = (groups?: SupplierGroup[] | null) => {
      (groups ?? []).forEach((g) => {
        if (g.supplier_id && !g.is_local_producer) ids.add(g.supplier_id);
      });
    };
    collect(normalized.scenario_split_max?.suppliers);
    collect(normalized.scenario_monolith?.suppliers);
    collect(normalized.scenario_smart_hybrid?.suppliers);
    (normalized.scenarios ?? []).forEach((sc) => collect(sc.suppliers));
    collect(normalized.variant_split?.suppliers);
    if (normalized.variant_monolith?.supplier_id) ids.add(normalized.variant_monolith.supplier_id);
    if (normalized.best_option?.supplier_id) ids.add(normalized.best_option.supplier_id);
    (normalized.best_option?.suppliers ?? []).forEach((g) => {
      if (g.supplier_id) ids.add(g.supplier_id);
    });
    if (!ids.size) return normalized;

    const { data } = await supabase
      .from('suppliers')
      .select('id,name,email')
      .in('id', [...ids]);
    const byId: Record<string, { name: string; email: string | null }> = {};
    (data ?? []).forEach((r: any) => {
      const n = String(r.name || '').trim();
      if (r.id && n) byId[r.id] = { name: n, email: r.email ?? null };
    });
    if (!Object.keys(byId).length) return normalized;

    const fixGroup = (g: SupplierGroup): SupplierGroup => {
      if (g.is_local_producer) return g;
      const hit = g.supplier_id ? byId[g.supplier_id] : null;
      if (!hit) return g;
      const cur = (g.supplier_name || '').trim();
      if (cur && cur !== 'Dostawca' && g.supplier_email) return g;
      return {
        ...g,
        supplier_name: hit.name,
        supplier_email: g.supplier_email || hit.email,
      };
    };
    const fixGroups = (groups?: SupplierGroup[]) => (groups ?? []).map(fixGroup);
    const fixScenario = <T extends { suppliers?: SupplierGroup[] }>(sc?: T | null): T | null | undefined => {
      if (!sc) return sc;
      return { ...sc, suppliers: fixGroups(sc.suppliers) };
    };

    return {
      ...normalized,
      scenario_split_max: fixScenario(normalized.scenario_split_max) ?? normalized.scenario_split_max,
      scenario_monolith: fixScenario(normalized.scenario_monolith) ?? normalized.scenario_monolith,
      scenario_smart_hybrid: fixScenario(normalized.scenario_smart_hybrid) ?? normalized.scenario_smart_hybrid,
      scenarios: (normalized.scenarios ?? []).map((sc) => ({
        ...sc,
        suppliers: fixGroups(sc.suppliers),
      })),
      variant_split: normalized.variant_split
        ? { ...normalized.variant_split, suppliers: fixGroups(normalized.variant_split.suppliers) }
        : normalized.variant_split,
      variant_monolith: normalized.variant_monolith?.supplier_id && byId[normalized.variant_monolith.supplier_id]
        ? {
            ...normalized.variant_monolith,
            supplier_name: byId[normalized.variant_monolith.supplier_id].name,
            supplier_email:
              normalized.variant_monolith.supplier_email
              || byId[normalized.variant_monolith.supplier_id].email,
          }
        : normalized.variant_monolith,
      best_option: normalized.best_option
        ? {
            ...normalized.best_option,
            ...(normalized.best_option.supplier_id && byId[normalized.best_option.supplier_id]
              ? {
                  supplier_name: byId[normalized.best_option.supplier_id].name,
                  supplier_email:
                    normalized.best_option.supplier_email
                    || byId[normalized.best_option.supplier_id].email,
                }
              : {}),
            suppliers: fixGroups(normalized.best_option.suppliers),
          }
        : normalized.best_option,
    };
  }, []);

  const applyCompareResult = useCallback((raw: unknown) => {
    const normalized = normalizeOptimizeResult(raw as OptimizeResult);
    const sel = resolveSelectionFromCompare(normalized);
    setCompare(normalized);
    setQuantities(initQuantities(normalized));
    setSelectedOption(sel.option);
    setTiedSupplierId(sel.tiedId);
    setManualCart(null);
    if (normalized.credits_deducted && normalized.credits_deducted > 0) {
      const rem = normalized.credits_remaining ?? '—';
      setCreditsNotice(
        `Ta akcja kosztowała: ${normalized.credits_deducted} kredytów. Pozostałe saldo: ${rem}.`,
      );
    } else {
      setCreditsNotice(null);
    }
    // Uzupełnij nazwy dostawców z Supabase (gdy API zwróciło null / „Dostawca”)
    void patchSupplierNamesInResult(normalized).then((patched) => {
      if (patched !== normalized) setCompare(patched);
    });
    return normalized;
  }, [patchSupplierNamesInResult]);

  useEffect(() => {
    if (visible) {
      // Free / tier 1 bez trialu — zamknij modal i pokaż bramkę (nie uruchamiaj compare)
      if (!dealHunterUnlocked) {
        premiumAlert(DEAL_HUNTER_GATE_TITLE, DEAL_HUNTER_GATE_MESSAGE);
        onClose();
        return;
      }
      setError(null);
      setManualCart(null);
      setCatalogPicker(null);
      setPendingGroups(null);
      setShowNewOrder(false);
      setMessages([]);
      setCopiedId(null);
      setSendStatus({});
      setBodyText({});
      setSubjectText({});
      setFromEmails({});
      setToEmails({});
      setDraftSavedInfo(null);
      if (initialCompare) {
        setStep('compare');
        setQty('1');
        // Selection + compare w jednym kroku — edytowalny koszyk od razu, bez klikania kafelka.
        applyCompareResult(initialCompare);
      } else if (product) {
        setStep('qty');
        setQty(String(suggestQty(product)));
        setCompare(null);
        setQuantities({});
        setSelectedOption(null);
        setTiedSupplierId(null);
        setCreditsNotice(null);
      }
    }
  }, [visible, product, initialCompare, applyCompareResult, dealHunterUnlocked, premiumAlert, onClose]);

  const liveResult = useMemo(() => {
    if (!compare) return null;
    if (!compare.pricing_matrix?.length) return compare;
    return recalcFromMatrix(compare, quantities);
  }, [compare, quantities]);

  /** Gdy state chwilowo null — i tak pokaż koszyk rekomendowanego wariantu. */
  const effectiveSelectedOption = useMemo((): SelectedOption | null => {
    if (selectedOption) return selectedOption;
    if (!liveResult) return null;
    return resolveSelectionFromCompare(liveResult).option;
  }, [selectedOption, liveResult]);

  const baseSelectedSuppliers = useCallback((): SupplierGroup[] => {
    if (!liveResult || !effectiveSelectedOption) return [];
    if (
      effectiveSelectedOption === 'split_max'
      || effectiveSelectedOption === 'monolith'
      || effectiveSelectedOption === 'smart_hybrid'
    ) {
      return toSupplierGroups(liveResult, effectiveSelectedOption, tiedSupplierId);
    }
    const variant = liveResult.is_optimized
      ? effectiveSelectedOption === 'optimized'
        ? 'optimized'
        : 'all_one'
      : 'single';
    return toSupplierGroups(liveResult, variant, tiedSupplierId);
  }, [liveResult, effectiveSelectedOption, tiedSupplierId]);

  const updateQty = useCallback((key: string, value: number) => {
    setQuantities((prev) => ({ ...prev, [key]: value }));
    setManualCart((prev) => {
      const base = prev ?? baseSelectedSuppliers().map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) => ({ ...it })),
      }));
      if (!base.length) return prev;
      return base.map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) =>
          it.product_name === key ? { ...it, quantity: value } : it,
        ),
      }));
    });
  }, [baseSelectedSuppliers]);

  const ensureManualCart = useCallback((): SupplierGroup[] => {
    if (manualCart) return manualCart;
    const seeded = baseSelectedSuppliers().map((g) => recalcGroup({
      ...g,
      items: g.items.map((it) => ({ ...it })),
    }));
    setManualCart(seeded);
    return seeded;
  }, [manualCart, baseSelectedSuppliers]);

  const removeCartItem = useCallback((supplierId: string | null, productName: string) => {
    setManualCart((prev) => {
      const cart = prev ?? baseSelectedSuppliers().map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) => ({ ...it })),
      }));
      return cart
        .map((g) => {
          if (g.supplier_id !== supplierId) return g;
          return recalcGroup({
            ...g,
            items: g.items.filter((it) => it.product_name !== productName),
          });
        })
        .filter((g) => g.items.length > 0);
    });
  }, [baseSelectedSuppliers]);

  const addCatalogProduct = useCallback((row: CatalogRow) => {
    if (!catalogPicker) return;
    setManualCart((prev) => {
      const cart = prev ?? baseSelectedSuppliers().map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) => ({ ...it })),
      }));
      const unit = row.unit || 'szt';
      const qty = 1;
      const newItem: OfferItem = {
        product_name: row.name,
        quantity: qty,
        unit,
        base_dim: unit,
        unit_price_base: row.price_pln,
        matched_name: row.variant ? `${row.name} (${row.variant})` : row.name,
        line_total: recalcLineTotal(row.price_pln, qty, unit),
      };
      return cart.map((g) => {
        if (g.supplier_id !== catalogPicker.id) return g;
        const without = g.items.filter((it) => it.product_name !== row.name);
        return recalcGroup({
          ...g,
          supplier_name: catalogPicker.name || g.supplier_name,
          items: [...without, newItem],
        });
      });
    });
    setQuantities((prev) => ({ ...prev, [row.name]: 1 }));
    setCatalogPicker(null);
  }, [catalogPicker, baseSelectedSuppliers]);

  const resolveSupplierInCart = useCallback((info: {
    id: string;
    name: string;
    email?: string | null;
  }) => {
    const name = (info.name || '').trim();
    if (!name) return;
    setCatalogPicker((prev) => (prev && prev.id === info.id ? { ...prev, name } : prev));
    setManualCart((prev) => {
      const cart = prev ?? baseSelectedSuppliers().map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) => ({ ...it })),
      }));
      let changed = false;
      const next = cart.map((g) => {
        if (g.supplier_id !== info.id) return g;
        const cur = (g.supplier_name || '').trim();
        if (cur && cur !== 'Dostawca' && cur === name && (!info.email || g.supplier_email)) {
          return g;
        }
        changed = true;
        return {
          ...g,
          supplier_name: name,
          supplier_email: info.email ?? g.supplier_email,
        };
      });
      return changed ? next : prev;
    });
  }, [baseSelectedSuppliers]);

  const selectedSuppliers = useCallback((): SupplierGroup[] => {
    if (manualCart !== null) return manualCart;
    return baseSelectedSuppliers();
  }, [manualCart, baseSelectedSuppliers]);

  const [savingDraft, setSavingDraft] = useState(false);

  useEffect(() => {
    if (!visible) lastDraftFpRef.current = null;
  }, [visible]);

  const draftFingerprint = useCallback((groups: SupplierGroup[]) => {
    return groups
      .map((g) => {
        const items = g.items
          .map((it) => `${it.product_name}:${it.quantity}:${it.unit_price_base ?? 0}`)
          .sort()
          .join(',');
        return `${g.supplier_id}|${items}`;
      })
      .sort()
      .join('||');
  }, []);

  const saveDraftCart = useCallback(async () => {
    const MAX_GAP = 150;
    const allGroups = selectedSuppliers().filter((g) => g.items.length > 0 && g.supplier_id);
    const groups = allGroups.filter((g) => {
      const minV = Number(g.min_order_value ?? 0);
      if (minV <= 0) return true;
      const gap = minV - Number(g.subtotal_pln ?? 0);
      return gap <= MAX_GAP;
    });
    const skipped = allGroups.filter((g) => !groups.includes(g));
    if (groups.length === 0) {
      premiumAlert(
        'Za daleko do minimum',
        skipped.length
          ? `Nie zapisano koszyka — do minimum brakuje ponad ${MAX_GAP} zł (${skipped.map((g) => g.supplier_name).join(', ')}). `
            + 'Dorzuć produkty albo wybierz dostawcę bez tak wysokiego limitu.'
          : 'Brak pozycji do zapisania.',
      );
      return;
    }
    if (skipped.length) {
      Alert.alert(
        'Pominięto koszyki',
        `Nie zapisano: ${skipped.map((g) => g.supplier_name).join(', ')} — do minimum brakuje ponad ${MAX_GAP} zł.`,
      );
    }
    const fp = draftFingerprint(groups);
    if (lastDraftFpRef.current === fp) {
      premiumAlert('Już w koszyku', 'Już dodałeś to zamówienie do koszyka.');
      return;
    }
    setSavingDraft(true);
    try {
      let saved = 0;
      let savedLocal = 0;
      const { data: authData } = await supabase.auth.getUser();
      const restaurantId = authData?.user?.id ?? null;
      const accountKey = getAccountKey() || null;

      for (const g of groups) {
        if (g.is_local_producer) {
          if (!restaurantId || !accountKey || !g.supplier_id) {
            continue;
          }
          const { data: order, error: orderErr } = await supabase
            .from('producer_orders')
            .insert({
              producer_id: g.supplier_id,
              restaurant_id: restaurantId,
              restaurant_account_key: accountKey,
              total_price: Number(g.subtotal_pln) || 0,
              shipping_cost: Number(g.shipping_pln) || 0,
              payment_status: 'pending',
              shipment_status: 'draft',
              notes: 'Szkic z Łowcy Okazji',
            })
            .select('id')
            .single();
          if (orderErr || !order) throw orderErr ?? new Error('Nie utworzono zamówienia lokalnego');
          const rows = g.items
            .map((it) => {
              const productId = (it as { catalog_product_id?: string }).catalog_product_id;
              if (!productId) return null;
              return {
                order_id: order.id,
                product_id: productId,
                quantity: Number(it.quantity) || 0,
                unit_price: Number(it.unit_price_base) || 0,
              };
            })
            .filter(Boolean);
          if (rows.length) {
            const { error: itemsErr } = await supabase.from('producer_order_items').insert(rows);
            if (itemsErr) throw itemsErr;
          }
          savedLocal += 1;
          continue;
        }

        const { data: order, error: orderErr } = await supabase
          .from('supplier_orders')
          .insert(
            withAccountKey({
              supplier_id: g.supplier_id,
              status: 'draft',
              notes: null,
            }),
          )
          .select('id')
          .single();
        if (orderErr || !order) throw orderErr ?? new Error('Nie utworzono koszyka');
        const rows = await Promise.all(
          g.items.map(async (it) => {
            const whName = (it.product_name || '').trim();
            let wid: string | null =
              product && whName && product.product_name === whName ? product.id : null;
            if (!wid && whName) {
              wid = await supplierOrdersService.resolveWarehouseProductId(whName);
            }
            return {
              order_id: order.id,
              raw_product_name: it.matched_name || it.product_name,
              price_net: it.unit_price_base ?? null,
              unit: it.unit || 'szt',
              quantity_ordered: Number(it.quantity) || 0,
              warehouse_product_id: wid,
            };
          }),
        );
        const { error: itemsErr } = await supabase.from('supplier_order_items').insert(rows);
        if (itemsErr) throw itemsErr;
        saved += 1;
      }
      lastDraftFpRef.current = fp;
      try {
        DeviceEventEmitter.emit(supplierOrdersService.SUPPLIER_BASKET_CHANGED);
      } catch { /* ignore */ }
      const parts: string[] = [];
      if (saved) parts.push(`${saved} szkic(ów) u hurtowników (Dostawcy → Koszyk)`);
      if (savedLocal) parts.push(`${savedLocal} szkic(ów) u lokalnych przetwórców`);
      setDraftSavedInfo(
        parts.length
          ? `Utworzono: ${parts.join(' · ')}. Otwórz Dostawcy → Koszyk, żeby zobaczyć zapis.`
          : 'Brak koszyków do zapisania.',
      );
    } catch (e: any) {
      premiumAlert('Błąd', e?.message ?? 'Nie udało się zapisać koszyka.');
    } finally {
      setSavingDraft(false);
    }
  }, [selectedSuppliers, draftFingerprint, premiumAlert]);

  // When user taps another scenario — drop edits and show that full cart at top
  const selectOption = useCallback((opt: SelectedOption) => {
    setSelectedOption(opt);
    if (liveResult) {
      const groups = toSupplierGroups(liveResult, opt, tiedSupplierId)
        .filter((g) => (g.items?.length ?? 0) > 0)
        .map((g) => recalcGroup({
          ...g,
          items: g.items.map((it) => ({ ...it })),
        }));
      setManualCart(groups.length ? groups : null);
    } else {
      setManualCart(null);
    }
    requestAnimationFrame(() => {
      compareScrollRef.current?.scrollTo({ y: 0, animated: true });
    });
  }, [liveResult, tiedSupplierId]);

  const runCompare = useCallback(async () => {
    if (!product) return;
    if (!dealHunterUnlocked) {
      premiumAlert(DEAL_HUNTER_GATE_TITLE, DEAL_HUNTER_GATE_MESSAGE);
      onClose();
      return;
    }
    const q = parseFloat(qty.replace(',', '.'));
    if (isNaN(q) || q <= 0) {
      setError('Podaj poprawną ilość (liczba > 0).');
      return;
    }
    setError(null);
    setLoading(true);
    setStep('compare');
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders/compare-offers`, {
        method: 'POST',
        headers: await apiJsonHeaders(),
        body: JSON.stringify({
          restaurant_name: restaurantName ?? 'Nasza restauracja',
          search_scope: searchScope,
          items: [{ product_name_or_id: product.product_name, quantity: q, unit: product.unit }],
        }),
      });
      if (!res.ok) throw new Error(`Błąd serwera (${res.status})`);
      const data = await res.json();
      const normalized = applyCompareResult(data);
      if (!normalized.best_option && !normalized.option_optimized?.suppliers?.length) {
        setError(
          searchScope === 'local_producers_only'
            ? 'Nie znaleziono tego produktu u lokalnych dostawców.'
            : searchScope === 'both'
              ? 'Nie znaleziono tego produktu u hurtowników ani lokalnych dostawców.'
              : 'Nie znaleziono tego produktu w katalogu dostawców.',
        );
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się pobrać ofert.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [product, qty, restaurantName, searchScope, applyCompareResult, dealHunterUnlocked, premiumAlert, onClose]);

  const generateMessages = useCallback(async (groups?: SupplierGroup[]) => {
    const suppliers = groups ?? pendingGroups ?? selectedSuppliers();
    if (suppliers.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders/generate-messages`, {
        method: 'POST',
        headers: await apiJsonHeaders(),
        body: JSON.stringify({
          restaurant_name: restaurantName || undefined,
          suppliers,
        }),
      });
      if (!res.ok) throw new Error(`Błąd serwera (${res.status})`);
      const data = await res.json();
      const msgs: MessageCard[] = data.messages ?? [];
      setMessages(msgs);
      const profileEmail = (
        (data.profile?.contact_email as string | undefined)
        || contactEmail
        || accountMail
        || ''
      ).trim();
      const preferredFrom = profileEmail || ASSISTANT_FROM_EMAIL;
      const useAssistant = preferredFrom.toLowerCase() === ASSISTANT_FROM_EMAIL.toLowerCase();
      const initial: Record<string, string> = {};
      const subjectInit: Record<string, string> = {};
      const fromInit: Record<string, string> = {};
      const toInit: Record<string, string> = {};
      msgs.forEach((m) => {
        const key = m.supplier_id ?? m.supplier_name;
        const raw = m.email_body_text ?? m.email_text ?? '';
        initial[key] = useAssistant ? raw : stripAssistantOrderFooter(raw);
        subjectInit[key] = m.email_subject ?? '';
        fromInit[key] = preferredFrom;
        toInit[key] = m.supplier_email ?? '';
      });
      setBodyText(initial);
      setSubjectText(subjectInit);
      setFromEmails(fromInit);
      setToEmails(toInit);
      setPendingGroups(null);
      setStep('preview');
      // Panel Zamówienia → Przygotowywane
      try {
        for (const g of suppliers) {
          if (g.is_local_producer || !g.supplier_id) continue;
          await supplierOrdersService.ensureSentOrderForSupplier({
            supplierId: g.supplier_id,
            notes: 'Łowca Okazji',
            items: await Promise.all(
              (g.items || []).map(async (it) => {
                const whName = (it.product_name || '').trim();
                let wid: string | null =
                  product && whName && product.product_name === whName ? product.id : null;
                if (!wid && whName) {
                  wid = await supplierOrdersService.resolveWarehouseProductId(whName);
                }
                return {
                  raw_product_name: it.matched_name || it.product_name,
                  price_net: it.unit_price_base ?? null,
                  unit: it.unit || 'szt',
                  quantity_ordered: Number(it.quantity) || 0,
                  warehouse_product_id: wid,
                };
              }),
            ),
          });
        }
      } catch {
        /* best-effort — mail i tak działa */
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się wygenerować wiadomości.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [selectedSuppliers, restaurantName, pendingGroups, contactEmail, accountMail]);

  const prepareEmailForGroups = useCallback(async (groups: SupplierGroup[]) => {
    if (!groups.length) return;
    // Lokalni → Stripe Checkout (jak w Lokalni Przetwórcy), nie e-mail/SMS
    const localGroups = groups.filter((g) => g.is_local_producer && g.items.length > 0);
    const wholesalerGroups = groups.filter((g) => !g.is_local_producer && g.items.length > 0);
    if (localGroups.length === 1 && wholesalerGroups.length === 0) {
      setLpPayGroup(localGroups[0]);
      return;
    }
    if (localGroups.length > 0 && wholesalerGroups.length === 0) {
      // Kilka lokalnych naraz — po kolei (pierwszy sheet)
      setLpPayGroup(localGroups[0]);
      if (localGroups.length > 1) {
        Alert.alert(
          'Lokalni dystrybutorzy',
          `Masz ${localGroups.length} koszyków lokalnych. Opłać pierwszy w Stripe, potem wróć i zamów kolejne.`,
        );
      }
      return;
    }
    if (localGroups.length > 0 && wholesalerGroups.length > 0) {
      Alert.alert(
        'Mieszane zamówienie',
        'Lokalnych dystrybutorów opłacisz przez Stripe (przycisk „Zamów i zapłać” przy ich koszyku). '
        + 'Teraz przygotujemy e-mail/SMS tylko do hurtowników.',
      );
    }
    const withItems = wholesalerGroups.length ? wholesalerGroups : groups.filter((g) => g.items.length > 0);
    if (!withItems.length) {
      setError('Brak pozycji do zamówienia u tego dostawcy.');
      return;
    }
    const underMin = withItems.filter(
      (g) => (g.min_order_value ?? 0) > 0 && !g.meets_minimum_order,
    );
    // Twardy próg: luka > 150 zł → nie buduj / nie wysyłaj koszyka
    const MAX_GAP = 150;
    const gapTooBig = withItems.filter((g) => {
      const minV = Number(g.min_order_value ?? 0);
      if (minV <= 0) return false;
      const gap = minV - Number(g.subtotal_pln ?? 0);
      return gap > MAX_GAP;
    });
    const cleaned = withItems.filter(
      (g) => {
        const minV = Number(g.min_order_value ?? 0);
        if (minV <= 0) return true;
        if (g.meets_minimum_order === false) return false;
        return (minV - Number(g.subtotal_pln ?? 0)) <= MAX_GAP;
      },
    );
    if (gapTooBig.length) {
      const names = gapTooBig.map((g) => g.supplier_name).join(', ');
      Alert.alert(
        'Za daleko do minimum',
        `Pominięto koszyki, w których do minimum brakuje ponad ${MAX_GAP} zł: ${names}. `
        + 'Dorzuć produkty do większego zamówienia albo wybierz inny wariant.',
      );
    } else if (underMin.length) {
      const names = underMin.map((g) => g.supplier_name).join(', ');
      Alert.alert(
        'Poniżej minimum zamówienia',
        `Pominięto koszyki poniżej min. logistycznego: ${names}. `
        + 'Dorzuć produkty lub wybierz inny wariant.',
      );
    }
    if (!cleaned.length) {
      setError('Żaden koszyk nie spełnia minimum zamówienia u dostawcy.');
      return;
    }
    setPendingGroups(cleaned);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/restaurant/profile`, {
        headers: await apiJsonHeaders(),
      });
      const data = await res.json();
      setContactEmail((data.contact_email || accountMail || '').trim());
      setContactPhone(data.contact_phone ?? '');
      const emailOk = !!(String(data.contact_email || accountMail || '').trim());
      const phoneOk = !!(String(data.contact_phone || '').trim());
      if (emailOk && phoneOk) {
        await generateMessages(cleaned);
      } else {
        setStep('contact');
        setLoading(false);
      }
    } catch {
      setStep('contact');
      setLoading(false);
    }
  }, [generateMessages, accountMail]);

  const saveProfile = useCallback(async () => {
    const email = contactEmail.trim();
    const phone = contactPhone.trim();
    if (!email || !phone) {
      setError('Uzupełnij e-mail i telefon kontaktowy.');
      return;
    }
    if (!email.includes('@') || !email.includes('.')) {
      setError('Podaj poprawny adres e-mail.');
      return;
    }
    setSavingProfile(true);
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/restaurant/profile`, {
        method: 'PUT',
        headers: await apiJsonHeaders(),
        body: JSON.stringify({ contact_email: email, contact_phone: phone }),
      });
      if (!res.ok) throw new Error('Nie udało się zapisać danych.');
      await generateMessages(pendingGroups ?? undefined);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się zapisać danych.';
      setError(msg);
    } finally {
      setSavingProfile(false);
    }
  }, [contactEmail, contactPhone, generateMessages, pendingGroups]);

  const addProductToOrder = useCallback((opts: {
    supplierId: string;
    supplierName: string;
    supplierEmail: string | null;
    productName: string;
    unit: string;
    unitPrice: number;
    quantity?: number;
    minOrder?: number;
  }) => {
    const qty = opts.quantity ?? 1;
    const newItem: OfferItem = {
      product_name: opts.productName,
      quantity: qty,
      unit: opts.unit || 'szt',
      base_dim: opts.unit || 'szt',
      unit_price_base: opts.unitPrice,
      matched_name: opts.productName,
      line_total: recalcLineTotal(opts.unitPrice, qty, opts.unit || 'szt'),
    };
    setManualCart((prev) => {
      const base = prev ?? baseSelectedSuppliers().map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) => ({ ...it })),
      }));
      const idx = base.findIndex((g) => g.supplier_id === opts.supplierId);
      if (idx >= 0) {
        const g = base[idx];
        const without = g.items.filter((it) => it.product_name !== opts.productName);
        const next = [...base];
        next[idx] = recalcGroup({ ...g, items: [...without, newItem] });
        return next;
      }
      return [
        ...base,
        recalcGroup({
          supplier_id: opts.supplierId,
          supplier_name: opts.supplierName,
          supplier_email: opts.supplierEmail,
          items: [newItem],
          subtotal_pln: 0,
          min_order_value: opts.minOrder ?? 0,
        }),
      ];
    });
    setQuantities((q) => ({ ...q, [opts.productName]: qty }));
    if (!selectedOption) setSelectedOption('single');
    setShowNewOrder(false);
  }, [baseSelectedSuppliers, selectedOption]);

  async function copySms(m: MessageCard) {
    await Clipboard.setStringAsync(m.sms_text);
    setCopiedId(m.supplier_id ?? m.supplier_name);
    setTimeout(() => setCopiedId(null), 1800);
  }

  const sendEmail = useCallback(async (m: MessageCard) => {
    const key = m.supplier_id ?? m.supplier_name;
    const to = (toEmails[key] ?? m.supplier_email ?? '').trim();
    const from = (fromEmails[key] ?? ASSISTANT_FROM_EMAIL).trim() || ASSISTANT_FROM_EMAIL;
    const subject = (subjectText[key] ?? m.email_subject ?? '').trim() || m.email_subject;
    const body = bodyText[key] ?? m.email_body_text;
    if (!to) {
      Alert.alert('Brak odbiorcy', 'Podaj adres e-mail dostawcy.');
      return;
    }
    if (m.supplier_id) {
      const check = await checkSupplierMinOrder({
        supplierId: m.supplier_id,
        subtotalPln: Number(m.subtotal_pln) || 0,
        supplierName: m.supplier_name,
      });
      if (!check.ok) {
        const copy = minOrderAlertCopy(check);
        premiumAlert(copy.title, copy.message);
        return;
      }
    }
    const usesAssistant = from.toLowerCase() === ASSISTANT_FROM_EMAIL.toLowerCase();
    const bodyToSend = usesAssistant ? body : stripAssistantOrderFooter(body);
    if (!usesAssistant) {
      try {
        await openMailInBrowser({
          fromEmail: from,
          to,
          subject,
          body: bodyToSend,
        });
        setSendStatus((s) => ({ ...s, [key]: 'sent' }));
        if (m.supplier_id) {
          try {
            const ak = getAccountKey();
            let q = supabase
              .from('supplier_orders')
              .select('id')
              .eq('supplier_id', m.supplier_id)
              .eq('status', 'draft');
            if (ak && ak !== 'default') q = q.eq('account_key', ak);
            const { data } = await q;
            const ids = (data || []).map((r: { id: string }) => r.id);
            if (ids.length) {
              await supabase.from('supplier_orders').update({ status: 'sent' }).in('id', ids);
              try {
                DeviceEventEmitter.emit(supplierOrdersService.SUPPLIER_BASKET_CHANGED);
              } catch { /* ignore */ }
            }
          } catch {
            /* best-effort */
          }
        }
        premiumAlert(
          'Zamówienie',
          'Twoje zamówienie trafiło do zakładki Dostawy - Przygotowywane',
        );
      } catch {
        setSendStatus((s) => ({ ...s, [key]: 'error' }));
      }
      return;
    }
    setSendStatus((s) => ({ ...s, [key]: 'sending' }));
    try {
      const res = await fetch(`${BACKEND_URL}/api/orders/send-email`, {
        method: 'POST',
        headers: await apiJsonHeaders(),
        body: JSON.stringify({
          to,
          subject,
          body_text: bodyToSend,
          from_email: ASSISTANT_FROM_EMAIL,
          supplier_name: m.supplier_name,
        }),
      });
      if (!res.ok) throw new Error();
      setSendStatus((s) => ({ ...s, [key]: 'sent' }));
      if (m.supplier_id) {
        try {
          const ak = getAccountKey();
          let q = supabase
            .from('supplier_orders')
            .select('id')
            .eq('supplier_id', m.supplier_id)
            .eq('status', 'draft');
          if (ak && ak !== 'default') q = q.eq('account_key', ak);
          const { data } = await q;
          const ids = (data || []).map((r: { id: string }) => r.id);
          if (ids.length) {
            await supabase.from('supplier_orders').update({ status: 'sent' }).in('id', ids);
            try {
              DeviceEventEmitter.emit(supplierOrdersService.SUPPLIER_BASKET_CHANGED);
            } catch { /* ignore */ }
          }
        } catch {
          /* best-effort */
        }
      }
    } catch {
      setSendStatus((s) => ({ ...s, [key]: 'error' }));
    }
  }, [toEmails, fromEmails, bodyText, subjectText, premiumAlert]);

  const sendAllEmails = useCallback(async () => {
    if (!messages.length) return;
    const pending = messages.filter((m) => {
      const key = m.supplier_id ?? m.supplier_name;
      return sendStatus[key] !== 'sent';
    });
    if (!pending.length) {
      Alert.alert('Gotowe', 'Wszystkie zamówienia zostały już wysłane.');
      return;
    }
    const allAssistant = pending.every((m) => {
      const key = m.supplier_id ?? m.supplier_name;
      const from = (fromEmails[key] ?? ASSISTANT_FROM_EMAIL).trim().toLowerCase();
      return from === ASSISTANT_FROM_EMAIL.toLowerCase();
    });
    if (!allAssistant) {
      Alert.alert(
        'Wysyłka po kolei',
        'Przy prywatnym nadawcy otwieramy skrzynkę osobno dla każdego dostawcy. '
        + 'Ustaw nadawcę na asystent.dostaw@gastromanager.org, aby wysłać wszystko naraz z poziomu aplikacji.',
      );
    }
    for (const m of pending) {
      // eslint-disable-next-line no-await-in-loop
      await sendEmail(m);
    }
  }, [messages, sendStatus, fromEmails, sendEmail, premiumAlert]);

  const result = liveResult;
  const stepIndex = step === 'qty' ? 0 : step === 'compare' ? 1 : 2;
  const stepLabels = isBulkMode ? ['Oferty', 'Kontakt', 'Wyślij'] : ['Ilość', 'Oferty', 'Wyślij'];
  const bulkStepIndex = isBulkMode
    ? step === 'compare'
      ? 0
      : step === 'contact'
        ? 1
        : step === 'preview'
          ? 2
          : 0
    : stepIndex;

  const renderEditableCart = () => {
    if (!effectiveSelectedOption) return null;
    const groups = selectedSuppliers().filter((g) => g.items.length > 0);
    const orderable = groups.filter(
      (g) => (g.min_order_value ?? 0) <= 0 || g.meets_minimum_order !== false,
    );
    const grand = Math.round(groups.reduce((s, g) => s + g.subtotal_pln, 0) * 100) / 100;
    const ctaBg = C.isPremium ? '#5CFFB0' : C.accent;
    const ctaFg = C.isPremium ? '#0A0A0A' : C.white;

    // Braki: (1) nie ma w katalogach, (2) są w katalogu, ale nie weszły do koszyka (min. zamówienia itd.)
    const { catalogMissing, basketMissing } = (() => {
      const catalog: string[] = [];
      const basket: string[] = [];
      const seenCat = new Set<string>();
      const seenBasket = new Set<string>();
      const pushUnique = (list: string[], seen: Set<string>, name: string) => {
        const n = String(name || '').trim();
        const key = n.toLowerCase();
        if (!n || seen.has(key)) return;
        seen.add(key);
        list.push(n);
      };

      if (!result) return { catalogMissing: catalog, basketMissing: basket };

      for (const r of result.items_requested ?? []) {
        if (r.found) continue;
        pushUnique(catalog, seenCat, r.product_name);
      }
      for (const name of result.not_found_products ?? []) {
        pushUnique(catalog, seenCat, name);
      }

      // Braki scenariusza (znalezione, ale nie przypisane do koszyka)
      const opt = effectiveSelectedOption;
      let scenarioMissing: string[] = [];
      if (opt === 'split_max' || opt === 'monolith' || opt === 'smart_hybrid') {
        const sc =
          (result.scenarios ?? []).find((s) => s.id === opt)
          ?? (opt === 'split_max' ? result.scenario_split_max : null)
          ?? (opt === 'monolith' ? result.scenario_monolith : null)
          ?? (opt === 'smart_hybrid' ? result.scenario_smart_hybrid : null);
        scenarioMissing = sc?.missing ?? [];
      } else if (opt === 'optimized') {
        scenarioMissing =
          result.option_optimized?.missing
          ?? result.variant_split?.missing
          ?? [];
      } else if (opt === 'all_one') {
        scenarioMissing =
          result.option_all_one?.missing
          ?? result.best_option?.missing
          ?? [];
      }
      for (const name of scenarioMissing) {
        pushUnique(basket, seenBasket, name);
      }

      // Pozycje „found” których nie ma w aktualnych grupach koszyka
      const inCart = new Set<string>();
      for (const g of groups) {
        for (const it of g.items ?? []) {
          const k = String(it.product_name || '').trim().toLowerCase();
          if (k) inCart.add(k);
        }
      }
      for (const r of result.items_requested ?? []) {
        if (!r.found) continue;
        const name = String(r.product_name || '').trim();
        const key = name.toLowerCase();
        if (!name || inCart.has(key) || seenCat.has(key)) continue;
        pushUnique(basket, seenBasket, name);
      }

      // Nie duplikuj nazw już w „brak w katalogu”
      const basketFiltered = basket.filter((n) => !seenCat.has(n.toLowerCase()));
      return { catalogMissing: catalog, basketMissing: basketFiltered };
    })();
    const packNotes: string[] = Array.isArray((result as any)?.pack_adjustment_notes)
      ? ((result as any).pack_adjustment_notes as string[]).filter((n) => !!String(n || '').trim())
      : [];

    return (
      <View style={styles.editCart} testID="deal-hunter-edit-cart">
        <Text style={styles.editCartTitle}>
          {effectiveSelectedOption === 'split_max' || effectiveSelectedOption === 'optimized'
            ? 'Zamówienie · Najniższa cena'
            : effectiveSelectedOption === 'monolith' || effectiveSelectedOption === 'all_one'
              ? 'Zamówienie · Wygoda (mało dostaw)'
              : 'Zamówienia u dostawców'}
        </Text>
        {groups.length > 0 ? (
          <Text style={[styles.speechText, { fontWeight: '700', marginBottom: 4 }]} testID="deal-hunter-suppliers-summary">
            Od: {groups.map((g) => {
              const name = (g.supplier_name || '').trim() || 'Dostawca';
              return g.is_local_producer ? `${name}` : name;
            }).join(' · ')}
          </Text>
        ) : null}
        <Text style={styles.editCartHint}>
          Edytuj pozycje. Dorzuć z katalogu tego dostawcy albo „Nowe zamówienie” (inni dostawcy).
        </Text>
        <TouchableOpacity
          style={[styles.newOrderBtn, { marginBottom: 8 }]}
          onPress={() => setShowNewOrder(true)}
          activeOpacity={0.85}
          testID="deal-hunter-new-order-btn-top"
        >
          <Package size={16} color={C.accent} strokeWidth={2.2} />
          <Text style={styles.newOrderBtnText} numberOfLines={2}>
            Dodaj z katalogów
          </Text>
        </TouchableOpacity>
        {groups.length === 0 ? (
          <Text style={styles.newOrderHint}>
            Brak pozycji w koszyku. Skorzystaj z przycisku powyżej, aby dodać produkty.
          </Text>
        ) : (
          groups.map((g, gi) => {
            const blocked = (g.min_order_value ?? 0) > 0 && g.meets_minimum_order === false;
            return (
            <View key={`${g.supplier_id}-${gi}`} style={styles.supplierOrderCard}>
              <View style={styles.groupHeader}>
                <Truck size={16} color={C.accent} strokeWidth={2.2} />
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[styles.editCartHint, { marginBottom: 0 }]}>
                    {g.is_local_producer ? 'Lokalny przetwórca' : 'Zamówienie od'}
                  </Text>
                  <Text style={styles.groupName} numberOfLines={2}>
                    {(g.supplier_name || '').trim() || 'Dostawca (uzupełnij nazwę)'}
                  </Text>
                  {g.is_local_producer && g.local_producer_city ? (
                    <Text style={[styles.editCartHint, { marginBottom: 0 }]}>
                      {g.local_producer_city}
                      {g.local_producer_voivodeship ? ` · ${g.local_producer_voivodeship}` : ''}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.groupSub}>{formatPln(g.subtotal_pln)}</Text>
              </View>
              <Text style={[styles.editCartHint, { marginBottom: 6 }]}>
                {g.is_local_producer
                  ? 'Płatność Stripe (produkty + kurier + 5% serwisu) — bez e-maila do dystrybutora.'
                  : g.supplier_email
                    ? `E-mail: ${g.supplier_email}`
                    : 'Brak e-maila dostawcy — uzupełnij w module Dostawcy.'}
              </Text>
              <MinOrderBadge meets={g.meets_minimum_order} minVal={g.min_order_value} />
              {g.items.map((it, idx) => (
                <OfferLine
                  key={`edit-${g.supplier_id}-${it.product_name}-${idx}`}
                  item={it}
                  productKey={it.product_name}
                  onQtyChange={updateQty}
                  editable
                  onRemove={() => removeCartItem(g.supplier_id, it.product_name)}
                />
              ))}
              // „Dodaj z katalogu” tylko dla hurtowników — lokalni mają produkty marketplace
              {!g.is_local_producer ? (
              <TouchableOpacity
                style={styles.addFromCatalogBtn}
                onPress={() => {
                  if (g.supplier_id) {
                    setCatalogPicker({
                      id: g.supplier_id,
                      name: (g.supplier_name || '').trim() || 'Dostawca',
                    });
                  } else {
                    setShowNewOrder(true);
                  }
                }}
                activeOpacity={0.8}
                testID={`deal-hunter-add-catalog-${g.supplier_id ?? gi}`}
              >
                <Plus size={14} color={C.accent} strokeWidth={2.5} />
                <Text style={styles.addFromCatalogText}>
                  {g.supplier_id
                    ? 'Dodaj z katalogu tego dostawcy'
                    : 'Dodaj produkt z katalogów dostawców'}
                </Text>
              </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={[
                  styles.prepareSupplierBtn,
                  { backgroundColor: blocked ? C.dangerLight : ctaBg },
                  (loading || blocked) && styles.primaryBtnDisabled,
                ]}
                onPress={() => {
                  if (g.is_local_producer) setLpPayGroup(g);
                  else void prepareEmailForGroups([g]);
                }}
                disabled={loading || blocked}
                activeOpacity={0.85}
                testID={`deal-hunter-prepare-${g.supplier_id ?? gi}`}
              >
                {loading ? (
                  <ActivityIndicator size="small" color={ctaFg} />
                ) : (
                  <>
                    {g.is_local_producer && !blocked ? (
                      <CreditCard size={15} color={ctaFg} strokeWidth={2.2} />
                    ) : (
                      <Mail size={15} color={blocked ? C.danger : ctaFg} strokeWidth={2.2} />
                    )}
                    <Text style={[styles.prepareSupplierBtnText, { color: blocked ? C.danger : ctaFg }]}>
                      {blocked
                        ? 'Poniżej minimum — uzupełnij koszyk'
                        : g.is_local_producer
                          ? 'Zamów i zapłać'
                          : 'Przygotuj e-mail/SMS'}
                    </Text>
                  </>
                )}
              </TouchableOpacity>
              {!g.is_local_producer && !blocked ? (
                <TouchableOpacity
                  style={styles.payBtn}
                  onPress={() =>
                    setManualPayOrder({
                      supplierId: g.supplier_id,
                      supplierName: (g.supplier_name || '').trim() || 'Dostawca',
                      orderTitle: `Zamówienie — ${(g.supplier_name || '').trim() || 'Dostawca'}`,
                      totalPln: Number(g.total_pln ?? g.subtotal_pln) || 0,
                    })
                  }
                  activeOpacity={0.85}
                  testID={`deal-hunter-cart-manual-pay-${g.supplier_id ?? gi}`}
                >
                  <Landmark size={16} color={C.accent} strokeWidth={2.2} />
                  <Text style={styles.payBtnText}>Opłać zamówienie</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            );
          })
        )}

        {packNotes.length > 0 ? (
          <View style={[styles.missingBox, { borderColor: C.accent, backgroundColor: C.isPremium ? 'rgba(92,255,176,0.08)' : 'rgba(0,0,0,0.04)' }]} testID="deal-hunter-pack-notes">
            <Text style={[styles.missingTitle, { color: C.accentDark || C.accent }]}>Dopasowanie opakowań</Text>
            {packNotes.map((note, i) => (
              <Text key={`pack-note-${i}`} style={[styles.missingName, { color: C.text, marginBottom: 6 }]}>
                {note}
              </Text>
            ))}
          </View>
        ) : null}
        {catalogMissing.length > 0 || basketMissing.length > 0 ? (
          <Text style={[styles.editCartHint, { marginBottom: 6 }]} testID="deal-hunter-missing-count">
            Braki łącznie: {catalogMissing.length + basketMissing.length}
            {result?.items_requested?.length
              ? ` z ${result.items_requested.length} pozycji`
              : ''}
          </Text>
        ) : null}
        {catalogMissing.length > 0 ? (
          <View style={styles.missingBox} testID="deal-hunter-missing-catalog">
            <Text style={[styles.editCartHint, { color: C.danger, marginBottom: 4 }]}>
              Brak w katalogach dostawców ({catalogMissing.length})
            </Text>
            {catalogMissing.map((name) => (
              <Text key={`cat-${name}`} style={styles.missingName} numberOfLines={2}>
                • {name}
              </Text>
            ))}
          </View>
        ) : null}
        {basketMissing.length > 0 ? (
          <View style={styles.missingBox} testID="deal-hunter-missing-basket">
            <Text style={[styles.editCartHint, { color: C.danger, marginBottom: 4 }]}>
              Znalezione, ale nie weszły do koszyka ({basketMissing.length})
              {'\n'}
              (np. za daleko do minimum zamówienia albo reguły optymalizacji)
            </Text>
            {basketMissing.map((name) => (
              <Text key={`bask-${name}`} style={styles.missingName} numberOfLines={2}>
                • {name}
              </Text>
            ))}
          </View>
        ) : null}

        {groups.length > 0 && (
          <View style={styles.optTotalRow}>
            <Text style={styles.optTotalLabel}>Suma wszystkich zamówień</Text>
            <Text style={styles.optTotalValue}>{formatPln(grand)}</Text>
          </View>
        )}

        {orderable.length > 1 && (
          <TouchableOpacity
            style={[styles.prepareSupplierBtn, { backgroundColor: ctaBg }, loading && styles.primaryBtnDisabled]}
            onPress={() => prepareEmailForGroups(orderable)}
            disabled={loading}
            activeOpacity={0.85}
            testID="deal-hunter-order-all"
          >
            {loading ? (
              <ActivityIndicator size="small" color={ctaFg} />
            ) : (
              <>
                {orderable.every((g) => g.is_local_producer) ? (
                  <CreditCard size={15} color={ctaFg} strokeWidth={2.2} />
                ) : (
                  <Send size={15} color={ctaFg} strokeWidth={2.2} />
                )}
                <Text style={[styles.prepareSupplierBtnText, { color: ctaFg }]}>
                  {orderable.every((g) => g.is_local_producer)
                    ? `Zamów i zapłać (${orderable.length})`
                    : orderable.some((g) => g.is_local_producer)
                      ? `Zamów hurtowników · lokalni osobno (${orderable.length})`
                      : `Zamów wszystkie (${orderable.length})`}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        {groups.length > 0 && (
          <TouchableOpacity
            style={[styles.saveDraftBtn, savingDraft && { opacity: 0.6 }]}
            onPress={() => void saveDraftCart()}
            disabled={savingDraft}
            activeOpacity={0.85}
            testID="deal-hunter-save-draft"
          >
            {savingDraft ? (
              <ActivityIndicator size="small" color={C.accent} />
            ) : (
              <>
                <ShoppingCart size={16} color={C.accent} strokeWidth={2.2} />
                <Text style={styles.saveDraftBtnText}>Dodaj do koszyka (na później)</Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={styles.newOrderBtn}
          onPress={() => setShowNewOrder(true)}
          activeOpacity={0.85}
          testID="deal-hunter-new-order-btn"
        >
          <Package size={16} color={C.accent} strokeWidth={2.2} />
          <Text style={styles.newOrderBtnText}>Nowe zamówienie</Text>
        </TouchableOpacity>
        <Text style={styles.newOrderHint}>
          Przeszukaj katalogi dostawców i ręcznie dodaj produkty (także od innych hurtowników).
        </Text>
      </View>
    );
  };

  const renderSingleMode = () => {
    if (!result) return null;
    const best = result.best_option;
    const tied = result.tied_suppliers ?? [];
    const showTied = tied.length > 1;

    return (
      <>
        {renderEditableCart()}
        <View style={styles.singleCard} testID="deal-hunter-single-option">
          <View style={styles.optHeader}>
            <View style={styles.optBadge}>
              <Store size={13} color={C.accent} strokeWidth={2.2} />
              <Text style={styles.optBadgeText}>Najlepsza oferta</Text>
            </View>
          </View>

          {showTied ? (
            <>
              <Text style={styles.tiedHint}>
                Ten sam koszyk u {tied.length} dostawców — wybierz, u kogo zamawiasz:
              </Text>
              <View style={styles.tiedRow}>
                {tied.map((t) => {
                  const active = tiedSupplierId === t.supplier_id;
                  return (
                    <TouchableOpacity
                      key={t.supplier_id}
                      style={[styles.tiedChip, active && styles.tiedChipActive]}
                      onPress={() => { setTiedSupplierId(t.supplier_id); setManualCart(null); }}
                      testID={`deal-hunter-tied-${t.supplier_id}`}
                    >
                      <Text style={[styles.tiedChipText, active && styles.tiedChipTextActive]}>
                        {t.supplier_name}
                      </Text>
                      <Text style={[styles.tiedChipSub, active && styles.tiedChipTextActive]}>
                        {formatPln(t.total_pln)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          ) : (
            <Text style={styles.optSupplier}>{best?.supplier_name ?? '—'}</Text>
          )}

          {!!best?.supplier_email && (
            <Text style={styles.editCartHint}>E-mail: {best.supplier_email}</Text>
          )}
          <MinOrderBadge meets={best?.meets_minimum_order} minVal={best?.min_order_value} />
          <View style={styles.optTotalRow}>
            <Text style={styles.optTotalLabel}>Propozycja AI</Text>
            <Text style={styles.optTotalValue}>{formatPln(best?.total_pln ?? 0)}</Text>
          </View>
        </View>
      </>
    );
  };

  const renderCompareMode = () => {
    // Tylko wybrany koszyk — bez alternatywnych wariantów (oszczędność kredytów / mniej szumu).
    return renderEditableCart();
  };

  return (
    <>
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container} testID="deal-hunter-modal">
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}>
              <Sparkles size={16} color={C.accent} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerTitle}>Łowca Okazji</Text>
              <Text style={styles.headerSub} numberOfLines={1}>
                {bulkContextLabel ?? product?.product_name ?? ''}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} testID="deal-hunter-close" hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <X size={22} color={C.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <View style={styles.steps}>
          {stepLabels.map((label, i) => {
            const active = bulkStepIndex === i;
            const done = bulkStepIndex > i;
            return (
              <View key={label} style={styles.stepItem}>
                <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
                  {done ? (
                    <Check size={11} color={C.white} strokeWidth={3} />
                  ) : (
                    <Text style={[styles.stepNum, active && styles.stepNumActive]}>{i + 1}</Text>
                  )}
                </View>
                <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{label}</Text>
              </View>
            );
          })}
        </View>

        {error && (
          <View style={styles.errorBanner} testID="deal-hunter-error">
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {step === 'qty' && product && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <View style={styles.stockCard}>
                <View style={styles.stockRow}>
                  <Text style={styles.stockLabel}>Stan aktualny</Text>
                  <Text style={styles.stockValue}>
                    {product.current_qty} {product.unit}
                  </Text>
                </View>
                <View style={styles.stockRow}>
                  <Text style={styles.stockLabel}>Próg krytyczny</Text>
                  <Text style={styles.stockValueMuted}>
                    {product.critical_threshold} {product.unit}
                  </Text>
                </View>
              </View>
              <Text style={styles.qtyHint}>
                Zaproponowaliśmy ilość o połowę większą niż aktualny stan. Możesz ją zmienić przed
                porównaniem ofert.
              </Text>
              <Text style={styles.fieldLabel}>Gdzie szukać ofert?</Text>
              <View style={{ gap: 8, marginBottom: 14 }}>
                {DEAL_HUNTER_SEARCH_SCOPE_OPTIONS.map((opt) => {
                  const on = searchScope === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => setSearchScope(opt.key)}
                      activeOpacity={0.85}
                      testID={`deal-hunter-scope-${opt.key}`}
                      style={{
                        borderWidth: StyleSheet.hairlineWidth,
                        borderColor: on ? C.accent : C.border,
                        backgroundColor: on ? C.accentLight : C.card,
                        borderRadius: 12,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                      }}
                    >
                      <Text style={{ color: C.textPrimary, fontWeight: '800', fontSize: 14 }}>
                        {opt.label}
                      </Text>
                      <Text style={{ color: C.textSecondary, fontSize: 12, marginTop: 2 }}>
                        {opt.hint}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.fieldLabel}>Ilość do zamówienia</Text>
              <View style={styles.qtyInputRow}>
                <TextInput
                  style={styles.qtyInput}
                  value={qty}
                  onChangeText={setQty}
                  keyboardType="decimal-pad"
                  selectTextOnFocus
                  placeholder="0"
                  placeholderTextColor={C.textTertiary}
                  testID="deal-hunter-qty-input"
                />
                <View style={styles.qtyUnit}>
                  <Text style={styles.qtyUnitText}>{product.unit}</Text>
                </View>
              </View>
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity style={styles.primaryBtn} onPress={runCompare} activeOpacity={0.85} testID="deal-hunter-compare-btn">
                <Sparkles size={17} color={C.white} strokeWidth={2.2} />
                <Text style={styles.primaryBtnText}>Porównaj oferty dostawców</Text>
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}

        {step === 'compare' && (
          loading ? (
            <View style={styles.centerBox}>
              <ActivityIndicator size="large" color={C.accent} />
              <Text style={styles.loadingText}>Analizuję oferty dostawców…</Text>
            </View>
          ) : result ? (
            <>
              <ScrollView
                ref={compareScrollRef}
                contentContainerStyle={styles.body}
                showsVerticalScrollIndicator={false}
              >
                {bulkContextLabel ? (
                  <Text style={[styles.editCartHint, { marginBottom: 8 }]} testID="deal-hunter-bulk-label">
                    {bulkContextLabel}
                  </Text>
                ) : null}
                {(result.is_optimized || result.is_multivariable) ? renderCompareMode() : renderSingleMode()}
                {creditsNotice ? (
                  <View style={styles.creditsNotice} testID="deal-hunter-credits-notice">
                    <Text style={styles.creditsNoticeText}>{creditsNotice}</Text>
                  </View>
                ) : null}
                {!effectiveSelectedOption && (
                  <TouchableOpacity
                    style={[styles.newOrderBtn, { marginTop: 12 }]}
                    onPress={() => { setSelectedOption('single'); setShowNewOrder(true); }}
                    activeOpacity={0.85}
                  >
                    <Package size={16} color={C.accent} strokeWidth={2.2} />
                    <Text style={styles.newOrderBtnText} numberOfLines={2}>Nowe zamówienie</Text>
                  </TouchableOpacity>
                )}
                <View style={{ height: 16 }} />
              </ScrollView>
            </>
          ) : (
            <View style={styles.centerBox}>
              <Text style={styles.loadingText}>Brak danych.</Text>
            </View>
          )
        )}

        {step === 'contact' && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
              <View style={styles.infoCard}>
                <Text style={styles.infoTitle}>Dane kontaktowe dla dostawców</Text>
                <Text style={styles.infoText}>
                  Wpisz dane, na które hurtownia ma się z Tobą kontaktować w sprawie tego zamówienia.
                </Text>
              </View>
              <Text style={styles.fieldLabel}>Twój e-mail kontaktowy</Text>
              <View style={styles.inputRow}>
                <Mail size={16} color={C.textSecondary} strokeWidth={2} />
                <TextInput
                  style={styles.textInput}
                  value={contactEmail}
                  onChangeText={setContactEmail}
                  placeholder="np. kontakt@twojarestauracja.pl"
                  placeholderTextColor={C.textTertiary}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  testID="deal-hunter-contact-email"
                />
              </View>
              <Text style={styles.fieldLabel}>Twój telefon</Text>
              <View style={styles.inputRow}>
                <Phone size={16} color={C.textSecondary} strokeWidth={2} />
                <TextInput
                  style={styles.textInput}
                  value={contactPhone}
                  onChangeText={setContactPhone}
                  placeholder="np. +48 600 100 200"
                  placeholderTextColor={C.textTertiary}
                  keyboardType="phone-pad"
                  testID="deal-hunter-contact-phone"
                />
              </View>
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.primaryBtn, savingProfile && styles.primaryBtnDisabled]}
                onPress={saveProfile}
                disabled={savingProfile}
                activeOpacity={0.85}
                testID="deal-hunter-save-profile-btn"
              >
                {savingProfile ? (
                  <ActivityIndicator size="small" color={C.white} />
                ) : (
                  <>
                    <Text style={styles.primaryBtnText}>Zapisz i przejdź do podglądu</Text>
                    <ChevronRight size={17} color={C.white} strokeWidth={2.2} />
                  </>
                )}
              </TouchableOpacity>
            </View>
          </KeyboardAvoidingView>
        )}

        {step === 'preview' && (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={styles.msgIntro}>
                Sprawdź treści zamówień. Wysyłaj pojedynczo albo wszystkie naraz (gdy nadawca to asystent dostaw).
              </Text>
              {messages.length > 1 && (
                <TouchableOpacity
                  style={[
                    styles.sendBtn,
                    C.isPremium && { backgroundColor: '#5CFFB0' },
                    messages.every((m) => sendStatus[m.supplier_id ?? m.supplier_name] === 'sent') && styles.btnDisabled,
                  ]}
                  onPress={() => void sendAllEmails()}
                  activeOpacity={0.85}
                  testID="deal-hunter-send-all"
                >
                  <Send size={16} color={C.isPremium ? '#0A0A0A' : C.white} strokeWidth={2.2} />
                  <Text style={[styles.sendBtnText, C.isPremium && { color: '#0A0A0A' }]}>
                    Wyślij wszystkie ({messages.length})
                  </Text>
                </TouchableOpacity>
              )}
              {messages.map((m) => {
                const key = m.supplier_id ?? m.supplier_name;
                const st = sendStatus[key];
                return (
                  <View key={key} style={styles.msgCard} testID={`deal-hunter-message-${m.supplier_name}`}>
                    <View style={styles.msgHeader}>
                      <Truck size={14} color={C.accent} strokeWidth={2.2} />
                      <Text style={styles.msgSupplier}>{m.supplier_name}</Text>
                      <Text style={styles.msgTotal}>{formatPln(m.subtotal_pln)}</Text>
                    </View>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Nadawca:</Text>
                    </View>
                    <TextInput
                      style={[styles.bodyInput, { minHeight: 44, marginBottom: 8 }]}
                      value={fromEmails[key] ?? ASSISTANT_FROM_EMAIL}
                      onChangeText={(t) => {
                        setFromEmails((b) => ({ ...b, [key]: t }));
                        if (t.trim().toLowerCase() !== ASSISTANT_FROM_EMAIL.toLowerCase()) {
                          setBodyText((b) => ({
                            ...b,
                            [key]: stripAssistantOrderFooter(b[key] ?? m.email_body_text ?? ''),
                          }));
                        }
                      }}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      placeholder={ASSISTANT_FROM_EMAIL}
                      testID={`deal-hunter-from-${m.supplier_name}`}
                    />
                    <Text style={{ fontSize: 11, color: C.textTertiary, marginBottom: 8 }}>
                      {(fromEmails[key] ?? ASSISTANT_FROM_EMAIL).trim().toLowerCase() ===
                      ASSISTANT_FROM_EMAIL.toLowerCase()
                        ? 'Wysyłka przez asystenta dostaw (backend :8001).'
                        : 'Otworzymy Twoją aplikację pocztową — bez stopki asystenta.'}
                    </Text>
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Odbiorca:</Text>
                    </View>
                    <TextInput
                      style={[styles.bodyInput, { minHeight: 44, marginBottom: 8 }]}
                      value={toEmails[key] ?? m.supplier_email ?? ''}
                      onChangeText={(t) => setToEmails((b) => ({ ...b, [key]: t }))}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      placeholder="zamowienia@dostawca.pl"
                      testID={`deal-hunter-to-${m.supplier_name}`}
                    />
                    <View style={styles.metaRow}>
                      <Text style={styles.metaLabel}>Temat:</Text>
                    </View>
                    <TextInput
                      style={[styles.bodyInput, { minHeight: 44, marginBottom: 8 }]}
                      value={subjectText[key] ?? m.email_subject ?? ''}
                      onChangeText={(t) => setSubjectText((b) => ({ ...b, [key]: t }))}
                      placeholder="Temat wiadomości"
                      placeholderTextColor={C.textTertiary}
                      testID={`deal-hunter-subject-${m.supplier_name}`}
                    />
                    <Text style={styles.msgSectionLabel}>Treść wiadomości (edytowalna)</Text>
                    <TextInput
                      style={styles.bodyInput}
                      value={bodyText[key] ?? ''}
                      onChangeText={(t) => setBodyText((b) => ({ ...b, [key]: t }))}
                      multiline
                      textAlignVertical="top"
                      testID={`deal-hunter-body-input-${m.supplier_name}`}
                    />
                    {st === 'sent' ? (
                      <View style={styles.successBox} testID={`deal-hunter-sent-${m.supplier_name}`}>
                        <Check size={16} color={C.success} strokeWidth={2.5} />
                        <Text style={styles.successText}>Zamówienie zostało wysłane pomyślnie!</Text>
                      </View>
                    ) : (
                      <>
                        <TouchableOpacity
                          style={[
                            styles.sendBtn,
                            C.isPremium && { backgroundColor: '#5CFFB0' },
                            (!(toEmails[key] ?? m.supplier_email) || st === 'sending') && styles.btnDisabled,
                          ]}
                          onPress={() => sendEmail(m)}
                          disabled={!(toEmails[key] ?? m.supplier_email) || st === 'sending'}
                          activeOpacity={0.85}
                          testID={`deal-hunter-send-email-${m.supplier_name}`}
                        >
                          {st === 'sending' ? (
                            <ActivityIndicator size="small" color={C.isPremium ? '#0A0A0A' : C.white} />
                          ) : (
                            <>
                              <Send size={16} color={C.isPremium ? '#0A0A0A' : C.white} strokeWidth={2.2} />
                              <Text style={[styles.sendBtnText, C.isPremium && { color: '#0A0A0A' }]}>Wyślij maila</Text>
                            </>
                          )}
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.smsBtn}
                          onPress={() => copySms(m)}
                          activeOpacity={0.85}
                          testID={`deal-hunter-copy-sms-${m.supplier_name}`}
                        >
                          {copiedId === key ? (
                            <>
                              <Check size={14} color={C.accent} strokeWidth={2.4} />
                              <Text style={styles.smsBtnText}>Skopiowano SMS</Text>
                            </>
                          ) : (
                            <>
                              <Copy size={14} color={C.accent} strokeWidth={2.2} />
                              <Text style={styles.smsBtnText}>Kopiuj do SMS</Text>
                            </>
                          )}
                        </TouchableOpacity>
                      </>
                    )}
                    <TouchableOpacity
                      style={styles.payBtn}
                      onPress={() =>
                        setManualPayOrder({
                          supplierId: m.supplier_id,
                          supplierName: m.supplier_name,
                          orderTitle:
                            (subjectText[key] ?? m.email_subject ?? '').trim()
                            || `Zamówienie — ${m.supplier_name}`,
                          totalPln: m.subtotal_pln,
                        })
                      }
                      activeOpacity={0.85}
                      testID={`deal-hunter-manual-pay-${m.supplier_name}`}
                    >
                      <Landmark size={16} color={C.accent} strokeWidth={2.2} />
                      <Text style={styles.payBtnText}>Opłać zamówienie</Text>
                    </TouchableOpacity>
                    {st === 'error' && (
                      <View style={styles.errRow}>
                        <CircleAlert size={13} color={C.danger} strokeWidth={2.2} />
                        <Text style={styles.emailError}>
                          Nie udało się wysłać. Sprawdź weryfikację domeny w Resend i spróbuj ponownie.
                        </Text>
                      </View>
                    )}
                  </View>
                );
              })}
              <TouchableOpacity style={styles.doneBtn} onPress={onClose} activeOpacity={0.85} testID="deal-hunter-done-btn">
                <Text style={styles.doneBtnText}>Zakończ</Text>
              </TouchableOpacity>
              <View style={{ height: 24 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        )}
        {catalogPicker ? (
          <SupplierCatalogPicker
            visible
            supplierId={catalogPicker.id}
            supplierName={catalogPicker.name}
            onClose={() => setCatalogPicker(null)}
            onPick={addCatalogProduct}
            onResolvedSupplier={resolveSupplierInCart}
          />
        ) : null}
        {showNewOrder ? (
          <NewOrderBrowser
            visible
            onClose={() => setShowNewOrder(false)}
            onAdd={addProductToOrder}
          />
        ) : null}
      </View>
    </Modal>
    <Modal
      visible={!!draftSavedInfo}
      transparent
      animationType="fade"
      onRequestClose={() => setDraftSavedInfo(null)}
    >
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.78)',
        justifyContent: 'center',
        paddingHorizontal: 28,
      }}>
        <View style={{
          backgroundColor: DS.color.surfaceCard,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: DS.color.borderSubtle,
          padding: 20,
          gap: 14,
        }}>
          <Text style={{ fontSize: 17, fontWeight: '800', color: DS.color.heading }}>
            Zapisano w koszyku
          </Text>
          <Text style={{ fontSize: 13, lineHeight: 19, color: DS.color.muted }}>
            {draftSavedInfo}
          </Text>
          <TouchableOpacity
            onPress={() => setDraftSavedInfo(null)}
            activeOpacity={0.85}
            style={{
              marginTop: 4,
              minHeight: 44,
              borderRadius: 10,
              backgroundColor: DS.color.greenEnd,
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: 16,
            }}
          >
            <Text style={{ fontSize: 14, fontWeight: '800', color: '#0A0A0A' }}>OK</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
    <LocalProducerCheckoutSheet
      visible={!!lpPayGroup}
      group={lpPayGroup}
      colors={C}
      onClose={() => setLpPayGroup(null)}
    />
    <ManualBankPaymentSheet
      visible={!!manualPayOrder}
      order={manualPayOrder}
      onClose={() => setManualPayOrder(null)}
      colors={{
        card: C.card,
        text: C.textPrimary,
        textSecondary: C.textSecondary,
        textTertiary: C.textTertiary,
        border: C.border,
        accent: C.accent,
        background: C.background,
        isPremium: C.isPremium,
      }}
    />
    </>
  );
}
