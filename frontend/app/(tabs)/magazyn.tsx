import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  RefreshControl,
  ActivityIndicator,
  DeviceEventEmitter,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import {
  Search,
  Trash2,
  X,
  Plus,
  Mic,
  Package,
  ChevronDown,
  ChevronRight,
  Tag,
  FileUp,
} from 'lucide-react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { FlashList } from '@shopify/flash-list';
import { requireTenantAccountKey } from '@/lib/tenantScope';
import * as inventoryService from '@/services/inventoryService';
import { INVENTORY_CHANGED } from '@/services/supplierOrdersService';
import { LoadingScreen, ErrorScreen } from '@/components/LoadingScreen';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { VoiceReportModal } from '@/components/VoiceReportModal';
import { ReportInfoButton } from '@/components/ReportInfoButton';
import { WasteReportModal } from '@/components/WasteReportModal';
import { DealHunterModal } from '@/components/DealHunterModal';
import { AdBannerFooter } from '@/components/ads/AdBannerFooter';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { PremiumTabChrome, premiumSurface } from '@/components/premium/PremiumTabChrome';
import {
  PremiumGlowCta,
  PremiumOutlineBtn,
} from '@/components/premium/PremiumUI';
import { DS } from '@/constants/premiumTheme';
import { convertProduceQty } from '@/lib/produceSizeConverter';
import { normalizeIngredientName } from '@/lib/fuzzyProductMatch';
import { normCategoryName } from '@/lib/warehouseCategories';
import { assignUniqueDishImageSources } from '@/lib/productImages';
import {
  clearProductCustomImage,
  getProductCustomImageSync,
  loadProductCustomImages,
  setProductCustomImage,
  subscribeProductCustomImages,
} from '@/lib/productCustomImages';
import { useAuth } from '@/contexts/AuthContext';
import { usePremiumAlert } from '@/components/PremiumAlert';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { DEAL_HUNTER_GATE_MESSAGE, DEAL_HUNTER_GATE_TITLE } from '@/lib/dealHunterGate';

import type { CategoryRow, ComboIngredientDraft, MagListRow, MockInventoryItem, WasteLogRow } from '@/components/magazyn/types';
import { BLANK_FORM, CAT_AUTO_COLORS, FALLBACK_COLOR } from '@/components/magazyn/constants';
import { getStatus, mapDbRow, newComboIngredient, findExistingWarehouseItem } from '@/components/magazyn/helpers';
import { ItemCard } from '@/components/magazyn/ItemCard';
import { CategorySection, catStyles } from '@/components/magazyn/CategorySection';
import { magazynScreenStyles as styles } from '@/components/magazyn/magazynScreenStyles';
import { buildMagRows } from '@/components/magazyn/buildMagRows';
import { AddCategoryModal } from '@/components/magazyn/AddCategoryModal';
import { MagFab } from '@/components/magazyn/MagFab';
import { ProductFormModal } from '@/components/magazyn/ProductFormModal';

export default function MagazynScreen() {
  const router = useRouter();
  const theme = useAppTheme();
  const { alert: premiumAlert } = usePremiumAlert();
  const { dealHunterUnlocked } = useSubscription();
  const { ready: authReady, isAuthenticated, accountKey } = useAuth();
  const focusParams = useLocalSearchParams<{
    focusProductId?: string | string[];
    focusProductName?: string | string[];
  }>();
  const focusHandledRef = useRef<string | null>(null);
  const [inventory, setInventory] = useState<MockInventoryItem[]>([]);
  const [wasteLogs, setWasteLogs] = useState<WasteLogRow[]>([]);
  const [dbCategories, setDbCategories] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanSyncing, setScanSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState('');
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [showWasteLogs, setShowWasteLogs] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [comboIngredients, setComboIngredients] = useState<ComboIngredientDraft[]>([newComboIngredient()]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const [addingCat, setAddingCat] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [savingCat, setSavingCat] = useState(false);
  const savingCatRef = useRef(false);
  const [showVoiceModal, setShowVoiceModal] = useState(false);
  const { setVoiceOverlay, openDocumentScan, documentScanRevision } = useUiOverlay();

  useEffect(() => {
    setVoiceOverlay(showVoiceModal);
    return () => setVoiceOverlay(false);
  }, [showVoiceModal, setVoiceOverlay]);

  const [orderProduct, setOrderProduct] = useState<MockInventoryItem | null>(null);
  const [customImageTick, setCustomImageTick] = useState(0);
  const [photoSaving, setPhotoSaving] = useState(false);

  useEffect(() => {
    void loadProductCustomImages().then(() => setCustomImageTick((t) => t + 1));
    return subscribeProductCustomImages(() => setCustomImageTick((t) => t + 1));
  }, [accountKey]);

  /** Unikalne miniatury katalogu — bez powtórzeń tej samej ikony w liście. */
  const libraryThumbByName = useMemo(() => {
    const items = inventory.map((i) => ({ name: i.product_name, category: i.category }));
    const assigned = assignUniqueDishImageSources(items);
    const map = new Map<string, number | { uri: string }>();
    for (const [name, a] of assigned) {
      if (a.source) map.set(name, a.source);
    }
    return map;
  }, [inventory]);

  const saveProductPhotoWebP = useCallback(
    async (itemId: string, sourceUri: string) => {
      setPhotoSaving(true);
      try {
        await setProductCustomImage(itemId, sourceUri);
      } catch (e: any) {
        premiumAlert('Nie udało się zapisać', e?.message || 'Kompresja WebP nie powiodła się.');
      } finally {
        setPhotoSaving(false);
      }
    },
    [premiumAlert],
  );

  const handleChangeProductPhoto = useCallback(
    (item: MockInventoryItem) => {
      const hasCustom = !!getProductCustomImageSync(item.id);
      premiumAlert('Zmień zdjęcie', item.product_name, [
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
            await saveProductPhotoWebP(item.id, r.assets[0].uri);
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
            await saveProductPhotoWebP(item.id, r.assets[0].uri);
          },
        },
        ...(hasCustom
          ? [
              {
                text: 'Przywróć z biblioteki',
                style: 'destructive' as const,
                onPress: () => {
                  void clearProductCustomImage(item.id);
                },
              },
            ]
          : []),
        { text: 'Anuluj', style: 'cancel' as const },
      ]);
    },
    [premiumAlert, saveProductPhotoWebP],
  );

  // ── Data fetching ────────────────────────────────────────────────────────────────────────

  const fetchData = useCallback(async (opts?: { fast?: boolean }) => {
    // Czekaj na sesję — inaczej pierwsze query idzie na account_key=default (całe demo, 20–30s).
    if (!authReady || !isAuthenticated || !accountKey || accountKey === 'default') {
      return;
    }
    const ak = accountKey;
    const fast = !!opts?.fast;
    try {
      const dataPromise = inventoryService.fetchWarehouseData(ak);
      if (fast) {
        void inventoryService.seedWarehouse(ak, true);
      } else {
        void inventoryService.seedWarehouse(ak, false);
      }
      const { items, categories, wasteLogs } = await dataPromise;
      setInventory(items.map(mapDbRow));
      setDbCategories(categories as CategoryRow[]);
      setWasteLogs(wasteLogs as WasteLogRow[]);
      setError(null);
    } catch (e: any) {
      setError(e.message ?? 'Nieznany błąd');
    } finally {
      setLoading(false);
      setRefreshing(false);
      setScanSyncing(false);
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

  useEffect(() => {
    if (documentScanRevision > 0) {
      setScanSyncing(true);
      setRefreshing(true);
      void fetchData({ fast: true });
    }
  }, [documentScanRevision, fetchData]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(INVENTORY_CHANGED, () => {
      void fetchData({ fast: true });
    });
    return () => sub.remove();
  }, [fetchData]);

  const onRefresh = () => { setRefreshing(true); void fetchData(); };

  // ── Category derived data ───────────────────────────────────────────────────────────────

  const categoryColorMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    dbCategories.forEach((c) => { map[c.name] = c.color; });
    return map;
  }, [dbCategories]);

  const categoryIdMap = useMemo<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    // Pierwszy wpis wygrywa — po dedupe nazwy są unikalne; przy race bierzemy stabilnie pierwsze id.
    dbCategories.forEach((c) => {
      if (!map[c.name]) map[c.name] = c.id;
    });
    return map;
  }, [dbCategories]);

  const uniqueCategories = useMemo<CategoryRow[]>(() => {
    const seen = new Set<string>();
    const out: CategoryRow[] = [];
    for (const c of dbCategories) {
      const key = normCategoryName(c.name);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
    return out;
  }, [dbCategories]);

  const categoryProductCounts = useMemo<Record<string, number>>(() => {
    const counts: Record<string, number> = {};
    inventory.forEach((item) => {
      const key = item.category_id
        ? (uniqueCategories.find((c) => c.id === item.category_id)?.name ?? item.category)
        : item.category;
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [inventory, uniqueCategories]);

  const formCategories = useMemo<string[]>(() => {
    return [...uniqueCategories]
      .sort((a, b) => {
        const diff = (categoryProductCounts[b.name] ?? 0) - (categoryProductCounts[a.name] ?? 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name, 'pl');
      })
      .map((c) => c.name);
  }, [uniqueCategories, categoryProductCounts]);

  useEffect(() => {
    if (formCategories.length > 0 && !form.category) {
      setForm((f) => ({ ...f, category: formCategories[0] }));
    }
  }, [formCategories]);

  const magRows = useMemo(
    () =>
      buildMagRows({
        inventory,
        search,
        uniqueCategories,
        dbCategoriesLength: dbCategories.length,
        expandedCategories,
      }),
    [inventory, search, uniqueCategories, dbCategories.length, expandedCategories],
  );

  const totalCritical = useMemo(() => inventory.filter((i) => getStatus(i) === 'critical').length, [inventory]);

  // ── Category management ───────────────────────────────────────────────────────────────

  const handleAddCategory = async () => {
    if (savingCatRef.current) return;
    const name = newCatName.trim();
    if (!name) return;
    const dup = uniqueCategories.find((c) => normCategoryName(c.name) === normCategoryName(name));
    if (dup) {
      premiumAlert('Kategoria istnieje', `Masz już kategorię „${dup.name}". Wybierz ją z listy zamiast tworzyć duplikat.`);
      setForm((f) => ({ ...f, category: dup.name }));
      setNewCatName('');
      setAddingCat(false);
      return;
    }
    savingCatRef.current = true;
    setSavingCat(true);
    const usedColors = dbCategories.map((c) => c.color);
    const color = CAT_AUTO_COLORS.find((c) => !usedColors.includes(c))
      ?? CAT_AUTO_COLORS[dbCategories.length % CAT_AUTO_COLORS.length];
    const maxOrder = dbCategories.reduce((m, c) => Math.max(m, (c as any).sort_order ?? 0), 0);
    if (!accountKey || accountKey === 'default') {
      premiumAlert('Konto', 'Brak konta użytkownika — wyloguj się i zaloguj ponownie.');
      savingCatRef.current = false;
      setSavingCat(false);
      return;
    }
    const { data: newCat, error } = await inventoryService.insertCategory({
      name, color, sortOrder: maxOrder + 10, accountKey,
    });
    savingCatRef.current = false;
    setSavingCat(false);
    if (error) {
      const msg = error.message || '';
      if (/duplicate|unique|23505/i.test(msg)) {
        premiumAlert('Kategoria istnieje', 'Kategoria o tej nazwie już jest na koncie.');
        fetchData();
        return;
      }
      premiumAlert(
        'Błąd',
        /row-level security|RLS/i.test(msg)
          ? 'Brak uprawnień do kategorii. Wyloguj się i zaloguj ponownie. Jeśli problem wraca — skontaktuj się z supportem.'
          : msg,
      );
      return;
    }
    setNewCatName('');
    setAddingCat(false);
    if (newCat) {
      setDbCategories((prev) => [...prev, newCat as CategoryRow]);
      setExpandedCategories((prev) => new Set([...prev, name]));
      setForm((f) => ({ ...f, category: name }));
    } else {
      fetchData();
    }
  };

  const handleDeleteCategory = (cat: CategoryRow) => {
    const count = categoryProductCounts[cat.name] ?? 0;
    const msg = count > 0
      ? `Ta kategoria zawiera ${count} ${count === 1 ? 'produkt' : 'produktów'}. Po usunięciu produkty pozostaną bez kategorii.`
      : 'Czy na pewno chcesz usunąć tę kategorię?';
    premiumAlert('Usuń kategorię', msg, [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń', style: 'destructive',
        onPress: async () => {
          const { error } = await inventoryService.deleteCategory(cat.id, accountKey || undefined);
          if (error) premiumAlert('Błąd', error.message);
          else {
            setDbCategories((prev) => prev.filter((c) => c.id !== cat.id));
            setExpandedCategories((prev) => {
              const next = new Set(prev);
              next.delete(cat.name);
              return next;
            });
            // Produkty zostają — odśwież listę (mogą wpaść do „Bez kategorii”).
            void fetchData();
          }
        },
      },
    ]);
  };

  const handlePressItem = (item: MockInventoryItem) => {
    router.push({ pathname: '/product-suppliers', params: { productId: item.id, productName: item.product_name } });
  };

  // Deep-link z alertów Premium (Finanse → Magazyn → szczegóły produktu)
  useEffect(() => {
    const rawId = focusParams.focusProductId;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    if (!id || loading) return;
    if (focusHandledRef.current === id) return;

    const rawName = focusParams.focusProductName;
    const nameParam = Array.isArray(rawName) ? rawName[0] : rawName;
    const fromList = inventory.find((i) => i.id === id);
    focusHandledRef.current = id;

    if (fromList) {
      handlePressItem(fromList);
      return;
    }
    if (nameParam) {
      router.push({
        pathname: '/product-suppliers',
        params: { productId: id, productName: nameParam },
      });
    }
  }, [focusParams.focusProductId, focusParams.focusProductName, loading, inventory]);

  const handleOrderItem = (item: MockInventoryItem) => {
    // Półprodukty nie zamawiamy u dostawcy — otwieramy edycję/recepturę doróbki.
    if (item.is_combo_półprodukt) {
      openEditItem(item);
      return;
    }
    // Free / tier 1 bez trialu → tylko PremiumAlert, bez flow Łowcy
    if (!dealHunterUnlocked) {
      premiumAlert(DEAL_HUNTER_GATE_TITLE, DEAL_HUNTER_GATE_MESSAGE);
      return;
    }
    setOrderProduct(item);
  };

  const handleDeleteItem = (item: MockInventoryItem) => {
    premiumAlert(
      'Usuń produkt',
      `Czy na pewno chcesz usunąć "${item.product_name}"?`,
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń', style: 'destructive',
          onPress: async () => {
            try {
              await inventoryService.softDeleteItem(item.id, accountKey || undefined);
            } catch (e: any) {
              premiumAlert('Błąd', e?.message ?? 'Nie udało się usunąć.');
              return;
            }
            setInventory((prev) => prev.filter((i) => i.id !== item.id));
          },
        },
      ],
    );
  };

  function toggleCategory(catName: string) {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(catName)) next.delete(catName);
      else next.add(catName);
      return next;
    });
  }

  const renderMagRow = useCallback(
    ({ item }: { item: MagListRow }) => {
      switch (item.type) {
        case 'search_meta':
          return (
            <Text style={[styles.searchResultLabel, theme.isPremium && { color: theme.textMuted }]}>
              {item.count} wyników dla "{item.q}"
            </Text>
          );
        case 'search_empty':
          return (
            <View style={styles.emptyWrap}>
              <Package size={36} color={theme.isPremium ? theme.textMuted : Colors.textTertiary} strokeWidth={1.5} />
              <Text style={[styles.emptyTitle, theme.isPremium && { color: theme.text }]}>Brak wyników</Text>
              <Text style={[styles.emptyText, theme.isPremium && { color: theme.textSecondary }]}>
                Brak produktów pasujących do "{item.q}"
              </Text>
            </View>
          );
        case 'search_item':
          return (
            <ItemCard
              item={item.item}
              catColor={categoryColorMap[item.item.category] ?? FALLBACK_COLOR}
              libraryThumb={libraryThumbByName.get(item.item.product_name)}
              photoTick={customImageTick}
              onChangePhoto={handleChangeProductPhoto}
              onDelete={() => handleDeleteItem(item.item)}
              onPress={() => handlePressItem(item.item)}
              onOrder={() => handleOrderItem(item.item)}
              onEdit={() => openEditItem(item.item)}
            />
          );
        case 'cat_toolbar':
          return (
            <View style={styles.catSectionHeader}>
              <Tag size={12} color={theme.isPremium ? DS.color.muted : Colors.textSecondary} strokeWidth={2} />
              <Text
                style={[
                  styles.catSectionTitle,
                  theme.isPremium && {
                    color: DS.color.muted,
                    fontSize: 11,
                    letterSpacing: 0.7,
                    textTransform: 'uppercase',
                  },
                ]}
                allowFontScaling={false}
              >
                Kategorie produktów
              </Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity
                style={[styles.addCatBtnWrap, theme.isPremium && DS.shadow.greenGlow]}
                onPress={() => setAddingCat(true)}
                activeOpacity={0.8}
              >
                {theme.isPremium ? (
                  <LinearGradient
                    colors={[...DS.gradient.green]}
                    start={{ x: 0, y: 0.2 }}
                    end={{ x: 1, y: 0.8 }}
                    style={styles.addCatBtn}
                  >
                    <Plus size={12} color="#0A0A0A" strokeWidth={2.5} />
                    <Text style={styles.addCatBtnTextPrem} allowFontScaling={false}>Dodaj kategorię</Text>
                  </LinearGradient>
                ) : (
                  <View style={[styles.addCatBtn, { backgroundColor: Colors.accentLight }]}>
                    <Plus size={13} color={Colors.accent} strokeWidth={2.5} />
                    <Text style={styles.addCatBtnText}>Dodaj kategorię</Text>
                  </View>
                )}
              </TouchableOpacity>
            </View>
          );
        case 'mag_empty':
          return (
            <View style={styles.emptyWrap}>
              <Package size={40} color={theme.isPremium ? theme.textMuted : Colors.textTertiary} strokeWidth={1.5} />
              <Text style={[styles.emptyTitle, theme.isPremium && { color: theme.text }]}>Magazyn jest pusty</Text>
              <Text style={styles.emptyText}>Dodaj pierwszą kategorię, a następnie produkty.</Text>
            </View>
          );
        case 'cat_header':
          return (
            <CategorySection
              category={item.cat}
              itemCount={item.itemCount}
              criticalCount={item.criticalCount}
              warningCount={item.warningCount}
              isExpanded={expandedCategories.has(item.cat.name)}
              onToggle={() => toggleCategory(item.cat.name)}
              onDelete={() => handleDeleteCategory(item.cat)}
            />
          );
        case 'cat_item':
          return (
            <ItemCard
              item={item.item}
              catColor={item.catColor}
              libraryThumb={libraryThumbByName.get(item.item.product_name)}
              photoTick={customImageTick}
              onChangePhoto={handleChangeProductPhoto}
              onDelete={() => handleDeleteItem(item.item)}
              onPress={() => handlePressItem(item.item)}
              onOrder={() => handleOrderItem(item.item)}
              onEdit={() => openEditItem(item.item)}
            />
          );
        case 'cat_empty':
          return (
            <View style={catStyles.emptyBody}>
              <Text style={[catStyles.emptyBodyText, theme.isPremium && { color: DS.color.muted }]}>
                Brak produktów w tej kategorii
              </Text>
            </View>
          );
        case 'uncat_header':
          return (
            <View style={catStyles.section}>
              <TouchableOpacity
                style={catStyles.header}
                onPress={() => toggleCategory('__uncategorized__')}
                activeOpacity={0.75}
              >
                <View style={[catStyles.colorBar, { backgroundColor: FALLBACK_COLOR }]} />
                <View style={catStyles.headerContent}>
                  <View style={catStyles.headerLeft}>
                    <Text style={catStyles.catName}>Bez kategorii</Text>
                    <Text style={catStyles.totalCount}>{item.itemCount} produktów</Text>
                  </View>
                  <View style={catStyles.headerRight}>
                    {expandedCategories.has('__uncategorized__')
                      ? <ChevronDown size={18} color={Colors.textSecondary} strokeWidth={2} />
                      : <ChevronRight size={18} color={Colors.textSecondary} strokeWidth={2} />}
                  </View>
                </View>
              </TouchableOpacity>
            </View>
          );
        case 'uncat_item':
          return (
            <ItemCard
              item={item.item}
              catColor={FALLBACK_COLOR}
              libraryThumb={libraryThumbByName.get(item.item.product_name)}
              photoTick={customImageTick}
              onChangePhoto={handleChangeProductPhoto}
              onDelete={() => handleDeleteItem(item.item)}
              onPress={() => handlePressItem(item.item)}
              onOrder={() => handleOrderItem(item.item)}
              onEdit={() => openEditItem(item.item)}
            />
          );
        default:
          return null;
      }
    },
    [
      theme,
      categoryColorMap,
      expandedCategories,
      libraryThumbByName,
      customImageTick,
      handleChangeProductPhoto,
    ],
  );

  // ── Auto-unlock offer items ────────────────────────────────────────────────────────────

  async function autoUnlockOfferItems(newItemId: string, newItemName: string) {
    await inventoryService.autoUnlockOfferItems(accountKey, newItemId, newItemName);
  }

  // ── Save product ───────────────────────────────────────────────────────────────────────

  async function handleSave() {
    if (!form.name.trim()) { premiumAlert('Wymagane pole', 'Podaj nazwę produktu.'); return; }
    const currentQty = parseFloat(form.currentQty);
    const criticalThreshold = parseFloat(form.criticalThreshold);
    if (isNaN(currentQty) || currentQty < 0) { premiumAlert('Błąd', 'Aktualna ilość musi być liczbą nieujemną.'); return; }
    if (isNaN(criticalThreshold) || criticalThreshold <= 0) {
      premiumAlert(
        'Ustaw próg krytyczny',
        'Stan krytyczny musi być liczbą większą od zera — bez niego aplikacja nie wie, kiedy ostrzec o braku produktu.',
      );
      return;
    }
    let safetyBuffer = parseFloat(form.safetyBuffer);
    if (isNaN(safetyBuffer)) safetyBuffer = 20;
    if (safetyBuffer < 10) safetyBuffer = 10;
    if (safetyBuffer > 200) safetyBuffer = 200;
    let optimalThreshold: number | null = null;
    if (form.optimalThreshold.trim()) {
      const o = parseFloat(form.optimalThreshold);
      if (isNaN(o) || o < 0) {
        premiumAlert('Próg optymalny', 'Próg optymalny musi być liczbą ≥ 0 (albo zostaw puste).');
        return;
      }
      if (o > 0 && o < criticalThreshold) {
        premiumAlert(
          'Próg optymalny',
          'Próg optymalny powinien być ≥ stanu krytycznego (albo pusty — wtedy system wyliczy go z bufora).',
        );
        return;
      }
      optimalThreshold = o > 0 ? o : null;
    }
    setSaving(true);
    try {
      const nameTrim = form.name.trim();
      const dup = findExistingWarehouseItem(inventory, nameTrim, editingId);
      if (dup && !editingId) {
        let addQty = currentQty;
        if (dup.unit !== form.unit) {
          const converted = convertProduceQty(currentQty, form.unit, dup.unit, dup.product_name || nameTrim);
          if (converted == null) {
            premiumAlert(
              'Produkt już istnieje',
              `W magazynie jest już „${dup.product_name}” (${dup.unit}). Edytuj ten wpis — nie da się automatycznie dodać ${form.unit} do ${dup.unit}.`,
            );
            setSaving(false);
            return;
          }
          addQty = converted;
        }
        const mergedQty = (dup.current_qty || 0) + addQty;
        const row = await inventoryService.saveInventoryItem({
          payload: { quantity: mergedQty },
          editingId: dup.id,
          ak: requireTenantAccountKey(),
        });
        const mapped = mapDbRow(row);
        setInventory((prev) => prev.map((i) => (i.id === dup.id ? mapped : i)));
        premiumAlert(
          'Scalono z istniejącym',
          `„${nameTrim}” to to samo co „${dup.product_name}”. Stan: ${dup.current_qty} → ${mergedQty} ${dup.unit}.`,
        );
        setForm({ ...BLANK_FORM, category: formCategories[0] ?? '' });
        setComboIngredients([newComboIngredient()]);
        setEditingId(null);
        setShowAddModal(false);
        setSaving(false);
        return;
      }

      const isPiece = form.unit === 'szt' || form.unit === 'opak';
      const uwv = isPiece && form.unitWeightVolume.trim() ? parseFloat(form.unitWeightVolume) : null;
      let shelfLifeDays: number | null = null;
      if (form.isCombo && form.shelfLifeDays.trim()) {
        const d = parseInt(form.shelfLifeDays, 10);
        if (!isNaN(d) && d > 0) shelfLifeDays = d;
      }
      const ak = requireTenantAccountKey();
      const payload: any = {
        name: normalizeIngredientName(nameTrim) || nameTrim,
        variant: form.variant.trim() || null,
        category_id: categoryIdMap[form.category] ?? null,
        quantity: currentQty,
        unit: form.unit,
        min_quantity: criticalThreshold,
        optimal_quantity: optimalThreshold,
        is_combo_polprodukt: form.isCombo,
        safety_buffer_percent: safetyBuffer,
        shelf_life_days: form.isCombo ? shelfLifeDays : null,
        unit_cost: 0,
        unit_weight_volume: uwv && !isNaN(uwv) ? uwv : null,
        weight_volume_unit: uwv && !isNaN(uwv) ? form.weightVolumeUnit : null,
        account_key: ak,
      };
      const row = await inventoryService.saveInventoryItem({ payload, editingId, ak });

      // Persist combo recipe (best-effort if tabela jeszcze nie zmigrowana)
      const itemId = row.id as string;
      try {
        const rows = form.isCombo
          ? comboIngredients
              .filter((i) => i.name.trim())
              .map((ing, idx) => {
                const matchId =
                  ing.warehouse_product_id ||
                  inventory.find(
                    (p) =>
                      p.id !== itemId &&
                      normCategoryName(p.product_name) === normCategoryName(ing.name),
                  )?.id ||
                  null;
                return {
                  inventory_item_id: itemId,
                  ingredient_name: ing.name.trim(),
                  quantity: parseFloat(ing.quantity) || 0,
                  unit: ing.unit || 'g',
                  warehouse_product_id: matchId,
                  sort_order: idx,
                  account_key: ak,
                };
              })
          : [];
        await inventoryService.replaceComboIngredients(itemId, rows);
      } catch (comboEx: any) {
        if (!/does not exist|schema cache|relation/i.test(comboEx?.message ?? '')) {
          throw comboEx;
        }
      }

      const mapped = mapDbRow(row);
      if (editingId) {
        setInventory((prev) => prev.map((i) => (i.id === editingId ? mapped : i)));
      } else {
        setInventory((prev) => [...prev, mapped]);
        await autoUnlockOfferItems(row.id, row.name);
      }
      if (form.category) {
        setExpandedCategories((prev) => new Set([...prev, form.category]));
      }
      setForm({ ...BLANK_FORM, category: formCategories[0] ?? '' });
      setComboIngredients([newComboIngredient()]);
      setEditingId(null);
      setShowAddModal(false);
    } catch (e: any) {
      premiumAlert('Błąd zapisu', e.message ?? 'Nieznany błąd');
    } finally {
      setSaving(false);
    }
  }

  function handleCloseAddModal() {
    setForm({ ...BLANK_FORM, category: formCategories[0] ?? '' });
    setComboIngredients([newComboIngredient()]);
    setEditingId(null);
    setShowAddModal(false);
  }

  async function openEditItem(item: MockInventoryItem) {
    setEditingId(item.id);
    setForm({
      ...BLANK_FORM,
      name: item.product_name,
      variant: item.variant ?? '',
      category: item.category || (formCategories[0] ?? ''),
      currentQty: String(item.current_qty),
      criticalThreshold: String(item.critical_threshold),
      optimalThreshold: item.optimal_threshold > 0 ? String(item.optimal_threshold) : '',
      unit: item.unit,
      isCombo: item.is_combo_półprodukt,
      safetyBuffer: String(item.safety_buffer_percent ?? 20),
      shelfLifeDays: item.shelf_life_days != null && item.shelf_life_days > 0 ? String(item.shelf_life_days) : '',
    });
    setComboIngredients([newComboIngredient()]);
    setShowAddModal(true);
    if (item.is_combo_półprodukt) {
      try {
        const data = await inventoryService.fetchComboIngredients(item.id);
        if (data.length) {
          setComboIngredients(
            data.map((r: any) => ({
              key: r.id,
              name: r.ingredient_name ?? '',
              quantity: r.quantity != null ? String(r.quantity) : '',
              unit: r.unit || 'g',
              warehouse_product_id: r.warehouse_product_id ?? null,
            })),
          );
        }
      } catch {
        /* tabela może jeszcze nie istnieć */
      }
    }
  }

  const surf = premiumSurface(theme);

  if (loading) return <LoadingScreen />;
  if (error) return <ErrorScreen message={error} />;

  const headerActions = (
    <View style={{ flexDirection: 'row', gap: 8, width: '100%' }}>
      <View style={{ flex: 1 }}>
        <PremiumOutlineBtn
          label="+ Dodaj produkt"
          onPress={() => setShowAddModal(true)}
          tone="green"
          size="lg"
          fullWidth
        />
      </View>
      <View style={{ flex: 1 }}>
        <PremiumOutlineBtn
          label="Zgłoś stratę/licznik"
          onPress={() => setShowWasteLogs(true)}
          tone="red"
          size="lg"
          fullWidth
          icon={<Trash2 size={14} color="#0A0A0A" strokeWidth={2} />}
        />
      </View>
    </View>
  );

  const actionButtons = theme.isPremium ? (
    <View style={styles.actionBtnsWrap}>
      <PremiumGlowCta
        label="Zgłoś informację"
        onPress={() => setShowVoiceModal(true)}
        icon={<Mic size={16} color="#0A0A0A" strokeWidth={2.5} />}
      />
      <View style={{ height: 12 }} />
      <PremiumOutlineBtn
        label="Wgraj fakturę"
        onPress={() => openDocumentScan('invoice')}
        tone="green"
        fullWidth
        icon={<FileUp size={13} color={DS.color.greenEnd} strokeWidth={2} />}
      />
    </View>
  ) : (
    <View style={styles.actionBtnsWrap}>
      <View style={styles.actionBtnsRow}>
        <TouchableOpacity
          style={[styles.magPillBtn, { backgroundColor: '#8B5CF6', shadowColor: '#8B5CF6' }]}
          onPress={() => setShowAddModal(true)}
          activeOpacity={0.85}
        >
          <View style={styles.magPillIcon}>
            <Plus size={14} color={Colors.white} strokeWidth={2.5} />
          </View>
          <Text style={[styles.magPillText, { color: Colors.white }]}>Dodaj produkt</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.magPillBtn, { backgroundColor: '#8B5CF6', shadowColor: '#8B5CF6' }]}
          onPress={() => setShowWasteLogs(true)}
          activeOpacity={0.85}
        >
          <View style={styles.magPillIcon}>
            <Trash2 size={14} color={Colors.white} strokeWidth={2.5} />
          </View>
          <Text style={[styles.magPillText, { color: Colors.white }]}>Zgłoś straty</Text>
        </TouchableOpacity>
        <ReportInfoButton contextHint="Magazyn" onApplied={fetchData} testID="magazyn-report-info" />
        <TouchableOpacity
          style={[styles.magPillBtn, { backgroundColor: Colors.success, shadowColor: Colors.success }]}
          onPress={() => openDocumentScan('invoice')}
          activeOpacity={0.85}
        >
          <View style={styles.magPillIcon}>
            <FileUp size={14} color={Colors.white} strokeWidth={2.5} />
          </View>
          <Text style={[styles.magPillText, { color: Colors.white }]}>Wgraj fakturę</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  const searchBar = (
    <View style={[styles.searchWrap, surf.search, theme.isPremium && { marginBottom: 8 }]}>
      <Search size={16} color={theme.isPremium ? theme.textSecondary : Colors.textSecondary} strokeWidth={2} />
      <TextInput
        style={[styles.searchInput, theme.isPremium && { color: theme.text }]}
        placeholder="Szukaj produktu lub kategorii..."
        placeholderTextColor={theme.isPremium ? theme.textMuted : Colors.textTertiary}
        value={search}
        onChangeText={setSearch}
        clearButtonMode="while-editing"
        autoCorrect={false}
        autoCapitalize="none"
      />
      {search.length > 0 && (
        <TouchableOpacity onPress={() => setSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <X size={14} color={theme.isPremium ? theme.textSecondary : Colors.textSecondary} strokeWidth={2} />
        </TouchableOpacity>
      )}
    </View>
  );

  const body = (
    <>
      {!theme.isPremium ? (
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: Colors.textPrimary }]}>Magazyn</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>
              {inventory.length} produktów
              {totalCritical > 0 ? ` · ${totalCritical} alarmów` : ' · Stan OK'}
            </Text>
          </View>
        </View>
      ) : null}

      {/* Free: kafle akcji + search nad listą (bez sticky chrome) */}
      {!theme.isPremium ? (
        <>
          {actionButtons}
          {searchBar}
        </>
      ) : null}

      {/* Main content — FlashList recycles rows + images stay on disk cache */}
      <FlashList
        data={magRows}
        extraData={`${expandedCategories.size}:${customImageTick}:${libraryThumbByName.size}`}
        keyExtractor={(row, index) => {
          switch (row.type) {
            case 'search_item': return `si-${row.item.id}`;
            case 'cat_header': return `ch-${row.cat.id}`;
            case 'cat_item': return `ci-${row.item.id}`;
            case 'cat_empty': return `ce-${row.catId}`;
            case 'uncat_header': return 'uncat-h';
            case 'uncat_item': return `ui-${row.item.id}`;
            case 'search_meta': return 'search-meta';
            case 'search_empty': return 'search-empty';
            case 'cat_toolbar': return 'cat-toolbar';
            case 'mag_empty': return 'mag-empty';
            default: return `row-${index}`;
          }
        }}
        renderItem={renderMagRow}
        getItemType={(row) => row.type}
        drawDistance={480}
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={theme.isPremium ? theme.accent : Colors.accent} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          theme.isPremium ? (
            <>
              {actionButtons}
              {searchBar}
            </>
          ) : null
        }
        ListFooterComponent={
          <>
            <View style={{ height: 120 }} />
            <AdBannerFooter />
          </>
        }
      />

      {/* FAB stack — ukryty w premium (dodawanie z nagłówka) */}
      {!theme.isPremium && (
        <MagFab
          onAddProduct={() => setShowAddModal(true)}
          onMic={() => setShowVoiceModal(true)}
        />
      )}

      <ProductFormModal
        visible={showAddModal}
        editingId={editingId}
        form={form}
        setForm={setForm}
        comboIngredients={comboIngredients}
        setComboIngredients={setComboIngredients}
        formCategories={formCategories}
        categoryColorMap={categoryColorMap}
        categoryProductCounts={categoryProductCounts}
        uniqueCategories={uniqueCategories}
        categoryIdMap={categoryIdMap}
        inventory={inventory}
        saving={saving}
        onSave={handleSave}
        onClose={handleCloseAddModal}
        onDeleteCategory={handleDeleteCategory}
      />

      {/* Waste Report Modal — ręczne zgłaszanie + logi okresowe */}
      <WasteReportModal
        visible={showWasteLogs}
        onClose={() => setShowWasteLogs(false)}
        onSaved={fetchData}
      />

      {/* Voice Report Modal */}
      {showVoiceModal ? (
        <VoiceReportModal
          visible={showVoiceModal}
          onClose={() => setShowVoiceModal(false)}
          onApplied={() => {
            void fetchData();
          }}
          contextHint="Magazyn"
        />
      ) : null}

      {/* Deal Hunter (Łowca Okazji) — porównanie ofert i zamówienie */}
      <DealHunterModal
        visible={orderProduct !== null}
        product={orderProduct}
        restaurantName="Gastro Manager"
        onClose={() => setOrderProduct(null)}
      />

      <AddCategoryModal
        visible={addingCat}
        newCatName={newCatName}
        onChangeName={setNewCatName}
        savingCat={savingCat}
        onSave={handleAddCategory}
        onClose={() => { setAddingCat(false); setNewCatName(''); }}
      />
    </>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: theme.bg }]} edges={['top']}>
      {theme.isPremium ? (
        <PremiumTabChrome
          title="Magazyn"
          subtitle="Panel magazynowy"
          meta={`${inventory.length} produktów${totalCritical > 0 ? ` · ${totalCritical} alertów` : ' · Stan OK'}`}
          showFloats={false}
          headerVariant="centered"
          belowHeader={
            <View style={styles.actionBtnsWrap}>{headerActions}</View>
          }
        >
          {body}
        </PremiumTabChrome>
      ) : (
        body
      )}
      {photoSaving ? (
        <View style={styles.scanSyncOverlay} pointerEvents="auto" testID="product-photo-webp-loader">
          <View style={styles.scanSyncCard}>
            <ActivityIndicator size="large" color={DS.color.greenEnd} />
            <Text style={styles.scanSyncTitle}>Kompresuję zdjęcie do WebP…</Text>
            <Text style={styles.scanSyncSub}>Zapisuję miniaturę produktu</Text>
          </View>
        </View>
      ) : null}
      {scanSyncing ? (
        <View style={styles.scanSyncOverlay} pointerEvents="auto">
          <View style={styles.scanSyncCard}>
            <ActivityIndicator size="large" color={DS.color.greenEnd} />
            <Text style={styles.scanSyncTitle}>Zapisywanie produktów…</Text>
            <Text style={styles.scanSyncSub}>Odświeżam magazyn — chwilkę…</Text>
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
}
