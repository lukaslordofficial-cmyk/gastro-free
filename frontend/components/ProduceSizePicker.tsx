/**
 * Visual S/M/L size picker — liczniki per rozmiar (np. 2 małe + 2 średnie + 2 duże).
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DS } from '@/constants/premiumTheme';
import type {
  ProduceConverter,
  ProduceSizeCounts,
  ProduceSizeKey,
} from '@/lib/produceSizeConverter';
import { formatKg, mixedPiecesToKg } from '@/lib/produceSizeConverter';

type Props = {
  converter: ProduceConverter;
  counts: ProduceSizeCounts;
  onChangeCounts: (counts: ProduceSizeCounts) => void;
};

export function ProduceSizePicker({ converter, counts, onChangeCounts }: Props) {
  const total = mixedPiecesToKg(counts, converter);

  function bump(key: ProduceSizeKey, delta: number) {
    const cur = Math.max(0, Math.floor(Number(counts[key]) || 0));
    const next = Math.max(0, cur + delta);
    onChangeCounts({ ...counts, [key]: next });
  }

  return (
    <View style={styles.wrap} testID="produce-size-picker">
      <Text style={styles.title}>Rozmiar „na oko” → kg ({converter.namePl})</Text>
      <Text style={styles.sub}>
        Ustaw ile sztuk każdego rozmiaru (np. 2 małe, 2 średnie, 2 duże). Magazyn dostanie
        przybliżoną wagę w kg.
      </Text>
      <View style={styles.row}>
        {converter.sizes.map((tier) => {
          const n = Math.max(0, Math.floor(Number(counts[tier.key]) || 0));
          const active = n > 0;
          const tierGrams = n * tier.avgWeightG;
          return (
            <View
              key={tier.key}
              style={[styles.card, active && styles.cardActive]}
              testID={`produce-size-${tier.key}`}
            >
              <Text style={[styles.sizeKey, active && styles.sizeKeyActive]}>{tier.key}</Text>
              <Text style={styles.label}>{tier.labelPl}</Text>
              <Text style={styles.meta}>~{tier.avgWeightG} g · {tier.pcsPerKgLabel}/kg</Text>
              <Text style={styles.visual}>{tier.visualPl}</Text>
              <View style={styles.stepper}>
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => bump(tier.key, -1)}
                  disabled={n <= 0}
                  testID={`produce-size-${tier.key}-minus`}
                >
                  <Text style={styles.stepBtnText}>−</Text>
                </TouchableOpacity>
                <Text style={styles.stepCount} testID={`produce-size-${tier.key}-count`}>
                  {n}
                </Text>
                <TouchableOpacity
                  style={styles.stepBtn}
                  onPress={() => bump(tier.key, 1)}
                  testID={`produce-size-${tier.key}-plus`}
                >
                  <Text style={styles.stepBtnText}>+</Text>
                </TouchableOpacity>
              </View>
              {n > 0 ? (
                <Text style={[styles.result, styles.resultActive]}>
                  {n} szt. ≈ {tierGrams >= 1000 ? formatKg(tierGrams / 1000) : `${Math.round(tierGrams)} g`}
                </Text>
              ) : (
                <Text style={styles.resultMuted}>0 szt.</Text>
              )}
            </View>
          );
        })}
      </View>
      <View style={styles.totalBox} testID="produce-size-total">
        <Text style={styles.totalLabel}>Razem w liczniku strat</Text>
        <Text style={styles.totalValue}>
          {total.pieces} szt. · ≈ {formatKg(total.kg)}
          {total.kg < 1 && total.pieces > 0 ? ` (${Math.round(total.grams)} g)` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginTop: 14,
    padding: 14,
    borderRadius: DS.radius.card,
    backgroundColor: DS.color.surfaceCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
    gap: 10,
  },
  title: {
    color: DS.color.heading,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  sub: {
    color: DS.color.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  row: { gap: 8 },
  card: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: DS.color.borderHover,
    backgroundColor: DS.color.bgTertiary,
    padding: 12,
    gap: 3,
  },
  cardActive: {
    borderColor: DS.color.greenEnd,
    backgroundColor: 'rgba(0,255,120,0.08)',
  },
  sizeKey: {
    color: DS.color.muted,
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 1,
  },
  sizeKeyActive: { color: DS.color.greenEnd },
  label: { color: DS.color.heading, fontSize: 13, fontWeight: '700' },
  meta: { color: DS.color.body, fontSize: 11, fontWeight: '500' },
  visual: { color: DS.color.muted, fontSize: 11, fontStyle: 'italic', marginTop: 2 },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 8,
  },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: DS.color.bgPrimary,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: { color: DS.color.heading, fontSize: 20, fontWeight: '700', lineHeight: 22 },
  stepCount: {
    minWidth: 28,
    textAlign: 'center',
    color: DS.color.heading,
    fontSize: 18,
    fontWeight: '800',
  },
  result: {
    marginTop: 6,
    color: DS.color.body,
    fontSize: 12,
    fontWeight: '700',
  },
  resultActive: { color: DS.color.greenEnd },
  resultMuted: { marginTop: 6, color: DS.color.muted, fontSize: 11 },
  totalBox: {
    marginTop: 4,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DS.color.borderSubtle,
    gap: 2,
  },
  totalLabel: { color: DS.color.muted, fontSize: 11, fontWeight: '600' },
  totalValue: { color: DS.color.greenEnd, fontSize: 15, fontWeight: '800' },
});
