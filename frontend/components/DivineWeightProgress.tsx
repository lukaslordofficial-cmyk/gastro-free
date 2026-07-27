/**
 * Progress chart for „Boska Waga w Ręku”: error ↓, points ↑, cultivation path.
 * Uses existing GreenAreaLineChart (react-native-svg) — no heavy chart deps.
 */
import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { DS } from '@/constants/premiumTheme';
import { GreenAreaLineChart } from '@/components/GreenAreaLineChart';
import { CULTIVATION_RANKS, rankById } from '@/lib/divineWeightGame';
import type { DivineWeightAttemptRow, DivineWeightStats } from '@/lib/divineWeightPersist';

type Props = {
  stats: DivineWeightStats;
  attempts: DivineWeightAttemptRow[];
};

export function DivineWeightProgress({ stats, attempts }: Props) {
  const errorPoints = useMemo(
    () =>
      attempts.map((a, i) => ({
        label: String(i + 1),
        value: Number(a.abs_error_g) || 0,
      })),
    [attempts],
  );

  const pointsCurve = useMemo(() => {
    let cum = 0;
    return attempts.map((a, i) => {
      cum += Number(a.points) || 0;
      return { label: String(i + 1), value: cum };
    });
  }, [attempts]);

  const current = rankById(stats.current_rank);
  const best = rankById(stats.best_rank);

  return (
    <ScrollView style={styles.wrap} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.heading}>Ścieżka kultywacji</Text>
      <Text style={styles.sub}>
        Aktualna ranga: {current.namePl}
        {'\n'}Najwyższa: {best.namePl}
        {' · '}Qi: {stats.total_points} pkt
        {' · '}seria: {stats.current_streak}
      </Text>

      <View style={styles.path}>
        {CULTIVATION_RANKS.map((r) => {
          const reached = stats.best_rank >= r.id;
          const active = stats.current_rank === r.id;
          return (
            <View
              key={r.id}
              style={[
                styles.rankRow,
                reached && styles.rankReached,
                active && styles.rankActive,
              ]}
            >
              <Text style={[styles.rankId, active && { color: DS.color.greenEnd }]}>
                {r.id}
              </Text>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rankName, active && { color: DS.color.heading }]}>
                  {r.namePl}
                </Text>
                <Text style={styles.rankDesc} numberOfLines={2}>
                  {r.descriptionPl}
                </Text>
              </View>
            </View>
          );
        })}
      </View>

      {errorPoints.length >= 2 ? (
        <>
          <Text style={styles.chartTitle}>Krzywa błędu (g)</Text>
          <GreenAreaLineChart
            points={errorPoints}
            color="#FF6B6B"
            height={140}
            dark
            title="Rozbieżność"
            formatY={(n) => `${Math.round(n)}g`}
          />
          <Text style={styles.chartTitle}>Narastające Qi (pkt)</Text>
          <GreenAreaLineChart
            points={pointsCurve}
            color={DS.color.greenEnd}
            height={140}
            dark
            title="Punkty"
            formatY={(n) => String(Math.round(n))}
          />
        </>
      ) : (
        <Text style={styles.empty}>
          Po co najmniej dwóch próbach pojawią się wykresy błędu i punktów.
        </Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  content: { paddingBottom: 32, gap: 10 },
  heading: {
    color: DS.color.heading,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: -0.3,
  },
  sub: {
    color: DS.color.muted,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 4,
  },
  path: { gap: 8, marginBottom: 8 },
  rankRow: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    backgroundColor: DS.color.bgTertiary,
    opacity: 0.55,
  },
  rankReached: { opacity: 0.9 },
  rankActive: {
    opacity: 1,
    borderColor: DS.color.greenEnd,
    backgroundColor: 'rgba(0,255,120,0.08)',
  },
  rankId: {
    width: 22,
    color: DS.color.muted,
    fontWeight: '800',
    fontSize: 16,
  },
  rankName: {
    color: DS.color.body,
    fontSize: 13,
    fontWeight: '700',
  },
  rankDesc: {
    color: DS.color.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  chartTitle: {
    color: DS.color.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  empty: {
    color: DS.color.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
  },
});
