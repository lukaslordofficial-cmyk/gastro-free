import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
  DeviceEventEmitter,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Package } from 'lucide-react-native';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { useAuth } from '@/contexts/AuthContext';
import { DEAL_HUNTER_GATE_MESSAGE, DEAL_HUNTER_GATE_TITLE } from '@/lib/dealHunterGate';
import { rankProductMatches } from '@/lib/fuzzyProductMatch';
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
  DEFAULT_DEAL_HUNTER_SEARCH_SCOPE,
} from '@/lib/dealHunterSearchScope';
import { LocalProducerCheckoutSheet } from '@/components/dealHunter/LocalProducerCheckoutSheet';
import {
  ManualBankPaymentSheet,
  type ManualPaymentOrder,
} from '@/components/dealHunter/ManualBankPaymentSheet';
import { EditableCartPanel } from '@/components/dealHunter/EditableCartPanel';
import { MessagePreviewStep } from '@/components/dealHunter/MessagePreviewStep';
import { DealHunterHeader } from '@/components/dealHunter/DealHunterHeader';
import { QtyStep } from '@/components/dealHunter/QtyStep';
import { ContactStep } from '@/components/dealHunter/ContactStep';
import { SingleBestOptionCard } from '@/components/dealHunter/SingleBestOptionCard';
import { DraftSavedModal } from '@/components/dealHunter/DraftSavedModal';

import { BACKEND_URL, themedStyles, useDealColors } from '@/components/dealHunter/theme';
import type { CatalogRow, MessageCard, Props, SelectedOption, Step } from '@/components/dealHunter/types';
import { recalcGroup, resolveSelectionFromCompare, suggestQty } from '@/components/dealHunter/helpers';
import { SupplierCatalogPicker } from '@/components/dealHunter/SupplierCatalogPicker';
import { NewOrderBrowser } from '@/components/dealHunter/NewOrderBrowser';

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

  const addSubstituteToCart = useCallback((offer: {
    supplier_id: string;
    supplier_name: string;
    supplier_email?: string | null;
    unit_price_base: number;
    base_dim: string;
    unit?: string;
    matched_name?: string;
    catalog_product_id?: string;
    is_local_producer?: boolean;
  }, variantLabel: string) => {
    const unit = offer.unit || offer.base_dim || 'szt';
    const qty = 1;
    const displayName = offer.matched_name || variantLabel;
    const newItem: OfferItem = {
      product_name: displayName,
      quantity: qty,
      unit,
      base_dim: offer.base_dim || unit,
      unit_price_base: offer.unit_price_base,
      matched_name: displayName,
      line_total: recalcLineTotal(offer.unit_price_base, qty, offer.base_dim || unit),
      ...(offer.catalog_product_id ? { catalog_product_id: offer.catalog_product_id } : {}),
      ...(offer.is_local_producer ? { is_local_producer: true } : {}),
    };
    setManualCart((prev) => {
      const cart = prev ?? baseSelectedSuppliers().map((g) => recalcGroup({
        ...g,
        items: g.items.map((it) => ({ ...it })),
      }));
      const existing = cart.find((g) => g.supplier_id === offer.supplier_id);
      if (existing) {
        return cart.map((g) => {
          if (g.supplier_id !== offer.supplier_id) return g;
          const without = g.items.filter((it) => it.product_name !== displayName);
          return recalcGroup({
            ...g,
            supplier_name: offer.supplier_name || g.supplier_name,
            supplier_email: offer.supplier_email ?? g.supplier_email,
            items: [...without, newItem],
          });
        });
      }
      const newGroup: SupplierGroup = recalcGroup({
        supplier_id: offer.supplier_id,
        supplier_name: offer.supplier_name || 'Dostawca',
        supplier_email: offer.supplier_email ?? null,
        items: [newItem],
        subtotal_pln: 0,
        ...(offer.is_local_producer ? { is_local_producer: true } : {}),
      });
      return [...cart, newGroup];
    });
    setQuantities((prev) => ({ ...prev, [displayName]: 1 }));
    setDraftSavedInfo(`Dodano „${displayName}” do koszyka (${offer.supplier_name || 'dostawca'}).`);
  }, [baseSelectedSuppliers]);

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
          items: [{
            product_name_or_id: product.product_name,
            quantity: q,
            unit: product.unit,
            ...(product.variant ? { variant: product.variant } : {}),
          }],
        }),
      });
      if (!res.ok) throw new Error(`Błąd serwera (${res.status})`);
      const data = await res.json();
      const normalized = applyCompareResult(data);
      const hasVariantSubs = (normalized.variant_reports ?? []).some(
        (v) => (v.substitute_variant_count ?? 0) > 0,
      );
      if (!normalized.best_option && !normalized.option_optimized?.suppliers?.length && !hasVariantSubs) {
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

  const cartGroups = effectiveSelectedOption
    ? selectedSuppliers().filter((g) => g.items.length > 0)
    : [];

  const renderEditableCart = () => {
    if (!effectiveSelectedOption) return null;
    return (
      <EditableCartPanel
        effectiveSelectedOption={effectiveSelectedOption}
        result={result}
        groups={cartGroups}
        loading={loading}
        savingDraft={savingDraft}
        onQtyChange={updateQty}
        onRemoveItem={removeCartItem}
        onAddSubstitute={addSubstituteToCart}
        onOpenNewOrder={() => setShowNewOrder(true)}
        onOpenCatalog={setCatalogPicker}
        onPrepareEmail={(groups) => void prepareEmailForGroups(groups)}
        onLocalProducerPay={setLpPayGroup}
        onManualPay={setManualPayOrder}
        onSaveDraft={() => void saveDraftCart()}
      />
    );
  };

  const renderSingleMode = () => {
    if (!result) return null;
    const best = result.best_option;
    const tied = result.tied_suppliers ?? [];

    return (
      <>
        {renderEditableCart()}
        {best?.supplier_name ? (
          <SingleBestOptionCard
            best={best}
            tied={tied}
            tiedSupplierId={tiedSupplierId}
            onSelectTied={(id) => { setTiedSupplierId(id); setManualCart(null); }}
          />
        ) : null}
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
        <DealHunterHeader
          subtitle={bulkContextLabel ?? product?.product_name ?? ''}
          stepLabels={stepLabels}
          activeStepIndex={bulkStepIndex}
          error={error}
          onClose={onClose}
        />

        {step === 'qty' && product && (
          <QtyStep
            product={product}
            qty={qty}
            searchScope={searchScope}
            onQtyChange={setQty}
            onSearchScopeChange={setSearchScope}
            onCompare={runCompare}
          />
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
          <ContactStep
            contactEmail={contactEmail}
            contactPhone={contactPhone}
            savingProfile={savingProfile}
            onEmailChange={setContactEmail}
            onPhoneChange={setContactPhone}
            onSave={saveProfile}
          />
        )}

        {step === 'preview' && (
          <MessagePreviewStep
            messages={messages}
            sendStatus={sendStatus}
            copiedId={copiedId}
            fromEmails={fromEmails}
            toEmails={toEmails}
            subjectText={subjectText}
            bodyText={bodyText}
            setFromEmails={setFromEmails}
            setToEmails={setToEmails}
            setSubjectText={setSubjectText}
            setBodyText={setBodyText}
            onSendEmail={sendEmail}
            onSendAll={() => void sendAllEmails()}
            onCopySms={copySms}
            onManualPay={setManualPayOrder}
            onDone={onClose}
          />
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
    <DraftSavedModal
      info={draftSavedInfo}
      onClose={() => setDraftSavedInfo(null)}
    />
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
