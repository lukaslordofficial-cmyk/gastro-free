/**
 * Szczegóły producenta: adres, km, produkty, koszyk, CTA zamówienia / kurier.
 */
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  MapPin,
  Package,
  ShoppingCart,
  Truck,
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
  COURIER_DELIVERY_STUB_PLN,
  PLATFORM_FEE_RATE,
} from '@/types/localProducers';
import {
  confirmProducerOrderPayment,
  openProducerOrderCheckout,
} from '@/services/localProducers/checkoutClient';

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
  } = useProducerDetail(producerId);

  const [busy, setBusy] = useState(false);
  const isPremium = !!theme.isPremium;
  const bg = isPremium ? '#0A0A0A' : Colors.background;
  const titleColor = isPremium ? '#F5F5F5' : Colors.textPrimary;
  const muted = isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary;
  const cardBg = isPremium ? 'rgba(255,255,255,0.06)' : Colors.card;
  const border = isPremium ? 'rgba(255,255,255,0.10)' : Colors.border;
  const accent = isPremium ? NEON : Colors.accent;

  const eta = estimateEtaMinutes(distanceKm);
  const address = producer ? formatProducerAddress(producer) : '';

  const confirmOrder = (withCourier: boolean) => {
    if (!cart.length) {
      premiumAlert('Koszyk pusty', 'Dodaj produkty, zanim złożysz zamówienie.', [
        { text: 'OK', style: 'primary' },
      ]);
      return;
    }
    if (withCourier && producer && !producer.courier_available) {
      premiumAlert('Brak kuriera', 'Ten producent nie oferuje dostawy kurierskiej.', [
        { text: 'OK', style: 'primary' },
      ]);
      return;
    }
    const fee = Math.round(cartTotal * PLATFORM_FEE_RATE * 100) / 100;
    let delivery = 0;
    if (withCourier) {
      const freeFrom = producer?.free_delivery_from != null
        ? Number(producer.free_delivery_from)
        : null;
      delivery = freeFrom != null && cartTotal >= freeFrom ? 0 : COURIER_DELIVERY_STUB_PLN;
    }
    const total = cartTotal + fee + delivery;
    premiumAlert(
      withCourier ? 'Zamów kuriera' : 'Złóż zamówienie',
      [
        `Produkty: ${formatPlnNumber(cartTotal)} zł`,
        `Opłata platformy: ${formatPlnNumber(fee)} zł`,
        withCourier ? `Dostawa: ${formatPlnNumber(delivery)} zł` : 'Dostawa: do uzgodnienia / odbiór',
        `Razem: ${formatPlnNumber(total)} zł`,
        '',
        'Po potwierdzeniu otworzy się Stripe Checkout (BLIK lub karta).',
        withCourier
          ? 'Po opłaceniu backend utworzy przesyłkę InPost (lub stub, jeśli brak tokenu).'
          : '',
      ]
        .filter(Boolean)
        .join('\n'),
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Zapłać',
          style: 'primary',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                const order = await placeOrder(withCourier);
                const pay = await openProducerOrderCheckout(order.id);
                if (!pay.ok) {
                  premiumAlert(
                    'Zamówienie zapisane',
                    `${pay.message}\n\nID: ${order.id.slice(0, 8)}…\nSprawdź STRIPE_SECRET_KEY na Railway albo spróbuj ponownie.`,
                    [{ text: 'OK', style: 'primary' }],
                  );
                  return;
                }
                premiumAlert(
                  'Stripe Checkout',
                  'Opłać zamówienie BLIK-iem lub kartą. Po powrocie do apki potwierdź płatność.',
                  [
                    {
                      text: 'Potwierdź płatność',
                      style: 'primary',
                      onPress: () => {
                        void (async () => {
                          const conf = await confirmProducerOrderPayment(pay.session_id);
                          premiumAlert(
                            conf.paid ? 'Opłacono' : 'Status płatności',
                            conf.message,
                            [{ text: 'OK', style: 'primary', onPress: () => router.back() }],
                          );
                        })();
                      },
                    },
                    { text: 'Później', style: 'cancel', onPress: () => router.back() },
                  ],
                );
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
          },
        },
      ],
    );
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
              products.map((p) => {
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
              })
            )}
          </ScrollView>

          <View style={[styles.footer, { borderTopColor: border, backgroundColor: bg }]}>
            <Text style={{ color: muted, fontSize: 12, marginBottom: 8 }}>
              Koszyk: {formatPlnNumber(cartTotal)} zł
              {cartCount ? ` · ${cartCount} szt.` : ''}
            </Text>
            <View style={styles.ctaRow}>
              <TouchableOpacity
                style={[styles.cta, { backgroundColor: accent }]}
                disabled={busy || ordering}
                onPress={() => confirmOrder(false)}
              >
                <ShoppingCart size={18} color={isPremium ? '#0A0A0A' : '#fff'} />
                <Text style={[styles.ctaText, { color: isPremium ? '#0A0A0A' : '#fff' }]}>
                  Złóż zamówienie
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.cta,
                  styles.ctaOutline,
                  {
                    borderColor: producer.courier_available ? accent : border,
                    opacity: producer.courier_available ? 1 : 0.45,
                  },
                ]}
                disabled={busy || ordering || !producer.courier_available}
                onPress={() => confirmOrder(true)}
              >
                <Truck size={18} color={accent} />
                <Text style={[styles.ctaText, { color: accent }]}>Zamów kuriera</Text>
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}
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
  ctaRow: { flexDirection: 'row', gap: 8 },
  cta: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 12,
  },
  ctaOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
  },
  ctaText: { fontSize: 12, fontWeight: '800' },
});
