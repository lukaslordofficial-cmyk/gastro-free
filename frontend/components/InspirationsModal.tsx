/**
 * Inspiracje Kulinarne — katalog kategorii → siatka dań → przepis AI.
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  Image,
  ActivityIndicator,
  ScrollView,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  ChevronLeft,
  Sparkles,
  Clock,
  ChefHat,
  Minus,
  Plus,
  Lightbulb,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { usePremiumAlert } from '@/components/PremiumAlert';
import type { InspirationCategory, InspirationDish } from '@/lib/inspirationsRegistry';
import {
  loadUnlockedInspirations,
  saveUnlockedInspiration,
  type InspirationRecipe,
} from '@/lib/inspirationUnlocks';
import { normalizeRecipeQuantity } from '@/lib/recipeUnits';

export type { InspirationRecipe };

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');
const COLS = 2;
const GAP = 10;
const SCREEN_W = Dimensions.get('window').width;
const TILE_W = (SCREEN_W - 40 - GAP) / COLS;

type Stage = 'categories' | 'dishes' | 'confirm' | 'loading' | 'recipe';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Most do budowania receptur w Menu — składniki z inspiracji */
  onApplyToMenu?: (payload: {
    dishName: string;
    slug: string;
    localAsset: number;
    ingredients: { name: string; quantity: number; unit: string }[];
  }) => void;
};

function scaleQty(base: number, portions: number, defaultPortions: number): string {
  const q = normalizeRecipeQuantity((base * portions) / Math.max(1, defaultPortions));
  return String(q);
}

export function InspirationsModal({ visible, onClose, onApplyToMenu }: Props) {
  const theme = useAppTheme();
  const { alert } = usePremiumAlert();
  const prem = theme.isPremium;
  const accent = prem ? DS.color.greenEnd : Colors.accent;
  const bg = prem ? DS.color.bgPrimary : Colors.background;
  const card = prem ? DS.color.surfaceCard : Colors.card;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const border = prem ? DS.color.borderSubtle : Colors.border;

  const [categories, setCategories] = useState<InspirationCategory[]>([]);
  const [stage, setStage] = useState<Stage>('categories');
  const [category, setCategory] = useState<InspirationCategory | null>(null);
  const [dish, setDish] = useState<InspirationDish | null>(null);
  const [recipe, setRecipe] = useState<InspirationRecipe | null>(null);
  const [portions, setPortions] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<Record<string, { recipe: InspirationRecipe }>>({});

  // Leniwe require katalogów dopiero gdy modal jest widoczny (nie przy imporcie Menu).
  useEffect(() => {
    if (!visible) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { getInspirationCategories } = require('@/lib/inspirationsRegistry') as {
        getInspirationCategories: () => InspirationCategory[];
      };
      setCategories(getInspirationCategories());
    } catch {
      setCategories([]);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    void loadUnlockedInspirations().then(setUnlocked);
  }, [visible]);

  const reset = useCallback(() => {
    setStage('categories');
    setCategory(null);
    setDish(null);
    setRecipe(null);
    setPortions(2);
    setError(null);
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  const openCategory = (c: InspirationCategory) => {
    setCategory(c);
    setStage('dishes');
  };

  const openDish = (d: InspirationDish) => {
    setDish(d);
    const hit = unlocked[d.slug];
    if (hit?.recipe) {
      setRecipe(hit.recipe);
      setPortions(1);
      setStage('recipe');
      return;
    }
    setStage('confirm');
  };

  const generateRecipe = async () => {
    if (!dish) return;
    if (!BACKEND_URL) {
      alert('Błąd', 'Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).');
      return;
    }
    setStage('loading');
    setError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/inspirations/recipe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dish_name: dish.labelPl, slug: dish.slug }),
      });
      if (!res.ok) {
        let msg = `Błąd serwera (${res.status})`;
        try {
          const raw = await res.text();
          const parsed = JSON.parse(raw);
          if (typeof parsed?.detail === 'string') msg = parsed.detail;
          else if (Array.isArray(parsed?.detail)) {
            msg = parsed.detail.map((x: any) => x?.msg || JSON.stringify(x)).join('; ');
          } else if (raw) msg = raw.slice(0, 300);
        } catch {
          /* keep msg */
        }
        if (res.status === 404) {
          msg =
            'Endpoint Inspiracji nie jest dostępny na backendzie (404). ' +
            'Zrestartuj uvicorn w folderze backend (pełny stop + start).';
        }
        throw new Error(msg);
      }
      const data = (await res.json()) as InspirationRecipe;
      setRecipe(data);
      setPortions(1);
      setStage('recipe');
      await saveUnlockedInspiration(dish.slug, dish.labelPl, data);
      setUnlocked((prev) => ({ ...prev, [dish.slug]: { recipe: { ...data, cached: true } } }));
    } catch (e: any) {
      setError(e?.message || 'Nie udało się wygenerować przepisu.');
      setStage('confirm');
      alert('Błąd', e?.message || 'Nie udało się wygenerować przepisu.');
    }
  };

  const title =
    stage === 'categories'
      ? 'Inspiracje Kulinarne'
      : stage === 'dishes'
        ? category?.titlePl ?? 'Potrawy'
        : stage === 'recipe'
          ? recipe?.dish_name ?? 'Przepis'
          : dish?.labelPl ?? 'Przepis';

  const canBack = stage !== 'categories';
  const goBack = () => {
    if (stage === 'dishes') {
      setCategory(null);
      setStage('categories');
    } else if (stage === 'confirm' || stage === 'loading') {
      setDish(null);
      setStage('dishes');
    } else if (stage === 'recipe') {
      setRecipe(null);
      setStage('dishes');
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: bg }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: border }]}>
          {canBack ? (
            <TouchableOpacity onPress={goBack} style={styles.iconBtn} hitSlop={8}>
              <ChevronLeft size={22} color={text} strokeWidth={2} />
            </TouchableOpacity>
          ) : (
            <View style={styles.iconBtn} />
          )}
          <View style={styles.headerCenter}>
            <Sparkles size={16} color={accent} strokeWidth={2.5} />
            <Text style={[styles.headerTitle, { color: text }]} numberOfLines={1}>
              {title}
            </Text>
          </View>
          <TouchableOpacity onPress={handleClose} style={styles.iconBtn} hitSlop={8}>
            <X size={20} color={muted} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {stage === 'categories' && (
          <FlatList
            data={categories}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listPad}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.catRow, { backgroundColor: card, borderColor: border }]}
                onPress={() => openCategory(item)}
                activeOpacity={0.85}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.catTitle, { color: text }]}>{item.titlePl}</Text>
                  <Text style={[styles.catMeta, { color: muted }]}>
                    {item.dishes.length} potraw
                  </Text>
                </View>
                <Text style={{ color: accent, fontWeight: '800' }}>→</Text>
              </TouchableOpacity>
            )}
            ListHeaderComponent={
              <Text style={[styles.intro, { color: muted }]}>
                Wybierz kategorię kuchni. Po kliknięciu w danie AI przygotuje przepis ze
                składnikami i gramaturami (skalowane na porcje).
              </Text>
            }
          />
        )}

        {stage === 'dishes' && category && (
          <FlatList
            data={category.dishes}
            keyExtractor={(item) => item.slug}
            numColumns={COLS}
            columnWrapperStyle={{ gap: GAP }}
            contentContainerStyle={styles.listPad}
            renderItem={({ item }) => {
              const isOpen = !!unlocked[item.slug];
              return (
                <TouchableOpacity
                  style={[styles.tile, { width: TILE_W, backgroundColor: card, borderColor: border }]}
                  onPress={() => openDish(item)}
                  activeOpacity={0.88}
                >
                  <Image source={item.localAsset} style={styles.tileImg} resizeMode="contain" />
                  {isOpen ? (
                    <View style={[styles.unlockedBadge, { backgroundColor: accent }]}>
                      <Text style={styles.unlockedBadgeText}>Odkryte</Text>
                    </View>
                  ) : null}
                  <Text style={[styles.tileLabel, { color: text }]} numberOfLines={2}>
                    {item.labelPl}
                  </Text>
                </TouchableOpacity>
              );
            }}
          />
        )}

        {(stage === 'confirm' || stage === 'loading') && dish && (
          <View style={styles.confirmWrap}>
            <Image source={dish.localAsset} style={styles.confirmImg} resizeMode="contain" />
            <Text style={[styles.confirmTitle, { color: text }]}>{dish.labelPl}</Text>
            <Text style={[styles.confirmQ, { color: muted }]}>
              Czy chcesz wygenerować szczegółowy przepis wraz z gramaturą składników, aby
              przygotować tę potrawę?
            </Text>
            {error ? <Text style={styles.err}>{error}</Text> : null}
            {stage === 'loading' ? (
              <View style={styles.loadingBox}>
                <ActivityIndicator size="large" color={accent} />
                <Text style={[styles.loadingText, { color: muted }]}>
                  Szef kuchni AI pisze przepis…
                </Text>
              </View>
            ) : (
              <View style={styles.confirmBtns}>
                <TouchableOpacity
                  style={[styles.btnGhost, { borderColor: border }]}
                  onPress={goBack}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: muted, fontWeight: '700' }}>Anuluj</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.btnPrimary, { backgroundColor: accent }]}
                  onPress={() => void generateRecipe()}
                  activeOpacity={0.85}
                >
                  <ChefHat size={16} color={prem ? '#0A0A0A' : '#fff'} strokeWidth={2.5} />
                  <Text style={[styles.btnPrimaryText, prem && { color: '#0A0A0A' }]}>
                    Generuj przepis
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {stage === 'recipe' && recipe && (
          <ScrollView contentContainerStyle={styles.recipePad} showsVerticalScrollIndicator={false}>
            {dish ? (
              <Image source={dish.localAsset} style={styles.recipeHero} resizeMode="contain" />
            ) : null}
            <Text style={[styles.recipeTeaser, { color: muted }]}>{recipe.short_teaser}</Text>
            <View style={styles.metaRow}>
              <View style={[styles.metaChip, { backgroundColor: prem ? 'rgba(0,255,120,0.1)' : Colors.accentLight }]}>
                <Clock size={13} color={accent} strokeWidth={2.5} />
                <Text style={[styles.metaChipText, { color: accent }]}>
                  {recipe.prep_time_minutes} min
                </Text>
              </View>
              <View style={[styles.metaChip, { backgroundColor: prem ? 'rgba(0,255,120,0.1)' : Colors.accentLight }]}>
                <Text style={[styles.metaChipText, { color: accent }]}>{recipe.difficulty}</Text>
              </View>
              {recipe.cached ? (
                <View style={[styles.metaChip, { backgroundColor: prem ? DS.color.bgTertiary : Colors.borderLight }]}>
                  <Text style={[styles.metaChipText, { color: muted }]}>z cache</Text>
                </View>
              ) : null}
            </View>

            <View style={[styles.portionsBar, { backgroundColor: card, borderColor: border }]}>
              <Text style={[styles.portionsLabel, { color: text }]}>Porcje</Text>
              <View style={styles.portionsCtrl}>
                <TouchableOpacity
                  style={[styles.portBtn, { borderColor: border }]}
                  onPress={() => setPortions((p) => Math.max(1, p - 1))}
                >
                  <Minus size={16} color={text} strokeWidth={2.5} />
                </TouchableOpacity>
                <Text style={[styles.portionsVal, { color: text }]}>{portions}</Text>
                <TouchableOpacity
                  style={[styles.portBtn, { borderColor: border }]}
                  onPress={() => setPortions((p) => Math.min(24, p + 1))}
                >
                  <Plus size={16} color={text} strokeWidth={2.5} />
                </TouchableOpacity>
              </View>
            </View>

            {recipe.ingredients_sections.map((sec) => (
              <View key={sec.section_name} style={{ marginBottom: 16 }}>
                <Text style={[styles.sectionTitle, { color: text }]}>{sec.section_name}</Text>
                {sec.ingredients.map((ing, idx) => (
                  <View key={`${sec.section_name}-${idx}`} style={styles.ingRow}>
                    <Text style={[styles.ingName, { color: text }]}>{ing.name}</Text>
                    <Text style={[styles.ingQty, { color: accent }]}>
                      {scaleQty(ing.base_quantity, portions, recipe.default_portions)} {ing.unit}
                    </Text>
                  </View>
                ))}
              </View>
            ))}

            <Text style={[styles.sectionTitle, { color: text }]}>Przygotowanie</Text>
            {recipe.steps.map((step, i) => (
              <View key={i} style={styles.stepRow}>
                <View style={[styles.stepBadge, { backgroundColor: accent }]}>
                  <Text style={[styles.stepNum, prem && { color: '#0A0A0A' }]}>{i + 1}</Text>
                </View>
                <Text style={[styles.stepText, { color: text }]}>{step}</Text>
              </View>
            ))}

            <View style={[styles.tipBox, { backgroundColor: prem ? 'rgba(0,255,120,0.08)' : '#FEF3C7', borderColor: border }]}>
              <Lightbulb size={16} color={accent} strokeWidth={2.5} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.tipLabel, { color: accent }]}>Wskazówka szefa</Text>
                <Text style={[styles.tipText, { color: text }]}>{recipe.chef_tip}</Text>
              </View>
            </View>

            {onApplyToMenu && dish ? (
              <TouchableOpacity
                style={[styles.btnPrimary, { backgroundColor: accent, marginTop: 16, alignSelf: 'stretch' }]}
                activeOpacity={0.85}
                onPress={() => {
                  const scale = portions / Math.max(1, recipe.default_portions || 1);
                  const ingredients = recipe.ingredients_sections.flatMap((sec) =>
                    sec.ingredients.map((ing) => ({
                      name: ing.name,
                      quantity: normalizeRecipeQuantity(ing.base_quantity * scale),
                      unit: ing.unit,
                    })),
                  );
                  onApplyToMenu({
                    dishName: recipe.dish_name || dish.labelPl,
                    slug: dish.slug,
                    localAsset: dish.localAsset,
                    ingredients,
                  });
                  handleClose();
                }}
              >
                <ChefHat size={16} color={prem ? '#0A0A0A' : '#fff'} strokeWidth={2.5} />
                <Text style={[styles.btnPrimaryText, prem && { color: '#0A0A0A' }]}>
                  Użyj w recepturze Menu
                </Text>
              </TouchableOpacity>
            ) : null}
            <View style={{ height: 40 }} />
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  headerTitle: { fontSize: 16, fontWeight: '800', maxWidth: '80%' },
  listPad: { padding: 20, paddingBottom: 40, gap: 10 },
  intro: { fontSize: 13, lineHeight: 19, marginBottom: 12 },
  catRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
  },
  catTitle: { fontSize: 15, fontWeight: '700' },
  catMeta: { fontSize: 12, marginTop: 2 },
  tile: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: GAP,
  },
  tileImg: { width: '100%', height: TILE_W, backgroundColor: '#111' },
  tileLabel: { fontSize: 12, fontWeight: '600', padding: 8, minHeight: 44 },
  unlockedBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  unlockedBadgeText: { color: '#0A0A0A', fontSize: 10, fontWeight: '800' },
  confirmWrap: { flex: 1, padding: 24, alignItems: 'center' },
  confirmImg: { width: 200, height: 200, borderRadius: 16, marginBottom: 16, backgroundColor: '#111' },
  confirmTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center', marginBottom: 10 },
  confirmQ: { fontSize: 14, lineHeight: 21, textAlign: 'center', marginBottom: 20 },
  confirmBtns: { flexDirection: 'row', gap: 10, width: '100%' },
  btnGhost: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1.5,
    alignItems: 'center',
  },
  btnPrimary: {
    flex: 1.4,
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  loadingBox: { alignItems: 'center', gap: 12, marginTop: 12 },
  loadingText: { fontSize: 13 },
  err: { color: Colors.danger, marginBottom: 10, textAlign: 'center', fontSize: 12 },
  recipePad: { padding: 20 },
  recipeHero: { width: '100%', aspectRatio: 1, maxHeight: 280, borderRadius: 14, marginBottom: 12, backgroundColor: '#111', alignSelf: 'center' },
  recipeTeaser: { fontSize: 14, lineHeight: 20, marginBottom: 12 },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  metaChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  metaChipText: { fontSize: 12, fontWeight: '700' },
  portionsBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 18,
  },
  portionsLabel: { fontSize: 14, fontWeight: '700' },
  portionsCtrl: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  portBtn: {
    width: 34,
    height: 34,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  portionsVal: { fontSize: 18, fontWeight: '800', minWidth: 28, textAlign: 'center' },
  sectionTitle: { fontSize: 15, fontWeight: '800', marginBottom: 8 },
  ingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    gap: 12,
  },
  ingName: { flex: 1, fontSize: 13 },
  ingQty: { fontSize: 13, fontWeight: '700' },
  stepRow: { flexDirection: 'row', gap: 10, marginBottom: 12, alignItems: 'flex-start' },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  stepNum: { fontSize: 11, fontWeight: '800', color: '#fff' },
  stepText: { flex: 1, fontSize: 13, lineHeight: 19 },
  tipBox: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 8,
    alignItems: 'flex-start',
  },
  tipLabel: { fontSize: 12, fontWeight: '800', marginBottom: 4 },
  tipText: { fontSize: 13, lineHeight: 18 },
});
