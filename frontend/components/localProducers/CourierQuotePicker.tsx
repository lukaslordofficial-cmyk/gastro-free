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

function bookableQuote(q: FurgonetkaQuote): boolean {
  return Boolean(q.available && q.price_gross && !q.error);
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
  const [width, setWidth] = useState('');
  const [height, setHeight] = useState('');
  const [depth, setDepth] = useState('');
  const [dimsDirty, setDimsDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [quotes, setQuotes] = useState<FurgonetkaQuote[]>([]);
  const [weightKg, setWeightKg] = useState(0);
  const [parcelCount, setParcelCount] = useState(1);
  const [suggested, setSuggested] = useState<{ w: number; h: number; d: number } | null>(null);

  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const dimsDirtyRef = useRef(dimsDirty);
  dimsDirtyRef.current = dimsDirty;
  const itemsKey = JSON.stringify(
    items.map((i) => [i.product_id || '', i.quantity, i.unit || '', i.weight_g || 0]),
  );

  const ready = useMemo(
    () => Boolean(producerId && street.trim() && city.trim() && postOk(postCode)),
    [producerId, street, city, postCode],
  );

  const dimsKey = dimsDirty ? `${width}x${height}x${depth}` : 'auto';

  useEffect(() => {
    dimsDirtyRef.current = false;
    setDimsDirty(false);
  }, [itemsKey]);

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
          const useCustom = dimsDirtyRef.current;
          const w = Number(width);
          const h = Number(height);
          const d = Number(depth);
          const res = await fetchCourierQuotes({
            producerId,
            items,
            receiverName,
            receiverPhone,
            street,
            buildingNumber,
            city,
            postCode,
            ...(useCustom && w > 0 && h > 0 && d > 0
              ? { widthCm: w, heightCm: h, depthCm: d }
              : {}),
          });
          if (!res.ok) {
            setError(res.message || 'Nie udało się pobrać stawek Furgonetka.');
            setQuotes([]);
            return;
          }
          const visible = (res.quotes || []).filter(bookableQuote);
          setQuotes(visible);
          setWeightKg(res.weight_kg);
          setParcelCount(res.parcels || 1);
          setNote(res.note || '');
          if (res.width_cm && res.height_cm && res.depth_cm) {
            setSuggested({ w: res.width_cm, h: res.height_cm, d: res.depth_cm });
            if (!dimsDirtyRef.current) {
              setWidth(String(res.width_cm));
              setHeight(String(res.height_cm));
              setDepth(String(res.depth_cm));
            }
          }
          const pick = res.cheapest && bookableQuote(res.cheapest)
            ? res.cheapest
            : visible[0];
          const current = selectedRef.current;
          const keep = current
            ? visible.find((q) => String(q.service_id) === String(current.serviceId))
            : null;
          const chosen = keep || pick;
          if (chosen?.price_gross) {
            const dw = dimsDirtyRef.current ? Number(width) : res.width_cm;
            const dh = dimsDirtyRef.current ? Number(height) : res.height_cm;
            const dd = dimsDirtyRef.current ? Number(depth) : res.depth_cm;
            onSelect({
              serviceId: chosen.service_id,
              service: chosen.service,
              name: chosen.name,
              priceGross: chosen.price_gross,
              widthCm: dw || res.width_cm,
              heightCm: dh || res.height_cm,
              depthCm: dd || res.depth_cm,
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
  }, [ready, producerId, street, buildingNumber, city, postCode, itemsKey, dimsKey]);

  const setDim = (which: 'w' | 'h' | 'd') => (text: string) => {
    setDimsDirty(true);
    if (which === 'w') setWidth(text);
    else if (which === 'h') setHeight(text);
    else setDepth(text);
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.title, { color: colors.textPrimary }]}>
        Kalkulator Furgonetka
      </Text>
      <Text style={[styles.hint, { color: colors.textSecondary }]}>
        Waga i wymiary paczki (cm) dobierane z zawartości koszyka — kurierzy bez dostawy
        w Polsce są ukryci.
        {weightKg > 0
          ? ` Szacowana waga: ${weightKg.toFixed(2)} kg${parcelCount > 1 ? ` · ${parcelCount} paczki` : ''}.`
          : ''}
      </Text>
      {suggested ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Sugerowany rozmiar: {suggested.w}×{suggested.h}×{suggested.d} cm
          {dimsDirty ? ' (edytujesz ręcznie)' : ''}
        </Text>
      ) : null}
      <View style={styles.dims}>
        {(
          [
            ['Szer.', width, setDim('w')],
            ['Wys.', height, setDim('h')],
            ['Gł.', depth, setDim('d')],
          ] as const
        ).map(([label, value, setter]) => (
          <View key={label} style={styles.dimField}>
            <Text style={[styles.dimLabel, { color: colors.textSecondary }]}>{label}</Text>
            <TextInput
              value={value}
              onChangeText={setter}
              keyboardType="number-pad"
              placeholder="auto"
              placeholderTextColor={colors.textSecondary}
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
      {!busy && ready && quotes.length === 0 && !error ? (
        <Text style={[styles.hint, { color: colors.textSecondary }]}>
          Brak kurierów dostępnych dla tej wagi i trasy Polska → Polska.
        </Text>
      ) : null}
      {quotes.map((q) => {
        const active = selected?.serviceId === q.service_id;
        return (
          <TouchableOpacity
            key={String(q.service_id)}
            onPress={() => {
              if (!q.price_gross) return;
              onSelect({
                serviceId: q.service_id,
                service: q.service,
                name: q.name,
                priceGross: q.price_gross,
                widthCm: Number(width) || suggested?.w || 30,
                heightCm: Number(height) || suggested?.h || 20,
                depthCm: Number(depth) || suggested?.d || 40,
                weightKg,
                source: q.source,
              });
            }}
            style={[
              styles.row,
              {
                borderColor: active ? colors.accent : colors.border,
              },
            ]}
          >
            <Text style={[styles.rowName, { color: colors.textPrimary }]}>
              {String(q.name || q.service || 'Kurier')}
            </Text>
            <Text style={[styles.rowPrice, { color: colors.accent }]}>
              {formatPln(q.price_gross || 0)}
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
