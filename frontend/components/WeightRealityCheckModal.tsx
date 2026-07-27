/**
 * Minigra reality-check: szacunek → wynik z wagi → ranga 1–5 (dark premium).
 */
import React, { useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';
import {
  evaluateWeightGuess,
  formatGramsInput,
  type WeightSkillResult,
} from '@/lib/weightRealityCheck';

type Step = 'estimate' | 'actual' | 'result';

type Props = {
  visible: boolean;
  onClose: () => void;
  itemName?: string | null;
  /** Podpowiedź gramatury (np. po przeliczeniu S/M/L) — tylko hint w UI. */
  suggestedGrams?: number | null;
};

export function WeightRealityCheckModal({
  visible,
  onClose,
  itemName,
  suggestedGrams,
}: Props) {
  const [step, setStep] = useState<Step>('estimate');
  const [estimateRaw, setEstimateRaw] = useState('');
  const [actualRaw, setActualRaw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WeightSkillResult | null>(null);

  const hint = useMemo(() => {
    if (suggestedGrams != null && suggestedGrams > 0) {
      return `Podpowiedź z rozmiaru: ok. ${Math.round(suggestedGrams)} g (nie musisz jej używać).`;
    }
    return null;
  }, [suggestedGrams]);

  function resetAndClose() {
    setStep('estimate');
    setEstimateRaw('');
    setActualRaw('');
    setError(null);
    setResult(null);
    onClose();
  }

  function goActual() {
    const est = formatGramsInput(estimateRaw);
    if (est == null || est <= 0) {
      setError('Podaj szacowaną wagę w gramach (np. 450).');
      return;
    }
    setError(null);
    setStep('actual');
  }

  function finish() {
    const est = formatGramsInput(estimateRaw);
    const act = formatGramsInput(actualRaw);
    if (est == null || est <= 0) {
      setError('Brak szacunku — wróć o krok.');
      return;
    }
    if (act == null || act <= 0) {
      setError('Podaj wynik z wagi w gramach (np. 540).');
      return;
    }
    setError(null);
    setResult(evaluateWeightGuess(est, act));
    setStep('result');
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={resetAndClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Ocena wagi na oko</Text>
              <Text style={styles.sub}>
                {itemName ? `Produkt: ${itemName}` : 'Porównaj szacunek z wagą — poziom 1–5'}
              </Text>
            </View>
            <TouchableOpacity onPress={resetAndClose} style={styles.closeBtn} hitSlop={12}>
              <X size={20} color={DS.color.muted} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            {step === 'estimate' && (
              <>
                <Text style={styles.stepLabel}>Krok 1 — oszacuj</Text>
                <Text style={styles.help}>
                  Weź towar do ręki (lub podobną ilość) i wpisz, ile według Ciebie waży — w gramach.
                </Text>
                {hint ? <Text style={styles.hint}>{hint}</Text> : null}
                <TextInput
                  style={styles.input}
                  value={estimateRaw}
                  onChangeText={setEstimateRaw}
                  keyboardType="decimal-pad"
                  placeholder="np. 450"
                  placeholderTextColor={DS.color.muted}
                />
                <Text style={styles.unitHint}>gramy (g)</Text>
              </>
            )}

            {step === 'actual' && (
              <>
                <Text style={styles.stepLabel}>Krok 2 — zważ</Text>
                <Text style={styles.help}>
                  Połóż to samo na wadze kuchennej i wpisz wynik. To weryfikacja — bez niej raport strat
                  „na oko” psuje food cost.
                </Text>
                <TextInput
                  style={styles.input}
                  value={actualRaw}
                  onChangeText={setActualRaw}
                  keyboardType="decimal-pad"
                  placeholder="np. 540"
                  placeholderTextColor={DS.color.muted}
                />
                <Text style={styles.unitHint}>gramy (g) z wagi</Text>
              </>
            )}

            {step === 'result' && result && (
              <>
                <Text style={styles.stepLabel}>Wynik — poziom {result.rank}/5</Text>
                <View style={styles.resultCard}>
                  <Text style={styles.rankBig}>{result.rank}</Text>
                  <Text style={styles.rankTitle}>{result.title}</Text>
                  <Text style={styles.headline}>{result.headline}</Text>
                  <Text style={styles.desc}>{result.description}</Text>
                </View>
                <Text style={styles.tip}>
                  Cel kuchni: powtarzalne porcje (ok. 5–10 g przy mięsach) i straty ważone, nie zgadywane.
                </Text>
              </>
            )}

            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>

          <View style={styles.footer}>
            {step === 'estimate' && (
              <TouchableOpacity style={styles.primary} onPress={goActual} activeOpacity={0.85}>
                <Text style={styles.primaryText}>Dalej — ważenie</Text>
              </TouchableOpacity>
            )}
            {step === 'actual' && (
              <View style={styles.row}>
                <TouchableOpacity
                  style={styles.secondary}
                  onPress={() => {
                    setError(null);
                    setStep('estimate');
                  }}
                >
                  <Text style={styles.secondaryText}>Wstecz</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.primary, { flex: 1 }]} onPress={finish} activeOpacity={0.85}>
                  <Text style={styles.primaryText}>Pokaż poziom</Text>
                </TouchableOpacity>
              </View>
            )}
            {step === 'result' && (
              <TouchableOpacity style={styles.primary} onPress={resetAndClose} activeOpacity={0.85}>
                <Text style={styles.primaryText}>Gotowe</Text>
              </TouchableOpacity>
            )}
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: DS.color.bgPrimary },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: DS.space.screen,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: DS.color.borderSubtle,
    gap: 12,
  },
  title: { fontSize: 20, fontWeight: '700', color: DS.color.heading, letterSpacing: -0.3 },
  sub: { fontSize: 13, color: DS.color.muted, marginTop: 4 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DS.color.surfaceCard,
  },
  body: { padding: DS.space.screen, paddingBottom: 24 },
  stepLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: DS.color.greenEnd,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  help: { fontSize: 15, lineHeight: 22, color: DS.color.body, marginBottom: 12 },
  hint: { fontSize: 13, color: DS.color.muted, marginBottom: 10 },
  input: {
    backgroundColor: DS.color.surfaceCard,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 22,
    fontWeight: '700',
    color: DS.color.heading,
  },
  unitHint: { marginTop: 8, fontSize: 13, color: DS.color.muted },
  resultCard: {
    backgroundColor: DS.color.surfaceCard,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    padding: 20,
    alignItems: 'center',
    gap: 8,
  },
  rankBig: { fontSize: 56, fontWeight: '800', color: DS.color.greenEnd, lineHeight: 64 },
  rankTitle: { fontSize: 18, fontWeight: '700', color: DS.color.heading, textAlign: 'center' },
  headline: { fontSize: 15, color: DS.color.body, textAlign: 'center', lineHeight: 22 },
  desc: { fontSize: 14, color: DS.color.muted, textAlign: 'center', lineHeight: 20, marginTop: 4 },
  tip: { marginTop: 16, fontSize: 13, color: DS.color.muted, lineHeight: 19 },
  error: { marginTop: 12, color: DS.color.alert, fontSize: 14 },
  footer: {
    paddingHorizontal: DS.space.screen,
    paddingBottom: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: DS.color.borderSubtle,
    gap: 10,
  },
  row: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  primary: {
    backgroundColor: DS.color.greenEnd,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    ...DS.shadow.greenGlow,
  },
  primaryText: { color: '#0A120E', fontSize: 16, fontWeight: '800' },
  secondary: {
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
  },
  secondaryText: { color: DS.color.heading, fontWeight: '600' },
});
