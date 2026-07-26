import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import {
  ArrowLeft,
  Truck,
  ShoppingCart,
  Package,
  TrendingDown,
  Star,
  AlertCircle,
  Pencil,
  Save,
  Check,
  UtensilsCrossed,
  RefreshCw,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { OrderModal } from '@/components/OrderModal';
import { ProductExpiryEditor } from '@/components/ProductExpiryEditor';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { formatPlnNumber } from '@/lib/format';
import { namesMatch } from '@/lib/fuzzyProductMatch';

interface OfferRow {
  id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_color: string;
  raw_product_name: string;
  price_net: number | null;
  unit: string;
}

interface CategoryRow {
  id: string;
  name: string;
  color: string;
}

interface ProductRow {
  id: string;
  name: string;
  category_id: string | null;
  quantity: number;
  unit: string;
  min_quantity: number;
  portion_size: number | null;
  safety_buffer_percent?: number | null;
  is_combo_polprodukt?: boolean;
  unit_weight_volume?: number | null;
  weight_volume_unit?: string | null;
}

const UNIT_OPTIONS = ['kg', 'g', 'l', 'ml', 'szt', 'op'];
const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

interface YieldDish {
  menu_item_id: string;
  dish_name: string;
  is_active: boolean;
  per_portion_qty: number;
  unit: string;
  portions: number;
  convertible: boolean;
}

interface YieldData {
  item_name: string;
  stock_quantity: number;
  stock_unit: string;
  dishes: YieldDish[];
}

type TabKey = 'suppliers' | 'edit';

export default function ProductSuppliersScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const { productId, productName } = useLocalSearchParams<{ productId: string; productName: string }>();

  const [tab, setTab] = useState<TabKey>('suppliers');

  // Suppliers tab state
  const [offers, setOffers] = useState<OfferRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [orderSupplierId, setOrderSupplierId] = useState<string | null>(null);
  const [orderSupplierName, setOrderSupplierName] = useState('');

  // Edit tab state
  const [product, setProduct] = useState<ProductRow | null>(null);
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [loadingEdit, setLoadingEdit] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [form, setForm] = useState({
    name: '',
    categoryId: '' as string | null | '',
    quantity: '',
    unit: 'kg',
    minQuantity: '',
    optimalQuantity: '',
    portionSize: '',
    safetyBuffer: '20',
    unitWeightVolume: '',
    weightVolumeUnit: 'g' as 'g' | 'ml',
  });

  // Dynamic portions yield ("Dostępność w menu")
  const [yieldData, setYieldData] = useState<YieldData | null>(null);
  const [loadingYield, setLoadingYield] = useState(true);

  const loadYield = useCallback(async () => {
    if (!productId) return;
    setLoadingYield(true);
    try {
      const res = await fetch(`${BACKEND_URL}/api/inventory/${productId}/portions-yield`);
      if (res.ok) {
        setYieldData(await res.json());
      }
    } catch {
      /* non-critical */
    } finally {
      setLoadingYield(false);
    }
  }, [productId]);

  const loadOffers = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    try {
      // 1) Oferty już zlinkowane do produktu magazynowego
      const { data: linked } = await supabase
        .from('supplier_offer_items')
        .select('id, supplier_id, raw_product_name, price_net, unit, warehouse_product_id, suppliers(name, icon_color)')
        .eq('warehouse_product_id', productId)
        .order('price_net', { ascending: true, nullsFirst: false });

      const rows: OfferRow[] = (linked ?? []).map((r: any) => ({
        id: r.id,
        supplier_id: r.supplier_id,
        supplier_name: r.suppliers?.name ?? 'Nieznany dostawca',
        supplier_color: r.suppliers?.icon_color ?? Colors.textSecondary,
        raw_product_name: r.raw_product_name,
        price_net: r.price_net != null ? Number(r.price_net) : null,
        unit: r.unit,
      }));

      // 2) Fuzzy: oferty bez warehouse_product_id + katalog dostawcy (nazwa ≈ produkt)
      const productLabel = (productName || '').trim();
      if (productLabel) {
        const seen = new Set(rows.map((r) => r.id));

        const { data: unlinked } = await supabase
          .from('supplier_offer_items')
          .select('id, supplier_id, raw_product_name, price_net, unit, warehouse_product_id, suppliers(name, icon_color)')
          .is('warehouse_product_id', null)
          .limit(2000);

        const toLink: string[] = [];
        for (const r of unlinked ?? []) {
          if (!r?.raw_product_name || seen.has(r.id)) continue;
          if (!namesMatch(productLabel, r.raw_product_name, 72)) continue;
          seen.add(r.id);
          toLink.push(r.id);
          rows.push({
            id: r.id,
            supplier_id: r.supplier_id,
            supplier_name: (r as any).suppliers?.name ?? 'Nieznany dostawca',
            supplier_color: (r as any).suppliers?.icon_color ?? Colors.textSecondary,
            raw_product_name: r.raw_product_name,
            price_net: r.price_net != null ? Number(r.price_net) : null,
            unit: r.unit,
          });
        }
        // Backfill FK — żeby kolejne otwarcia były szybkie
        if (toLink.length > 0) {
          void supabase
            .from('supplier_offer_items')
            .update({ warehouse_product_id: productId })
            .in('id', toLink);
        }

        // Katalog dostawców (cennik) — gdy nie ma wierszy w offer_items
        const { data: catalog } = await supabase
          .from('supplier_catalog')
          .select('id, supplier_id, name, price_pln, unit, suppliers(name, icon_color)')
          .limit(3000);
        for (const c of catalog ?? []) {
          if (!c?.name || !namesMatch(productLabel, c.name, 72)) continue;
          const synId = `cat-${c.id}`;
          if (seen.has(synId)) continue;
          // Unikaj duplikatu tego samego dostawcy + zbliżonej nazwy
          const already = rows.some(
            (r) => r.supplier_id === c.supplier_id && namesMatch(r.raw_product_name, c.name, 85),
          );
          if (already) continue;
          seen.add(synId);
          rows.push({
            id: synId,
            supplier_id: c.supplier_id,
            supplier_name: (c as any).suppliers?.name ?? 'Nieznany dostawca',
            supplier_color: (c as any).suppliers?.icon_color ?? Colors.textSecondary,
            raw_product_name: c.name,
            price_net: c.price_pln != null ? Number(c.price_pln) : null,
            unit: (c as any).unit || 'szt',
          });
        }
      }

      const priced = rows.filter((r) => r.price_net != null);
      const unpriced = rows.filter((r) => r.price_net == null);
      priced.sort((a, b) => (a.price_net ?? 0) - (b.price_net ?? 0));
      setOffers([...priced, ...unpriced]);
    } finally {
      setLoading(false);
    }
  }, [productId, productName]);

  const loadProduct = useCallback(async () => {
    if (!productId) return;
    setLoadingEdit(true);
    try {
      const [prodRes, catsRes] = await Promise.all([
        supabase
          .from('inventory_items')
          .select('id, name, category_id, quantity, unit, min_quantity, optimal_quantity, portion_size, safety_buffer_percent, is_combo_polprodukt, unit_weight_volume, weight_volume_unit')
          .eq('id', productId)
          .single(),
        supabase
          .from('inventory_categories')
          .select('id, name, color')
          .order('sort_order'),
      ]);
      // Retry select without optional columns if migrations not applied
      let prodData = prodRes.data;
      if (prodRes.error && /safety_buffer_percent|unit_weight_volume|weight_volume_unit/.test(prodRes.error.message ?? '')) {
        const retry = await supabase
          .from('inventory_items')
          .select('id, name, category_id, quantity, unit, min_quantity, portion_size, is_combo_polprodukt')
          .eq('id', productId)
          .single();
        prodData = retry.data;
      }
      if (prodData) {
        setProduct(prodData as any);
        setForm({
          name: prodData.name ?? '',
          categoryId: prodData.category_id ?? '',
          quantity: prodData.quantity != null ? String(prodData.quantity) : '',
          unit: prodData.unit ?? 'kg',
          minQuantity: prodData.min_quantity != null ? String(prodData.min_quantity) : '',
          optimalQuantity: (prodData as any).optimal_quantity != null ? String((prodData as any).optimal_quantity) : '',
          portionSize: prodData.portion_size != null ? String(prodData.portion_size) : '',
          safetyBuffer: (prodData as any).safety_buffer_percent != null ? String((prodData as any).safety_buffer_percent) : '20',
          unitWeightVolume: (prodData as any).unit_weight_volume != null ? String((prodData as any).unit_weight_volume) : '',
          weightVolumeUnit: ((prodData as any).weight_volume_unit === 'ml' ? 'ml' : 'g'),
        });
      }
      if (catsRes.data) setCategories(catsRes.data as any);
    } finally {
      setLoadingEdit(false);
    }
  }, [productId]);

  useEffect(() => { loadOffers(); loadProduct(); }, [loadOffers, loadProduct]);

  // Auto-refresh yield whenever the screen gains focus (e.g. after a waste/sale
  // report changes stock elsewhere in the app).
  useFocusEffect(
    useCallback(() => {
      loadYield();
    }, [loadYield])
  );

  function openOrder(offer: OfferRow) {
    setOrderSupplierId(offer.supplier_id);
    setOrderSupplierName(offer.supplier_name);
  }

  async function handleSaveEdit() {
    if (!productId) return;
    if (!form.name.trim()) { Alert.alert('Wymagane pole', 'Podaj nazwę produktu.'); return; }
    const qty = parseFloat(form.quantity);
    const minQty = parseFloat(form.minQuantity);
    if (isNaN(qty) || qty < 0) { Alert.alert('Błąd', 'Aktualna ilość musi być liczbą nieujemną.'); return; }
    if (isNaN(minQty) || minQty <= 0) { Alert.alert('Błąd', 'Próg krytyczny musi być liczbą > 0.'); return; }
    let optimalQty: number | null = null;
    if (form.optimalQuantity.trim()) {
      const o = parseFloat(form.optimalQuantity);
      if (isNaN(o) || o < 0) { Alert.alert('Błąd', 'Próg optymalny musi być liczbą ≥ 0.'); return; }
      if (o > 0 && o < minQty) {
        Alert.alert('Błąd', 'Próg optymalny powinien być ≥ progu krytycznego (albo pusty).');
        return;
      }
      optimalQty = o > 0 ? o : null;
    }
    let buffer = parseFloat(form.safetyBuffer);
    if (isNaN(buffer)) buffer = 20;
    if (buffer < 10) buffer = 10;
    if (buffer > 200) buffer = 200;

    setSaving(true);
    try {
      const isPiece = form.unit === 'szt' || form.unit === 'op';
      const uwv = isPiece && form.unitWeightVolume.trim() ? parseFloat(form.unitWeightVolume) : null;
      const payload: any = {
        name: form.name.trim(),
        category_id: form.categoryId || null,
        quantity: qty,
        unit: form.unit,
        min_quantity: minQty,
        optimal_quantity: optimalQty,
        safety_buffer_percent: buffer,
        unit_weight_volume: uwv && !isNaN(uwv) ? uwv : null,
        weight_volume_unit: uwv && !isNaN(uwv) ? form.weightVolumeUnit : null,
      };
      let res = await supabase.from('inventory_items').update(payload).eq('id', productId);
      // Fallback if optional columns not migrated yet
      if (res.error && /optimal_quantity|safety_buffer_percent|unit_weight_volume|weight_volume_unit/.test(res.error.message ?? '')) {
        const { optimal_quantity, safety_buffer_percent, unit_weight_volume, weight_volume_unit, ...fallback } = payload;
        if (/optimal_quantity/.test(res.error.message ?? '') && !/safety_buffer/.test(res.error.message ?? '')) {
          res = await supabase.from('inventory_items').update({
            ...fallback, safety_buffer_percent, unit_weight_volume, weight_volume_unit,
          }).eq('id', productId);
        } else {
          res = await supabase.from('inventory_items').update(fallback).eq('id', productId);
        }
      }
      if (res.error) throw res.error;
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 1800);
      await loadProduct();
      await loadYield();
    } catch (e: any) {
      Alert.alert('Błąd zapisu', e.message ?? 'Nieznany błąd');
    } finally {
      setSaving(false);
    }
  }

  const pricedOffers = offers.filter((o) => o.price_net != null);
  const bestPrice = pricedOffers.length > 0 ? pricedOffers[0].price_net! : null;

  const accent = prem ? DS.color.greenEnd : Colors.accent;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const cardBg = prem ? DS.color.surfaceCard : Colors.card;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const inputBg = prem ? DS.color.bgTertiary : Colors.card;
  const soft = prem ? 'rgba(0,255,120,0.12)' : Colors.accentLight;

  return (
    <SafeAreaView style={[s.safe, prem && { backgroundColor: DS.color.bgPrimary }]} edges={['top']}>
      {/* Header */}
      <View style={[s.header, prem && { backgroundColor: DS.color.bgPrimary, borderBottomColor: border }]}>
        <TouchableOpacity onPress={() => router.back()} style={[s.backBtn, prem && { backgroundColor: inputBg }]} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }} data-testid="product-back">
          <ArrowLeft size={22} color={text} strokeWidth={2} />
        </TouchableOpacity>
        <View style={s.headerText}>
          <Text style={[s.headerTitle, { color: text }]} numberOfLines={1}>{productName ?? 'Produkt'}</Text>
          <Text style={[s.headerSub, { color: muted }]}>
            {tab === 'suppliers'
              ? (loading ? 'Szukam ofert...' : offers.length === 0 ? 'Brak ofert dostawców' : `${offers.length} ${offers.length === 1 ? 'dostawca' : offers.length < 5 ? 'dostawców' : 'dostawców'}`)
              : 'Edytuj dane produktu'}
          </Text>
        </View>
      </View>

      {/* Tabs */}
      <View style={[s.tabsRow, prem && { backgroundColor: DS.color.bgPrimary, borderBottomColor: border }]}>
        <TouchableOpacity
          style={[
            s.tabBtn,
            prem && { backgroundColor: DS.color.bgPrimary, borderColor: border },
            tab === 'suppliers' && (prem ? { backgroundColor: soft, borderColor: accent } : s.tabBtnActive),
          ]}
          onPress={() => setTab('suppliers')}
          activeOpacity={0.85}
          data-testid="product-tab-suppliers"
        >
          <Truck size={14} color={tab === 'suppliers' ? accent : muted} strokeWidth={2} />
          <Text style={[s.tabText, { color: tab === 'suppliers' ? accent : muted }, tab === 'suppliers' && prem && { fontWeight: '800' }]}>Dostawcy</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            s.tabBtn,
            prem && { backgroundColor: DS.color.bgPrimary, borderColor: border },
            tab === 'edit' && (prem ? { backgroundColor: soft, borderColor: accent } : s.tabBtnActive),
          ]}
          onPress={() => setTab('edit')}
          activeOpacity={0.85}
          data-testid="product-tab-edit"
        >
          <Pencil size={14} color={tab === 'edit' ? accent : muted} strokeWidth={2} />
          <Text style={[s.tabText, { color: tab === 'edit' ? accent : muted }, tab === 'edit' && prem && { fontWeight: '800' }]}>Edytuj produkt</Text>
        </TouchableOpacity>
      </View>

      {/* Suppliers tab */}
      {tab === 'suppliers' && (
        <>
          {loading ? (
            <View style={s.center}>
              <ActivityIndicator size="large" color={Colors.accent} />
              <Text style={s.loadingText}>Szukam ofert dostawców...</Text>
            </View>
          ) : offers.length === 0 ? (
            <View style={s.center}>
              <AlertCircle size={48} color={Colors.textTertiary} strokeWidth={1.5} />
              <Text style={s.emptyTitle}>Brak ofert dla tego produktu</Text>
              <Text style={s.emptySub}>
                {'Żaden z Twoich dostawców nie ma tego produktu w swojej ofercie AI. Wgraj cennik PDF w zakładce Dostawcy.'}
              </Text>
            </View>
          ) : (
            <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
              {bestPrice != null && (
                <View style={s.bestBanner}>
                  <TrendingDown size={14} color={Colors.success} strokeWidth={2} />
                  <Text style={s.bestBannerText}>
                    Najlepsza cena: <Text style={s.bestBannerPrice}>{formatPlnNumber(bestPrice)} zł/{pricedOffers[0].unit}</Text>
                  </Text>
                </View>
              )}
              <Text style={s.sectionLabel}>Oferty dostawców — od najtańszej</Text>
              {offers.map((offer, idx) => {
                const isBest = offer.price_net != null && offer.price_net === bestPrice && idx === 0;
                const priceDiff = bestPrice != null && offer.price_net != null && idx > 0
                  ? ((offer.price_net - bestPrice) / bestPrice * 100)
                  : null;
                const iconBg = offer.supplier_color + '18';
                return (
                  <View key={offer.id} style={[s.card, isBest && s.cardBest]}>
                    {isBest && (
                      <View style={s.bestBadge}>
                        <Star size={10} color={Colors.success} strokeWidth={2.5} />
                        <Text style={s.bestBadgeText}>Najlepsza cena</Text>
                      </View>
                    )}
                    <View style={s.cardTop}>
                      <View style={[s.iconWrap, { backgroundColor: iconBg }]}>
                        <Truck size={18} color={offer.supplier_color} strokeWidth={2} />
                      </View>
                      <View style={s.cardInfo}>
                        <Text style={s.supplierName}>{offer.supplier_name}</Text>
                        <View style={s.productRow}>
                          <Package size={11} color={Colors.textTertiary} strokeWidth={2} />
                          <Text style={s.productRowText} numberOfLines={1}>{offer.raw_product_name}</Text>
                        </View>
                      </View>
                      <View style={s.priceWrap}>
                        {offer.price_net != null ? (
                          <>
                            <Text style={[s.price, isBest && s.priceBest]}>{formatPlnNumber(offer.price_net)} zł</Text>
                            <Text style={s.priceUnit}>za {offer.unit}</Text>
                            {priceDiff != null && priceDiff > 0 && (
                              <Text style={s.priceDiff}>+{priceDiff.toFixed(0)}%</Text>
                            )}
                          </>
                        ) : (
                          <Text style={s.noPrice}>Brak ceny</Text>
                        )}
                      </View>
                    </View>
                    <TouchableOpacity style={s.orderBtn} onPress={() => openOrder(offer)} activeOpacity={0.8}>
                      <ShoppingCart size={14} color={Colors.accent} strokeWidth={2} />
                      <Text style={s.orderBtnText}>Złóż zamówienie</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}
              <View style={{ height: 32 }} />
            </ScrollView>
          )}
        </>
      )}

      {/* Edit tab */}
      {tab === 'edit' && (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          {loadingEdit ? (
            <View style={s.center}>
              <ActivityIndicator size="large" color={Colors.accent} />
              <Text style={s.loadingText}>Ładuję dane produktu...</Text>
            </View>
          ) : !product ? (
            <View style={s.center}>
              <AlertCircle size={40} color={Colors.textTertiary} strokeWidth={1.5} />
              <Text style={s.emptyTitle}>Nie znaleziono produktu</Text>
            </View>
          ) : (
              <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[s.formSection, { color: text }]}>Podstawowe dane</Text>

              <View style={s.field}>
                <Text style={[s.label, { color: muted }]}>Nazwa produktu <Text style={s.req}>*</Text></Text>
                <TextInput
                  style={[s.input, prem && { backgroundColor: inputBg, borderColor: border, color: text }]}
                  value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                  placeholder="np. Kurczak filet"
                  placeholderTextColor={muted}
                  data-testid="edit-product-name"
                />
              </View>

              <View style={s.field}>
                <Text style={[s.label, { color: muted }]}>Kategoria</Text>
                {categories.length === 0 ? (
                  <Text style={[s.fieldHint, { color: muted }]}>Brak kategorii w bazie</Text>
                ) : (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.pillRow}>
                    {categories.map((cat) => {
                      const active = form.categoryId === cat.id;
                      return (
                        <TouchableOpacity
                          key={cat.id}
                          style={[
                            s.pill,
                            prem && !active && { backgroundColor: inputBg, borderColor: border },
                            active && { backgroundColor: cat.color, borderColor: cat.color },
                          ]}
                          onPress={() => setForm((f) => ({ ...f, categoryId: cat.id }))}
                          activeOpacity={0.75}
                          data-testid={`edit-product-category-${cat.name}`}
                        >
                          {active && <Check size={11} color={Colors.white} strokeWidth={3} />}
                          <Text
                            style={[
                              s.pillText,
                              prem && !active && { color: muted },
                              active && { color: Colors.white, fontWeight: '700' },
                            ]}
                          >
                            {cat.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                )}
              </View>

              <Text style={[s.formSection, { color: text }]}>Stan magazynowy</Text>

              <View style={s.fieldRow}>
                <View style={[s.field, { flex: 1 }]}>
                  <Text style={[s.label, { color: muted }]}>Aktualna ilość <Text style={s.req}>*</Text></Text>
                  <TextInput
                    style={[s.input, prem && { backgroundColor: inputBg, borderColor: border, color: text }]}
                    value={form.quantity}
                    onChangeText={(v) => setForm((f) => ({ ...f, quantity: v.replace(',', '.') }))}
                    keyboardType="decimal-pad"
                    placeholder="0"
                    placeholderTextColor={muted}
                    data-testid="edit-product-quantity"
                  />
                  <Text style={[s.fieldHint, { color: muted }]}>Stan w magazynie teraz</Text>
                </View>
                <View style={[s.field, { flex: 1 }]}>
                  <Text style={[s.label, { color: muted }]}>Próg krytyczny <Text style={s.req}>*</Text></Text>
                  <TextInput
                    style={[s.input, prem && { backgroundColor: inputBg, borderColor: border, color: text }]}
                    value={form.minQuantity}
                    onChangeText={(v) => setForm((f) => ({ ...f, minQuantity: v.replace(',', '.') }))}
                    keyboardType="decimal-pad"
                    placeholder="np. 2"
                    placeholderTextColor={muted}
                    data-testid="edit-product-min-quantity"
                  />
                  <Text style={[s.fieldHint, { color: muted }]}>Poniżej → zamawiamy</Text>
                </View>
              </View>

              <View style={s.field}>
                <Text style={[s.label, { color: muted }]}>Próg optymalny</Text>
                <TextInput
                  style={[s.input, prem && { backgroundColor: inputBg, borderColor: border, color: text }]}
                  value={form.optimalQuantity}
                  onChangeText={(v) => setForm((f) => ({ ...f, optimalQuantity: v.replace(',', '.') }))}
                  keyboardType="decimal-pad"
                  placeholder="np. 20 (docelowy zapas)"
                  placeholderTextColor={muted}
                  data-testid="edit-product-optimal-quantity"
                />
                <Text style={[s.fieldHint, { color: muted }]}>
                  Docelowy zapas — Łowca Okazji dobija stan do tego progu (±10% jeśli opakowanie tańsze). Puste = krytyczny + bufor.
                </Text>
              </View>

              <View style={s.field}>
                <Text style={[s.label, { color: muted }]}>Jednostka</Text>
                <View style={s.unitRow}>
                  {UNIT_OPTIONS.map((u) => {
                    const active = form.unit === u;
                    return (
                      <TouchableOpacity
                        key={u}
                        style={[
                          s.unitBtn,
                          prem && { backgroundColor: inputBg, borderColor: border },
                          active && (prem
                            ? { backgroundColor: accent, borderColor: accent }
                            : s.unitBtnActive),
                        ]}
                        onPress={() => setForm((f) => ({ ...f, unit: u }))}
                        activeOpacity={0.7}
                        data-testid={`edit-product-unit-${u}`}
                      >
                        <Text
                          style={[
                            s.unitBtnText,
                            prem && { color: muted },
                            active && (prem
                              ? { color: '#0A0A0A', fontWeight: '800' }
                              : s.unitBtnTextActive),
                          ]}
                        >
                          {u}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              {(form.unit === 'szt' || form.unit === 'op') && (
                <View style={s.field}>
                  <Text style={[s.label, { color: muted }]}>
                    Waga/objętość jednej {form.unit === 'op' ? 'op.' : 'szt.'}
                  </Text>
                  <View style={s.wvRow}>
                    <TextInput
                      style={[
                        s.input,
                        { flex: 1 },
                        prem && { backgroundColor: inputBg, borderColor: border, color: text },
                      ]}
                      value={form.unitWeightVolume}
                      onChangeText={(v) => setForm((f) => ({ ...f, unitWeightVolume: v.replace(',', '.') }))}
                      keyboardType="decimal-pad"
                      placeholder="np. 400"
                      placeholderTextColor={muted}
                      testID="edit-product-unit-weight"
                    />
                    <View
                      style={[
                        s.wvToggle,
                        prem && { backgroundColor: DS.color.bgSecondary, borderColor: border },
                      ]}
                    >
                      {(['g', 'ml'] as const).map((u) => {
                        const active = form.weightVolumeUnit === u;
                        return (
                          <TouchableOpacity
                            key={u}
                            style={[
                              s.wvToggleBtn,
                              active && (prem
                                ? { backgroundColor: accent }
                                : s.wvToggleBtnActive),
                            ]}
                            onPress={() => setForm((f) => ({ ...f, weightVolumeUnit: u }))}
                            activeOpacity={0.7}
                            testID={`edit-product-wv-unit-${u}`}
                          >
                            <Text
                              style={[
                                s.wvToggleText,
                                prem && !active && { color: muted },
                                active && (prem
                                  ? { color: '#0A0A0A', fontWeight: '800' }
                                  : s.wvToggleTextActive),
                              ]}
                            >
                              {u}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                  </View>
                  <Text style={[s.fieldHint, { color: muted }]}>
                    Przelicza zapas w {form.unit === 'op' ? 'op.' : 'szt.'} na porcje potraw liczone w {form.weightVolumeUnit} (np. 1 szt. = 400 g).
                  </Text>
                </View>
              )}

              <View style={s.field}>
                <View style={s.yieldHeaderRow}>
                  <UtensilsCrossed size={15} color={accent} strokeWidth={2} />
                  <Text style={[s.yieldTitle, { color: text }]}>Dostępność w menu</Text>
                  <TouchableOpacity
                    onPress={loadYield}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={[s.yieldRefresh, prem && { backgroundColor: inputBg }]}
                    testID="yield-refresh"
                  >
                    <RefreshCw size={13} color={muted} strokeWidth={2} />
                  </TouchableOpacity>
                </View>
                <Text style={[s.yieldHint, { color: muted }]}>
                  Na ile porcji każdej potrawy wystarczy aktualny zapas ({yieldData ? `${yieldData.stock_quantity} ${yieldData.stock_unit}` : '…'}). Wyliczane automatycznie z receptur.
                </Text>

                {loadingYield ? (
                  <View style={s.yieldLoading}>
                    <ActivityIndicator size="small" color={accent} />
                    <Text style={[s.yieldLoadingText, { color: muted }]}>Przeliczam porcje…</Text>
                  </View>
                ) : !yieldData || yieldData.dishes.length === 0 ? (
                  <View
                    style={[
                      s.yieldEmpty,
                      prem && { backgroundColor: inputBg },
                    ]}
                  >
                    <Text style={[s.yieldEmptyText, { color: muted }]}>
                      Ten surowiec nie jest jeszcze użyty w żadnej recepturze z Menu.
                    </Text>
                  </View>
                ) : (
                  <View style={s.yieldList} testID="yield-list">
                    {yieldData.dishes.map((d) => {
                      const critical = d.convertible && d.portions <= 3;
                      return (
                        <View
                          key={d.menu_item_id}
                          style={[
                            s.yieldRow,
                            prem && { backgroundColor: cardBg, borderColor: border },
                          ]}
                          testID={`yield-dish-${d.menu_item_id}`}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={[s.yieldDish, { color: text }]} numberOfLines={1}>{d.dish_name}</Text>
                            <Text style={[s.yieldRecipe, { color: muted }]}>{d.per_portion_qty} {d.unit} / porcję</Text>
                          </View>
                          {d.convertible ? (
                            <View
                              style={[
                                s.yieldBadge,
                                prem && !critical && {
                                  backgroundColor: soft,
                                  borderColor: accent,
                                },
                                critical && s.yieldBadgeCritical,
                              ]}
                            >
                              <Text
                                style={[
                                  s.yieldBadgeNum,
                                  prem && !critical && { color: accent },
                                  critical && s.yieldBadgeNumCritical,
                                ]}
                              >
                                {d.portions}
                              </Text>
                              <Text
                                style={[
                                  s.yieldBadgeLabel,
                                  prem && !critical && { color: accent },
                                  critical && s.yieldBadgeNumCritical,
                                ]}
                              >
                                porcji
                              </Text>
                            </View>
                          ) : (
                            <View style={[s.yieldBadgeNa, prem && { backgroundColor: inputBg }]}>
                              <Text style={[s.yieldBadgeNaText, { color: muted }]}>jedn.{'\n'}niezgodne</Text>
                            </View>
                          )}
                        </View>
                      );
                    })}
                  </View>
                )}
              </View>

              <View style={s.field}>
                <Text style={[s.label, { color: muted }]}>Bufor bezpieczeństwa (%)</Text>
                <TextInput
                  style={[s.input, prem && { backgroundColor: inputBg, borderColor: border, color: text }]}
                  value={form.safetyBuffer}
                  onChangeText={(v) => setForm((f) => ({ ...f, safetyBuffer: v.replace(',', '.') }))}
                  keyboardType="number-pad"
                  placeholder="20"
                  placeholderTextColor={muted}
                  data-testid="edit-product-safety-buffer"
                />
                <View
                  style={[
                    s.bufferInfoBox,
                    prem && {
                      backgroundColor: 'rgba(0,230,118,0.08)',
                      borderLeftColor: accent,
                    },
                  ]}
                >
                  <Text style={[s.bufferInfoText, prem && { color: muted }]}>
                    💡 <Text style={[s.bufferInfoBold, prem && { color: text }]}>Bufor bezpieczeństwa</Text> – Zapas na niezgłoszone straty i ubytki. Ostrzeżenie o braku towaru włączy się o tyle % wcześniej.
                  </Text>
                </View>
              </View>

              {product ? (
                <ProductExpiryEditor
                  inventoryItemId={product.id}
                  productName={form.name || product.name}
                  unit={form.unit || product.unit || 'szt'}
                />
              ) : null}

              <TouchableOpacity
                style={[s.saveBtn, prem && { backgroundColor: accent }, (saving || savedFlash) && { opacity: 0.85 }]}
                onPress={handleSaveEdit}
                disabled={saving}
                activeOpacity={0.85}
                data-testid="edit-product-save"
              >
                {savedFlash ? (
                  <>
                    <Check size={16} color={prem ? '#0A0A0A' : Colors.white} strokeWidth={3} />
                    <Text style={[s.saveBtnText, prem && { color: '#0A0A0A' }]}>Zapisano</Text>
                  </>
                ) : (
                  <>
                    <Save size={16} color={prem ? '#0A0A0A' : Colors.white} strokeWidth={2.5} />
                    <Text style={[s.saveBtnText, prem && { color: '#0A0A0A' }]}>{saving ? 'Zapisywanie...' : 'Zapisz zmiany'}</Text>
                  </>
                )}
              </TouchableOpacity>

              <View style={{ height: 32 }} />
            </ScrollView>
          )}
        </KeyboardAvoidingView>
      )}

      <OrderModal
        supplierId={orderSupplierId ?? ''}
        supplierName={orderSupplierName}
        visible={orderSupplierId != null}
        onClose={() => setOrderSupplierId(null)}
      />
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
    backgroundColor: Colors.card,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: Colors.borderLight,
    alignItems: 'center', justifyContent: 'center',
  },
  headerText: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700', color: Colors.textPrimary },
  headerSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },

  tabsRow: {
    flexDirection: 'row', gap: 8,
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8,
    backgroundColor: Colors.card,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 10, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.background,
  },
  tabBtnActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  tabText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  tabTextActive: { color: Colors.accent, fontWeight: '700' },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  loadingText: { fontSize: 14, color: Colors.textTertiary },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: Colors.textSecondary, textAlign: 'center' },
  emptySub: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center', lineHeight: 19 },

  scroll: { flex: 1 },
  content: { padding: 16 },

  bestBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: Colors.successLight, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14,
    borderWidth: 1, borderColor: '#BBF7D0',
  },
  bestBannerText: { fontSize: 13, color: Colors.success, fontWeight: '500' },
  bestBannerPrice: { fontWeight: '700' },
  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5, marginBottom: 10, textTransform: 'uppercase' },
  card: {
    backgroundColor: Colors.card, borderRadius: 14, marginBottom: 10,
    borderWidth: 1.5, borderColor: Colors.border,
    shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2, overflow: 'hidden',
  },
  cardBest: { borderColor: Colors.success, borderWidth: 2 },
  bestBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.successLight,
    paddingHorizontal: 12, paddingVertical: 5,
    borderBottomWidth: 1, borderBottomColor: '#BBF7D0',
  },
  bestBadgeText: { fontSize: 11, fontWeight: '700', color: Colors.success },
  cardTop: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  iconWrap: { width: 42, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  cardInfo: { flex: 1, gap: 4 },
  supplierName: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  productRowText: { fontSize: 12, color: Colors.textSecondary, flex: 1 },
  priceWrap: { alignItems: 'flex-end', gap: 2, flexShrink: 0 },
  price: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  priceBest: { color: Colors.success },
  priceUnit: { fontSize: 11, color: Colors.textTertiary },
  priceDiff: { fontSize: 11, fontWeight: '700', color: Colors.danger, backgroundColor: Colors.dangerLight, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  noPrice: { fontSize: 12, color: Colors.textTertiary, fontStyle: 'italic' },
  orderBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.accentLight, borderTopWidth: 1, borderTopColor: Colors.border, paddingVertical: 12,
  },
  orderBtnText: { fontSize: 14, fontWeight: '600', color: Colors.accent },

  // Edit tab
  formSection: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5, marginBottom: 12, marginTop: 4, textTransform: 'uppercase' },
  field: { marginBottom: 14 },
  fieldRow: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600', marginBottom: 6 },
  req: { color: Colors.danger },
  input: {
    backgroundColor: Colors.card, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: Platform.OS === 'ios' ? 12 : 10,
    fontSize: 15, color: Colors.textPrimary,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  fieldHint: { fontSize: 11, color: Colors.textTertiary, marginTop: 5 },
  yieldHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  yieldTitle: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  yieldRefresh: { width: 30, height: 30, borderRadius: 8, backgroundColor: Colors.borderLight, alignItems: 'center', justifyContent: 'center' },
  yieldHint: { fontSize: 11, color: Colors.textTertiary, marginTop: 5, marginBottom: 10, lineHeight: 15 },
  yieldLoading: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16, justifyContent: 'center' },
  yieldLoadingText: { fontSize: 13, color: Colors.textTertiary },
  yieldEmpty: { backgroundColor: Colors.borderLight, borderRadius: 10, padding: 14 },
  yieldEmptyText: { fontSize: 12, color: Colors.textSecondary, lineHeight: 17 },
  yieldList: { gap: 8 },
  yieldRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: Colors.card, borderRadius: 12, padding: 12,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  yieldDish: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  yieldRecipe: { fontSize: 11, color: Colors.textTertiary, marginTop: 2 },
  yieldBadge: {
    alignItems: 'center', justifyContent: 'center', minWidth: 58,
    backgroundColor: Colors.accentLight, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  yieldBadgeCritical: { backgroundColor: Colors.dangerLight, borderColor: '#FECACA' },
  yieldBadgeNum: { fontSize: 20, fontWeight: '800', color: Colors.accent, letterSpacing: -0.5 },
  yieldBadgeNumCritical: { color: Colors.danger },
  yieldBadgeLabel: { fontSize: 9, fontWeight: '700', color: Colors.accent, textTransform: 'uppercase', letterSpacing: 0.3 },
  yieldBadgeNa: { minWidth: 58, alignItems: 'center', justifyContent: 'center', backgroundColor: Colors.borderLight, borderRadius: 10, paddingVertical: 6, paddingHorizontal: 8 },
  yieldBadgeNaText: { fontSize: 9, fontWeight: '600', color: Colors.textTertiary, textAlign: 'center' },
  pillRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  pill: {
    flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  pillText: { fontSize: 12, fontWeight: '500', color: Colors.textSecondary },
  unitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  unitBtn: {
    paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card,
    alignItems: 'center', minWidth: 48,
  },
  unitBtnActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  unitBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  unitBtnTextActive: { color: Colors.white },
  wvRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  wvToggle: { flexDirection: 'row', backgroundColor: Colors.borderLight, borderRadius: 10, padding: 3, borderWidth: 1.5, borderColor: Colors.border },
  wvToggleBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8 },
  wvToggleBtnActive: { backgroundColor: Colors.accent },
  wvToggleText: { fontSize: 14, fontWeight: '700', color: Colors.textSecondary },
  wvToggleTextActive: { color: Colors.white },
  bufferInfoBox: {
    marginTop: 6, backgroundColor: Colors.borderLight, borderRadius: 10, padding: 10,
    borderLeftWidth: 3, borderLeftColor: Colors.accent,
  },
  bufferInfoText: { fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
  bufferInfoBold: { fontWeight: '700', color: Colors.textPrimary },

  saveBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: Colors.accent, paddingVertical: 15, borderRadius: 12, marginTop: 8,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 5,
  },
  saveBtnText: { fontSize: 16, fontWeight: '700', color: Colors.white },
});
