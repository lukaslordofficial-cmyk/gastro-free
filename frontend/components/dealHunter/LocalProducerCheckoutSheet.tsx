/**
 * Sheet „Zamów i zapłać” (Stripe) dla koszyka lokalnego przetwórcy z Łowcy Okazji.
 * Ten sam flow co ręcznie w Lokalni Przetwórcy — bez e-mail/SMS.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { CreditCard, X } from 'lucide-react-native';
import type { SupplierGroup } from '@/lib/bargainHunter';
import { formatPln } from '@/lib/format';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { createProducerOrder } from '@/services/localProducers/localProducersService';
import {
  openProducerOrderCheckout,
} from '@/services/localProducers/checkoutClient';
import { StripeOpeningOverlay, CourierQuotePicker } from '@/components/localProducers';
import type { SelectedCourierQuote } from '@/components/localProducers/CourierQuotePicker';
import {
  PLATFORM_FEE_RATE,
} from '@/types/localProducers';
import { quoteCourier } from '@/lib/localProducers/courierQuote';
import { useRestaurantShippingForm } from '@/hooks/localProducers/useRestaurantShippingForm';

type Palette = {
  card: string;
  textPrimary: string;
  textSecondary: string;
  border: string;
  accent: string;
  background: string;
  isPremium?: boolean;
};

type Props = {
  visible: boolean;
  group: SupplierGroup | null;
  colors: Palette;
  onClose: () => void;
};

export function LocalProducerCheckoutSheet({ visible, group, colors, onClose }: Props) {
  const { alert: premiumAlert } = usePremiumAlert();
  const [busy, setBusy] = useState(false);
  const [busyMsg, setBusyMsg] = useState('Przygotowywanie płatności…');
  const {
    shipName,
    setShipName,
    shipPhone,
    setShipPhone,
    shipStreet,
    setShipStreet,
    shipBuilding,
    setShipBuilding,
    shipCity,
    setShipCity,
    shipPost,
    setShipPost,
    hydrate,
    toDelivery,
    missingMessage,
  } = useRestaurantShippingForm();
  const [courierPick, setCourierPick] = useState<SelectedCourierQuote | null>(null);

  useEffect(() => {
    if (visible) void hydrate();
  }, [visible, hydrate]);

  const producerAmount = useMemo(
    () => Math.round((group?.subtotal_pln ?? 0) * 100) / 100,
    [group?.subtotal_pln],
  );
  const platformFee = Math.round(producerAmount * PLATFORM_FEE_RATE * 100) / 100;
  const courierQuote = useMemo(
    () => quoteCourier((group?.items ?? []).map((it) => ({
      quantity: Number(it.quantity) || 0,
      unit: it.unit,
    }))),
    [group?.items],
  );
  const delivery = courierPick?.priceGross ?? courierQuote.pricePln;
  const total = Math.round((producerAmount + delivery + platformFee) * 100) / 100;

  const pay = () => {
    if (!group?.supplier_id) return;
    const missing = missingMessage();
    if (missing) {
      premiumAlert('Adres dostawy', missing, [{ text: 'OK', style: 'primary' }]);
      return;
    }
    const delivery = toDelivery();

    const items = (group.items ?? [])
      .map((it) => {
        const productId = String(it.catalog_product_id || '').trim();
        if (!productId) return null;
        return {
          productId,
          quantity: Number(it.quantity) || 0,
          unitPrice: Number(it.unit_price_base) || 0,
          unit: it.unit,
        };
      })
      .filter((x): x is { productId: string; quantity: number; unitPrice: number; unit: string } => !!x);

    if (!items.length) {
      premiumAlert(
        'Brak produktów marketplace',
        'W koszyku brak ID produktów lokalnego dystrybutora. Spróbuj ponownie porównać oferty albo zamów z zakładki Lokalni Przetwórcy.',
        [{ text: 'OK', style: 'primary' }],
      );
      return;
    }
    if (items.some((i) => i.quantity <= 0 || i.unitPrice <= 0)) {
      premiumAlert('Koszyk', 'Sprawdź ilości i ceny pozycji.', [{ text: 'OK', style: 'primary' }]);
      return;
    }

    void (async () => {
      setBusy(true);
      setBusyMsg('Składanie zamówienia…');
      try {
        const order = await createProducerOrder({
          producerId: group.supplier_id!,
          items,
          delivery,
          notes: 'Zamów i zapłać · Łowca Okazji',
          courier: courierPick ? {
            serviceId: courierPick.serviceId,
            service: courierPick.service,
            name: courierPick.name,
            priceGross: courierPick.priceGross,
            widthCm: courierPick.widthCm,
            heightCm: courierPick.heightCm,
            depthCm: courierPick.depthCm,
            weightKg: courierPick.weightKg,
          } : null,
        });
        setBusyMsg('Otwieranie Stripe…');
        const payRes = await openProducerOrderCheckout(order.id, {
          onOpening: () => setBusyMsg('Otwieranie Stripe…'),
        });
        onClose();
        if (!payRes.ok) {
          premiumAlert(
            'Zamówienie zapisane',
            `${payRes.message}\n\nID: ${order.id.slice(0, 8)}…`,
            [{ text: 'OK', style: 'primary' }],
          );
        }
        // Po Stripe: LpPaymentReturnHost pokaże „Opłacono” (deep link / powrót do apki).
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

  const ctaFg = colors.isPremium ? '#0A0A0A' : '#fff';
  const inputBg = colors.isPremium ? '#0A0A0A' : colors.background;

  return (
    <>
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.header}>
            <Text style={[styles.title, { color: colors.textPrimary }]} numberOfLines={2}>
              Zamów i zapłać
            </Text>
            <TouchableOpacity onPress={onClose} hitSlop={12} disabled={busy}>
              <X size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <Text style={[styles.hint, { color: colors.textSecondary }]}>
              {(group?.supplier_name || 'Lokalny dystrybutor').trim()}
            </Text>
            <Text style={[styles.breakdown, { color: colors.textSecondary }]}>
              {`Produkty: ${formatPln(producerAmount)}\n`}
              {`Kurier${courierPick?.name ? ` (${courierPick.name})` : ''}: ${formatPln(delivery)}\n`}
              {`Opłata serwisu (5%): ${formatPln(platformFee)}\n`}
              {`Razem: ${formatPln(total)}`}
            </Text>
            <Text style={[styles.label, { color: colors.textSecondary }]}>
              Adres restauracji, na który kurier dowiezie paczkę. Przy pierwszym zamówieniu uzupełnij dane — zapiszemy je i podstawimy przy kolejnych przesyłkach.
            </Text>
            {(
              [
                ['Nazwa', shipName, setShipName, 'Moja Restauracja'],
                ['Telefon', shipPhone, setShipPhone, '500600700'],
                ['Ulica', shipStreet, setShipStreet, 'ul. Przykładowa'],
                ['Nr budynku', shipBuilding, setShipBuilding, '12'],
                ['Miasto', shipCity, setShipCity, 'Warszawa'],
                ['Kod pocztowy', shipPost, setShipPost, '00-001'],
              ] as const
            ).map(([label, value, setter, ph]) => (
              <View key={label} style={styles.field}>
                <Text style={[styles.fieldLabel, { color: colors.textSecondary }]}>{label}</Text>
                <TextInput
                  value={value}
                  onChangeText={setter}
                  placeholder={ph}
                  placeholderTextColor={colors.textSecondary}
                  keyboardType={label === 'Telefon' ? 'phone-pad' : 'default'}
                  style={[
                    styles.input,
                    {
                      color: colors.textPrimary,
                      borderColor: colors.border,
                      backgroundColor: inputBg,
                    },
                  ]}
                />
              </View>
            ))}
            {group?.supplier_id ? (
              <CourierQuotePicker
                producerId={group.supplier_id}
                items={(group.items ?? []).map((it) => ({
                  quantity: Number(it.quantity) || 0,
                  unit: it.unit,
                  product_id: String(it.catalog_product_id || ''),
                }))}
                receiverName={shipName}
                receiverPhone={shipPhone}
                street={shipStreet}
                buildingNumber={shipBuilding}
                city={shipCity}
                postCode={shipPost}
                colors={{
                  textPrimary: colors.textPrimary,
                  textSecondary: colors.textSecondary,
                  border: colors.border,
                  accent: colors.accent,
                  background: inputBg,
                }}
                selected={courierPick}
                onSelect={setCourierPick}
              />
            ) : null}
            <TouchableOpacity
              style={[styles.cta, { backgroundColor: colors.accent, opacity: busy ? 0.6 : 1 }]}
              disabled={busy}
              onPress={pay}
              testID="deal-hunter-lp-stripe-pay"
            >
              {busy ? (
                <ActivityIndicator color={ctaFg} />
              ) : (
                <>
                  <CreditCard size={18} color={ctaFg} />
                  <Text style={[styles.ctaText, { color: ctaFg }]}>Przejdź do Stripe</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
    <StripeOpeningOverlay visible={busy} message={busyMsg} />
    </>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    maxHeight: '92%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 28,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  title: { fontSize: 17, fontWeight: '800', flex: 1, paddingRight: 8 },
  hint: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  breakdown: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  label: { fontSize: 12, marginBottom: 8 },
  field: { marginBottom: 8 },
  fieldLabel: { fontSize: 11, marginBottom: 4 },
  input: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  cta: {
    marginTop: 10,
    marginBottom: 12,
    borderRadius: 12,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  ctaText: { fontSize: 15, fontWeight: '800' },
});
