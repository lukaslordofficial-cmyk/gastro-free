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

import { themedStyles, useDealColors } from './theme';
import type { CatalogBrowseRow, InvStock, SupplierBrowse } from './types';
import { findWarehouseStock, sortCatalogMenuFirst } from './helpers';

export function NewOrderBrowser({
  visible,
  onClose,
  onAdd,
}: {
  visible: boolean;
  onClose: () => void;
  onAdd: (opts: {
    supplierId: string;
    supplierName: string;
    supplierEmail: string | null;
    productName: string;
    unit: string;
    unitPrice: number;
    quantity?: number;
    minOrder?: number;
  }) => void;
}) {
  const C = useDealColors();
  const styles = useMemo(() => themedStyles(C), [C]);
  const [loading, setLoading] = useState(false);
  const [q, setQ] = useState('');
  const [inventory, setInventory] = useState<InvStock[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierBrowse[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<{
    supplier: SupplierBrowse;
    product: CatalogBrowseRow;
  } | null>(null);
  const [addQty, setAddQty] = useState('1');

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setQ('');
      setExpandedId(null);
      setSelectedProduct(null);
      const ak = getAccountKey();
      if (!ak || ak === 'default') {
        setInventory([]);
        setSuppliers([]);
        setLoading(false);
        return;
      }
      const [invRes, supRes] = await Promise.all([
        supabase.from('inventory_items').select('id,name,quantity,unit,min_quantity').eq('account_key', ak).limit(3000),
        supabase.from('suppliers').select('id,name,email,min_order_value').eq('account_key', ak).order('name').limit(500),
      ]);
      if (cancelled) return;
      setInventory(
        (invRes.data ?? []).map((r: any) => ({
          id: r.id,
          name: r.name,
          quantity: Number(r.quantity ?? 0),
          unit: r.unit || 'szt',
          min_quantity: Number(r.min_quantity ?? 0),
        })),
      );
      const supplierIds = (supRes.data ?? []).map((s: { id: string }) => s.id).filter(Boolean);
      let cats: unknown[] = [];
      if (supplierIds.length) {
        let catRes = await supabase
          .from('supplier_catalog')
          .select('id,supplier_id,name,variant,unit,price_pln,is_visible')
          .in('supplier_id', supplierIds)
          .limit(5000);
        if (catRes.error && /is_visible/.test(catRes.error.message ?? '')) {
          catRes = await supabase
            .from('supplier_catalog')
            .select('id,supplier_id,name,variant,unit,price_pln')
            .in('supplier_id', supplierIds)
            .limit(5000);
        }
        cats = catRes.data ?? [];
      }
      const allowedSuppliers = new Set(supplierIds);
      cats = (cats as { supplier_id?: string }[]).filter((c) => c.supplier_id && allowedSuppliers.has(c.supplier_id));
      const bySup: Record<string, CatalogBrowseRow[]> = {};
      for (const c of cats as any[]) {
        if (!(Number(c.price_pln) > 0)) continue;
        const sid = c.supplier_id;
        if (!sid) continue;
        (bySup[sid] ||= []).push({
          id: c.id,
          supplier_id: sid,
          name: c.name,
          variant: c.variant,
          unit: c.unit || 'szt',
          price_pln: Number(c.price_pln),
          in_menu: c.is_visible !== false,
        });
      }
      setSuppliers(
        (supRes.data ?? [])
          .map((s: any) => ({
            id: s.id,
            name: s.name,
            email: s.email ?? null,
            min_order_value: Number(s.min_order_value ?? 0),
            products: sortCatalogMenuFirst(bySup[s.id] ?? []),
          }))
          .filter((s) => s.products.length > 0),
      );
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [visible]);

  const filteredSuppliers = useMemo(() => {
    const s = q.trim();
    if (!s) return suppliers;
    const sLower = s.toLowerCase();
    return suppliers
      .map((sup) => {
        const nameHit = sup.name.toLowerCase().includes(sLower);
        const matchedProducts = sortCatalogMenuFirst(
          rankProductMatches(s, sup.products, (p) => `${p.name} ${p.variant ?? ''}`, {
            threshold: 52,
            limit: 80,
          }).map((x) => x.item),
        );
        return {
          ...sup,
          products: nameHit && matchedProducts.length === 0 ? sup.products : matchedProducts,
        };
      })
      .filter((sup) => sup.products.length > 0 || sup.name.toLowerCase().includes(sLower));
  }, [suppliers, q]);

  const stockForSelected = selectedProduct
    ? findWarehouseStock(inventory, selectedProduct.product.name)
    : null;

  if (!visible) return null;

  // Overlay wewnątrz Łowcy — nie osobny Modal (zagnieżdżenie z Jarvisem nic nie pokazywało)
  return (
      <View style={styles.pickerOverlay} testID="deal-hunter-new-order">
        <View style={[styles.pickerSheet, { maxHeight: '92%' }]}>
          <View style={styles.pickerHeader}>
            <Text style={styles.pickerTitle}>Nowe zamówienie</Text>
            <TouchableOpacity onPress={onClose} testID="deal-hunter-new-order-close">
              <X size={22} color={C.textSecondary} />
            </TouchableOpacity>
          </View>
          <Text style={styles.newOrderIntro}>
            Wybierz dostawcę i produkt. Pozycje z receptur menu są na górze; dodatkowa oferta też jest do zamówienia.
          </Text>
          <View style={styles.pickerSearch}>
            <Search size={16} color={C.textTertiary} />
            <TextInput
              style={styles.pickerSearchInput}
              value={q}
              onChangeText={setQ}
              placeholder="Szukaj dostawcy lub produktu…"
              placeholderTextColor={C.textTertiary}
            />
          </View>
          {loading ? (
            <ActivityIndicator style={{ margin: 28 }} color={C.accent} />
          ) : (
            <ScrollView keyboardShouldPersistTaps="handled">
              {filteredSuppliers.map((sup) => {
                const open = expandedId === sup.id;
                const products = open ? sortCatalogMenuFirst(sup.products).slice(0, 200) : [];
                const inMenu = products.filter((p) => p.in_menu);
                const extra = products.filter((p) => !p.in_menu);
                const renderProduct = (p: CatalogBrowseRow) => {
                  const stock = findWarehouseStock(inventory, p.name);
                  const active = selectedProduct?.product.id === p.id;
                  return (
                    <TouchableOpacity
                      key={p.id}
                      style={[styles.browseProduct, active && styles.browseProductActive]}
                      onPress={() => {
                        setSelectedProduct({ supplier: sup, product: p });
                        setAddQty('1');
                      }}
                      activeOpacity={0.8}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={styles.pickerName}>{p.name}</Text>
                        {!!p.variant && <Text style={styles.pickerVariant}>{p.variant}</Text>}
                        <Text style={styles.stockLine}>
                          {stock
                            ? `Magazyn: ${stock.quantity} ${stock.unit}`
                              + (stock.min_quantity > 0 && stock.quantity <= stock.min_quantity
                                ? ' · stan krytyczny'
                                : '')
                            : 'Brak w magazynie (lub inna nazwa)'}
                        </Text>
                        {p.in_menu ? (
                          <View style={styles.menuTag}>
                            <Text style={styles.menuTagText}>W recepturach menu</Text>
                          </View>
                        ) : (
                          <View style={styles.extraTag}>
                            <Text style={styles.extraTagText}>Dodatkowa oferta (też do zamówienia)</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.pickerPrice}>{formatPln(p.price_pln)}</Text>
                    </TouchableOpacity>
                  );
                };
                return (
                  <View key={sup.id} style={styles.browseSupplier}>
                    <TouchableOpacity
                      style={styles.browseSupplierHead}
                      onPress={() => setExpandedId(open ? null : sup.id)}
                      activeOpacity={0.8}
                    >
                      <Truck size={15} color={C.accent} strokeWidth={2} />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.browseSupplierName}>{sup.name}</Text>
                        <Text style={styles.browseSupplierMeta}>{sup.products.length} produktów w katalogu</Text>
                      </View>
                      {open
                        ? <ChevronDown size={18} color={C.textTertiary} />
                        : <ChevronRight size={18} color={C.textTertiary} />}
                    </TouchableOpacity>
                    {open && inMenu.length > 0 ? (
                      <Text style={styles.pickerSection}>W RECEPTURACH MENU</Text>
                    ) : null}
                    {inMenu.map(renderProduct)}
                    {open && extra.length > 0 ? (
                      <Text style={styles.pickerSection}>DODATKOWA OFERTA (też do zamówienia)</Text>
                    ) : null}
                    {extra.map(renderProduct)}
                  </View>
                );
              })}
              <View style={{ height: 120 }} />
            </ScrollView>
          )}

          {selectedProduct && (
            <View style={styles.addBar}>
              <Text style={styles.addBarTitle} numberOfLines={1}>
                {selectedProduct.product.name}
              </Text>
              <Text style={styles.addBarStock}>
                {stockForSelected
                  ? `Na stanie: ${stockForSelected.quantity} ${stockForSelected.unit}`
                  : 'Brak dopasowania w magazynie'}
                {' · '}{selectedProduct.supplier.name}
              </Text>
              <View style={styles.addBarRow}>
                <TextInput
                  style={styles.addQtyInput}
                  value={addQty}
                  onChangeText={setAddQty}
                  keyboardType="decimal-pad"
                  placeholder="ilość"
                  placeholderTextColor={C.textTertiary}
                />
                <Text style={styles.addQtyUnit}>{selectedProduct.product.unit}</Text>
                <TouchableOpacity
                  style={styles.addBarBtn}
                  onPress={() => {
                    const n = parseFloat(addQty.replace(',', '.'));
                    if (!isFinite(n) || n <= 0) return;
                    onAdd({
                      supplierId: selectedProduct.supplier.id,
                      supplierName: selectedProduct.supplier.name,
                      supplierEmail: selectedProduct.supplier.email,
                      productName: selectedProduct.product.name,
                      unit: selectedProduct.product.unit,
                      unitPrice: selectedProduct.product.price_pln,
                      quantity: n,
                      minOrder: selectedProduct.supplier.min_order_value,
                    });
                    setSelectedProduct(null);
                  }}
                  activeOpacity={0.85}
                >
                  <Plus size={16} color={C.white} strokeWidth={2.5} />
                  <Text style={styles.addBarBtnText}>Dodaj do zamówienia</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      </View>
  );
}
