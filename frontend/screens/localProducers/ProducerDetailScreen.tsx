/**
 * Szczegóły producenta: adres, km, produkty, koszyk, Zamów i zapłać (Stripe + InPost).
 */
import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  MapPin,
  Package,
  ShoppingCart,
  CreditCard,
  X,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { useProducerDetail } from '@/hooks/localProducers/useProducerDetail';
import { formatPlnNumber } from '@/lib/format';
import { formatDistanceKm, estimateEtaMinutes } from '@/lib/localProducers/haversine';
import {
  formatProducerAddress,
  formatShippingDays,
} from '@/lib/localProducers/formatProducer';
import {
  PLATFORM_FEE_RATE,
} from '@/types/localProducers';
import { quoteCourier } from '@/lib/localProducers/courierQuote';
import {
  openProducerOrderCheckout,
} from '@/services/localProducers/checkoutClient';
import { StripeOpeningOverlay, CourierQuotePicker } from '@/components/localProducers';
import type { SelectedCourierQuote } from '@/components/localProducers/CourierQuotePicker';

const NEON = '#00FF88';

export function ProducerDetailScreen() {
  const theme = useAppTheme();
  const { alert: premiumAlert } = usePremiumAlert();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const producerId = typeof id === 'string' ? id : Array.isArray(id) ? id[0] : undefined;
  const {
    producer,
    products,
    cart,
    cartTotal,
    cartCount,
    distanceKm,
    loading,
    ordering,
    error,
    addToCart,
    setQty,
    placeOrder,
    categories,
  } = useProducerDetail(producerId);

  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState('Przygotowywanie płatności…');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [shipName, setShipName] = useState('');
  const [shipPhone, setShipPhone] = useState('');
  const [shipStreet, setShipStreet] = useState('');
  const [shipBuilding, setShipBuilding] = useState('');
  const [shipCity, setShipCity] = useState('');
  const [shipPost, setShipPost] = useState('');
  const [courierPick, setCourierPick] = useState<SelectedCourierQuote | null>(null);

  const isPremium = !!theme.isPremium;
  const bg = isPremium ? '#0A0A0A' : Colors.background;
  const titleColor = isPremium ? '#F5F5F5' : Colors.textPrimary;
  const muted = isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary;
  const cardBg = isPremium ? 'rgba(255,255,255,0.06)' : Colors.card;
  const border = isPremium ? 'rgba(255,255,255,0.10)' : Colors.border;
  const accent = isPremium ? NEON : Colors.accent;
  const inputBg = isPremium ? 'rgba(255,255,255,0.08)' : Colors.background;

  const eta = estimateEtaMinutes(distanceKm);
  const address = producer ? formatProducerAddress(producer) : '';

  const feeBreakdown = useMemo(() => {
    const fee = Math.round(cartTotal * PLATFORM_FEE_RATE * 100) / 100;
    const freeFrom = producer?.free_delivery_from != null
      ? Number(producer.free_delivery_from)
      : null;
    const quote = quoteCourier(cart.map((l) => ({
      quantity: l.quantity,
      unit: l.product.unit,
      weight_g: l.product.weight_g,
    })));
    const delivery = freeFrom != null && cartTotal >= freeFrom
      ? 0
      : (courierPick?.priceGross ?? quote.pricePln);
    const total = Math.round((cartTotal + fee + delivery) * 100) / 100;
    return { fee, delivery, total, weightKg: courierPick?.weightKg ?? quote.weightKg, courierName: courierPick?.name };
  }, [cart, cartTotal, producer?.free_delivery_from, courierPick]);

  const productsByCategory = useMemo(() => {
    const catName = (id: string | null) =>
      categories.find((c) => c.id === id)?.name || 'Inne';
    const groups: { key: string; title: string; items: typeof products }[] = [];
    const seen = new Map<string, number>();
    for (const p of products) {
      const title = catName(p.category_id);
      const key = p.category_id || '_inne';
      const idx = seen.get(key);
      if (idx == null) {
        seen.set(key, groups.length);
        groups.push({ key, title, items: [p] });
      } else {
        groups[idx].items.push(p);
      }
    }
    groups.sort((a, b) => {
      const sa = categories.find((c) => c.id === a.key)?.sort_order ?? 999;
      const sb = categories.find((c) => c.id === b.key)?.sort_order ?? 999;
      return sa - sb || a.title.localeCompare(b.title, 'pl');
    });
    return groups;
  }, [products, categories]);

  const openCheckoutSheet = () => {
    if (!cart.length) {
      premiumAlert('Koszyk pusty', 'Dodaj produkty, zanim złożysz zamówienie.', [
        { text: 'OK', style: 'primary' },
      ]);
      return;
    }
    if (producer && !producer.courier_available) {
      premiumAlert('Brak kuriera', 'Ten producent nie oferuje dostawy kurierskiej.', [
        { text: 'OK', style: 'primary' },
      ]);
      return;
    }
    setCheckoutOpen(true);
  };

  const payAndOrder = () => {
    const phone = shipPhone.trim();
    const street = shipStreet.trim();
    const city = shipCity.trim();
    const post = shipPost.trim();
    if (!phone || !street || !city || !post) {
      premiumAlert(
        'Adres dostawy',
        'Uzupełnij telefon, ulicę, miasto i kod pocztowy — kurier musi wiedzieć, dokąd jechać.',
        [{ text: 'OK', style: 'primary' }],
      );
      return;
    }
    setCheckoutOpen(false);
    void (async () => {
      setBusy(true);
      setBusyMsg('Składanie zamówienia…');
      try {
        const order = await placeOrder({
          name: shipName.trim() || 'Restauracja',
          phone,
          street,
          building_number: shipBuilding.trim() || '1',
          city,
          post_code: post,
        }, courierPick ? {
          serviceId: courierPick.serviceId,
          service: courierPick.service,
          name: courierPick.name,
          priceGross: courierPick.priceGross,
          widthCm: courierPick.widthCm,
          heightCm: courierPick.heightCm,
          depthCm: courierPick.depthCm,
          weightKg: courierPick.weightKg,
        } : null);
        setBusyMsg('Otwieranie Stripe…');
        const pay = await openProducerOrderCheckout(order.id, {
          onOpening: () => setBusyMsg('Otwieranie Stripe…'),
        });
        if (!pay.ok) {
          premiumAlert(
            'Zamówienie zapisane',
            `${pay.message}\n\nID: ${order.id.slice(0, 8)}…\nSprawdź STRIPE_SECRET_KEY na Railway albo spróbuj ponownie.`,
            [{ text: 'OK', style: 'primary' }],
          );
          return;
        }
        // Po Stripe: LpPaymentReturnHost → „Opłacono” (bez pośredniego alertu).
        router.back();
      } catch (e) {
        premiumAlert(
          'Błąd zamówienia',
          e instanceof Error ? e.message : 'Nie udało się złożyć zamówienia',
          [{ text: 'OK', style: 'primary' }],
        );
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: bg }]} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.backBtn}
          hitSlop={12}
        >
          <ArrowLeft size={22} color={titleColor} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: titleColor }]} numberOfLines={1}>
          {producer?.company_name || 'Producent'}
        </Text>
        <View style={styles.cartBadge}>
          <ShoppingCart size={18} color={accent} />
          {cartCount > 0 ? (
            <View style={[styles.badge, { backgroundColor: accent }]}>
              <Text style={styles.badgeText}>{cartCount}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={accent} />
        </View>
      ) : error || !producer ? (
        <View style={styles.center}>
          <Text style={[styles.error, { color: Colors.danger }]}>
            {error || 'Nie znaleziono producenta'}
          </Text>
        </View>
      ) : (
        <>
          <ScrollView contentContainerStyle={styles.scroll}>
            {(producer.banner_url || producer.logo_url) ? (
              <Image
                source={{ uri: producer.banner_url || producer.logo_url || undefined }}
                style={styles.banner}
                resizeMode="cover"
              />
            ) : null}

            <View style={[styles.card, { backgroundColor: cardBg, borderColor: border }]}>
              <Text style={[styles.name, { color: titleColor }]}>{producer.company_name}</Text>
              {producer.owner_name ? (
                <Text style={{ color: muted, fontSize: 13 }}>{producer.owner_name}</Text>
              ) : null}

              <View style={styles.row}>
                <MapPin size={16} color={accent} />
                <Text style={[styles.address, { color: muted }]}>{address}</Text>
              </View>

              <View style={styles.metaRow}>
                <Text style={[styles.pill, { color: titleColor, borderColor: border }]}>
                  {formatDistanceKm(distanceKm)}
                </Text>
                {eta != null ? (
                  <Text style={[styles.pill, { color: titleColor, borderColor: border }]}>
                    ~{eta} min
                  </Text>
                ) : null}
                <Text style={[styles.pill, { color: titleColor, borderColor: border }]}>
                  Min. {formatPlnNumber(Number(producer.min_order_value) || 0)} zł
                </Text>
              </View>

              <Text style={[styles.sectionLabel, { color: muted }]}>Wysyłka</Text>
              <Text style={{ color: titleColor, fontSize: 13 }}>
                {formatShippingDays(producer.shipping_days)}
              </Text>
              {producer.next_ship_note ? (
                <Text style={{ color: muted, fontSize: 12, marginTop: 4 }}>
                  {producer.next_ship_note}
                </Text>
              ) : null}
              <Text style={{ color: muted, fontSize: 12, marginTop: 6 }}>
                {producer.pickup_available ? 'Odbiór osobisty · ' : ''}
                {producer.courier_available ? 'Kurier dostępny' : 'Bez kuriera'}
                {producer.free_delivery_from != null
                  ? ` · Darmowa dostawa od ${formatPlnNumber(Number(producer.free_delivery_from))} zł`
                  : ''}
              </Text>

              {producer.description ? (
                <Text style={[styles.desc, { color: muted }]}>{producer.description}</Text>
              ) : null}
            </View>

            <Text style={[styles.productsTitle, { color: titleColor }]}>
              Produkty ({products.length})
            </Text>

            {products.length === 0 ? (
              <Text style={{ color: muted, paddingHorizontal: 4 }}>
                Brak dostępnych produktów (available = true).
              </Text>
            ) : (
              productsByCategory.map((group) => (
                <View key={group.key}>
                  <Text style={[styles.catTitle, { color: accent }]}>{group.title}</Text>
                  {group.items.map((p) => {
                    const line = cart.find((c) => c.product.id === p.id);
                    return (
                      <View
                        key={p.id}
                        style={[styles.productCard, { backgroundColor: cardBg, borderColor: border }]}
                      >
                        {p.image_url ? (
                          <Image source={{ uri: p.image_url }} style={styles.productImg} />
                        ) : (
                          <View style={[styles.productImg, styles.productImgPlaceholder]}>
                            <Package size={22} color={muted} />
                          </View>
                        )}
                        <View style={styles.productBody}>
                          <Text style={[styles.productTitle, { color: titleColor }]} numberOfLines={2}>
                            {p.title}
                          </Text>
                          <Text style={{ color: muted, fontSize: 12 }}>
                            {formatPlnNumber(Number(p.price))} zł / {p.unit}
                            {p.stock != null ? ` · stan ${p.stock}` : ''}
                          </Text>
                          {line ? (
                            <View style={styles.qtyRow}>
                              <TouchableOpacity
                                onPress={() => setQty(p.id, line.quantity - 1)}
                                style={[styles.qtyBtn, { borderColor: border }]}
                              >
                                <Text style={{ color: titleColor, fontWeight: '700' }}>−</Text>
                              </TouchableOpacity>
                              <Text style={{ color: titleColor, fontWeight: '700', minWidth: 24, textAlign: 'center' }}>
                                {line.quantity}
                              </Text>
                              <TouchableOpacity
                                onPress={() => setQty(p.id, line.quantity + 1)}
                                style={[styles.qtyBtn, { borderColor: border }]}
                              >
                                <Text style={{ color: titleColor, fontWeight: '700' }}>+</Text>
                              </TouchableOpacity>
                            </View>
                          ) : (
                            <TouchableOpacity
                              onPress={() => addToCart(p, 1)}
                              style={[styles.addBtn, { backgroundColor: accent }]}
                            >
                              <Text style={styles.addBtnText}>Do koszyka</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              ))
            )}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: border, backgroundColor: bg }]}>
            <Text style={{ color: muted, fontSize: 12, marginBottom: 4 }}>
              Koszyk: {formatPlnNumber(cartTotal)} zł
              {cartCount ? ` · ${cartCount} szt.` : ''}
              {cartCount ? ` · razem ok. ${formatPlnNumber(feeBreakdown.total)} zł` : ''}
            </Text>
            <Text style={{ color: muted, fontSize: 11, marginBottom: 8 }}>
              Produkty + kurier + opłata serwisu 5%
            </Text>
            <TouchableOpacity
              style={[
                styles.cta,
                {
                  backgroundColor: accent,
                  opacity: producer.courier_available ? 1 : 0.45,
                },
              ]}
              disabled={busy || ordering || !producer.courier_available}
              onPress={openCheckoutSheet}
            >
              <CreditCard size={18} color={isPremium ? '#0A0A0A' : '#fff'} />
              <Text style={[styles.ctaText, { color: isPremium ? '#0A0A0A' : '#fff' }]}>
                Zamów i zapłać
              </Text>
            </TouchableOpacity>
            {!producer.courier_available ? (
              <Text style={{ color: Colors.danger, fontSize: 11, marginTop: 6 }}>
                Producent nie obsługuje kuriera — zamówienie niedostępne.
              </Text>
            ) : null}
          </View>

          <Modal
            visible={checkoutOpen}
            transparent
            animationType="slide"
            onRequestClose={() => setCheckoutOpen(false)}
          >
            <KeyboardAvoidingView
              style={styles.modalOverlay}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <View style={[styles.sheet, { backgroundColor: isPremium ? '#141414' : Colors.card, borderColor: border }]}>
                <View style={styles.sheetHeader}>
                  <Text style={[styles.sheetTitle, { color: titleColor }]}>Zamów i zapłać</Text>
                  <TouchableOpacity onPress={() => setCheckoutOpen(false)} hitSlop={12}>
                    <X size={20} color={muted} />
                  </TouchableOpacity>
                </View>
                <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                  <Text style={{ color: muted, fontSize: 13, lineHeight: 19, marginBottom: 12 }}>
                    {`Produkty: ${formatPlnNumber(cartTotal)} zł\n`}
                    {`Kurier${feeBreakdown.courierName ? ` (${feeBreakdown.courierName})` : ''} (~${feeBreakdown.weightKg} kg): ${formatPlnNumber(feeBreakdown.delivery)} zł\n`}
                    {`Opłata serwisu (5%): ${formatPlnNumber(feeBreakdown.fee)} zł\n`}
                    {`Razem: ${formatPlnNumber(feeBreakdown.total)} zł`}
                  </Text>
                  <Text style={{ color: muted, fontSize: 12, marginBottom: 8 }}>
                    Adres dostawy do restauracji (kurier odbierze u producenta)
                  </Text>
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: muted, fontSize: 11, marginBottom: 4 }}>Nazwa / restauracja</Text>
                    <TextInput value={shipName} onChangeText={setShipName} placeholder="np. Moja Restauracja" placeholderTextColor={muted} style={[styles.input, { color: titleColor, borderColor: border, backgroundColor: inputBg }]} />
                  </View>
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: muted, fontSize: 11, marginBottom: 4 }}>Telefon</Text>
                    <TextInput value={shipPhone} onChangeText={setShipPhone} placeholder="500600700" placeholderTextColor={muted} keyboardType="phone-pad" style={[styles.input, { color: titleColor, borderColor: border, backgroundColor: inputBg }]} />
                  </View>
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: muted, fontSize: 11, marginBottom: 4 }}>Ulica</Text>
                    <TextInput value={shipStreet} onChangeText={setShipStreet} placeholder="ul. Przykładowa" placeholderTextColor={muted} style={[styles.input, { color: titleColor, borderColor: border, backgroundColor: inputBg }]} />
                  </View>
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: muted, fontSize: 11, marginBottom: 4 }}>Nr budynku</Text>
                    <TextInput value={shipBuilding} onChangeText={setShipBuilding} placeholder="12" placeholderTextColor={muted} style={[styles.input, { color: titleColor, borderColor: border, backgroundColor: inputBg }]} />
                  </View>
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: muted, fontSize: 11, marginBottom: 4 }}>Miasto</Text>
                    <TextInput value={shipCity} onChangeText={setShipCity} placeholder="Warszawa" placeholderTextColor={muted} style={[styles.input, { color: titleColor, borderColor: border, backgroundColor: inputBg }]} />
                  </View>
                  <View style={{ marginBottom: 8 }}>
                    <Text style={{ color: muted, fontSize: 11, marginBottom: 4 }}>Kod pocztowy</Text>
                    <TextInput value={shipPost} onChangeText={setShipPost} placeholder="00-001" placeholderTextColor={muted} style={[styles.input, { color: titleColor, borderColor: border, backgroundColor: inputBg }]} />
                  </View>
                  {producer ? (
                    <CourierQuotePicker
                      producerId={producer.id}
                      items={cart.map((l) => ({
                        quantity: l.quantity,
                        unit: l.product.unit,
                        weight_g: l.product.weight_g,
                        product_id: l.product.id,
                      }))}
                      receiverName={shipName}
                      receiverPhone={shipPhone}
                      street={shipStreet}
                      buildingNumber={shipBuilding}
                      city={shipCity}
                      postCode={shipPost}
                      colors={{
                        textPrimary: titleColor,
                        textSecondary: muted,
                        border,
                        accent,
                        background: inputBg,
                      }}
                      selected={courierPick}
                      onSelect={setCourierPick}
                    />
                  ) : null}
                  <TouchableOpacity
                    style={[styles.cta, { backgroundColor: accent, marginTop: 8, marginBottom: 8 }]}
                    disabled={busy || ordering}
                    onPress={payAndOrder}
                  >
                    <CreditCard size={18} color={isPremium ? '#0A0A0A' : '#fff'} />
                    <Text style={[styles.ctaText, { color: isPremium ? '#0A0A0A' : '#fff' }]}>
                      Przejdź do Stripe
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </Modal>
        </>
      )}
      <StripeOpeningOverlay visible={busy} message={busyMsg} />
    </SafeAreaView>
  );
}

export default ProducerDetailScreen;

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  backBtn: { padding: 4 },
  headerTitle: { flex: 1, fontSize: 17, fontWeight: '700' },
  cartBadge: { width: 36, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute',
    top: -4,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  badgeText: { color: '#0A0A0A', fontSize: 10, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  error: { textAlign: 'center', fontSize: 14 },
  scroll: { padding: 16, paddingBottom: 24, gap: 12 },
  banner: { width: '100%', height: 140, borderRadius: 14, backgroundColor: '#222' },
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 14,
    gap: 6,
  },
  name: { fontSize: 20, fontWeight: '800' },
  row: { flexDirection: 'row', gap: 8, marginTop: 6, alignItems: 'flex-start' },
  address: { flex: 1, fontSize: 13, lineHeight: 18 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  pill: {
    fontSize: 11,
    fontWeight: '700',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  sectionLabel: { marginTop: 10, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  desc: { marginTop: 8, fontSize: 13, lineHeight: 18 },
  productsTitle: { fontSize: 16, fontWeight: '800', marginTop: 4 },
  catTitle: {
    fontSize: 13,
    fontWeight: '800',
    marginTop: 14,
    marginBottom: 6,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  productCard: {
    flexDirection: 'row',
    gap: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    padding: 10,
  },
  productImg: { width: 72, height: 72, borderRadius: 10, backgroundColor: '#1a1a1a' },
  productImgPlaceholder: { alignItems: 'center', justifyContent: 'center' },
  productBody: { flex: 1, gap: 4, justifyContent: 'center' },
  productTitle: { fontSize: 14, fontWeight: '700' },
  addBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
  },
  addBtnText: { color: '#0A0A0A', fontWeight: '800', fontSize: 12 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
  qtyBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
  },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  ctaText: { fontSize: 14, fontWeight: '800' },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 28,
    maxHeight: '92%',
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
});
