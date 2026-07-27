/**
 * Visual S/M/L size picker for produce → kg conversion (dark premium).
 */
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { DS } from '@/constants/premiumTheme';
import type { ProduceConverter, ProduceSizeKey, ProduceSizeTier } from '@/lib/produceSizeConverter';
import { formatKg, piecesToKg } from '@/lib/produceSizeConverter';

type Props = {
  converter: ProduceConverter;
  pieceCount: number;
  selectedSize: ProduceSizeKey | null;
  onSelectSize: (size: ProduceSizeKey, tier: ProduceSizeTier, kg: number) => void;
};

export function ProduceSizePicker({
  converter,
  pieceCount,
  selectedSize,
  onSelectSize,
}: Props) {
  const pcs = Number.isFinite(pieceCount) && pieceCount > 0 ? pieceCount : 0;

  return (
    <View style={styles.wrap} testID="produce-size-picker">
      <Text style={styles.title}>Rozmiar → kg ({converter.namePl})</Text>
      <Text style={styles.sub}>
        Wybierz wizualny rozmiar — system przeliczy sztuki na kilogramy dla magazynu.
      </Text>
      <View style={styles.row}>
        {converter.sizes.map((tier) => {
          const active = selectedSize === tier.key;
          const { kg, grams } = piecesToKg(pcs || 1, tier);
          return (
            <TouchableOpacity
              key={tier.key}
              style={[styles.card, active && styles.cardActive]}
              onPress={() => onSelectSize(tier.key, tier, piecesToKg(pcs || 0, tier).kg)}
              activeOpacity={0.85}
              testID={`produce-size-${tier.key}`}
            >
              <Text style={[styles.sizeKey, active && styles.sizeKeyActive]}>{tier.key}</Text>
              <Text style={styles.label}>{tier.labelPl}</Text>
              <Text style={styles.meta}>~{tier.avgWeightG} g · {tier.pcsPerKgLabel}/kg</Text>
              <Text style={styles.visual}>{tier.visualPl}</Text>
              {pcs > 0 ? (
                <Text style={[styles.result, active && styles.resultActive]}>
                  {pcs} szt. → {formatKg(kg)}
                  {kg < 1 ? '' : ` (${Math.round(grams)} g)`}
                </Text>
              ) : (
                <Text style={styles.resultMuted}>Podaj liczbę sztuk</Text>
              )}
            </TouchableOpacity>
          );
        })}
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
  result: {
    marginTop: 6,
    color: DS.color.body,
    fontSize: 12,
    fontWeight: '700',
  },
  resultActive: { color: DS.color.greenEnd },
  resultMuted: { marginTop: 6, color: DS.color.muted, fontSize: 11 },
});
