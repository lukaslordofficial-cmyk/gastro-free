import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { formatPln } from '@/lib/format';
import {
  fetchCourierQuotes,
  type CourierQuoteItem,
  type FurgonetkaQuote,
} from '@/lib/localProducers/furgonetkaQuotes';

type Colors = {
  textPrimary: string;
  textSecondary: string;
  border: string;
  accent: string;
  background: string;
};

export type SelectedCourierQuote = {
  serviceId: number | string;
  service: string;
  name: string;
  priceGross: number;
  widthCm: number;
  heightCm: number;
  depthCm: number;
  weightKg: number;
  source?: string;
};

type Props = {
  producerId: string;
  items: CourierQuoteItem[];
  receiverName?: string;
  receiverPhone: string;
  street: string;
  buildingNumber?: string;
  city: string;
  postCode: string;
  colors: Colors;
  selected: SelectedCourierQuote | null;
  onSelect: (q: SelectedCourierQuote) => void;
};

function postOk(raw: string) {
  return raw.replace(/\D/g, '').length === 5;
}

export function CourierQuotePicker({
  producerId,
  items,
  receiverName,
  receiverPhone,
  street,
  buildingNumber,
  city,
  postCode,
  colors,
  selected,
  onSelect,
}: Props) {
  const [width, setWidth] = useState('30');
  const [height, setHeight] = useState('20');
  const [depth, setDepth] = useState('40');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<FurgonetkaQuote[]>([]);
  const [weightKg, setWeightKg] = useState(0);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const itemsKey = JSON.stringify(
    items.map((i) => [i.product_id || '', i.quantity, i.unit || '', i.weight_g || 0]),
  );

  const ready = useMemo(
    () => Boolean(producerId && street.trim() && city.trim() && postOk(postCode)),
    [producerId, street, city, postCode],
  );

  useEffect(() => {
    if (!ready) {
      setQuotes([]);
      return;
    }
    const t = setTimeout(() => {
      void (async () => {
        setBusy(true);
        setError(null);
        try {
          const w = Number(width) || undefined;
          const h = Number(height) || undefined;
          const d = Number(depth) || undefined;
          const res = await fetchCourierQuotes({
            producerId,
            items,
            receiverName,
            receiverPhone,
            street,
            buildingNumber,
            city,
            postCode,
            widthCm: w,
            heightCm: h,
            depthCm: d,
          });
          if (!res.ok) {
            setError(res.message || 'Nie udało się pobrać stawek Furgonetka.');
            setQuotes([]);
            return;
          }
          setQuotes(res.quotes);
          setWeightKg(res.weight_kg);
          setNote(res.note || '');
          const pick = res.cheapest || res.quotes.find((q) => q.available && q.price_gross);
          const current = selectedRef.current;
          const keep = current
            ? res.quotes.find((q) => String(q.service_id) === String(current.serviceId) && q.available && q.price_gross)
            : null;
          const chosen = keep || pick;
          if (chosen?.price_gross) {
            onSelect({
              serviceId: chosen.service_id,
              service: chosen.service,
              name: chosen.name,
              priceGross: chosen.price_gross,
              widthCm: Number(width) || res.width_cm,
              heightCm: Number(height) || res.height_cm,
              depthCm: Number(depth) || res.depth_cm,
              weightKg: res.weight_kg,
              source: res.source,
            });
          }
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Błąd wyceny kuriera.');
        } finally {
          setBusy(false);
        }
      })();
    }, 450);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, producerId, street, buildingNumber, city, postCode, width, height, depth, itemsKey]);

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>
        Kalkulator Furgonetka
      </Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        Waga i wymiary paczki (cm) — porównanie stawek wszystkich kurierów.
        {weightKg > 0 ? ` Szacowana waga: ${weightKg.toFixed(2)} kg.` : ''}
      </Text>
      <View style={styles.dims}>
        {(
          [
            ['Szer.', width, setWidth],
            ['Wys.', height, setHeight],
            ['Gł.', depth, setDepth],
          ] as const
        ).map(([label, value, setter]) => (
          <View key={label} style={styles.dimField}>
            <Text style={[styles.dimLabel, { color: colors.textSecondary }]}>{label}</Text>
            <TextInput
              value={value}
              onChangeText={setter}
              keyboardType="number-pad"
              style={[
                styles.dimInput,
                {
                  color: colors.textPrimary,
                  borderColor: colors.border,
                  backgroundColor: colors.background,
                },
              ]}
            />
          </View>
        ))}
      </View>
      {!ready ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Uzupełnij ulicę, miasto i kod pocztowy, żeby zobaczyć stawki.
        </Text>
      ) : null}
      {busy ? <ActivityIndicator color={colors.accent} style={{ marginVertical: 8 }} /> : null}
      {error ? (
        <Text style={[styles.hint, { color: '#FF6B6B' }]}>{error}</Text>
      ) : null}
      {note ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>{note}</Text>
      ) : null}
      {quotes.map((q) => {
        const active = selected?.serviceId === q.service_id;
        const disabled = !q.available || !q.price_gross;
        return (
          <TouchableOpacity
            key={String(q.service_id)}
            disabled={disabled}
            onPress={() => {
              if (!q.price_gross) return;
              onSelect({
                serviceId: q.service_id,
                service: q.service,
                name: q.name,
                priceGross: q.price_gross,
                widthCm: Number(width) || 30,
                heightCm: Number(height) || 20,
                depthCm: Number(depth) || 40,
                weightKg,
                source: q.source,
              });
            }}
            style={[
              styles.row,
              {
                borderColor: active ? colors.accent : colors.border,
                opacity: disabled ? 0.45 : 1,
              },
            ]}
          >
            <Text style={[styles.rowName, { color: colors.textPrimary }]}>
              {String(q.name || q.service || 'Kurier')}
            </Text>
            <Text style={[styles.rowPrice, { color: colors.accent }]}>
              {disabled ? String(q.error || 'niedostępny') : formatPln(q.price_gross || 0)}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 8, marginBottom: 12, gap: 6 },
  title: { fontSize: 13, fontWeight: '800' },
  hint: { fontSize: 11, lineHeight: 16 },
  dims: { flexDirection: 'row', gap: 8, marginTop: 4 },
  dimField: { flex: 1 },
  dimLabel: { fontSize: 10, marginBottom: 4 },
  dimInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 14,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  rowName: { fontSize: 13, fontWeight: '700' },
  rowPrice: { fontSize: 13, fontWeight: '800' },
});
