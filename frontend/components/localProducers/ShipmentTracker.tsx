/**
 * Timeline dostawy LP — status z Furgonetki, bez obiecywania dokładnej godziny.
 */
import React from 'react';
import { View, Text, StyleSheet, Linking, TouchableOpacity } from 'react-native';
import { Colors } from '@/constants/colors';
import type { LpShippingView } from '@/services/localProducers/shippingClient';

const DS_NEON = '#00FF88';

const STEPS = [
  'Przygotowywanie paczki',
  'Kurier zamówiony',
  'Odebrano od dystrybutora',
  'W transporcie',
  'Kurier w drodze do Ciebie',
  'Doręczono',
];

function inpostTrackingUrl(tracking: string): string | null {
  const t = tracking.trim();
  if (!t) return null;
  return `https://inpost.pl/sledzenie-przesylek?number=${encodeURIComponent(t)}`;
}

type Props = {
  shipping: LpShippingView | null;
  fallbackTracking?: string | null;
  isPremium?: boolean;
};

export function ShipmentTracker({ shipping, fallbackTracking, isPremium }: Props) {
  const titleColor = isPremium ? '#F5F5F5' : Colors.textPrimary;
  const muted = isPremium ? 'rgba(255,255,255,0.55)' : Colors.textSecondary;
  const cardBg = isPremium ? 'rgba(255,255,255,0.06)' : Colors.card;
  const border = isPremium ? 'rgba(255,255,255,0.10)' : Colors.border;
  const accent = isPremium ? DS_NEON : Colors.accent;

  const idx = Math.max(0, Math.min(5, Number(shipping?.timeline_index ?? 0)));
  const tracking = (shipping?.tracking || fallbackTracking || '').trim();
  const pickup = (shipping?.pickup_label || '').trim();
  const err = (shipping?.shipping_error || '').trim();
  const courier = (shipping?.courier_name || 'InPost').toString();

  return (
    <View style={[styles.box, { backgroundColor: cardBg, borderColor: border }]}>
      <Text style={[styles.title, { color: titleColor }]}>Dostawa</Text>
      <Text style={[styles.meta, { color: muted }]}>
        Przewoźnik: {courier.toUpperCase() === 'INPOST' ? 'InPost Kurier' : courier}
      </Text>
      {tracking ? (
        <Text style={[styles.track, { color: accent }]}>Numer przesyłki: {tracking}</Text>
      ) : (
        <Text style={[styles.meta, { color: muted }]}>Numer przesyłki pojawi się po zleceniu kuriera.</Text>
      )}
      {pickup ? (
        <Text style={[styles.meta, { color: titleColor }]}>
          Odbiór u dystrybutora: {pickup}
        </Text>
      ) : null}
      {err ? (
        <Text style={styles.err}>{err}</Text>
      ) : null}

      <View style={styles.steps}>
        {STEPS.map((label, i) => {
          const done = i <= idx;
          return (
            <View key={label} style={styles.stepRow}>
              <View
                style={[
                  styles.dot,
                  { backgroundColor: done ? accent : border, borderColor: done ? accent : border },
                ]}
              />
              <Text style={[styles.stepText, { color: done ? titleColor : muted, fontWeight: done ? '700' : '500' }]}>
                {label}
              </Text>
            </View>
          );
        })}
      </View>

      {tracking ? (
        <TouchableOpacity
          onPress={() => {
            const url = inpostTrackingUrl(tracking);
            if (url) void Linking.openURL(url);
          }}
          style={[styles.btn, { borderColor: accent }]}
        >
          <Text style={[styles.btnText, { color: accent }]}>Śledź przesyłkę</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 8,
    marginTop: 4,
  },
  title: { fontSize: 15, fontWeight: '800' },
  meta: { fontSize: 13, lineHeight: 18 },
  track: { fontSize: 13, fontWeight: '700' },
  err: { fontSize: 12, color: '#DC2626', lineHeight: 17 },
  steps: { marginTop: 8, gap: 8 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, borderWidth: 1 },
  stepText: { fontSize: 13 },
  btn: {
    marginTop: 6,
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  btnText: { fontSize: 13, fontWeight: '800' },
});
