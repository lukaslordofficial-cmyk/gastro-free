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
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { X, ShoppingCart, Plus, Package, Trash2, Truck } from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';
import type { SupplierOfferItem } from '@/lib/types';

interface Props {
  supplierId: string;
  supplierName: string;
  visible: boolean;
  onClose: () => void;
}

interface WarehouseInfo {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  min_quantity: number;
}

interface ProductRow extends SupplierOfferItem {
  warehouseInfo: WarehouseInfo | null;
}

interface CartEntry {
  item: ProductRow;
  quantity: number;
}

export function OrderModal({ supplierId, supplierName, visible, onClose }: Props) {
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Map<string, CartEntry>>(new Map());
  const [showQtyModal, setShowQtyModal] = useState(false);
  const [pendingItem, setPendingItem] = useState<ProductRow | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [notes, setNotes] = useState('');
  const [deliveryCost, setDeliveryCost] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'products' | 'cart'>('products');

  const cartItems = useMemo(() => Array.from(cart.values()), [cart]);
  const cartCount = cartItems.length;

  const load = useCallback(async () => {
    setLoading(true);
    const { data: items } = await supabase
      .from('supplier_offer_items')
      .select('*')
      .eq('supplier_id', supplierId)
      .order('raw_product_name');

    const rows: SupplierOfferItem[] = items ?? [];
    const warehouseIds = rows
      .filter((r) => r.warehouse_product_id)
      .map((r) => r.warehouse_product_id!);

    const warehouseMap = new Map<string, WarehouseInfo>();
    if (warehouseIds.length > 0) {
      const { data: wItems } = await supabase
        .from('inventory_items')
        .select('id, name, quantity, unit, min_quantity')
        .in('id', warehouseIds);
      (wItems ?? []).forEach((w) => warehouseMap.set(w.id, w as WarehouseInfo));
    }

    setProducts(
      rows.map((r) => ({
        ...r,
        warehouseInfo: r.warehouse_product_id ? (warehouseMap.get(r.warehouse_product_id) ?? null) : null,
      }))
    );
    setLoading(false);
  }, [supplierId]);

  useEffect(() => {
    if (visible) {
      setCart(new Map());
      setNotes('');
      setDeliveryCost('');
      setActiveTab('products');
      load();
    }
  }, [visible, load]);

  function openQty(item: ProductRow) {
    setPendingItem(item);
    const existing = cart.get(item.id);
    setQtyInput(existing ? existing.quantity.toString() : '1');
    setShowQtyModal(true);
  }

  function confirmQty() {
    if (!pendingItem) return;
    const qty = parseFloat(qtyInput.replace(',', '.'));
    if (isNaN(qty) || qty <= 0) {
      Alert.alert('Błąd', 'Podaj poprawną ilość (liczba > 0).');
      return;
    }
    setCart((prev) => {
      const next = new Map(prev);
      next.set(pendingItem.id, { item: pendingItem, quantity: qty });
      return next;
    });
    setShowQtyModal(false);
    setPendingItem(null);
  }

  function removeFromCart(itemId: string) {
    setCart((prev) => {
      const next = new Map(prev);
      next.delete(itemId);
      return next;
    });
  }

  async function placeOrder() {
    if (cart.size === 0) {
      Alert.alert('Puste zamówienie', 'Dodaj produkty do zamówienia.');
      return;
    }
    setSaving(true);
    try {
      const deliveryCostVal = parseFloat(deliveryCost.replace(',', '.'));
      const deliveryCostNote = !isNaN(deliveryCostVal) && deliveryCostVal > 0
        ? `Koszt dostawy: ${deliveryCostVal.toFixed(2)} PLN`
        : '';
      const fullNotes = [deliveryCostNote, notes.trim()].filter(Boolean).join('\n');

      const { data: order, error: orderErr } = await supabase
        .from('supplier_orders')
        .insert({ supplier_id: supplierId, status: 'sent', notes: fullNotes || null })
        .select()
        .single();
      if (orderErr || !order) throw orderErr ?? new Error('Błąd tworzenia zamówienia');

      const rows = cartItems.map((e) => ({
        order_id: order.id,
        raw_product_name: e.item.raw_product_name,
        price_net: e.item.price_net,
        unit: e.item.unit,
        quantity_ordered: e.quantity,
        warehouse_product_id: e.item.warehouse_product_id,
      }));
      const { error: itemsErr } = await supabase.from('supplier_order_items').insert(rows);
      if (itemsErr) throw itemsErr;

      Alert.alert(
        'Zamówienie złożone',
        `Zamówienie do ${supplierName} zostało zapisane.\n${cartItems.length} pozycji.`,
        [{ text: 'OK', onPress: onClose }]
      );
    } catch (e: any) {
      Alert.alert('Błąd', e.message ?? 'Nie udało się złożyć zamówienia.');
    } finally {
      setSaving(false);
    }
  }

  const deliveryCostVal = parseFloat(deliveryCost.replace(',', '.'));
  const deliveryCostNum = !isNaN(deliveryCostVal) && deliveryCostVal > 0 ? deliveryCostVal : 0;

  const productsTotal = useMemo(() => {
    if (cartItems.length === 0) return null;
    if (!cartItems.every((e) => e.item.price_net != null)) return null;
    return cartItems.reduce((acc, e) => acc + e.item.price_net! * e.quantity, 0);
  }, [cartItems]);

  const grandTotal = productsTotal != null ? productsTotal + deliveryCostNum : null;

  function renderProduct({ item }: { item: ProductRow }) {
    const inCart = cart.get(item.id);
    const isCritical = item.warehouseInfo
      ? item.warehouseInfo.quantity <= item.warehouseInfo.min_quantity
      : false;

    return (
      <View style={styles.productRow}>
        <View style={styles.productLeft}>
          <Text style={styles.productName} numberOfLines={2}>
            {item.raw_product_name}
          </Text>
          <View style={styles.productMeta}>
            {item.price_net != null && (
              <Text style={styles.productPrice}>
                {Number(item.price_net).toFixed(2)} PLN/{item.unit}
              </Text>
            )}
            {item.warehouseInfo && (
              <View style={[styles.stockBadge, isCritical && styles.stockBadgeCritical]}>
                <Package size={9} color={isCritical ? Colors.danger : Colors.success} strokeWidth={2.5} />
                <Text style={[styles.stockText, isCritical && styles.stockTextCritical]}>
                  {Number(item.warehouseInfo.quantity).toFixed(1)} {item.warehouseInfo.unit}
                </Text>
              </View>
            )}
          </View>
        </View>
        <TouchableOpacity
          style={[styles.addBtn, inCart && styles.addBtnActive]}
          onPress={() => openQty(item)}
          activeOpacity={0.75}
        >
          {inCart ? (
            <Text style={styles.addBtnQty} numberOfLines={1}>
              {Number(inCart.quantity) % 1 === 0
                ? inCart.quantity.toFixed(0)
                : inCart.quantity.toFixed(2)}{' '}
              {item.unit}
            </Text>
          ) : (
            <Plus size={18} color={Colors.accent} strokeWidth={2.5} />
          )}
        </TouchableOpacity>
      </View>
    );
  }

  function renderCartItem({ item: entry }: { item: CartEntry }) {
    return (
      <View style={styles.cartRow}>
        <View style={styles.cartLeft}>
          <Text style={styles.cartName} numberOfLines={1}>
            {entry.item.raw_product_name}
          </Text>
          <Text style={styles.cartQty}>
            {Number(entry.quantity) % 1 === 0
              ? entry.quantity.toFixed(0)
              : entry.quantity.toFixed(2)}{' '}
            {entry.item.unit}
            {entry.item.price_net != null
              ? ` · ${(entry.item.price_net * entry.quantity).toFixed(2)} PLN`
              : ''}
          </Text>
        </View>
        <View style={styles.cartActions}>
          <TouchableOpacity
            style={styles.editQtyBtn}
            onPress={() => openQty(entry.item)}
            activeOpacity={0.7}
          >
            <Plus size={14} color={Colors.accent} strokeWidth={2.5} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.removeBtn}
            onPress={() => removeFromCart(entry.item.id)}
            activeOpacity={0.7}
          >
            <Trash2 size={14} color={Colors.danger} strokeWidth={2} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <ShoppingCart size={18} color={Colors.accent} strokeWidth={2} />
            <View>
              <Text style={styles.headerTitle}>Zamówienie</Text>
              <Text style={styles.headerSub}>{supplierName}</Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={onClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <X size={22} color={Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {/* Tabs */}
        <View style={styles.tabs}>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'products' && styles.tabActive]}
            onPress={() => setActiveTab('products')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, activeTab === 'products' && styles.tabTextActive]}>
              Produkty
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tab, activeTab === 'cart' && styles.tabActive]}
            onPress={() => setActiveTab('cart')}
            activeOpacity={0.8}
          >
            <Text style={[styles.tabText, activeTab === 'cart' && styles.tabTextActive]}>
              Koszyk
            </Text>
            {cartCount > 0 && (
              <View style={styles.cartBadge}>
                <Text style={styles.cartBadgeText}>{cartCount}</Text>
              </View>
            )}
          </TouchableOpacity>
        </View>

        {/* Content */}
        {loading ? (
          <View style={styles.centerBox}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.loadingText}>Wczytywanie produktów...</Text>
          </View>
        ) : activeTab === 'products' ? (
          products.length === 0 ? (
            <View style={styles.centerBox}>
              <Package size={40} color={Colors.textTertiary} strokeWidth={1.5} />
              <Text style={styles.emptyTitle}>Brak produktów</Text>
              <Text style={styles.emptySub}>
                Wgraj ofertę AI lub dodaj produkty ręcznie w karcie dostawcy.
              </Text>
            </View>
          ) : (
            <FlatList
              data={products}
              keyExtractor={(item) => item.id}
              renderItem={renderProduct}
              contentContainerStyle={styles.list}
              showsVerticalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )
        ) : cartItems.length === 0 ? (
          <View style={styles.centerBox}>
            <ShoppingCart size={40} color={Colors.textTertiary} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>Koszyk jest pusty</Text>
            <Text style={styles.emptySub}>
              Przejdź do zakładki Produkty i dodaj pozycje do zamówienia.
            </Text>
          </View>
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Supplier header in cart */}
            <View style={styles.supplierHeader}>
              <Truck size={14} color={Colors.accent} strokeWidth={2} />
              <Text style={styles.supplierHeaderText}>{supplierName}</Text>
              <Text style={styles.supplierHeaderCount}>{cartItems.length} poz.</Text>
            </View>

            {cartItems.map((entry, idx) => (
              <View key={entry.item.id}>
                {renderCartItem({ item: entry })}
                {idx < cartItems.length - 1 && <View style={styles.separator} />}
              </View>
            ))}

            {/* Delivery cost tile */}
            <View style={styles.deliveryTile}>
              <View style={styles.deliveryTileLeft}>
                <Truck size={16} color={Colors.textSecondary} strokeWidth={2} />
                <View>
                  <Text style={styles.deliveryTileLabel}>Koszt dostawy</Text>
                  <Text style={styles.deliveryTileHint}>Opcjonalny — wpisz jeśli wystąpi</Text>
                </View>
              </View>
              <View style={styles.deliveryInputWrap}>
                <TextInput
                  style={styles.deliveryInput}
                  value={deliveryCost}
                  onChangeText={setDeliveryCost}
                  placeholder="0.00"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="decimal-pad"
                />
                <Text style={styles.deliveryCurrency}>PLN</Text>
              </View>
            </View>

            {/* Notes */}
            <View style={{ paddingTop: 12 }}>
              <Text style={styles.notesLabel}>Uwagi do zamówienia</Text>
              <TextInput
                style={styles.notesInput}
                value={notes}
                onChangeText={setNotes}
                placeholder="Opcjonalne uwagi dla dostawcy..."
                placeholderTextColor={Colors.textTertiary}
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />
            </View>

            <View style={{ height: 120 }} />
          </ScrollView>
        )}

        {/* Footer */}
        {activeTab === 'cart' && cartItems.length > 0 && (
          <View style={styles.footer}>
            {(grandTotal != null || deliveryCostNum > 0) && (
              <View style={styles.totalsRow}>
                {productsTotal != null && (
                  <Text style={styles.totalLine}>
                    Produkty: {productsTotal.toFixed(2)} PLN
                  </Text>
                )}
                {deliveryCostNum > 0 && (
                  <Text style={styles.totalLine}>
                    Dostawa: {deliveryCostNum.toFixed(2)} PLN
                  </Text>
                )}
                {grandTotal != null && (
                  <Text style={styles.grandTotal}>
                    Razem: {grandTotal.toFixed(2)} PLN
                  </Text>
                )}
              </View>
            )}
            <TouchableOpacity
              style={[styles.placeOrderBtn, saving && styles.placeOrderBtnDisabled]}
              onPress={placeOrder}
              disabled={saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <>
                  <ShoppingCart size={16} color={Colors.white} strokeWidth={2} />
                  <Text style={styles.placeOrderText}>
                    Złóż zamówienie · {cartItems.length} poz.
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Quantity input modal */}
      <Modal
        visible={showQtyModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowQtyModal(false)}
      >
        <KeyboardAvoidingView
          style={styles.qtyOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.qtySheet}>
            <Text style={styles.qtyTitle}>Ile chcesz zamówić?</Text>
            {pendingItem && (
              <Text style={styles.qtyProduct} numberOfLines={2}>
                {pendingItem.raw_product_name}
              </Text>
            )}
            <View style={styles.qtyInputRow}>
              <TextInput
                style={styles.qtyInput}
                value={qtyInput}
                onChangeText={setQtyInput}
                keyboardType="decimal-pad"
                autoFocus
                selectTextOnFocus
                placeholder="1"
                placeholderTextColor={Colors.textTertiary}
              />
              <View style={styles.qtyUnitBox}>
                <Text style={styles.qtyUnitText}>{pendingItem?.unit ?? 'szt'}</Text>
              </View>
            </View>
            <View style={styles.qtyBtns}>
              <TouchableOpacity
                style={styles.qtyCancelBtn}
                onPress={() => setShowQtyModal(false)}
              >
                <Text style={styles.qtyCancelText}>Anuluj</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.qtyConfirmBtn} onPress={confirmQty}>
                <Text style={styles.qtyConfirmText}>Dodaj do zamówienia</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingBottom: 12,
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  tabs: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
  },
  tabActive: { borderBottomWidth: 2, borderBottomColor: Colors.accent },
  tabText: { fontSize: 14, fontWeight: '600', color: Colors.textTertiary },
  tabTextActive: { color: Colors.accent },
  cartBadge: {
    backgroundColor: Colors.accent,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
    minWidth: 18,
    alignItems: 'center',
  },
  cartBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.white },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  loadingText: { fontSize: 14, color: Colors.textTertiary, marginTop: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textSecondary },
  emptySub: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center', lineHeight: 19 },
  list: { padding: 16, paddingBottom: 32 },
  separator: { height: 1, backgroundColor: Colors.borderLight },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: Colors.card,
    gap: 12,
  },
  productLeft: { flex: 1, gap: 4 },
  productName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary, lineHeight: 19 },
  productMeta: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  productPrice: { fontSize: 12, color: Colors.textSecondary, fontWeight: '500' },
  stockBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.successLight,
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  stockBadgeCritical: { backgroundColor: Colors.dangerLight },
  stockText: { fontSize: 10, fontWeight: '600', color: Colors.success },
  stockTextCritical: { color: Colors.danger },
  addBtn: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: Colors.accentLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
  },
  addBtnActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  addBtnQty: { fontSize: 10, fontWeight: '700', color: Colors.white, textAlign: 'center' },
  // Cart
  supplierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.accentLight,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  supplierHeaderText: { flex: 1, fontSize: 13, fontWeight: '700', color: Colors.accent },
  supplierHeaderCount: { fontSize: 12, color: Colors.accent, fontWeight: '500' },
  cartRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    backgroundColor: Colors.card,
    gap: 12,
  },
  cartLeft: { flex: 1, gap: 3 },
  cartName: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  cartQty: { fontSize: 12, color: Colors.textSecondary },
  cartActions: { flexDirection: 'row', gap: 8 },
  editQtyBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: Colors.accentLight,
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
  // Delivery cost tile
  deliveryTile: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.borderLight,
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  deliveryTileLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  deliveryTileLabel: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  deliveryTileHint: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  deliveryInputWrap: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  deliveryInput: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textPrimary,
    borderWidth: 1.5,
    borderColor: Colors.border,
    width: 90,
    textAlign: 'right',
  },
  deliveryCurrency: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  notesLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary, marginBottom: 8 },
  notesInput: {
    backgroundColor: Colors.borderLight,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: Colors.textPrimary,
    borderWidth: 1,
    borderColor: Colors.border,
    height: 80,
    textAlignVertical: 'top',
  },
  footer: {
    backgroundColor: Colors.card,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    padding: 16,
    gap: 10,
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },
  totalsRow: { gap: 3 },
  totalLine: { fontSize: 12, color: Colors.textSecondary, textAlign: 'right' },
  grandTotal: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, textAlign: 'right', marginTop: 2 },
  placeOrderBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
  },
  placeOrderBtnDisabled: { opacity: 0.6 },
  placeOrderText: { fontSize: 15, fontWeight: '700', color: Colors.white },
  qtyOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  qtySheet: {
    backgroundColor: Colors.card,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    gap: 16,
  },
  qtyTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary, textAlign: 'center' },
  qtyProduct: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center', lineHeight: 18 },
  qtyInputRow: { flexDirection: 'row', gap: 8 },
  qtyInput: {
    flex: 1,
    backgroundColor: Colors.borderLight,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 22,
    fontWeight: '700',
    color: Colors.textPrimary,
    textAlign: 'center',
    borderWidth: 2,
    borderColor: Colors.accent,
  },
  qtyUnitBox: {
    width: 60,
    backgroundColor: Colors.borderLight,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  qtyUnitText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  qtyBtns: { flexDirection: 'row', gap: 10 },
  qtyCancelBtn: {
    flex: 1,
    backgroundColor: Colors.borderLight,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  qtyCancelText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  qtyConfirmBtn: {
    flex: 2,
    backgroundColor: Colors.accent,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
  },
  qtyConfirmText: { fontSize: 14, fontWeight: '700', color: Colors.white },
});