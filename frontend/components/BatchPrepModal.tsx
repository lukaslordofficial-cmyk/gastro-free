/**
 * Przygotowanie partii — skalowanie receptury + rekomendacja naczynia z Magazynu.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChefHat, Minus, Plus, X, Ruler } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';
import { supabase } from '@/lib/supabase';
import { fetchKitchenUtensils, type KitchenUtensilRow } from '@/lib/kitchenUtensils';
import {
  estimateLiquidLiters,
  pickUtensil,
  scaleRecipeIngredients,
  type ScalableIngredient,
} from '@/lib/portionCookware';

export type BatchPrepDish = {
  id: string;
  name: string;
  category: string;
  recipe: ScalableIngredient[];
  /** Jeśli receptura jest na X porcji (domyślnie 1). */
  basePortions?: number;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  dish: BatchPrepDish | null;
  accountKey: string;
};

function formatQty(q: number): string {
  if (!Number.isFinite(q)) return '—';
  if (Math.abs(q - Math.round(q)) < 0.001) return String(Math.round(q));
  return (Math.round(q * 10) / 10).toFixed(1);
}

export function BatchPrepModal({ visible, onClose, dish, accountKey }: Props) {
  const [portions, setPortions] = useState(1);
  const [portionsRaw, setPortionsRaw] = useState('1');
  const [utensils, setUtensils] = useState<KitchenUtensilRow[]>([]);
  const [loadingUtensils, setLoadingUtensils] = useState(false);
  const [utensilsError, setUtensilsError] = useState<string | null>(null);

  const loadUtensils = useCallback(async () => {
    if (!accountKey || accountKey === 'default') {
      setUtensils([]);
      return;
    }
    setLoadingUtensils(true);
    setUtensilsError(null);
    const { rows, error } = await fetchKitchenUtensils(supabase, accountKey);
    setLoadingUtensils(false);
    if (error) {
      setUtensilsError(error);
      setUtensils([]);
      return;
    }
    setUtensils(rows);
  }, [accountKey]);

  useEffect(() => {
    if (!visible) return;
    setPortions(1);
    setPortionsRaw('1');
    void loadUtensils();
  }, [visible, dish?.id, loadUtensils]);

  const applyPortions = (n: number) => {
    const p = Math.max(1, Math.min(999, Math.round(n)));
    setPortions(p);
    setPortionsRaw(String(p));
  };

  const scaled = useMemo(() => {
    if (!dish) return [];
    return scaleRecipeIngredients(dish.recipe || [], portions, dish.basePortions ?? 1);
  }, [dish, portions]);

  const liquid = useMemo(() => {
    if (!dish) return { liters: 0, approximate: false };
    return estimateLiquidLiters(scaled, dish.category);
  }, [dish, scaled]);

  const pick = useMemo(
    () => pickUtensil(utensils, liquid.liters, ['garnek', 'pojemnik']),
    [utensils, liquid.liters],
  );

  if (!dish) return null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.header}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.eyebrow}>Przygotowanie partii</Text>
              <Text style={styles.title} numberOfLines={2}>
                {dish.name}
              </Text>
              <Text style={styles.sub}>{dish.category}</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={12}>
              <X size={20} color={DS.color.muted} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
            <Text style={styles.sectionLabel}>Liczba porcji</Text>
            <View style={styles.stepper}>
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => applyPortions(portions - 1)}
                activeOpacity={0.8}
                testID="batch-prep-minus"
              >
                <Minus size={18} color={DS.color.heading} strokeWidth={2.5} />
              </TouchableOpacity>
              <TextInput
                style={styles.stepInput}
                value={portionsRaw}
                onChangeText={(v) => {
                  setPortionsRaw(v);
                  const n = parseInt(v.replace(/[^\d]/g, ''), 10);
                  if (!Number.isNaN(n) && n > 0) setPortions(Math.min(999, n));
                }}
                onBlur={() => applyPortions(portions)}
                keyboardType="number-pad"
                selectTextOnFocus
                testID="batch-prep-portions"
              />
              <TouchableOpacity
                style={styles.stepBtn}
                onPress={() => applyPortions(portions + 1)}
                activeOpacity={0.8}
                testID="batch-prep-plus"
              >
                <Plus size={18} color={DS.color.heading} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionLabel}>
              Składniki na {portions} {portions === 1 ? 'porcję' : portions < 5 ? 'porcje' : 'porcji'}
            </Text>
            {scaled.length === 0 ? (
              <Text style={styles.empty}>Brak receptury — dodaj składniki w edycji dania.</Text>
            ) : (
              <View style={styles.listCard}>
                {scaled.map((ing, idx) => (
                  <View
                    key={`${ing.name}-${idx}`}
                    style={[styles.ingRow, idx === scaled.length - 1 && styles.ingRowLast]}
                  >
                    <Text style={styles.ingName} numberOfLines={2}>
                      {ing.name}
                    </Text>
                    <Text style={styles.ingQty}>
                      {formatQty(ing.quantity)} {ing.unit}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <Text style={styles.tip}>
              Tip: przy mięsie zostaw 5–10 g zapasu na porcję (obróbka / ubytki) — receptura to punkt
              startowy, nie dogma.
            </Text>

            <View style={styles.cookwareHeader}>
              <Ruler size={16} color={DS.color.greenEnd} strokeWidth={2} />
              <Text style={[styles.sectionLabel, { marginBottom: 0 }]}>Rekomendowane naczynie</Text>
            </View>

            {loadingUtensils ? (
              <ActivityIndicator color={DS.color.greenEnd} style={{ marginVertical: 16 }} />
            ) : utensilsError ? (
              <Text style={styles.warn}>
                Nie udało się wczytać naczyń z Magazynu ({utensilsError}).
              </Text>
            ) : liquid.liters <= 0 ? (
              <Text style={styles.muted}>
                Brak wystarczających danych o cieczach — dobór garnka jest niedostępny dla tej
                receptury. Dla zup/sosów dodaj wodę, bulion lub mleko w ml/l (lub g).
              </Text>
            ) : pick.utensil ? (
              <View style={styles.utensilCard}>
                <View style={styles.utensilIcon}>
                  <ChefHat size={20} color={DS.color.greenEnd} strokeWidth={2} />
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.utensilName}>{pick.utensil.name}</Text>
                  <Text style={styles.utensilMeta}>
                    {pick.utensil.utensil_type}
                    {pick.capacityLiters != null
                      ? ` · ${formatQty(pick.capacityLiters)} l`
                      : ''}
                  </Text>
                  <Text style={styles.utensilNeed}>
                    Szacunek partii: ~{formatQty(pick.needLiters)} l
                    {liquid.approximate ? ' (przybliżony)' : ''}
                    {' · '}cel ≥ {formatQty(pick.targetLiters)} l (+12%)
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.warnCard}>
                <Text style={styles.warnTitle}>Brak wystarczająco dużego naczynia</Text>
                <Text style={styles.warn}>
                  Potrzeba ok. {formatQty(pick.targetLiters)} l (z zapasem 12%
                  {liquid.approximate ? ', szacunek przybliżony' : ''}). Dodaj większy garnek lub
                  pojemnik w Magazyn → Naczynia kuchenne.
                </Text>
              </View>
            )}

            {liquid.approximate && liquid.liters > 0 ? (
              <Text style={styles.disclaimer}>
                Objętość oszacowana (g≈ml dla płynów w zupach/sosach) — sprawdź przy pierwszej
                partii.
              </Text>
            ) : null}
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
    alignItems: 'flex-start',
    gap: 12,
    paddingHorizontal: DS.space.screen,
    paddingTop: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DS.color.borderSubtle,
  },
  eyebrow: {
    color: DS.color.greenEnd,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  title: { color: DS.color.heading, fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  sub: { color: DS.color.muted, fontSize: 13, marginTop: 2 },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DS.color.bgTertiary,
  },
  body: {
    padding: DS.space.screen,
    paddingBottom: 40,
    gap: 8,
  },
  sectionLabel: {
    color: DS.color.muted,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    marginTop: 12,
    marginBottom: 8,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    alignSelf: 'flex-start',
  },
  stepBtn: {
    width: 44,
    height: 44,
    borderRadius: DS.radius.button,
    backgroundColor: DS.color.bgTertiary,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepInput: {
    minWidth: 64,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: '800',
    color: DS.color.heading,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: DS.radius.button,
    backgroundColor: DS.color.surfaceCard,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
  },
  listCard: {
    backgroundColor: DS.color.surfaceCard,
    borderRadius: DS.radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
    overflow: 'hidden',
  },
  ingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DS.color.borderSubtle,
  },
  ingRowLast: { borderBottomWidth: 0 },
  ingName: { flex: 1, color: DS.color.body, fontSize: 14, fontWeight: '500' },
  ingQty: { color: DS.color.heading, fontSize: 14, fontWeight: '700' },
  empty: { color: DS.color.muted, fontSize: 13, fontStyle: 'italic', marginBottom: 8 },
  tip: {
    color: DS.color.muted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 10,
    padding: 12,
    borderRadius: DS.radius.image,
    backgroundColor: DS.color.warningSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.warningBorder,
  },
  cookwareHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    marginBottom: 8,
  },
  utensilCard: {
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    borderRadius: DS.radius.card,
    backgroundColor: 'rgba(0,255,120,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(0,255,120,0.2)',
  },
  utensilIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: DS.color.bgTertiary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  utensilName: { color: DS.color.heading, fontSize: 15, fontWeight: '700' },
  utensilMeta: {
    color: DS.color.greenEnd,
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    marginTop: 2,
  },
  utensilNeed: { color: DS.color.muted, fontSize: 12, marginTop: 6, lineHeight: 16 },
  warnCard: {
    padding: 14,
    borderRadius: DS.radius.card,
    backgroundColor: DS.color.dangerSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,90,90,0.28)',
    gap: 6,
  },
  warnTitle: { color: DS.color.danger, fontSize: 14, fontWeight: '700' },
  warn: { color: DS.color.body, fontSize: 13, lineHeight: 18 },
  muted: { color: DS.color.muted, fontSize: 13, lineHeight: 18 },
  disclaimer: {
    color: DS.color.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 8,
  },
});
