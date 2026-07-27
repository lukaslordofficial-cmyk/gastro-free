/**
 * Minigra „Boska Waga w Ręku” — szacunek → waga → Kompas Rozbieżności.
 * Dark premium, Polish xianxia copy.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Line, G } from 'react-native-svg';
import { X, Scale, Sparkles } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';
import {
  compassDeflection,
  evaluateAttempt,
  type AttemptResult,
} from '@/lib/divineWeightGame';
import {
  fetchDivineWeightAttempts,
  fetchDivineWeightStats,
  persistDivineWeightAttempt,
  type DivineWeightAttemptRow,
  type DivineWeightStats,
} from '@/lib/divineWeightPersist';
import { DivineWeightProgress } from '@/components/DivineWeightProgress';

type Stage = 'estimate' | 'actual' | 'result' | 'progress';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Optional product name for attempt log */
  itemName?: string | null;
  /** Suggested grams (e.g. from size converter) */
  suggestedGrams?: number | null;
};

function PerceptionCompass({ absErrorG }: { absErrorG: number }) {
  const defl = compassDeflection(absErrorG);
  // Needle rotates ± up to ~75° from north based on error; wobble via slight offset
  const angleDeg = defl * 75 * (absErrorG % 2 === 0 ? 1 : -1);
  const rad = (angleDeg * Math.PI) / 180;
  const cx = 70;
  const cy = 70;
  const len = 48;
  const x2 = cx + Math.sin(rad) * len;
  const y2 = cy - Math.cos(rad) * len;

  return (
    <View style={styles.compassWrap}>
      <Svg width={140} height={140}>
        <Circle cx={cx} cy={cy} r={62} stroke="rgba(255,255,255,0.08)" strokeWidth={2} fill="#111" />
        <Circle cx={cx} cy={cy} r={54} stroke="rgba(0,255,120,0.18)" strokeWidth={1} fill="transparent" />
        {/* North mark */}
        <Line x1={cx} y1={14} x2={cx} y2={24} stroke={DS.color.greenEnd} strokeWidth={2} />
        <G>
          <Line
            x1={cx}
            y1={cy}
            x2={x2}
            y2={y2}
            stroke={defl > 0.55 ? DS.color.danger : DS.color.greenEnd}
            strokeWidth={3}
            strokeLinecap="round"
          />
          <Circle cx={cx} cy={cy} r={5} fill={DS.color.heading} />
        </G>
      </Svg>
      <Text style={styles.compassLabel}>Kompas Rozbieżności</Text>
    </View>
  );
}

export function DivineWeightGameModal({
  visible,
  onClose,
  itemName,
  suggestedGrams,
}: Props) {
  const [stage, setStage] = useState<Stage>('estimate');
  const [estimateStr, setEstimateStr] = useState('');
  const [actualStr, setActualStr] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [stats, setStats] = useState<DivineWeightStats | null>(null);
  const [attempts, setAttempts] = useState<DivineWeightAttemptRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return;
    setStage('estimate');
    setEstimateStr(
      suggestedGrams && suggestedGrams > 0 ? String(Math.round(suggestedGrams)) : '',
    );
    setActualStr('');
    setResult(null);
    setError(null);
    void (async () => {
      const [s, a] = await Promise.all([
        fetchDivineWeightStats(),
        fetchDivineWeightAttempts(50),
      ]);
      setStats(s);
      setAttempts(a);
    })();
  }, [visible, suggestedGrams]);

  const estimateG = useMemo(() => {
    const n = parseFloat(estimateStr.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }, [estimateStr]);

  const actualG = useMemo(() => {
    const n = parseFloat(actualStr.replace(',', '.'));
    return Number.isFinite(n) ? n : NaN;
  }, [actualStr]);

  function goToActual() {
    setError(null);
    if (!Number.isFinite(estimateG) || estimateG <= 0) {
      setError('Podaj szacowaną wagę w gramach (np. 450).');
      return;
    }
    setStage('actual');
  }

  async function submitActual() {
    setError(null);
    if (!Number.isFinite(actualG) || actualG <= 0) {
      setError('Podaj rzeczywistą wagę z wagi (np. 540).');
      return;
    }
    const prev = stats ?? {
      account_key: '',
      total_attempts: 0,
      total_points: 0,
      current_streak: 0,
      current_rank: 1 as const,
      best_rank: 1 as const,
      last_abs_error_g: null,
    };
    const evaluated = evaluateAttempt({
      estimateG,
      actualG,
      previousAbsErrorG: prev.last_abs_error_g,
      previousStreak: prev.current_streak,
      rankHeldId: prev.current_rank,
    });
    setSaving(true);
    try {
      const { stats: next } = await persistDivineWeightAttempt({
        result: evaluated,
        itemName,
        previousStats: prev,
      });
      setResult(evaluated);
      setStats(next);
      const refreshed = await fetchDivineWeightAttempts(50);
      setAttempts(refreshed);
      setStage('result');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Boska Waga w Ręku</Text>
            <Text style={styles.sub}>
              {stage === 'estimate'
                ? 'Trening Boskiej Percepcji — oszacuj wagę'
                : stage === 'actual'
                  ? 'Połóż towar na wadze i wpisz wynik'
                  : stage === 'result'
                    ? 'Werdykt niebios'
                    : 'Ścieżka kultywacji'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} hitSlop={10} style={styles.closeBtn}>
            <X size={20} color={DS.color.muted} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {stage === 'estimate' && (
              <>
                <View style={styles.heroIcon}>
                  <Sparkles size={28} color={DS.color.greenEnd} strokeWidth={2} />
                </View>
                <Text style={styles.flavor}>
                  Weź towar do ręki. Wyczuj ciężar okiem i dłonią — wpisz domysł w gramach.
                  {itemName ? `\n\nProdukt: ${itemName}` : ''}
                </Text>
                <Text style={styles.label}>Szacunek (g)</Text>
                <TextInput
                  style={styles.input}
                  value={estimateStr}
                  onChangeText={setEstimateStr}
                  keyboardType="decimal-pad"
                  placeholder="np. 450"
                  placeholderTextColor={DS.color.muted}
                  testID="divine-estimate-input"
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <TouchableOpacity style={styles.primary} onPress={goToActual} activeOpacity={0.85}>
                  <Text style={styles.primaryText}>Dalej — ważenie</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghost} onPress={onClose}>
                  <Text style={styles.ghostText}>Pomiń trening</Text>
                </TouchableOpacity>
              </>
            )}

            {stage === 'actual' && (
              <>
                <View style={styles.heroIcon}>
                  <Scale size={28} color={DS.color.greenEnd} strokeWidth={2} />
                </View>
                <Text style={styles.flavor}>
                  Połóż ten sam towar na wadze. Wpisz realny wynik — Kompas Rozbieżności
                  pokaże, jak daleko odbiega Twoja percepcja.
                </Text>
                <Text style={styles.hint}>Twój szacunek: {estimateG} g</Text>
                <Text style={styles.label}>Waga rzeczywista (g)</Text>
                <TextInput
                  style={styles.input}
                  value={actualStr}
                  onChangeText={setActualStr}
                  keyboardType="decimal-pad"
                  placeholder="np. 540"
                  placeholderTextColor={DS.color.muted}
                  testID="divine-actual-input"
                />
                {error ? <Text style={styles.error}>{error}</Text> : null}
                <TouchableOpacity
                  style={[styles.primary, saving && { opacity: 0.6 }]}
                  onPress={() => void submitActual()}
                  disabled={saving}
                  activeOpacity={0.85}
                >
                  {saving ? (
                    <ActivityIndicator color="#0A0A0A" />
                  ) : (
                    <Text style={styles.primaryText}>Odczytaj Kompas</Text>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghost} onPress={() => setStage('estimate')}>
                  <Text style={styles.ghostText}>Wróć do szacunku</Text>
                </TouchableOpacity>
              </>
            )}

            {stage === 'result' && result && (
              <>
                <PerceptionCompass absErrorG={result.absErrorG} />
                <Text style={styles.flavorCenter}>{result.flavorLine}</Text>
                <View style={styles.statGrid}>
                  <View style={styles.statCell}>
                    <Text style={styles.statVal}>{result.absErrorG} g</Text>
                    <Text style={styles.statKey}>|błąd|</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={styles.statVal}>+{result.pointsEarned}</Text>
                    <Text style={styles.statKey}>Qi</Text>
                  </View>
                  <View style={styles.statCell}>
                    <Text style={styles.statVal}>{result.streakAfter}</Text>
                    <Text style={styles.statKey}>seria</Text>
                  </View>
                </View>
                <Text style={styles.rankName}>{result.rank.namePl}</Text>
                <Text style={styles.rankDesc}>{result.rank.descriptionPl}</Text>
                {!result.improved && !result.isFirst ? (
                  <Text style={styles.rewindNote}>
                    Seria cofnięta do początku łańcucha Twojej rangi (nie do zera) —
                    symboliczny reset w tej samej klasie kultywacji.
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={styles.primary}
                  onPress={() => setStage('progress')}
                  activeOpacity={0.85}
                >
                  <Text style={styles.primaryText}>Ścieżka rozwoju</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghost} onPress={onClose}>
                  <Text style={styles.ghostText}>Zamknij</Text>
                </TouchableOpacity>
              </>
            )}

            {stage === 'progress' && stats && (
              <>
                <DivineWeightProgress stats={stats} attempts={attempts} />
                <TouchableOpacity style={styles.primary} onPress={onClose} activeOpacity={0.85}>
                  <Text style={styles.primaryText}>Zakończ</Text>
                </TouchableOpacity>
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: DS.color.bgPrimary },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: DS.space.screen,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DS.color.borderSubtle,
    gap: 12,
  },
  title: { color: DS.color.heading, fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  sub: { color: DS.color.muted, fontSize: 12, marginTop: 4 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: DS.space.screen, paddingBottom: 48, gap: 12 },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(0,255,120,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginTop: 8,
  },
  flavor: {
    color: DS.color.body,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
  },
  flavorCenter: {
    color: DS.color.body,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    fontWeight: '600',
  },
  label: {
    color: DS.color.muted,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
  },
  hint: { color: DS.color.greenEnd, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  input: {
    borderWidth: 1,
    borderColor: DS.color.borderHover,
    backgroundColor: DS.color.surfaceCard,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 14,
    color: DS.color.heading,
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  primary: {
    marginTop: 8,
    backgroundColor: DS.color.greenEnd,
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    ...DS.shadow.greenGlow,
  },
  primaryText: { color: '#0A0A0A', fontSize: 14, fontWeight: '800' },
  ghost: { paddingVertical: 12, alignItems: 'center' },
  ghostText: { color: DS.color.muted, fontSize: 13, fontWeight: '600' },
  error: { color: DS.color.danger, fontSize: 13, textAlign: 'center' },
  compassWrap: { alignItems: 'center', marginVertical: 8 },
  compassLabel: {
    color: DS.color.muted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginTop: 6,
  },
  statGrid: { flexDirection: 'row', gap: 8 },
  statCell: {
    flex: 1,
    backgroundColor: DS.color.bgTertiary,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    paddingVertical: 12,
    alignItems: 'center',
  },
  statVal: { color: DS.color.heading, fontSize: 18, fontWeight: '800' },
  statKey: { color: DS.color.muted, fontSize: 11, marginTop: 2 },
  rankName: {
    color: DS.color.greenEnd,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 4,
  },
  rankDesc: {
    color: DS.color.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  rewindNote: {
    color: DS.color.warning,
    fontSize: 11,
    lineHeight: 16,
    textAlign: 'center',
    backgroundColor: DS.color.warningSoft,
    padding: 10,
    borderRadius: 12,
  },
});
