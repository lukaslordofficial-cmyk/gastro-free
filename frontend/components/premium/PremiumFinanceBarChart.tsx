import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { PremiumColors } from '@/constants/premiumTheme';
import { ChartYAxis, GreenAreaLineChart } from '@/components/GreenAreaLineChart';
import { compactAxisAmount, formatPLN } from './premiumFinanceHelpers';

const { width: SCREEN_W } = Dimensions.get('window');

export function PremiumFinanceBarChart({
  points,
  onBarPress,
  metricLabel,
}: {
  points: { label: string; value: number; dateKey?: string; weekday?: string }[];
  onBarPress?: (p: { label: string; value: number; dateKey?: string; weekday?: string }) => void;
  metricLabel?: string;
}) {
  const values = points.map((r) => Number(r.value) || 0);

  if (!values.length) {
    return (
      <View style={{ height: 140, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: PremiumColors.textMuted, fontSize: 12 }}>
          Brak danych sprzedaży — dodaj przychody, a wykres się zaktualizuje.
        </Text>
      </View>
    );
  }

  const total = values.reduce((a, b) => a + b, 0);
  const mid = Math.floor(values.length / 2) || 1;
  const firstHalf = values.slice(0, mid);
  const secondHalf = values.slice(mid);
  const first = firstHalf.reduce((a, b) => a + b, 0) / mid;
  const second = secondHalf.reduce((a, b) => a + b, 0) / Math.max(secondHalf.length, 1);
  const trendPct = Math.abs(first) > 1e-6 ? ((second - first) / Math.abs(first)) * 100 : null;
  const lineColor = total < 0 ? '#FF5252' : PremiumColors.neon;

  // Dolna oś SVG = kwoty. Nie używaj weekday.slice(0,3) — dla miesięcy/lat
  // weekday bywało „2026-01” / „2026” i dawało „202” na każdym ticku.
  const chartPts = points.map((p) => {
    const value = Number(p.value) || 0;
    return { label: compactAxisAmount(value), value };
  });

  const slot = Math.max(56, Math.min(72, Math.floor((SCREEN_W - 64) / Math.min(points.length, 7))));
  const chipW = Math.max(56, slot - 6);
  const chipGap = 6;
  // Szerokość musi uwzględniać gap między chipami — inaczej ostatnie dni miesiąca są obcinane (~27 zamiast 28–31).
  const plotW = Math.max(
    SCREEN_W - 88,
    points.length * chipW + Math.max(0, points.length - 1) * chipGap + 8,
  );
  const chartH = 170;

  return (
    <View>
      {/* Stały nagłówek — nie scrolluje się z wykresem */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 8, gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: PremiumColors.textMuted, fontSize: 12, fontWeight: '700', marginBottom: 2 }}>
            {metricLabel ?? 'Sprzedaż'}
          </Text>
          <Text style={{ color: lineColor, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 }}>
            {formatPLN(total)}
          </Text>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          {trendPct != null && Number.isFinite(trendPct) ? (
            <View style={{ backgroundColor: `${lineColor}22`, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 }}>
              <Text style={{ color: lineColor, fontSize: 11, fontWeight: '800' }}>
                {trendPct >= 0 ? '+' : ''}{trendPct.toFixed(1)}%
              </Text>
            </View>
          ) : null}
          <Text style={{ color: PremiumColors.textMuted, fontSize: 11, fontWeight: '600' }}>
            {points.length} pkt
          </Text>
        </View>
      </View>

      {/* Stała oś Y + scroll tylko wykresu i dolnej osi dat */}
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <ChartYAxis points={chartPts} height={chartH} dark />
        <ScrollView horizontal showsHorizontalScrollIndicator decelerationRate="fast" style={{ flex: 1 }}>
          <View style={{ width: plotW }}>
            <GreenAreaLineChart
              points={chartPts}
              color={lineColor}
              height={chartH}
              hideHeader
              hideYAxis
              dark
              width={plotW}
            />
            <View style={{ flexDirection: 'row', gap: chipGap, marginTop: 4, paddingLeft: 4, width: plotW }}>
              {points.map((r, i) => {
                const v = values[i];
                const neg = v < 0;
                return (
                  <TouchableOpacity
                    key={`${r.label}-${i}`}
                    onPress={() => onBarPress?.(r)}
                    activeOpacity={0.8}
                    style={{
                      backgroundColor: neg ? 'rgba(255,82,82,0.12)' : 'rgba(0,230,118,0.12)',
                      borderRadius: 10,
                      paddingHorizontal: 6,
                      paddingVertical: 8,
                      minWidth: chipW,
                      width: chipW,
                      alignItems: 'center',
                      overflow: 'visible',
                    }}
                    testID={`premium-bar-${r.dateKey || i}`}
                  >
                    <Text
                      style={{ color: PremiumColors.textMuted, fontSize: 10, fontWeight: '700' }}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.75}
                    >
                      {r.label}
                    </Text>
                    <Text
                      style={{
                        color: neg ? '#FF5252' : PremiumColors.neon,
                        fontSize: 11,
                        fontWeight: '800',
                        marginTop: 2,
                        width: '100%',
                        textAlign: 'center',
                      }}
                      numberOfLines={1}
                      adjustsFontSizeToFit
                      minimumFontScale={0.65}
                      allowFontScaling={false}
                    >
                      {compactAxisAmount(v)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </ScrollView>
      </View>
      <Text style={{ color: PremiumColors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 8 }}>
        Przesuń wykres · dotknij punkt → raport
      </Text>
    </View>
  );
}
