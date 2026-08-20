import React, { useState, useMemo, useRef, useCallback, useEffect, Suspense, lazy } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Switch,
  RefreshControl,
  DeviceEventEmitter,
  ActivityIndicator,
  InteractionManager,
} from 'react-native';
import {
  emitRecipeIngredientsChanged,
  RECIPE_INGREDIENTS_CHANGED,
  type RecipeIngredientsChangedPayload,
} from '@/lib/recipeSync';
import { FlashList } from '@shopify/flash-list';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ChefHat,
  Search,
  Mic,
  Camera,
  Ruler,
  Leaf,
  X,
  UtensilsCrossed,
  Plus,
  Trash2,
  Check,
  FlaskConical,
  Bell,
  Box,
  BookOpen,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { MenuScanModal } from '@/components/MenuScanModal';
import { BatchPrepModal, type BatchPrepDish } from '@/components/BatchPrepModal';
import { AdBannerFooter } from '@/components/ads/AdBannerFooter';
import { DishCard } from '@/components/menu/DishCard';
import { IngredientRow } from '@/components/menu/IngredientRow';
import { menuScreenStyles as styles } from '@/components/menu/menuScreenStyles';
import { PremiumTabChrome } from '@/components/premium/PremiumTabChrome';
import {
  PremiumCapsule,
  PremiumGlowCta,
  PremiumOutlineBtn,
  PremiumStatTile,
} from '@/components/premium/PremiumUI';
import {
  CATEGORY_COLORS,
  FORM_CATEGORIES,
  INV_CATEGORY_COLORS,
  INV_PRESET_CATEGORIES,
  INV_UNIT_OPTIONS,
} from '@/constants/menuUi';
import {
  makePosId,
  mapDbToDish,
  mapInvDbRow,
  newDraftIngredient,
  normIngredientName,
} from '@/lib/menuScreenHelpers';
import type {
  Dish,
  IngredientDraft,
  InventoryItem,
  KitchenUtensil,
  MenuListRow,
  RecipeIngredient,
  StockStatus,
  Unit,
} from '@/types/menu';
import { DS } from '@/constants/premiumTheme';
import {
  loadDishCustomImages,
  setDishCustomImage,
  clearDishCustomImage,
  subscribeDishCustomImages,
  getDishCustomImageSync,
} from '@/lib/dishCustomImages';
import { getMenuThumbSync, subscribeMenuThumbs } from '@/lib/menuThumbCache';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '@/contexts/AuthContext';
import { normalizeMenuUnit, normalizeRecipeQuantity, parseOptionalPieceWeightG } from '@/lib/recipeUnits';
import { normalizeIngredientName, namesMatch } from '@/lib/fuzzyProductMatch';
import { secureId } from '@/lib/secureId';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { usePremiumAlert } from '@/components/PremiumAlert';

/** Ciężki modal receptur — osobny chunk Metro, nie przy cold start Menu. */
const RecipesModal = lazy(() =>
  import('@/components/RecipesModal').then((m) => ({ default: m.RecipesModal })),
);


const MENU_LIST_CACHE = new Map<string, Dish[]>();

// ─── Blank forms ──────────────────────────────────────────────────────────────

const BLANK_DISH_FORM = { name: '', category: FORM_CATEGORIES[0], price: '' };

const BLANK_INV_FORM = {
  name: '',
  category: INV_PRESET_CATEGORIES[0],
  currentQty: '',
  criticalThreshold: '',
  unit: 'g' as Unit,
  isCombo: false,
  portionSize: '',
};

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function MenuScreen() {
  const theme = useAppTheme();
  const { openVoiceReport, documentScanRevision, notifyDocumentScanComplete } = useUiOverlay();
  const { ready: authReady, isAuthenticated, accountKey } = useAuth();
  const { alert: premiumAlert } = usePremiumAlert();
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [utensils, setUtensils] = useState<KitchenUtensil[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [categoryMap, setCategoryMap] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  /** null = jeszcze nie wybrano; startujemy od najmniejszej kategorii użytkownika (nie „Wszystkie”). */
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const catInitRef = useRef(false);
  const [showAddModal, setShowAddModal] = useState(false);

  // Edit mode
  const [editingDish, setEditingDish] = useState<Dish | null>(null);

  // Main dish form
  const [form, setForm] = useState(BLANK_DISH_FORM);
  const [ingredients, setIngredients] = useState<IngredientDraft[]>([newDraftIngredient()]);

  // Quick-add inventory sub-modal
  const [showInvModal, setShowInvModal] = useState(false);
  const [pendingIngKey, setPendingIngKey] = useState<string | null>(null);
  const [invForm, setInvForm] = useState(BLANK_INV_FORM);
  const [invSaving, setInvSaving] = useState(false);

  // Batch prep (premium) — skalowanie + dobór naczynia
  const [batchPrepDish, setBatchPrepDish] = useState<BatchPrepDish | null>(null);

  // ── Data fetching ─────────────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    if (!authReady || !isAuthenticated || !accountKey || accountKey === 'default') return;
    const ak = accountKey;
    const cached = MENU_LIST_CACHE.get(ak);
    if (cached?.length) {
      setDishes(cached);
      setLoading(false);
    }
    try {
      const listRes = await supabase
        .from('menu_items')
        .select('id, name, category, price_pln, pos_id')
        .eq('account_key', ak)
        .eq('is_active', true)
        .order('category')
        .order('name')
        .limit(1000);
      if (listRes.error) throw listRes.error;

      const byId = new Map<string, Dish>();
      for (const row of listRes.data ?? []) {
        const id = String((row as { id?: string }).id || '');
        if (!id || byId.has(id)) continue;
        byId.set(id, {
          id,
          name: String((row as { name?: string }).name || ''),
          category: String((row as { category?: string }).category || ''),
          price_pln: Number((row as { price_pln?: number }).price_pln) || 0,
          pos_id: String((row as { pos_id?: string }).pos_id || ''),
          recipe: [],
        });
      }
      const list = Array.from(byId.values());
      MENU_LIST_CACHE.set(ak, list);
      setDishes(list);
      setError(null);
      setLoading(false);
      setRefreshing(false);

      void (async () => {
        try {
          let recipesRes = await supabase
            .from('menu_items')
            .select('id, recipe_ingredients(id, ingredient_name, quantity, unit, sort_order, piece_weight_g)')
            .eq('account_key', ak)
            .eq('is_active', true)
            .limit(1000);
          if (recipesRes.error && /piece_weight_g/i.test(recipesRes.error.message ?? '')) {
            recipesRes = await supabase
              .from('menu_items')
              .select('id, recipe_ingredients(id, ingredient_name, quantity, unit, sort_order)')
              .eq('account_key', ak)
              .eq('is_active', true)
              .limit(1000);
          }
          if (!recipesRes.error && recipesRes.data) {
            const recipeById = new Map<string, RecipeIngredient[]>();
            for (const row of recipesRes.data) {
              const mapped = mapDbToDish(row);
              recipeById.set(mapped.id, mapped.recipe);
            }
            setDishes((prev) => {
              const next = prev.map((d) => ({
                ...d,
                recipe: recipeById.get(d.id) ?? d.recipe,
              }));
              MENU_LIST_CACHE.set(ak, next);
              return next;
            });
          }

          const [utensilsRes, invRes, catsRes] = await Promise.all([
            supabase
              .from('kitchen_utensils')
              .select('id, name, utensil_type, capacity_value, capacity_unit')
              .eq('account_key', ak)
              .order('name'),
            supabase
              .from('inventory_items')
              .select('id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)')
              .eq('account_key', ak)
              .eq('is_active', true)
              .order('name')
              .then(async (res) => {
                if (res.error && /is_active/.test(res.error.message ?? '')) {
                  return supabase
                    .from('inventory_items')
                    .select('id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)')
                    .eq('account_key', ak)
                    .order('name');
                }
                return res;
              }),
            supabase
              .from('inventory_categories')
              .select('id, name')
              .eq('account_key', ak)
              .order('sort_order'),
          ]);

          if (utensilsRes.error) {
            if (!/account_key|schema cache|column/i.test(utensilsRes.error.message ?? '')) {
              if (__DEV__) console.warn('[menu] utensils', utensilsRes.error.message);
            }
            setUtensils([]);
          } else {
            setUtensils(utensilsRes.data ?? []);
          }
          if (!invRes.error) {
            const invMapped = (invRes.data ?? []).map(mapInvDbRow);
            const invById = new Map<string, InventoryItem>();
            for (const i of invMapped) {
              if (!invById.has(i.id)) invById.set(i.id, i);
            }
            setInventory(Array.from(invById.values()));
          }
          if (!catsRes.error) {
            const map: Record<string, string> = {};
            (catsRes.data ?? []).forEach((c: { id?: string; name?: string }) => {
              if (c.name && c.id) map[c.name] = c.id;
            });
            setCategoryMap(map);
          }
        } catch (bgErr) {
          if (__DEV__) console.warn('[menu] background', bgErr);
        }
      })();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Nieznany błąd');
      setLoading(false);
      setRefreshing(false);
    }
  }, [authReady, isAuthenticated, accountKey]);

  useEffect(() => {
    if (!authReady) return;
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void fetchData();
  }, [fetchData, authReady, isAuthenticated, accountKey]);

  // Odśwież listę po skanie menu (DocumentScanHost / globalny modal) — jak magazyn po fakturze.
  useEffect(() => {
    if (documentScanRevision > 0) {
      setRefreshing(true);
      void fetchData();
    }
  }, [documentScanRevision, fetchData]);

  const editingDishRef = useRef<Dish | null>(null);
  editingDishRef.current = editingDish;

  // Sync receptur z Ustawień POS (ta sama tabela recipe_ingredients)
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      RECIPE_INGREDIENTS_CHANGED,
      (payload: RecipeIngredientsChangedPayload) => {
        void (async () => {
          await fetchData();
          const open = editingDishRef.current;
          if (!payload?.menuItemId || !open || open.id !== payload.menuItemId) return;
          const { data } = await supabase
            .from('recipe_ingredients')
            .select('ingredient_name, quantity, unit, sort_order, piece_weight_g')
            .eq('menu_item_id', payload.menuItemId)
            .order('sort_order');
          const rows = (data ?? []).sort(
            (a: any, b: any) => (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0)
          );
          setIngredients(
            rows.length > 0
              ? rows.map((r: any) => ({
                  key: secureId('ing'),
                  name: r.ingredient_name ?? '',
                  quantity: String(r.quantity ?? 0),
                  unit: r.unit || 'g',
                  pieceWeightG: r.piece_weight_g != null ? String(r.piece_weight_g) : '',
                }))
              : [newDraftIngredient()]
          );
        })();
      }
    );
    return () => sub.remove();
  }, [fetchData]);

  const onRefresh = () => { setRefreshing(true); fetchData(); };

  // ── Derived / filtered data ───────────────────────────────────────────────

  const allCategories = useMemo(() => {
    const seen = new Set<string>();
    dishes.forEach((d) => seen.add(d.category));
    return ['Wszystkie', ...Array.from(seen)];
  }, [dishes]);

  /** Kategoria z najmniejszą liczbą dań — domyślny widok wejścia do Menu. */
  const fewestCategory = useMemo(() => {
    if (!dishes.length) return null;
    const counts = new Map<string, number>();
    for (const d of dishes) counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
    let best: string | null = null;
    let bestN = Number.POSITIVE_INFINITY;
    for (const [cat, n] of counts) {
      if (n < bestN || (n === bestN && (best == null || cat.localeCompare(best) < 0))) {
        best = cat;
        bestN = n;
      }
    }
    return best;
  }, [dishes]);

  // Start od kategorii z najmniejszą liczbą dań — nigdy od „Wszystkie”.
  useEffect(() => {
    if (!fewestCategory || catInitRef.current) return;
    catInitRef.current = true;
    setSelectedCat(fewestCategory);
  }, [fewestCategory]);

  const activeCat = selectedCat ?? fewestCategory ?? 'Wszystkie';

  const filtered = useMemo(() => {
    let list = dishes;
    if (activeCat !== 'Wszystkie') list = list.filter((d) => d.category === activeCat);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((d) => d.name.toLowerCase().includes(q));
    }
    return list;
  }, [dishes, search, activeCat]);

  const grouped = useMemo(() => {
    const map: Record<string, Dish[]> = {};
    filtered.forEach((d) => {
      if (!map[d.category]) map[d.category] = [];
      map[d.category].push(d);
    });
    return map;
  }, [filtered]);

  const menuRows = useMemo((): MenuListRow[] => {
    const rows: MenuListRow[] = [];
    for (const [category, items] of Object.entries(grouped)) {
      rows.push({ type: 'header', category, count: items.length });
      for (const dish of items) rows.push({ type: 'dish', dish });
    }
    return rows;
  }, [grouped]);

  const [thumbTick, setThumbTick] = useState(0);
  const [customImageTick, setCustomImageTick] = useState(0);
  const [photoSaving, setPhotoSaving] = useState(false);
  const dishNamesKey = useMemo(
    () => dishes.map((d) => `${d.name}\u0001${d.category}`).join('|'),
    [dishes],
  );

  useEffect(() => subscribeMenuThumbs(() => setThumbTick((t) => t + 1)), []);

  // 1) Odczyt zapisanych przypisań (natychmiast).
  // 2) Matcher TYLKO dla nowych dań bez cache — nigdy ponownie dla całego menu.
  useEffect(() => {
    if (!dishes.length) return;
    let cancelled = false;
    const items = dishes.map((d) => ({ name: d.name, category: d.category }));
    const firstCat =
      (activeCat && activeCat !== 'Wszystkie' ? activeCat : fewestCategory) || '';
    const priorityNames = new Set(
      (firstCat ? dishes.filter((d) => d.category === firstCat) : dishes.slice(0, 24)).map(
        (d) => d.name,
      ),
    );

    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        try {
          const {
            hydrateMenuThumbsFromDisk,
            applyThumbsToMemory,
            persistMenuThumbMatches,
            listMissingThumbItems,
          } = await import('@/lib/menuThumbCache');
          if (cancelled) return;

          const seed = await hydrateMenuThumbsFromDisk(items);
          if (cancelled) return;
          applyThumbsToMemory(seed);

          const missing = listMissingThumbItems(items, seed);
          if (!missing.length) {
            // Wszystkie potrawy mają już obrazek — koniec, bez indeksu / matchera.
            return;
          }

          const { assignMenuDishThumbsProgressive } = await import('@/lib/menuDishThumbs');
          if (cancelled) return;

          const assigned = await assignMenuDishThumbsProgressive(missing, {
            seed,
            priorityNames,
            cancelled: () => cancelled,
            chunkSize: 8,
            onBatch: (map) => {
              if (cancelled) return;
              applyThumbsToMemory(map);
              void persistMenuThumbMatches(missing, map);
            },
          });
          if (cancelled) return;

          applyThumbsToMemory(assigned);
          void persistMenuThumbMatches(missing, assigned);
        } catch (err) {
          if (__DEV__) console.warn('[menu] thumb assign failed', err);
        }
      })();
    });

    return () => {
      cancelled = true;
      task.cancel?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dishNamesKey only
  }, [dishNamesKey]);

  useEffect(() => {
    void loadDishCustomImages().then(() => setCustomImageTick((t) => t + 1));
    return subscribeDishCustomImages(() => setCustomImageTick((t) => t + 1));
  }, []);

  const saveDishPhotoWebP = useCallback(
    async (dishId: string, sourceUri: string) => {
      setPhotoSaving(true);
      try {
        await setDishCustomImage(dishId, sourceUri);
      } catch (e: any) {
        premiumAlert('Nie udało się zapisać', e?.message || 'Kompresja WebP nie powiodła się.');
      } finally {
        setPhotoSaving(false);
      }
    },
    [premiumAlert],
  );

  const handleChangeDishPhoto = useCallback(
    (dish: Dish) => {
      const hasCustom = !!getDishCustomImageSync(dish.id);
      premiumAlert('Zmień zdjęcie', dish.name, [
        {
          text: 'Wybierz z galerii',
          onPress: async () => {
            const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!perm.granted) {
              premiumAlert('Brak dostępu', 'Pozwól na dostęp do galerii, aby zmienić zdjęcie.');
              return;
            }
            const r = await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ['images'],
              quality: 0.85,
            });
            if (r.canceled || !r.assets?.[0]?.uri) return;
            await saveDishPhotoWebP(dish.id, r.assets[0].uri);
          },
        },
        {
          text: 'Zrób zdjęcie',
          onPress: async () => {
            let perm = await ImagePicker.getCameraPermissionsAsync();
            if (!perm.granted && perm.canAskAgain) {
              perm = await ImagePicker.requestCameraPermissionsAsync();
            }
            if (!perm.granted) {
              premiumAlert('Brak dostępu', 'Pozwól na dostęp do aparatu, aby zmienić zdjęcie.');
              return;
            }
            const r = await ImagePicker.launchCameraAsync({
              mediaTypes: ['images'],
              quality: 0.85,
            });
            if (r.canceled || !r.assets?.[0]?.uri) return;
            await saveDishPhotoWebP(dish.id, r.assets[0].uri);
          },
        },
        ...(hasCustom
          ? [
              {
                text: 'Przywróć z biblioteki',
                style: 'destructive' as const,
                onPress: () => {
                  void clearDishCustomImage(dish.id);
                },
              },
            ]
          : []),
        { text: 'Anuluj', style: 'cancel' as const },
      ]);
    },
    [premiumAlert, saveDishPhotoWebP],
  );

  // ── Ingredient autocomplete ───────────────────────────────────────────────

  function getSuggestions(draftName: string): string[] {
    if (draftName.trim().length < 2) return [];
    const q = draftName.trim().toLowerCase();
    return inventory
      .filter((i) => i.product_name.toLowerCase().includes(q))
      .map((i) => i.product_name)
      .slice(0, 6);
  }

  // Status składnika względem magazynu (zielony ptaszek / czerwony X + dymek)
  function getStockStatus(name: string): StockStatus | null {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const match = inventory.find((i) => i.product_name.toLowerCase() === trimmed.toLowerCase());
    if (match) return { found: true, qty: match.current_qty, unit: match.unit };
    return { found: false, qty: 0, unit: '' };
  }

  // ── Ingredient form helpers ───────────────────────────────────────────────

  function handleIngredientChange(key: string, field: keyof IngredientDraft, value: string) {
    setIngredients((prev) => prev.map((ing) => (ing.key === key ? { ...ing, [field]: value } : ing)));
  }

  function handleIngredientRemove(key: string) {
    setIngredients((prev) => (prev.length === 1 ? prev : prev.filter((ing) => ing.key !== key)));
  }

  function handleSelectSuggestion(key: string, name: string) {
    setIngredients((prev) => prev.map((ing) => (ing.key === key ? { ...ing, name } : ing)));
  }

  // ── Open / close modals ───────────────────────────────────────────────────

  function handleOpenAdd() {
    setEditingDish(null);
    setForm(BLANK_DISH_FORM);
    setIngredients([newDraftIngredient()]);
    setShowAddModal(true);
  }

  function handleOpenEdit(dish: Dish) {
    setEditingDish(dish);
    setForm({ name: dish.name, category: dish.category, price: String(dish.price_pln) });
    setIngredients(
      dish.recipe.length > 0
        ? dish.recipe.map((r) => ({
            key: secureId('ing'),
            name: r.name,
            quantity: String(r.quantity),
            unit: r.unit,
            pieceWeightG: r.piece_weight_g != null ? String(r.piece_weight_g) : '',
          }))
        : [newDraftIngredient()]
    );
    setShowAddModal(true);
  }

  function handleCloseAddModal() {
    setForm(BLANK_DISH_FORM);
    setIngredients([newDraftIngredient()]);
    setEditingDish(null);
    setShowAddModal(false);
  }

  // ── Delete dish ───────────────────────────────────────────────────────────

  function handleDeleteDish(dish: Dish) {
    premiumAlert(
      'Usuń danie',
      `Czy na pewno chcesz usunąć "${dish.name}" z menu?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: async () => {
            try {
              const { data: linkedRows } = await supabase
                .from('recipe_ingredients')
                .select('warehouse_product_id')
                .eq('menu_item_id', dish.id);
              const linkedIds = [
                ...new Set(
                  (linkedRows ?? [])
                    .map((r: any) => r.warehouse_product_id as string | null)
                    .filter((id): id is string => !!id),
                ),
              ];

              await supabase.from('recipe_ingredients').delete().eq('menu_item_id', dish.id);
              const { error: delError } = await supabase
                .from('menu_items')
                .delete()
                .eq('id', dish.id);
              if (delError) throw delError;
              setDishes((prev) => prev.filter((d) => d.id !== dish.id));

              // Auto-usuń z magazynu produkty utworzone pod to danie, jeśli nadal mają stan 0
              // i nie są używane w innych recepturach.
              for (const wid of linkedIds) {
                const { data: inv } = await supabase
                  .from('inventory_items')
                  .select('id, quantity')
                  .eq('id', wid)
                  .maybeSingle();
                if (!inv || Number(inv.quantity) > 0) continue;
                const { count } = await supabase
                  .from('recipe_ingredients')
                  .select('id', { count: 'exact', head: true })
                  .eq('warehouse_product_id', wid);
                if ((count ?? 0) > 0) continue;
                await supabase.from('inventory_items').delete().eq('id', wid);
                setInventory((prev) => prev.filter((i) => i.id !== wid));
              }
            } catch (e: any) {
              premiumAlert('Błąd', e.message ?? 'Nie udało się usunąć dania.');
            }
          },
        },
      ],
    );
  }

  const renderMenuRow = useCallback(
    ({ item }: { item: MenuListRow }) => {
      if (item.type === 'header') {
        return (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: DS.space[16], marginTop: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: DS.color.greenEnd }} />
            <Text
              style={{ color: DS.color.heading, fontSize: 13, fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase', flex: 1 }}
              allowFontScaling={false}
            >
              {item.category}
            </Text>
            <Text style={{ color: DS.color.muted, fontSize: 13, fontWeight: '600' }} allowFontScaling={false}>
              {item.count}
            </Text>
          </View>
        );
      }
      return (
        <DishCard
          dish={item.dish}
          onEdit={handleOpenEdit}
          onDelete={handleDeleteDish}
          onBatchPrep={(d) =>
            setBatchPrepDish({
              id: d.id,
              name: d.name,
              category: d.category,
              recipe: d.recipe,
              basePortions: 1,
            })
          }
          premium
          thumb={getMenuThumbSync(item.dish.name)}
          onChangePhoto={handleChangeDishPhoto}
        />
      );
    },
    [handleChangeDishPhoto, customImageTick, thumbTick],
  );

  // ── Save / update dish ────────────────────────────────────────────────────

  async function ensureWarehouseLinks(
    validIngredients: IngredientDraft[],
  ): Promise<Map<string, string>> {
    /** normName → inventory_items.id — tworzy brakujące produkty ze stanem 0. */
    const linkMap = new Map<string, string>();
    if (!accountKey || accountKey === 'default') return linkMap;

    // Świeży snapshot z DB — lokalny stan może być nieaktualny przy równoległym skanie.
    let dbInv: unknown[] | null = null;
    {
      const withActive = await supabase
        .from('inventory_items')
        .select(
          'id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name)',
        )
        .eq('account_key', accountKey)
        .eq('is_active', true)
        .limit(3000);
      if (!withActive.error) {
        dbInv = withActive.data;
      } else if (/is_active/i.test(withActive.error.message ?? '')) {
        const fallback = await supabase
          .from('inventory_items')
          .select(
            'id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name)',
          )
          .eq('account_key', accountKey)
          .limit(3000);
        dbInv = fallback.error ? null : fallback.data;
      }
    }
    const working: InventoryItem[] = (dbInv ?? []).map(mapInvDbRow);
    // Dołącz lokalne, których jeszcze nie ma w odpowiedzi (optimistic).
    for (const local of inventory) {
      if (!working.some((w) => w.id === local.id)) working.push(local);
    }

    const findLocal = (displayName: string, key: string) =>
      working.find(
        (i) =>
          normIngredientName(i.product_name) === key ||
          namesMatch(i.product_name, displayName, 86),
      );

    for (const ing of validIngredients) {
      const name = normalizeIngredientName(ing.name.trim());
      const key = normIngredientName(name);
      if (!key || linkMap.has(key)) continue;
      const existing = findLocal(name, key);
      if (existing) {
        linkMap.set(key, existing.id);
        continue;
      }
      const unit = normalizeMenuUnit(ing.unit);
      const insertPayload: Record<string, unknown> = {
        name,
        category_id: categoryMap['Inne'] ?? categoryMap['Przyprawy'] ?? null,
        quantity: 0,
        unit,
        min_quantity: 1,
        is_combo_polprodukt: false,
        unit_cost: 0,
        account_key: accountKey,
      };
      const { data: newRow, error } = await supabase
        .from('inventory_items')
        .insert(insertPayload as never)
        .select('id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name)')
        .single();
      if (error || !newRow?.id) {
        // Race: ktoś właśnie dodał ten sam produkt — dociągnij i zlinkuj.
        const { data: raced } = await supabase
          .from('inventory_items')
          .select(
            'id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name)',
          )
          .eq('account_key', accountKey)
          .eq('is_active', true)
          .limit(3000);
        const hit = (raced ?? [])
          .map(mapInvDbRow)
          .find(
            (i) =>
              normIngredientName(i.product_name) === key ||
              namesMatch(i.product_name, name, 86),
          );
        if (hit) {
          working.push(hit);
          linkMap.set(key, hit.id);
        }
        continue;
      }
      const mapped = mapInvDbRow(newRow);
      working.push(mapped);
      linkMap.set(key, newRow.id);
      setInventory((prev) => (prev.some((p) => p.id === mapped.id) ? prev : [...prev, mapped]));
    }
    return linkMap;
  }

  function buildIngredientRows(
    menuItemId: string,
    validIngredients: IngredientDraft[],
    linkMap: Map<string, string>,
  ) {
    return validIngredients.map((ing, idx) => {
      const iname = normalizeIngredientName(ing.name.trim());
      const row: Record<string, unknown> = {
        menu_item_id: menuItemId,
        ingredient_name: iname,
        quantity: normalizeRecipeQuantity(parseFloat((ing.quantity || '').replace(',', '.')) || 0),
        unit: normalizeMenuUnit(ing.unit),
        sort_order: idx + 1,
      };
      const pw = parseOptionalPieceWeightG(ing.pieceWeightG);
      if ((ing.unit === 'szt' || ing.unit === 'sztuka') && pw != null) {
        row.piece_weight_g = pw;
      }
      const wid = linkMap.get(normIngredientName(iname));
      if (wid) row.warehouse_product_id = wid;
      return row;
    });
  }

  async function handleSave() {
    if (saving) return;
    if (!form.name.trim()) { premiumAlert('Wymagane pole', 'Podaj nazwę dania.'); return; }
    const price = parseFloat(form.price);
    if (isNaN(price) || price <= 0) {
      premiumAlert('Błąd', 'Cena sprzedaży musi być liczbą większą od zera.');
      return;
    }

    // Uwaga: zapis jest możliwy nawet gdy składnik nie znajduje się w magazynie.
    // Brakujące produkty tworzymy ze stanem 0 i linkujemy do dania.

    const nameTrim = form.name.trim();
    const nameKey = normIngredientName(nameTrim);
    const dupDish = dishes.find((d) => {
      if (editingDish && d.id === editingDish.id) return false;
      return normIngredientName(d.name || '') === nameKey;
    });
    if (dupDish) {
      premiumAlert(
        'Danie już w menu',
        `„${dupDish.name}” już istnieje. Edytuj istniejące danie zamiast tworzyć duplikat.`,
      );
      return;
    }

    setSaving(true);
    try {
      const validIngredients = ingredients.filter((i) => (i.name ?? '').trim());
      const linkMap = await ensureWarehouseLinks(validIngredients);

      if (editingDish) {
        // ── Update existing dish ──
        const { error: updateError } = await supabase
          .from('menu_items')
          .update({ name: nameTrim, category: form.category, price_pln: price })
          .eq('id', editingDish.id);
        if (updateError) throw updateError;

        await supabase.from('recipe_ingredients').delete().eq('menu_item_id', editingDish.id);
        if (validIngredients.length > 0) {
          const rows = buildIngredientRows(editingDish.id, validIngredients, linkMap);
          const { error: ingError } = await supabase.from('recipe_ingredients').insert(rows);
          if (ingError) {
            if (/piece_weight_g|warehouse_product_id|schema cache/i.test(ingError.message ?? '')) {
              const fallback = rows.map(({ piece_weight_g: _pw, warehouse_product_id: _w, ...rest }) => rest);
              const { error: e2 } = await supabase.from('recipe_ingredients').insert(fallback);
              if (e2) throw e2;
            } else {
              throw ingError;
            }
          }
        }

        const updatedDish: Dish = {
          ...editingDish,
          name: nameTrim,
          category: form.category,
          price_pln: price,
          recipe: validIngredients.map((ing) => ({
            name: ing.name.trim(),
            quantity: normalizeRecipeQuantity(parseFloat((ing.quantity || '').replace(',', '.')) || 0),
            unit: normalizeMenuUnit(ing.unit),
            piece_weight_g: parseOptionalPieceWeightG(ing.pieceWeightG),
          })),
        };
        setDishes((prev) => prev.map((d) => (d.id === editingDish.id ? updatedDish : d)));
        emitRecipeIngredientsChanged(editingDish.id);
        setSelectedCat(form.category);
        handleCloseAddModal();
      } else {
        // ── Insert new dish ──
        const posId = makePosId(form.category, dishes.length + 1);

        if (!accountKey || accountKey === 'default') {
          throw new Error('Brak konta użytkownika — wyloguj się i zaloguj ponownie.');
        }
        const { data: newItem, error: itemError } = await supabase
          .from('menu_items')
          .insert({
            name: nameTrim,
            category: form.category,
            price_pln: price,
            pos_id: posId,
            is_active: true,
            account_key: accountKey,
          })
          .select('id')
          .single();
        if (itemError) {
          const msg = itemError.message || '';
          if (/row-level security|RLS/i.test(msg)) {
            throw new Error(
              'Brak uprawnień do zapisu menu. Wyloguj się i zaloguj ponownie. Jeśli problem wraca — skontaktuj się z supportem.',
            );
          }
          throw itemError;
        }

        if (validIngredients.length > 0) {
          const rows = buildIngredientRows(newItem.id, validIngredients, linkMap);
          const { error: ingError } = await supabase.from('recipe_ingredients').insert(rows);
          if (ingError) {
            if (/piece_weight_g|warehouse_product_id|schema cache/i.test(ingError.message ?? '')) {
              const fallback = rows.map(({ piece_weight_g: _pw, warehouse_product_id: _w, ...rest }) => rest);
              const { error: e2 } = await supabase.from('recipe_ingredients').insert(fallback);
              if (e2) throw e2;
            } else {
              throw ingError;
            }
          }
        }

        const newDish: Dish = {
          id: newItem.id,
          name: nameTrim,
          category: form.category,
          price_pln: price,
          pos_id: posId,
          recipe: validIngredients.map((ing) => ({
            name: ing.name.trim(),
            quantity: normalizeRecipeQuantity(parseFloat((ing.quantity || '').replace(',', '.')) || 0),
            unit: normalizeMenuUnit(ing.unit),
            piece_weight_g: parseOptionalPieceWeightG(ing.pieceWeightG),
          })),
        };
        setDishes((prev) => [...prev, newDish]);
        emitRecipeIngredientsChanged(newItem.id);
        setSelectedCat(form.category);
        handleCloseAddModal();
      }
    } catch (e: any) {
      premiumAlert('Błąd zapisu', e.message ?? 'Nieznany błąd');
    } finally {
      setSaving(false);
    }
  }

  // ── Quick-add inventory item ───────────────────────────────────────────────

  async function handleSaveInventoryItem() {
    if (invSaving) return;
    if (!invForm.name.trim()) { premiumAlert('Wymagane pole', 'Podaj nazwę produktu.'); return; }
    const currentQty = parseFloat(invForm.currentQty);
    const criticalThreshold = parseFloat(invForm.criticalThreshold);
    if (isNaN(currentQty) || currentQty < 0) { premiumAlert('Błąd', 'Aktualna ilość musi być liczbą nieujemną.'); return; }
    if (isNaN(criticalThreshold) || criticalThreshold <= 0) {
      premiumAlert('Ustaw próg krytyczny', 'Stan krytyczny musi być liczbą większą od zera — bez niego system nie wie, kiedy alarmować o braku.');
      return;
    }

    setInvSaving(true);
    try {
      if (!accountKey || accountKey === 'default') {
        throw new Error('Brak konta użytkownika — wyloguj się i zaloguj ponownie.');
      }
      const nameTrim = invForm.name.trim();
      const nameKey = normIngredientName(nameTrim);

      // Dedup: nie twórz drugiego wiersza — użyj istniejącego produktu.
      const existingLocal = inventory.find(
        (i) =>
          normIngredientName(i.product_name) === nameKey ||
          namesMatch(i.product_name, nameTrim, 86),
      );
      let linked = existingLocal;
      if (!linked) {
        const { data: dbHit } = await supabase
          .from('inventory_items')
          .select(
            'id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)',
          )
          .eq('account_key', accountKey)
          .eq('is_active', true)
          .limit(3000);
        linked = (dbHit ?? [])
          .map(mapInvDbRow)
          .find(
            (i) =>
              normIngredientName(i.product_name) === nameKey ||
              namesMatch(i.product_name, nameTrim, 86),
          );
      }

      let newInvItem: InventoryItem;
      if (linked) {
        const nextQty = (Number(linked.current_qty) || 0) + (Number(currentQty) || 0);
        const { data: updated, error: updErr } = await supabase
          .from('inventory_items')
          .update({
            quantity: nextQty,
            min_quantity: criticalThreshold,
            unit: invForm.unit,
            portion_size: invForm.portionSize.trim() ? (parseFloat(invForm.portionSize) || null) : null,
            is_combo_polprodukt: invForm.isCombo,
          })
          .eq('id', linked.id)
          .eq('account_key', accountKey)
          .select(
            'id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)',
          )
          .single();
        if (updErr) throw updErr;
        newInvItem = mapInvDbRow(updated);
        setInventory((prev) =>
          prev.some((p) => p.id === newInvItem.id)
            ? prev.map((p) => (p.id === newInvItem.id ? newInvItem : p))
            : [...prev, newInvItem],
        );
      } else {
        const { data: newRow, error: insertError } = await supabase
          .from('inventory_items')
          .insert({
            name: nameTrim,
            category_id: categoryMap[invForm.category] ?? null,
            quantity: currentQty,
            unit: invForm.unit,
            min_quantity: criticalThreshold,
            portion_size: invForm.portionSize.trim() ? (parseFloat(invForm.portionSize) || null) : null,
            is_combo_polprodukt: invForm.isCombo,
            unit_cost: 0,
            account_key: accountKey,
          } as never)
          .select('id, name, quantity, unit, min_quantity, portion_size, is_combo_polprodukt, inventory_categories(name), suppliers(name)')
          .single();

        if (insertError) {
          const msg = insertError.message || '';
          if (/row-level security|RLS/i.test(msg)) {
            throw new Error(
              'Brak uprawnień do zapisu magazynu. Wyloguj się i zaloguj ponownie. Jeśli problem wraca — skontaktuj się z supportem.',
            );
          }
          throw insertError;
        }

        newInvItem = mapInvDbRow(newRow);
        setInventory((prev) =>
          prev.some((p) => p.id === newInvItem.id) ? prev : [...prev, newInvItem],
        );
      }

      // Auto-fill the ingredient row that triggered this flow
      if (pendingIngKey) {
        setIngredients((prev) =>
          prev.map((ing) =>
            ing.key === pendingIngKey ? { ...ing, name: newInvItem.product_name } : ing
          )
        );
      }

      setInvForm(BLANK_INV_FORM);
      setPendingIngKey(null);
      setShowInvModal(false);
    } catch (e: any) {
      premiumAlert('Błąd zapisu', e.message ?? 'Nieznany błąd');
    } finally {
      setInvSaving(false);
    }
  }

  function handleCloseInvModal() {
    setInvForm(BLANK_INV_FORM);
    setPendingIngKey(null);
    setShowInvModal(false);
  }

  const [showScanModal, setShowScanModal] = useState(false);
  const [showRecipes, setShowRecipes] = useState(false);

  const handleScanMenu = () => setShowScanModal(true);

  if (loading && dishes.length === 0) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;

  const isEditing = editingDish !== null;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {photoSaving ? (
        <View
          style={{
            position: 'absolute',
            zIndex: 50,
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.55)',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
          pointerEvents="auto"
          testID="dish-photo-webp-loader"
        >
          <ActivityIndicator size="large" color="#C8F54B" />
          <Text style={{ color: '#F5F5F5', fontWeight: '700', fontSize: 14 }}>
            Kompresuję zdjęcie do WebP…
          </Text>
        </View>
      ) : null}
      {theme.isPremium ? (
        <PremiumTabChrome
          title="Menu"
          subtitle="Menu i receptury"
          meta={`${dishes.length} aktywnych dań · ${utensils.length} narzędzi`}
          showFloats={false}
          headerVariant="centered"
          right={undefined}
          belowHeader={
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: DS.space.screen, paddingBottom: 4 }}>
              <View style={{ flex: 1 }}>
                <PremiumOutlineBtn label="Skanuj menu" onPress={handleScanMenu} tone="green" size="lg" fullWidth />
              </View>
              <View style={{ flex: 1 }}>
                <PremiumOutlineBtn label="+ Dodaj danie" onPress={handleOpenAdd} tone="green" size="lg" fullWidth />
              </View>
            </View>
          }
        >
          <View style={{ flex: 1 }}>
            <View style={{ paddingHorizontal: DS.space.screen, paddingBottom: 8 }}>
              <View style={[styles.searchWrap, {
                backgroundColor: DS.color.bgTertiary,
                borderColor: DS.color.borderSubtle,
                borderRadius: DS.radius.button,
                marginBottom: 10,
              }]}>
                <View style={styles.searchIcon}>
                  <Search size={16} color={DS.color.muted} strokeWidth={2} />
                </View>
                <TextInput
                  style={[styles.searchInput, { color: DS.color.heading }]}
                  placeholder="Szukaj dania..."
                  placeholderTextColor={DS.color.muted}
                  value={search}
                  onChangeText={setSearch}
                  returnKeyType="search"
                  clearButtonMode="while-editing"
                />
              </View>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {allCategories.map((cat) => (
                  <PremiumCapsule
                    key={cat}
                    label={cat}
                    active={activeCat === cat}
                    onPress={() => {
                      requestAnimationFrame(() => setSelectedCat(cat));
                    }}
                    dotColor={cat !== 'Wszystkie' ? (CATEGORY_COLORS[cat] ?? DS.color.muted) : undefined}
                  />
                ))}
              </ScrollView>
            </View>
          <FlashList
            data={menuRows}
            estimatedItemSize={104}
            extraData={`${customImageTick}:${thumbTick}`}
            keyExtractor={(item) =>
              item.type === 'header' ? `h-${item.category}` : `dish-${item.dish.id}`
            }
            renderItem={renderMenuRow}
            getItemType={(item) => item.type}
            drawDistance={1200}
            removeClippedSubviews={false}
            style={styles.scroll}
            contentContainerStyle={[styles.content, { paddingTop: 8, paddingHorizontal: DS.space.screen, flexGrow: 1 }]}
            keyboardShouldPersistTaps="handled"
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
            ListHeaderComponent={
              <View style={{ marginTop: 10, marginBottom: DS.space[16], gap: 10 }}>
                <PremiumGlowCta
                  label="Receptury"
                  onPress={() => setShowRecipes(true)}
                  icon={<BookOpen size={16} color="#0A0A0A" strokeWidth={2.5} />}
                />
                <PremiumGlowCta
                  label="Zgłoś informację"
                  onPress={() => openVoiceReport()}
                  icon={<Mic size={16} color="#0A0A0A" strokeWidth={2.5} />}
                />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                  <PremiumStatTile
                    value={filtered.length}
                    label="Dań"
                    icon={<Bell size={14} color={DS.color.greenEnd} strokeWidth={2} />}
                  />
                  <PremiumStatTile
                    value={Object.keys(grouped).length}
                    label="Kategorii"
                    icon={<Box size={14} color={DS.color.greenEnd} strokeWidth={2} />}
                  />
                  <PremiumStatTile
                    value={filtered.reduce((s, d) => s + d.recipe.length, 0)}
                    label="Składników"
                    icon={<Trash2 size={14} color={DS.color.greenEnd} strokeWidth={2} />}
                  />
                </View>
              </View>
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <UtensilsCrossed size={32} color={DS.color.muted} strokeWidth={1.5} />
                <Text style={[styles.emptyTitle, { color: DS.color.heading }]}>Brak dań pasujących do filtrów</Text>
              </View>
            }
            ListFooterComponent={
              <>
                <View style={{ height: 48 }} />
                <AdBannerFooter />
              </>
            }
          />
          </View>
        </PremiumTabChrome>
      ) : (
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.accent} />}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: Colors.textPrimary }]}>
                Menu i receptury
              </Text>
              <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
                {dishes.length} aktywnych dań · {utensils.length} narzędzi
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.addBtn}
            onPress={handleOpenAdd}
            activeOpacity={0.8}
          >
            <Plus size={14} color={Colors.accent} strokeWidth={2.5} />
            <Text style={styles.addBtnText}>Dodaj danie</Text>
          </TouchableOpacity>
        </View>

        <View style={{ marginBottom: 14 }}>
          <ReportInfoButton contextHint="Menu" onApplied={fetchData} testID="menu-report-info" />
        </View>

        {/* Search */}
        <View style={[
          styles.searchWrap,
          theme.isPremium && { backgroundColor: theme.card, borderColor: theme.border },
        ]}>
          <View style={styles.searchIcon}>
            <Search size={16} color={Colors.textTertiary} strokeWidth={2} />
          </View>
          <TextInput
            style={styles.searchInput}
            placeholder="Szukaj dania..."
            placeholderTextColor={Colors.textTertiary}
            value={search}
            onChangeText={setSearch}
            returnKeyType="search"
            clearButtonMode="while-editing"
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} style={styles.clearBtn}>
              <X size={14} color={Colors.textTertiary} strokeWidth={2.5} />
            </TouchableOpacity>
          )}
        </View>

        {/* Category pills */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catBar}>
          {allCategories.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[styles.catPill, activeCat === cat && styles.catPillActive]}
              onPress={() => setSelectedCat(cat)}
              activeOpacity={0.7}
            >
              {cat !== 'Wszystkie' && (
                <View
                  style={[
                    styles.catDot,
                    { backgroundColor: activeCat === cat ? Colors.white : (CATEGORY_COLORS[cat] ?? Colors.textSecondary) },
                  ]}
                />
              )}
              <Text style={[styles.catPillText, activeCat === cat && styles.catPillTextActive]}>{cat}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Stats strip */}
        <View style={styles.statsStrip}>
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{filtered.length}</Text>
            <Text style={styles.statLabel}>dań</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{Object.keys(grouped).length}</Text>
            <Text style={styles.statLabel}>kategorii</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.statItem}>
            <Text style={styles.statValue}>{filtered.reduce((s, d) => s + d.recipe.length, 0)}</Text>
            <Text style={styles.statLabel}>składników</Text>
          </View>
        </View>

        {/* Dish list grouped by category */}
        {Object.entries(grouped).map(([category, items]) => (
          <View key={category} style={styles.categorySection}>
            <View style={styles.categoryHeaderRow}>
              <View style={[styles.categoryHeaderDot, { backgroundColor: CATEGORY_COLORS[category] ?? Colors.textSecondary }]} />
              <Text style={styles.categoryHeader}>{category}</Text>
              <Text style={styles.categoryCount}>{items.length}</Text>
            </View>
            {items.map((dish) => (
              <DishCard
                key={dish.id}
                dish={dish}
                onEdit={handleOpenEdit}
                onDelete={handleDeleteDish}
                onChangePhoto={handleChangeDishPhoto}
                thumb={getMenuThumbSync(dish.name)}
              />
            ))}
          </View>
        ))}

        {filtered.length === 0 && (
          <View style={styles.empty}>
            <UtensilsCrossed size={32} color={Colors.textTertiary} strokeWidth={1.5} />
            <Text style={styles.emptyTitle}>Brak dań pasujących do filtrów</Text>
            <Text style={styles.emptySub}>Zmień kategorię lub wyszukiwaną frazę</Text>
          </View>
        )}

        {/* Kitchen Utensils */}
        <View style={styles.sectionHeaderRow}>
          <Ruler size={16} color={Colors.textSecondary} strokeWidth={2} />
          <View style={{ flex: 1 }}>
            <Text style={styles.sectionTitle}>Definicje Naczyń Kuchennych</Text>
            <Text style={styles.sectionSubtitle}>Standardowe pojemności i porcje</Text>
          </View>
        </View>

        {utensils.length > 0 && (
          <View style={styles.utensilsCard}>
            <View style={styles.zeroWasteBanner}>
              <Leaf size={14} color="#16A34A" strokeWidth={2} />
              <Text style={styles.zeroWasteText}>
                Zasada Zero Waste: Używaj wskazanych naczyń, aby zachować idealne proporcje i eliminować straty.
              </Text>
            </View>
            {utensils.map((u, idx) => (
              <View key={u.id} style={[styles.utensilRow, idx === utensils.length - 1 && styles.utensilRowLast]}>
                <View style={[styles.utensilIcon, { backgroundColor: Colors.accentLight }]}>
                  <Ruler size={16} color={Colors.accent} strokeWidth={2} />
                </View>
                <View style={styles.utensilInfo}>
                  <Text style={styles.utensilName}>{u.name}</Text>
                  <Text style={[styles.utensilType, { color: Colors.accent }]}>{u.utensil_type}</Text>
                </View>
                {u.capacity_value != null && (
                  <View style={styles.utensilCap}>
                    <Text style={styles.utensilCapValue}>{u.capacity_value}</Text>
                    <Text style={styles.utensilCapUnit}>{u.capacity_unit}</Text>
                  </View>
                )}
              </View>
            ))}
          </View>
        )}

        {/* AI Creator */}
        <View style={styles.aiSection}>
          <View style={styles.aiHeader}>
            <ChefHat size={20} color={Colors.accent} strokeWidth={2} />
            <Text style={styles.aiTitle}>Kreator Receptur AI</Text>
          </View>
          <Text style={styles.aiSub}>Wgraj menu (PDF lub zdjęcie) — AI odczyta potrawy, ceny i składniki.</Text>
          <View style={styles.aiButtons}>
            <TouchableOpacity style={[styles.aiBtn, { backgroundColor: Colors.success }]} onPress={handleScanMenu} activeOpacity={0.85} testID="menu-scan-open">
              <Camera size={18} color={Colors.white} strokeWidth={2} />
              <Text style={styles.aiBtnText}>Skanuj menu</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 32 }} />
        <AdBannerFooter />
      </ScrollView>
      )}

      {/* ── Add / Edit Dish Modal ───────────────────────────────────────────── */}
      <Modal visible={showAddModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCloseAddModal}>
        <SafeAreaView
          style={[styles.modalSafe, theme.isPremium && { backgroundColor: DS.color.bgPrimary }]}
          edges={['top']}
        >
          <View
            style={[
              styles.modalHeader,
              theme.isPremium && {
                backgroundColor: DS.color.bgPrimary,
                borderBottomColor: DS.color.borderSubtle,
              },
            ]}
          >
            <View>
              <Text style={[styles.modalTitle, theme.isPremium && { color: DS.color.heading }]}>
                {isEditing ? 'Edytuj Danie' : 'Nowe Danie'}
              </Text>
              <Text style={[styles.modalSubtitle, theme.isPremium && { color: DS.color.muted }]}>
                {isEditing ? `Zmiana: ${editingDish?.name}` : 'Uzupełnij dane i recepturę'}
              </Text>
            </View>
            <TouchableOpacity onPress={handleCloseAddModal} style={styles.closeBtn}>
              <X size={20} color={theme.isPremium ? DS.color.muted : Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.formScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={[styles.formSection, theme.isPremium && { color: DS.color.heading }]}>Podstawowe dane</Text>

              <View style={styles.fieldWrap}>
                <Text style={[styles.fieldLabel, theme.isPremium && { color: DS.color.muted }]}>
                  Nazwa dania <Text style={{ color: Colors.danger }}>*</Text>
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    theme.isPremium && {
                      backgroundColor: DS.color.bgTertiary,
                      borderColor: DS.color.borderSubtle,
                      color: DS.color.heading,
                    },
                  ]}
                  placeholder="np. Burger Podwójny"
                  placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                  value={form.name}
                  onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                  returnKeyType="next"
                />
              </View>

              <View style={styles.fieldWrap}>
                <Text style={[styles.fieldLabel, theme.isPremium && { color: DS.color.muted }]}>
                  Cena sprzedaży (PLN) <Text style={{ color: Colors.danger }}>*</Text>
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    theme.isPremium && {
                      backgroundColor: DS.color.bgTertiary,
                      borderColor: DS.color.borderSubtle,
                      color: DS.color.heading,
                    },
                  ]}
                  placeholder="np. 36"
                  placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                  value={form.price}
                  onChangeText={(v) => setForm((f) => ({ ...f, price: v }))}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </View>

              <View style={styles.fieldWrap}>
                <Text style={[styles.fieldLabel, theme.isPremium && { color: DS.color.muted }]}>
                  Kategoria <Text style={{ color: Colors.danger }}>*</Text>
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.formCatBar}>
                  {FORM_CATEGORIES.map((cat) => {
                    const active = form.category === cat;
                    const color = CATEGORY_COLORS[cat] ?? Colors.textSecondary;
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={[
                          styles.formCatPill,
                          theme.isPremium && {
                            backgroundColor: DS.color.bgTertiary,
                            borderColor: DS.color.borderSubtle,
                          },
                          active && { backgroundColor: color, borderColor: color },
                        ]}
                        onPress={() => setForm((f) => ({ ...f, category: cat }))}
                        activeOpacity={0.7}
                      >
                        {active && <Check size={11} color={Colors.white} strokeWidth={3} />}
                        <View style={[styles.catDotSmall, { backgroundColor: active ? Colors.white : color }]} />
                        <Text
                          style={[
                            styles.formCatText,
                            theme.isPremium && !active && { color: DS.color.muted },
                            active && { color: Colors.white, fontWeight: '700' },
                          ]}
                        >
                          {cat}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <Text style={[styles.formSection, theme.isPremium && { color: DS.color.heading }]}>Receptura — składniki</Text>

              <View
                style={[
                  styles.invHintRow,
                  theme.isPremium && {
                    backgroundColor: 'rgba(0,255,120,0.08)',
                    borderColor: DS.color.borderSubtle,
                  },
                ]}
              >
                <Check size={12} color={theme.isPremium ? DS.color.greenEnd : Colors.success} strokeWidth={3} />
                <Text style={[styles.invHintText, theme.isPremium && { color: DS.color.muted }]}>
                  Podpowiedzi pobierane z magazynu ({inventory.length} produktów). Nieznane składniki będziesz mógł dodać na bieżąco.
                </Text>
              </View>

              {ingredients.map((ing, idx) => (
                <IngredientRow
                  key={ing.key}
                  draft={ing}
                  index={idx}
                  suggestions={getSuggestions(ing.name)}
                  stock={getStockStatus(ing.name)}
                  onChange={handleIngredientChange}
                  onRemove={handleIngredientRemove}
                  onSelectSuggestion={handleSelectSuggestion}
                />
              ))}

              <TouchableOpacity
                style={[
                  styles.addIngBtn,
                  theme.isPremium && {
                    borderColor: DS.color.greenEnd,
                    backgroundColor: 'rgba(0,255,120,0.1)',
                  },
                ]}
                onPress={() => setIngredients((prev) => [...prev, newDraftIngredient()])}
                activeOpacity={0.8}
              >
                <Plus size={15} color={theme.isPremium ? DS.color.greenEnd : Colors.accent} strokeWidth={2.5} />
                <Text style={[styles.addIngBtnText, theme.isPremium && { color: DS.color.greenEnd }]}>Dodaj składnik</Text>
              </TouchableOpacity>

              {form.name.trim() !== '' && form.price !== '' && (
                <View
                  style={[
                    styles.previewCard,
                    theme.isPremium && {
                      backgroundColor: DS.color.surfaceCard,
                      borderColor: DS.color.borderSubtle,
                    },
                  ]}
                >
                  <Text style={[styles.previewLabel, theme.isPremium && { color: DS.color.muted }]}>Podgląd</Text>
                  <View style={styles.previewRow}>
                    <View style={[styles.catDotSmall, { backgroundColor: CATEGORY_COLORS[form.category] ?? Colors.textSecondary }]} />
                    <Text style={[styles.previewName, theme.isPremium && { color: DS.color.heading }]}>{form.name.trim()}</Text>
                    <Text style={[styles.previewPrice, theme.isPremium && { color: DS.color.greenEnd }]}>{form.price} PLN</Text>
                  </View>
                  <Text style={[styles.previewMeta, theme.isPremium && { color: DS.color.muted }]}>
                    {form.category} · {ingredients.filter((i) => i.name.trim()).length} składnik(ów)
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  isEditing && styles.saveBtnEdit,
                  theme.isPremium && { backgroundColor: DS.color.greenEnd, shadowColor: DS.color.greenEnd },
                  saving && { opacity: 0.6 },
                ]}
                onPress={handleSave}
                disabled={saving}
                activeOpacity={0.85}
              >
                <Check size={18} color={theme.isPremium ? '#0A0A0A' : Colors.white} strokeWidth={2.5} />
                <Text style={[styles.saveBtnText, theme.isPremium && { color: '#0A0A0A' }]}>
                  {saving ? 'Zapisywanie...' : isEditing ? 'Aktualizuj Danie' : 'Zapisz Danie'}
                </Text>
              </TouchableOpacity>

              <View style={{ height: 32 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Quick-add Inventory Sub-Modal ──────────────────────────────────── */}
      <Modal visible={showInvModal} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleCloseInvModal}>
        <SafeAreaView
          style={[styles.modalSafe, theme.isPremium && { backgroundColor: DS.color.bgPrimary }]}
          edges={['top']}
        >
          <View
            style={[
              styles.modalHeader,
              styles.invModalHeader,
              theme.isPremium && {
                backgroundColor: DS.color.bgPrimary,
                borderBottomColor: DS.color.borderSubtle,
              },
            ]}
          >
            <View style={styles.invModalTitleWrap}>
              <View style={[styles.invModalBadge, theme.isPremium && { backgroundColor: DS.color.greenEnd }]}>
                <FlaskConical size={13} color={theme.isPremium ? '#0A0A0A' : Colors.white} strokeWidth={2.5} />
                <Text style={[styles.invModalBadgeText, theme.isPremium && { color: '#0A0A0A' }]}>Nowy produkt</Text>
              </View>
              <Text style={[styles.modalTitle, theme.isPremium && { color: DS.color.heading }]}>Dodaj do Magazynu</Text>
              <Text style={[styles.modalSubtitle, theme.isPremium && { color: DS.color.muted }]}>
                Produkt zostanie automatycznie dodany do receptury
              </Text>
            </View>
            <TouchableOpacity onPress={handleCloseInvModal} style={styles.closeBtn}>
              <X size={20} color={theme.isPremium ? DS.color.muted : Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView contentContainerStyle={styles.formScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              <View style={styles.fieldWrap}>
                <Text style={[styles.fieldLabel, theme.isPremium && { color: DS.color.muted }]}>
                  Nazwa produktu <Text style={{ color: Colors.danger }}>*</Text>
                </Text>
                <TextInput
                  style={[
                    styles.input,
                    theme.isPremium && {
                      backgroundColor: DS.color.bgTertiary,
                      borderColor: DS.color.borderSubtle,
                      color: DS.color.heading,
                    },
                  ]}
                  placeholder="np. Kurczak filet"
                  placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                  value={invForm.name}
                  onChangeText={(v) => setInvForm((f) => ({ ...f, name: v }))}
                  returnKeyType="next"
                />
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Kategoria</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.formCatBar}>
                  {INV_PRESET_CATEGORIES.map((cat) => {
                    const active = invForm.category === cat;
                    const color = INV_CATEGORY_COLORS[cat] ?? Colors.textSecondary;
                    return (
                      <TouchableOpacity
                        key={cat}
                        style={[styles.formCatPill, active && { backgroundColor: color, borderColor: color }]}
                        onPress={() => setInvForm((f) => ({ ...f, category: cat }))}
                        activeOpacity={0.7}
                      >
                        {active && <Check size={11} color={Colors.white} strokeWidth={3} />}
                        <Text style={[styles.formCatText, active && { color: Colors.white, fontWeight: '700' }]}>{cat}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>

              <View style={styles.fieldRow}>
                <View style={[styles.fieldWrap, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>
                    Aktualna ilość <Text style={{ color: Colors.danger }}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="np. 1500"
                    placeholderTextColor={Colors.textTertiary}
                    value={invForm.currentQty}
                    onChangeText={(v) => setInvForm((f) => ({ ...f, currentQty: v }))}
                    keyboardType="decimal-pad"
                    returnKeyType="next"
                  />
                </View>
                <View style={[styles.fieldWrap, { flex: 1 }]}>
                  <Text style={styles.fieldLabel}>
                    Stan krytyczny <Text style={{ color: Colors.danger }}>*</Text>
                  </Text>
                  <TextInput
                    style={styles.input}
                    placeholder="np. 500"
                    placeholderTextColor={Colors.textTertiary}
                    value={invForm.criticalThreshold}
                    onChangeText={(v) => setInvForm((f) => ({ ...f, criticalThreshold: v }))}
                    keyboardType="decimal-pad"
                    returnKeyType="done"
                  />
                </View>
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Jednostka</Text>
                <View style={styles.unitRow}>
                  {INV_UNIT_OPTIONS.map((u) => {
                    const active = invForm.unit === u;
                    return (
                      <TouchableOpacity
                        key={u}
                        style={[styles.unitBtn, active && styles.unitBtnActive]}
                        onPress={() => setInvForm((f) => ({ ...f, unit: u }))}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.unitBtnText, active && styles.unitBtnTextActive]}>{u}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.fieldLabel}>Wielkość porcji w Menu ({invForm.unit})</Text>
                <TextInput
                  style={styles.input}
                  placeholder="np. 200 (opcjonalne)"
                  placeholderTextColor={Colors.textTertiary}
                  value={invForm.portionSize}
                  onChangeText={(v) => setInvForm((f) => ({ ...f, portionSize: v }))}
                  keyboardType="decimal-pad"
                  returnKeyType="done"
                />
              </View>

              <View style={styles.switchRow}>
                <View style={styles.switchInfo}>
                  <FlaskConical size={16} color={Colors.accent} strokeWidth={2} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.switchLabel}>Półprodukt / Combo</Text>
                    <Text style={styles.switchHint}>Produkt przygotowywany wewnętrznie z innych składników</Text>
                  </View>
                </View>
                <Switch
                  value={invForm.isCombo}
                  onValueChange={(v) => setInvForm((f) => ({ ...f, isCombo: v }))}
                  trackColor={{ false: Colors.borderLight, true: Colors.accentLight }}
                  thumbColor={invForm.isCombo ? Colors.accent : Colors.textTertiary}
                />
              </View>

              <TouchableOpacity
                style={[
                  styles.saveBtn,
                  theme.isPremium && { backgroundColor: DS.color.greenEnd, shadowColor: DS.color.greenEnd },
                  invSaving && { opacity: 0.6 },
                ]}
                onPress={handleSaveInventoryItem}
                disabled={invSaving}
                activeOpacity={0.85}
              >
                <Check size={18} color={theme.isPremium ? '#0A0A0A' : Colors.white} strokeWidth={2.5} />
                <Text style={[styles.saveBtnText, theme.isPremium && { color: '#0A0A0A' }]}>
                  {invSaving ? 'Zapisywanie...' : 'Zapisz i Dodaj do Receptury'}
                </Text>
              </TouchableOpacity>

              <View style={{ height: 32 }} />
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>

      {/* ── Menu Scan Modal ─────────────────────────────────────────────────── */}
      <MenuScanModal
        visible={showScanModal}
        onClose={() => setShowScanModal(false)}
        onConfirmed={async () => {
          notifyDocumentScanComplete('menu');
          setRefreshing(true);
          await fetchData();
        }}
      />
      <BatchPrepModal
        visible={!!batchPrepDish}
        dish={batchPrepDish}
        accountKey={accountKey || ''}
        onClose={() => setBatchPrepDish(null)}
      />
      <Suspense fallback={<ActivityIndicator style={{ position: 'absolute', opacity: 0 }} />}>
        {showRecipes ? (
          <RecipesModal
            visible={showRecipes}
            onClose={() => setShowRecipes(false)}
            onUseInMenu={({ dishName, ingredients: ings }) => {
              setEditingDish(null);
              setForm({
                name: dishName,
                category: FORM_CATEGORIES[0],
                price: '',
              });
              setIngredients(
                ings.length > 0
                  ? ings.map((ing) => ({
                      key: secureId('ing'),
                      name: ing.name,
                      quantity: String(normalizeRecipeQuantity(ing.quantity)),
                      unit: normalizeMenuUnit(ing.unit),
                      pieceWeightG: '',
                    }))
                  : [newDraftIngredient()],
              );
              setShowAddModal(true);
            }}
            onAddToInventory={({ dishName, ingredients: ings }) => {
              setPendingIngKey(null);
              const first = ings[0];
              const rawUnit = (first?.unit || 'g').toLowerCase();
              const unitGuess: Unit =
                rawUnit === 'ml' || rawUnit === 'l'
                  ? rawUnit === 'l'
                    ? 'L'
                    : 'ml'
                  : rawUnit === 'kg'
                    ? 'kg'
                    : rawUnit === 'szt'
                      ? 'szt'
                      : rawUnit === 'opak'
                        ? 'opak'
                        : 'g';
              setInvForm({
                name: dishName,
                category: 'Inne',
                currentQty: first && first.quantity > 0 ? String(first.quantity) : '',
                criticalThreshold: '',
                unit: unitGuess,
                isCombo: true,
                portionSize: first && first.quantity > 0 ? String(first.quantity) : '',
              });
              setShowInvModal(true);
            }}
          />
        ) : null}
      </Suspense>
    </SafeAreaView>
  );
}
