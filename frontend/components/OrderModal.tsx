/**
 * Zamówienie od dostawcy — produkty z supplier_catalog
 * (najpierw „w menu”, potem dodatkowe) + wyszukiwanie + draft / e-mail.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
  DeviceEventEmitter,
} from 'react-native';
import { X, ShoppingCart, Plus, Package, Trash2, Truck, Search, Landmark } from 'lucide-react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { usePremiumAlert } from '@/components/PremiumAlert';
import {
  OrderEmailComposer,
  type OrderEmailDraft,
  ASSISTANT_FROM_EMAIL,
} from '@/components/OrderEmailComposer';
import {
  ManualBankPaymentSheet,
  type ManualPaymentOrder,
} from '@/components/dealHunter/ManualBankPaymentSheet';
import { formatPlnNumber } from '@/lib/format';
import { fetchOrderEmailTemplate } from '@/lib/orderEmailTemplate';
import { resolveOrderEmailFrom } from '@/services/restaurantProfileService';
import { SUPPLIER_BASKET_CHANGED } from '@/services/supplierOrdersService';
import { withAccountKey } from '@/lib/tenantScope';
import { useAuth } from '@/contexts/AuthContext';
import {
  checkSupplierMinOrder,
  minOrderAlertCopy,
} from '@/lib/supplierMinOrder';

interface Props {
  supplierId: string;
  supplierName: string;
  supplierEmail?: string | null;
  visible: boolean;
  onClose: () => void;
  /** Produkt z katalogu dostawcy — po otwarciu dodawany do koszyka (qty 1). */
  seedProduct?: {
    id: string;
    name: string;
    variant?: string;
    unit?: string;
    price_pln: number | null;
  } | null;
  onSeedConsumed?: () => void;
}

type CatalogRow = {
  id: string;
  name: string;
  variant: string;
  unit: string;
  price_pln: number | null;
  in_menu: boolean;
};

type CartEntry = {
  item: CatalogRow;
  quantity: number;
};

export function OrderModal({
  supplierId,
  supplierName,
  supplierEmail,
  visible,
  onClose,
  seedProduct = null,
  onSeedConsumed,
}: Props) {
  const theme = useAppTheme();
  const { alert } = usePremiumAlert();
  const { user, profile } = useAuth();
  const prem = theme.isPremium;
  const accent = prem ? DS.color.greenEnd : Colors.accent;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const bg = prem ? DS.color.bgPrimary : Colors.background;
  const card = prem ? DS.color.surfaceCard : Colors.card;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const tile = prem ? DS.color.bgTertiary : Colors.borderLight;

  const [products, setProducts] = useState<CatalogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Map<string, CartEntry>>(new Map());
  const [showQtyModal, setShowQtyModal] = useState(false);
  const [pendingItem, setPendingItem] = useState<CatalogRow | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'products' | 'cart'>('products');
  const [query, setQuery] = useState('');
  const [emailDraft, setEmailDraft] = useState<OrderEmailDraft | null>(null);
  const [showEmail, setShowEmail] = useState(false);
  const [manualPayOrder, setManualPayOrder] = useState<ManualPaymentOrder | null>(null);
  const [shippingCost, setShippingCost] = useState(0);
  const [freeShipFrom, setFreeShipFrom] = useState(0);
  const [minOrderValue, setMinOrderValue] = useState(0);

  const cartItems = useMemo(() => Array.from(cart.values()), [cart]);
  const cartCount = cartItems.length;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      let { data: sup, error: supErr } = await supabase
        .from('suppliers')
        .select('shipping_cost, free_shipping_threshold, min_order_value')
        .eq('id', supplierId)
        .maybeSingle();
      if (supErr && /min_order_value/.test(supErr.message ?? '')) {
        const retry = await supabase
          .from('suppliers')
          .select('shipping_cost, free_shipping_threshold')
          .eq('id', supplierId)
          .maybeSingle();
        sup = retry.data as typeof sup;
      }
      setShippingCost(Number((sup as { shipping_cost?: number } | null)?.shipping_cost) || 0);
      setFreeShipFrom(
        Number((sup as { free_shipping_threshold?: number } | null)?.free_shipping_threshold) || 0,
      );
      setMinOrderValue(Number((sup as { min_order_value?: number } | null)?.min_order_value) || 0);
    } catch {
      setShippingCost(0);
      setFreeShipFrom(0);
      setMinOrderValue(0);
    }
    let rows: any[] | null = null;
    const full = await supabase
      .from('supplier_catalog')
      .select('id, name, variant, unit, price_pln, is_visible, sort_order')
      .eq('supplier_id', supplierId)
      .order('sort_order')
      .order('name');
    if (full.error) {
      const base = await supabase
        .from('supplier_catalog')
        .select('id, name, variant, price_pln, is_visible, sort_order, volume_label')
        .eq('supplier_id', supplierId)
        .order('name');
      rows = base.data;
    } else {
      rows = full.data;
    }

    const mapped: CatalogRow[] = (rows ?? []).map((r: any) => ({
      id: String(r.id),
      name: String(r.name || ''),
      variant: String(r.variant || r.volume_label || ''),
      unit: String(r.unit || 'szt'),
      price_pln: r.price_pln != null ? Number(r.price_pln) : null,
      in_menu: r.is_visible !== false,
    }));
    mapped.sort((a, b) => {
      if (a.in_menu !== b.in_menu) return a.in_menu ? -1 : 1;
      return a.name.localeCompare(b.name, 'pl');
    });
    setProducts(mapped);
    setLoading(false);
  }, [supplierId]);

  useEffect(() => {
    if (!visible) return;
    setCart(new Map());
    setNotes('');
    setQuery('');
    setActiveTab(seedProduct?.id ? 'cart' : 'products');
    const seed = seedProduct;
    void load().then(() => {
      if (!seed?.id) return;
      const row: CatalogRow = {
        id: seed.id,
        name: seed.name,
        variant: seed.variant || '',
        unit: seed.unit || 'szt',
        price_pln: seed.price_pln,
        in_menu: true,
      };
      setCart(new Map([[row.id, { item: row, quantity: 1 }]]));
      onSeedConsumed?.();
    });
    // seed tylko przy otwarciu — nie w deps (unikamy pętli)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, load]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.variant.toLowerCase().includes(q),
    );
  }, [products, query]);

  const openQty = (item: CatalogRow) => {
    setPendingItem(item);
    const existing = cart.get(item.id);
    setQtyInput(existing ? existing.quantity.toString() : '1');
    setShowQtyModal(true);
  };

  const addOneToCart = (item: CatalogRow) => {
    setCart((prev) => {
      const next = new Map(prev);
      const existing = next.get(item.id);
      next.set(item.id, {
        item,
        quantity: (existing?.quantity || 0) + 1,
      });
      return next;
    });
  };

  const confirmQty = () => {
    if (!pendingItem) return;
    const qty = parseFloat(qtyInput.replace(',', '.'));
    if (isNaN(qty) || qty <= 0) {
      alert('Błąd', 'Podaj poprawną ilość (liczba > 0).');
      return;
    }
    setCart((prev) => {
      const next = new Map(prev);
      next.set(pendingItem.id, { item: pendingItem, quantity: qty });
      return next;
    });
    setShowQtyModal(false);
    setPendingItem(null);
  };

  const removeFromCart = (itemId: string) => {
    setCart((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  };

  const saveDraft = async () => {
    if (cart.size === 0) {
      alert('Puste zamówienie', 'Dodaj produkty do zamówienia.');
      return;
    }
    setSaving(true);
    try {
      const { data: order, error: orderErr } = await supabase
        .from('supplier_orders')
        .insert(
          withAccountKey({
            supplier_id: supplierId,
            status: 'draft',
            notes: notes.trim() || null,
          }),
        )
        .select()
        .single();
      if (orderErr || !order) throw orderErr ?? new Error('Błąd zapisu koszyka');

      const rows = cartItems.map((e) => ({
        order_id: order.id,
        raw_product_name: e.item.name,
        price_net: e.item.price_pln,
        unit: e.item.unit,
        quantity_ordered: e.quantity,
        warehouse_product_id: null,
      }));
      const { error: itemsErr } = await supabase.from('supplier_order_items').insert(rows);
      if (itemsErr) throw itemsErr;

      try {
        DeviceEventEmitter.emit(SUPPLIER_BASKET_CHANGED);
      } catch { /* ignore */ }

      alert('Dodano do koszyka', `Zapisano na później · ${cartItems.length} poz.`, [
        { text: 'OK', style: 'primary', onPress: onClose },
      ]);
    } catch (e: any) {
      alert('Błąd', e?.message ?? 'Nie udało się zapisać koszyka.');
    } finally {
      setSaving(false);
    }
  };

  const ensureMinOrderMet = async (): Promise<boolean> => {
    const subtotal = productsTotal ?? cartItems.reduce(
      (acc, e) => acc + (e.item.price_pln != null ? e.item.price_pln * e.quantity : 0),
      0,
    );
    const check = await checkSupplierMinOrder({
      supplierId,
      subtotalPln: subtotal,
      minOrderValue,
      supplierName,
    });
    if (check.ok) return true;
    const copy = minOrderAlertCopy(check);
    alert(copy.title, copy.message, [{ text: 'OK', style: 'primary' }]);
    return false;
  };

  const placeOrder = async () => {
    if (cart.size === 0) {
      alert('Puste zamówienie', 'Dodaj produkty do zamówienia.');
      return;
    }
    if (!(await ensureMinOrderMet())) return;
    setSaving(true);
    try {
      // status=sent → panel Zamówienia / Przygotowywane (po przejściu do maila)
      const { data: order, error: orderErr } = await supabase
        .from('supplier_orders')
        .insert(
          withAccountKey({
            supplier_id: supplierId,
            status: 'sent',
            notes: notes.trim() || null,
          }),
        )
        .select()
        .single();
      if (orderErr || !order) throw orderErr ?? new Error('Błąd tworzenia zamówienia');

      const rows = cartItems.map((e) => ({
        order_id: order.id,
        raw_product_name: e.item.name,
        price_net: e.item.price_pln,
        unit: e.item.unit,
        quantity_ordered: e.quantity,
        warehouse_product_id: null,
      }));
      const { error: itemsErr } = await supabase.from('supplier_order_items').insert(rows);
      if (itemsErr) throw itemsErr;

      // Nie przenoś innych niezależnych draftów tego dostawcy — tylko ten flow z OrderModal
      try {
        DeviceEventEmitter.emit(SUPPLIER_BASKET_CHANGED);
      } catch {
        /* ignore */
      }

      const productsSum = cartItems.reduce(
        (acc, e) => acc + (e.item.price_pln != null ? e.item.price_pln * e.quantity : 0),
        0,
      );
      const shipFee =
        shippingCost > 0
        && !(freeShipFrom > 0 && productsSum >= freeShipFrom)
          ? shippingCost
          : 0;
      const emailItems = [
        ...cartItems.map((e) => ({
          product_name: e.item.name,
          quantity: e.quantity,
          unit: e.item.unit,
          line_total:
            e.item.price_pln != null ? e.item.price_pln * e.quantity : 0,
        })),
        ...(shipFee > 0
          ? [{
              product_name: 'Koszt dostawy',
              quantity: 1,
              unit: 'szt',
              line_total: shipFee,
            }]
          : []),
      ];
      const tpl = await fetchOrderEmailTemplate({
        supplierId,
        supplierName,
        supplierEmail,
        notes,
        items: emailItems,
      });
      let fromEmail = ASSISTANT_FROM_EMAIL;
      let body = tpl.body;
      try {
        const resolved = await resolveOrderEmailFrom(
          tpl.body,
          ASSISTANT_FROM_EMAIL,
          user?.email || profile?.email,
        );
        fromEmail = resolved.fromEmail;
        body = resolved.body;
      } catch {
        /* asystent jako fallback */
      }
      setEmailDraft({
        supplierName,
        toEmail: tpl.supplierEmail || supplierEmail || '',
        fromEmail,
        subject: tpl.subject,
        body,
        supplierId,
        totalPln: Math.round((productsSum + shipFee) * 100) / 100,
      });
      setShowEmail(true);
    } catch (e: any) {
      alert('Błąd', e?.message ?? 'Nie udało się złożyć zamówienia.');
    } finally {
      setSaving(false);
    }
  };

  const productsTotal = useMemo(() => {
    if (!cartItems.length) return null;
    if (!cartItems.every((e) => e.item.price_pln != null)) return null;
    return cartItems.reduce((acc, e) => acc + e.item.price_pln! * e.quantity, 0);
  }, [cartItems]);

  const deliveryFee = useMemo(() => {
    if (productsTotal == null || shippingCost <= 0) return 0;
    if (freeShipFrom > 0 && productsTotal >= freeShipFrom) return 0;
    return shippingCost;
  }, [productsTotal, shippingCost, freeShipFrom]);

  const grandTotal = useMemo(() => {
    if (productsTotal == null) return null;
    return Math.round((productsTotal + deliveryFee) * 100) / 100;
  }, [productsTotal, deliveryFee]);

  const renderProduct = ({ item, index }: { item: CatalogRow; index: number }) => {
    const inCart = cart.get(item.id);
    const prev = filtered[index - 1];
    const showSection =
      index === 0 || (prev && prev.in_menu !== item.in_menu);

    return (
      <View>
        {showSection ? (
          <Text style={[styles.sectionLabel, { color: muted }]}>
            {item.in_menu ? 'Występujące w menu' : 'Dodatkowe'}
          </Text>
        ) : null}
        <TouchableOpacity
          style={[styles.productRow, { borderBottomColor: border }]}
          onPress={() => addOneToCart(item)}
          activeOpacity={0.7}
        >
          <View style={styles.productLeft}>
            <Text style={[styles.productName, { color: text }]} numberOfLines={2}>
              {item.name}
            </Text>
            <View style={styles.productMeta}>
              {item.variant ? (
                <Text style={[styles.productPrice, { color: muted }]}>{item.variant}</Text>
              ) : null}
              {item.price_pln != null && (
                <Text style={[styles.productPrice, { color: accent }]}>
                  {formatPlnNumber(item.price_pln)} zł/{item.unit}
                </Text>
              )}
            </View>
          </View>
          <TouchableOpacity
            style={[
              styles.addBtn,
              { backgroundColor: prem ? 'rgba(0,255,120,0.14)' : Colors.accentLight, borderColor: prem ? accent : '#BFDBFE' },
              inCart && { backgroundColor: accent, borderColor: accent },
            ]}
            onPress={() => openQty(item)}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
            activeOpacity={0.75}
          >
            {inCart ? (
              <Text style={[styles.addBtnQty, { color: prem ? '#0A0A0A' : Colors.white }]} numberOfLines={1}>
                {Number(inCart.quantity) % 1 === 0
                  ? inCart.quantity.toFixed(0)
                  : inCart.quantity.toFixed(2)}{' '}
                {item.unit}
              </Text>
            ) : (
              <Plus size={18} color={prem ? accent : Colors.accent} strokeWidth={2.5} />
            )}
          </TouchableOpacity>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: bg }]}>
        <View style={[styles.header, { backgroundColor: bg, borderBottomColor: border }]}>
          <View style={styles.headerLeft}>
            <ShoppingCart size={18} color={accent} strokeWidth={2} />
            <View>
              <Text style={[styles.headerTitle, { color: text }]}>Zamówienie</Text>
              <Text style={[styles.headerSub, { color: muted }]}>{supplierName}</Text>
            </View>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10}>
            <X size={22} color={muted} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <View style={[styles.tabs, { backgroundColor: bg, borderBottomColor: border }]}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'products' && { borderBottomColor: accent, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab('products')}
          >
            <Text style={[styles.tabText, { color: activeTab === 'products' ? accent : muted }]}>
              Produkty
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'cart' && { borderBottomColor: accent, borderBottomWidth: 2 }]}
            onPress={() => setActiveTab('cart')}
          >
            <Text style={[styles.tabText, { color: activeTab === 'cart' ? accent : muted }]}>Koszyk</Text>
            {cartCount > 0 && (
              <View style={[styles.cartBadge, { backgroundColor: accent }]}>
                <Text style={[styles.cartBadgeText, { color: '#0A0A0A' }]}>{cartCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={accent} />
            <Text style={[styles.loadingText, { color: muted }]}>Wczytywanie katalogu…</Text>
          </View>
        ) : activeTab === 'products' ? (
          products.length === 0 ? (
            <View style={styles.centerBox}>
              <Package size={40} color={muted} strokeWidth={1.5} />
              <Text style={[styles.emptyTitle, { color: text }]}>Brak produktów w katalogu</Text>
              <Text style={[styles.emptySub, { color: muted }]}>
                Dodaj produkty ręcznie albo wgraj ofertę / fakturę w karcie dostawcy.
              </Text>
            </View>
          ) : (
            <>
              <View style={[styles.searchWrap, { backgroundColor: tile, borderColor: border }]}>
                <Search size={16} color={muted} strokeWidth={2} />
                <TextInput
                  style={[styles.searchInput, { color: text }]}
                  value={query}
                  onChangeText={setQuery}
                  placeholder="Szukaj w katalogu…"
                  placeholderTextColor={muted}
                  autoCorrect={false}
                  testID="order-catalog-search"
                />
                {query ? (
                  <TouchableOpacity onPress={() => setQuery('')}>
                    <X size={16} color={muted} />
                  </TouchableOpacity>
                ) : null}
              </View>
              {filtered.length === 0 ? (
                <View style={styles.centerBox}>
                  <Text style={[styles.emptyTitle, { color: text }]}>Brak dopasowań</Text>
                  <Text style={[styles.emptySub, { color: muted }]}>
                    Spróbuj innej frazy — dopasowania pojawiają się po każdej literze.
                  </Text>
                </View>
              ) : (
                <FlatList
                  data={filtered}
                  keyExtractor={(item) => item.id}
                  renderItem={renderProduct}
                  contentContainerStyle={styles.list}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                />
              )}
            </>
          )
        ) : cartItems.length === 0 ? (
          <View style={styles.centerBox}>
            <ShoppingCart size={40} color={muted} strokeWidth={1.5} />
            <Text style={[styles.emptyTitle, { color: text }]}>Koszyk jest pusty</Text>
            <Text style={[styles.emptySub, { color: muted }]}>
              Przejdź do zakładki Produkty i dodaj pozycje.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
          >
            <View style={[styles.supplierHeader, { backgroundColor: prem ? 'rgba(0,255,120,0.12)' : Colors.accentLight, borderColor: prem ? accent : '#BFDBFE' }]}>
              <Truck size={14} color={accent} strokeWidth={2} />
              <Text style={[styles.supplierHeaderText, { color: accent }]}>{supplierName}</Text>
              <Text style={[styles.supplierHeaderCount, { color: accent }]}>{cartItems.length} poz.</Text>
            </View>
            {cartItems.map((entry) => (
              <View key={entry.item.id} style={[styles.cartRow, { borderBottomColor: border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.cartName, { color: text }]} numberOfLines={1}>
                    {entry.item.name}
                  </Text>
                  <Text style={[styles.cartQty, { color: muted }]}>
                    {entry.quantity} {entry.item.unit}
                    {entry.item.price_pln != null
                      ? ` · ${formatPlnNumber(entry.item.price_pln * entry.quantity)} zł`
                      : ''}
                  </Text>
                </View>
                <TouchableOpacity style={[styles.editQtyBtn, { backgroundColor: tile }]} onPress={() => openQty(entry.item)}>
                  <Plus size={14} color={accent} strokeWidth={2.5} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.removeBtn} onPress={() => removeFromCart(entry.item.id)}>
                  <Trash2 size={14} color={Colors.danger} strokeWidth={2} />
                </TouchableOpacity>
              </View>
            ))}
            <Text style={[styles.notesLabel, { color: muted }]}>Uwagi do zamówienia</Text>
            <TextInput
              style={[styles.notesInput, { backgroundColor: tile, borderColor: border, color: text }]}
              value={notes}
              onChangeText={setNotes}
              placeholder="Opcjonalne uwagi…"
              placeholderTextColor={muted}
              multiline
            />
            <View style={{ height: 140 }} />
          </ScrollView>
        )}

        {activeTab === 'cart' && cartItems.length > 0 && (
          <View style={[styles.footer, { backgroundColor: card, borderTopColor: border }]}>
            {grandTotal != null && (
              <View style={{ marginBottom: 8 }}>
                {deliveryFee > 0 ? (
                  <Text style={[styles.grandTotal, { color: muted, fontSize: 13, fontWeight: '600' }]}>
                    Produkty: {formatPlnNumber(productsTotal!)} zł · Dostawa: {formatPlnNumber(deliveryFee)} zł
                  </Text>
                ) : null}
                <Text style={[styles.grandTotal, { color: text }]}>
                  Razem: {formatPlnNumber(grandTotal)} zł
                </Text>
              </View>
            )}
            <View style={styles.footerRow}>
              <TouchableOpacity
                style={[styles.draftBtn, { borderColor: accent }, saving && { opacity: 0.6 }]}
                onPress={() => void saveDraft()}
                disabled={saving}
                activeOpacity={0.85}
              >
                <LinearGradient colors={[...DS.gradient.green]} start={{ x: 0, y: 0.2 }} end={{ x: 1, y: 0.8 }} style={styles.draftGrad}>
                  <Text style={styles.premBtnText} numberOfLines={1}>Dodaj do koszyka</Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.placeBtn, saving && { opacity: 0.6 }]}
                onPress={() => void placeOrder()}
                disabled={saving}
                activeOpacity={0.85}
              >
                <LinearGradient colors={[...DS.gradient.green]} start={{ x: 0, y: 0.2 }} end={{ x: 1, y: 0.8 }} style={styles.placeGrad}>
                  {saving ? (
                    <ActivityIndicator color="#0A0A0A" />
                  ) : (
                    <Text style={styles.premBtnText} numberOfLines={1}>Złóż zamówienie</Text>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
            <TouchableOpacity
              style={[styles.manualPayBtn, { borderColor: accent }]}
              onPress={() => {
                void (async () => {
                  if (!(await ensureMinOrderMet())) return;
                  setManualPayOrder({
                    supplierId,
                    supplierName,
                    orderTitle: `Zamówienie — ${supplierName}`,
                    totalPln: grandTotal ?? cartItems.reduce(
                      (acc, e) => acc + (e.item.price_pln != null ? e.item.price_pln * e.quantity : 0),
                      0,
                    ) + deliveryFee,
                  });
                })();
              }}
              activeOpacity={0.85}
              testID="order-modal-manual-pay"
            >
              <Landmark size={16} color={accent} strokeWidth={2.2} />
              <Text style={[styles.manualPayText, { color: accent }]}>Opłać zamówienie</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      <Modal visible={showQtyModal} transparent animationType="fade" onRequestClose={() => setShowQtyModal(false)}>
        <KeyboardAvoidingView style={styles.qtyOverlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View style={[styles.qtySheet, { backgroundColor: card, borderColor: border }]}>
            <Text style={[styles.qtyTitle, { color: text }]}>Ile chcesz zamówić?</Text>
            {pendingItem && (
              <Text style={[styles.qtyProduct, { color: muted }]} numberOfLines={2}>
                {pendingItem.name}
              </Text>
            )}
            <View style={styles.qtyInputRow}>
              <TextInput
                style={[styles.qtyInput, { backgroundColor: tile, borderColor: accent, color: text }]}
                value={qtyInput}
                onChangeText={setQtyInput}
                keyboardType="decimal-pad"
                autoFocus
                selectTextOnFocus
              />
              <View style={[styles.qtyUnitBox, { backgroundColor: tile, borderColor: border }]}>
                <Text style={{ color: muted, fontWeight: '700' }}>{pendingItem?.unit ?? 'szt'}</Text>
              </View>
            </View>
            <View style={styles.qtyBtns}>
              <TouchableOpacity style={[styles.qtyCancelBtn, { backgroundColor: tile }]} onPress={() => setShowQtyModal(false)}>
                <Text style={{ color: muted, fontWeight: '700' }}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.qtyConfirmBtn} onPress={confirmQty}>
                <LinearGradient colors={[...DS.gradient.green]} style={styles.qtyConfirmGrad}>
                  <Text style={styles.premBtnText}>Dodaj</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <OrderEmailComposer
        visible={showEmail}
        draft={emailDraft}
        onClose={() => {
          // Zostaw OrderModal otwarty — użytkownik wraca do złożonego zamówienia / koszyka
          setShowEmail(false);
        }}
        onSent={() => {
          // Asystent: zamówienie już jest status=sent (Przygotowywane)
          setShowEmail(false);
        }}
        onMailClientOpened={() => {
          // Zewnętrzna skrzynka — zostaje w Przygotowywanych (sent)
        }}
        onPayPress={
          emailDraft
            ? () =>
                setManualPayOrder({
                  supplierId: emailDraft.supplierId ?? supplierId,
                  supplierName: emailDraft.supplierName || supplierName,
                  orderTitle: emailDraft.subject || `Zamówienie — ${supplierName}`,
                  totalPln: emailDraft.totalPln ?? 0,
                })
            : undefined
        }
      />
      <ManualBankPaymentSheet
        visible={!!manualPayOrder}
        order={manualPayOrder}
        onClose={() => setManualPayOrder(null)}
        colors={{
          card,
          text,
          textSecondary: muted,
          textTertiary: muted,
          border,
          accent,
          background: bg,
          isPremium: prem,
        }}
      />
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerSub: { fontSize: 12, marginTop: 1 },
  tabs: { flexDirection: 'row', borderBottomWidth: 1 },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  tabText: { fontSize: 14, fontWeight: '600' },
  cartBadge: { borderRadius: 10, paddingHorizontal: 6, paddingVertical: 1, minWidth: 18, alignItems: 'center' },
  cartBadgeText: { fontSize: 11, fontWeight: '800' },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    marginBottom: 4,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: { flex: 1, fontSize: 14, padding: 0 },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  loadingText: { fontSize: 14, marginTop: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700' },
  emptySub: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  list: { padding: 16, paddingBottom: 32 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 10,
    marginBottom: 6,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  productLeft: { flex: 1, gap: 4 },
  productName: { fontSize: 14, fontWeight: '600', lineHeight: 19 },
  productMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  productPrice: { fontSize: 12, fontWeight: '500' },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  addBtnQty: { fontSize: 10, fontWeight: '800', textAlign: 'center' },
  supplierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
    borderWidth: 1,
  },
  supplierHeaderText: { flex: 1, fontSize: 13, fontWeight: '700' },
  supplierHeaderCount: { fontSize: 12, fontWeight: '500' },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  cartName: { fontSize: 14, fontWeight: '600' },
  cartQty: { fontSize: 12, marginTop: 2 },
  editQtyBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.dangerLight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesLabel: { fontSize: 13, fontWeight: '600', marginTop: 14, marginBottom: 8 },
  notesInput: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    borderWidth: 1,
    height: 80,
    textAlignVertical: 'top',
  },
  footer: {
    borderTopWidth: 1,
    padding: 16,
    gap: 10,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },
  grandTotal: { fontSize: 14, fontWeight: '800', textAlign: 'right' },
  footerRow: { flexDirection: 'row', gap: 8 },
  draftBtn: { flex: 1, borderRadius: 12, overflow: 'hidden', borderWidth: 0 },
  draftGrad: { paddingVertical: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  placeBtn: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  placeGrad: { paddingVertical: 13, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  manualPayBtn: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingVertical: 12,
  },
  manualPayText: { fontSize: 14, fontWeight: '800' },
  premBtnText: { fontSize: 13, fontWeight: '800', color: '#0A0A0A' },
  qtyOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  qtySheet: { borderRadius: 20, padding: 24, width: '100%', maxWidth: 340, gap: 16, borderWidth: 1 },
  qtyTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center' },
  qtyProduct: { fontSize: 13, textAlign: 'center', lineHeight: 18 },
  qtyInputRow: { flexDirection: 'row', gap: 8 },
  qtyInput: {
    flex: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    borderWidth: 2,
  },
  qtyUnitBox: {
    width: 60,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  qtyBtns: { flexDirection: 'row', gap: 10 },
  qtyCancelBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: 'center' },
  qtyConfirmBtn: { flex: 2, borderRadius: 12, overflow: 'hidden' },
  qtyConfirmGrad: { paddingVertical: 12, alignItems: 'center', borderRadius: 12 },
});
