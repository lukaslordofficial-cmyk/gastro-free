import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
  Switch,
} from 'react-native';
import {
  ChevronDown,
  ChevronRight,
  Link,
  Link2Off,
  Barcode,
  Check,
  Save,
  X,
  Plus,
  Trash2,
} from 'lucide-react-native';
import { secureId } from '@/lib/secureId';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { emitRecipeIngredientsChanged } from '@/lib/recipeSync';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { bestProductMatch, ingredientDedupeKey } from '@/lib/fuzzyProductMatch';
import { normalizeRecipeQuantity, parseOptionalPieceWeightG } from '@/lib/recipeUnits';
import { claimLegacyStorageKey, tenantStorageKey } from '@/lib/tenantStorage';
import { usePremiumAlert } from '@/components/PremiumAlert';
import {
  deleteRecipeIngredientIds,
  fetchRecipeRowsForMenuItem,
  insertRecipeIngredientRow,
  persistWarehouseProductLink,
  replaceMenuItemRecipe,
  saveMenuItemPosId,
  setMenuItemAvailable,
  updateRecipeIngredientRow,
} from '@/services/menuRecipeService';

const RECIPE_WH_MAP_LEGACY = '@gm/recipe_wh_map';
const RECIPE_WH_MAP_PREFIX = '@gm/recipe_wh_map_v2:';
const UNIT_OPTIONS = ['g', 'ml', 'szt', 'kg', 'L'] as const;
const PIECE_WEIGHT_HINT =
  'Pole nieobowiązkowe — wpisz, jeśli ten produkt kupujesz u dostawcy na wagę. Dzięki temu możliwe będzie monitorowanie stanu tego produktu na magazynie.';

function recipeWhMapKey(): string {
  return tenantStorageKey(RECIPE_WH_MAP_PREFIX);
}

async function loadSoftMap(): Promise<Record<string, string>> {
  try {
    const key = recipeWhMapKey();
    let raw = await AsyncStorage.getItem(key);
    if (raw == null) {
      raw = await claimLegacyStorageKey(
        (k) => AsyncStorage.getItem(k),
        (k, v) => AsyncStorage.setItem(k, v),
        (k) => AsyncStorage.removeItem(k),
        RECIPE_WH_MAP_LEGACY,
        key,
      );
    }
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function saveSoftMap(map: Record<string, string>) {
  await AsyncStorage.setItem(recipeWhMapKey(), JSON.stringify(map));
}

function normName(s: string) {
  return ingredientDedupeKey(s) || (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MenuItemForMapping {
  id: string;
  name: string;
  category: string | null;
  price_pln: number | null;
  pos_id: string | null;
  is_available?: boolean;
  /** Składniki z receptury (zagnieżdżone z menu_items) — podgląd gramatur */
  recipeIngredients?: RecipeIngredientRow[];
}

export interface RecipeIngredientRow {
  id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  piece_weight_g?: number | null;
  warehouse_product_id: string | null;
  warehouse_product_name?: string | null;
  in_stock?: boolean;
  stock_qty?: number;
}

export interface InventoryItemForRecipe {
  id: string;
  name: string;
  unit: string;
  quantity?: number;
  min_quantity?: number;
  category_name?: string | null;
}

type EditableIngredient = {
  key: string;
  id: string | null;
  name: string;
  quantity: string;
  unit: string;
  pieceWeightG: string;
  warehouse_product_id: string | null;
  warehouse_product_name?: string | null;
  in_stock?: boolean;
  stock_qty?: number;
};

interface Props {
  menuItem: MenuItemForMapping;
  inventoryItems: InventoryItemForRecipe[];
  onChanged: () => void;
}

function toEditable(rows: RecipeIngredientRow[]): EditableIngredient[] {
  return rows.map((r) => ({
    key: r.id,
    id: r.id,
    name: r.ingredient_name,
    quantity: String(r.quantity ?? 0),
    unit: r.unit || 'g',
    pieceWeightG: r.piece_weight_g != null ? String(r.piece_weight_g) : '',
    warehouse_product_id: r.warehouse_product_id,
    warehouse_product_name: r.warehouse_product_name,
    in_stock: r.in_stock,
    stock_qty: r.stock_qty,
  }));
}

function newEditable(): EditableIngredient {
  return {
    key: secureId('new'),
    id: null,
    name: '',
    quantity: '',
    unit: 'g',
    pieceWeightG: '',
    warehouse_product_id: null,
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MenuRecipeRow({ menuItem, inventoryItems, onChanged }: Props) {
  const theme = useAppTheme();
  const prem = theme.isPremium;
  const { alert: premiumAlert } = usePremiumAlert();

  const [expanded, setExpanded] = useState(false);
  const [ingredients, setIngredients] = useState<RecipeIngredientRow[]>(
    () => menuItem.recipeIngredients ?? []
  );
  const [drafts, setDrafts] = useState<EditableIngredient[]>(() =>
    toEditable(menuItem.recipeIngredients ?? [])
  );
  const [recipeDirty, setRecipeDirty] = useState(false);
  const [recipeSaving, setRecipeSaving] = useState(false);
  const [loadingIngredients, setLoadingIngredients] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeDraftKey, setActiveDraftKey] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [isAvailable, setIsAvailable] = useState(menuItem.is_available !== false);
  const [availSaving, setAvailSaving] = useState(false);
  const [manualAvail, setManualAvail] = useState(false);

  const [posIdInput, setPosIdInput] = useState(menuItem.pos_id ?? '');
  const [posIdDirty, setPosIdDirty] = useState(false);
  const [posIdSaving, setPosIdSaving] = useState(false);

  useEffect(() => {
    const rows = menuItem.recipeIngredients ?? [];
    setIngredients(rows);
    if (!recipeDirty) setDrafts(toEditable(rows));
    setIsAvailable(menuItem.is_available !== false);
  }, [menuItem.id, menuItem.recipeIngredients, menuItem.is_available, recipeDirty]);

  const loadIngredients = useCallback(async () => {
    setLoadingIngredients(true);

    const rows = await fetchRecipeRowsForMenuItem(menuItem.id);

    const soft = await loadSoftMap();
    for (const row of rows) {
      const softId = soft[row.id];
      if (softId) {
        row.warehouse_product_id = softId;
        const inv = inventoryItems.find((i) => i.id === softId);
        row.warehouse_product_name = inv?.name ?? null;
        row.in_stock = inv ? (Number(inv.quantity) || 0) > 0 : false;
        row.stock_qty = inv ? Number(inv.quantity) || 0 : 0;
        continue;
      }
      if (row.warehouse_product_id) {
        const inv = inventoryItems.find((i) => i.id === row.warehouse_product_id);
        row.warehouse_product_name = inv?.name ?? row.warehouse_product_name ?? null;
        row.in_stock = inv ? (Number(inv.quantity) || 0) > 0 : false;
        row.stock_qty = inv ? Number(inv.quantity) || 0 : 0;
        continue;
      }
      const key = normName(row.ingredient_name);
      if (!key || key.length < 2) {
        row.in_stock = false;
        continue;
      }
      const fuzzy = bestProductMatch(row.ingredient_name, inventoryItems, (i) => i.name, 72);
      const hit =
        fuzzy?.item ||
        inventoryItems.find((i) => normName(i.name) === key) ||
        inventoryItems.find((i) => {
          const n = normName(i.name);
          return n.length >= 4 && key.length >= 4 && (n.includes(key) || key.includes(n));
        });
      if (!hit) {
        row.in_stock = false;
        continue;
      }
      soft[row.id] = hit.id;
      row.warehouse_product_id = hit.id;
      row.warehouse_product_name = hit.name;
      row.in_stock = (Number(hit.quantity) || 0) > 0;
      row.stock_qty = Number(hit.quantity) || 0;
      await persistWarehouseProductLink(row.id, hit.id);
    }
    await saveSoftMap(soft);

    setIngredients(rows);
    setDrafts(toEditable(rows));
    setRecipeDirty(false);

    if (rows.length > 0 && !manualAvail) {
      const allOk = rows.every((r) => r.in_stock);
      if (allOk && !isAvailable) {
        const { error } = await setMenuItemAvailable(menuItem.id, true);
        if (!error) setIsAvailable(true);
      } else if (!allOk && isAvailable) {
        const { error } = await setMenuItemAvailable(menuItem.id, false);
        if (!error) setIsAvailable(false);
      }
    }

    setLoadingIngredients(false);
  }, [menuItem.id, inventoryItems, manualAvail, isAvailable]);

  useEffect(() => {
    if (expanded) {
      void loadIngredients();
    }
  }, [expanded, loadIngredients]);

  const handleToggle = () => {
    setExpanded((v) => !v);
  };

  const updateDraft = (key: string, patch: Partial<EditableIngredient>) => {
    setDrafts((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
    setRecipeDirty(true);
  };

  const handleAddIngredient = () => {
    setDrafts((prev) => [...prev, newEditable()]);
    setRecipeDirty(true);
  };

  const handleRemoveIngredient = (key: string) => {
    setDrafts((prev) => prev.filter((d) => d.key !== key));
    setRecipeDirty(true);
  };

  const handleSaveRecipe = async () => {
    const valid = drafts.filter((d) => d.name.trim());
    setRecipeSaving(true);
    try {
      const soft = await loadSoftMap();
      const keepIds = new Set(valid.map((d) => d.id).filter(Boolean) as string[]);
      const existingIds = ingredients.map((i) => i.id);
      const toDelete = existingIds.filter((id) => !keepIds.has(id));

      if (toDelete.length > 0) {
        await deleteRecipeIngredientIds(toDelete);
        for (const id of toDelete) delete soft[id];
      }

      for (let idx = 0; idx < valid.length; idx++) {
        const d = valid[idx];
        const payload: Record<string, unknown> = {
          ingredient_name: d.name.trim(),
          quantity: normalizeRecipeQuantity(parseFloat(d.quantity.replace(',', '.')) || 0),
          unit: d.unit || 'g',
          sort_order: idx + 1,
          warehouse_product_id: d.warehouse_product_id,
        };
        const pw = parseOptionalPieceWeightG(d.pieceWeightG);
        if ((d.unit === 'szt' || d.unit === 'sztuka') && pw != null) {
          payload.piece_weight_g = pw;
        } else {
          payload.piece_weight_g = null;
        }

        if (d.id) {
          const { error } = await updateRecipeIngredientRow(d.id, payload);
          if (error) throw new Error(error.message);
          if (d.warehouse_product_id) soft[d.id] = d.warehouse_product_id;
          else delete soft[d.id];
        } else {
          const insertRow: Record<string, unknown> = {
            menu_item_id: menuItem.id,
            ingredient_name: payload.ingredient_name,
            quantity: payload.quantity,
            unit: payload.unit,
            sort_order: payload.sort_order,
          };
          if (d.warehouse_product_id) insertRow.warehouse_product_id = d.warehouse_product_id;
          if (payload.piece_weight_g != null) insertRow.piece_weight_g = payload.piece_weight_g;
          const { id: insertedId, error } = await insertRecipeIngredientRow(insertRow);
          if (error) throw new Error(error.message);
          if (insertedId && d.warehouse_product_id) {
            soft[insertedId] = d.warehouse_product_id;
          }
        }
      }

      await saveSoftMap(soft);
      setRecipeDirty(false);
      await loadIngredients();
      emitRecipeIngredientsChanged(menuItem.id);
      onChanged();
    } catch (e: unknown) {
      premiumAlert(
        'Błąd zapisu',
        e instanceof Error ? e.message : 'Nie udało się zapisać receptury.',
      );
    } finally {
      setRecipeSaving(false);
    }
  };

  const handleSuggestRecipe = async () => {
    const base = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');
    if (!base) {
      premiumAlert('Brak backendu', 'Ustaw EXPO_PUBLIC_BACKEND_URL, aby AI mogło zaproponować recepturę.');
      return;
    }
    setSuggesting(true);
    try {
      const res = await fetch(`${base}/api/menu/suggest-recipe`, {
        method: 'POST',
        headers: await (await import('@/lib/apiHeaders')).apiJsonHeaders(),
        body: JSON.stringify({
          dishes: [
            {
              name: menuItem.name,
              category: menuItem.category || 'Inne',
              ingredients: [],
            },
          ],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = String(json?.detail || json?.error || `HTTP ${res.status}`);
        const low = detail.toLowerCase();
        if (
          res.status === 502 ||
          res.status === 503 ||
          res.status === 504 ||
          low.includes('application failed to respond') ||
          low.includes('failed to respond')
        ) {
          throw new Error(
            'Serwer AI nie zdążył odpowiedzieć (timeout / 502). Spróbuj ponownie za chwilę.',
          );
        }
        throw new Error(detail);
      }
      const suggested =
        (json?.dishes?.[0]?.suggested_ingredients as { name: string; quantity: number; unit: string }[]) ??
        [];
      if (!suggested.length) {
        premiumAlert('Brak propozycji', 'AI nie zwróciło składników dla tego dania.');
        return;
      }
      await replaceMenuItemRecipe(
        menuItem.id,
        suggested
          .filter((s) => (s.name || '').trim())
          .map((s, i) => ({
            ingredient_name: s.name.trim(),
            quantity: normalizeRecipeQuantity(Number(s.quantity) || 0),
            unit: s.unit || 'g',
            sort_order: i + 1,
          })),
      );
      await loadIngredients();
      emitRecipeIngredientsChanged(menuItem.id);
      onChanged();
    } catch (e: any) {
      premiumAlert('Błąd AI', e?.message ?? 'Nie udało się zaproponować receptury.');
    } finally {
      setSuggesting(false);
    }
  };

  const mappedCount = drafts.filter((i) => i.warehouse_product_id).length;
  const inStockCount = drafts.filter((i) => i.in_stock).length;
  const totalCount = drafts.filter((d) => d.name.trim() || d.id).length;

  const badgeStyle = useMemo(() => {
    if (totalCount === 0) return prem ? styles.badgeGrayPrem : styles.badgeGray;
    if (inStockCount === totalCount) return prem ? styles.badgeGreenPrem : styles.badgeGreen;
    if (inStockCount > 0) return prem ? styles.badgeOrangePrem : styles.badgeOrange;
    return prem ? styles.badgeRedPrem : styles.badgeRed;
  }, [totalCount, inStockCount, prem]);

  const handleToggleAvailable = async (value: boolean) => {
    setAvailSaving(true);
    setManualAvail(true);
    const { error } = await setMenuItemAvailable(menuItem.id, value);
    setAvailSaving(false);
    if (error) {
      premiumAlert('Błąd', error.message);
      return;
    }
    setIsAvailable(value);
    onChanged();
  };

  const openPicker = (draftKey: string) => {
    setActiveDraftKey(draftKey);
    setPickerSearch('');
    setPickerOpen(true);
  };

  const handleMapIngredient = async (warehouseItemId: string) => {
    if (!activeDraftKey) return;
    const draft = drafts.find((d) => d.key === activeDraftKey);
    if (!draft) return;

    const inv = inventoryItems.find((i) => i.id === warehouseItemId);
    updateDraft(activeDraftKey, {
      warehouse_product_id: warehouseItemId,
      warehouse_product_name: inv?.name ?? null,
      in_stock: inv ? (Number(inv.quantity) || 0) > 0 : false,
      stock_qty: inv ? Number(inv.quantity) || 0 : 0,
    });

    if (!draft.id) {
      setPickerOpen(false);
      return;
    }

    setSaving(true);
    const soft = await loadSoftMap();
    soft[draft.id] = warehouseItemId;
    await saveSoftMap(soft);
    const { error, schemaMissing } = await persistWarehouseProductLink(
      draft.id,
      warehouseItemId,
    );
    setSaving(false);
    setPickerOpen(false);
    if (error && !schemaMissing) {
      premiumAlert('Błąd', error.message);
    } else {
      emitRecipeIngredientsChanged(menuItem.id);
      onChanged();
    }
  };

  const handleUnmap = async (draftKey: string) => {
    const draft = drafts.find((d) => d.key === draftKey);
    if (!draft) return;
    updateDraft(draftKey, {
      warehouse_product_id: null,
      warehouse_product_name: null,
      in_stock: false,
      stock_qty: 0,
    });
    if (!draft.id) return;

    const soft = await loadSoftMap();
    delete soft[draft.id];
    await saveSoftMap(soft);
    const { error, schemaMissing } = await persistWarehouseProductLink(draft.id, null);
    if (error && !schemaMissing) {
      premiumAlert('Błąd', error.message);
      return;
    }
    emitRecipeIngredientsChanged(menuItem.id);
    onChanged();
  };

  const handleSavePosId = async () => {
    setPosIdSaving(true);
    const value = posIdInput.trim() || null;
    const { error } = await saveMenuItemPosId(menuItem.id, value);
    setPosIdSaving(false);
    if (error) {
      premiumAlert('Błąd', error.message);
    } else {
      setPosIdDirty(false);
      onChanged();
    }
  };

  const filteredInventory = inventoryItems.filter((i) =>
    i.name.toLowerCase().includes(pickerSearch.toLowerCase())
  );

  const cardBg = prem ? DS.color.surfaceCard : '#fff';
  const cardBorder = prem ? DS.color.borderSubtle : '#E2E8F0';
  const textPrimary = prem ? DS.color.heading : '#1E293B';
  const textSecondary = prem ? DS.color.muted : '#64748B';
  const textMuted = prem ? DS.color.muted : '#94A3B8';
  const inputBg = prem ? DS.color.bgTertiary : '#F8FAFC';
  const inputBorder = prem ? DS.color.borderSubtle : '#CBD5E1';
  const divider = prem ? DS.color.borderSubtle : '#F1F5F9';
  const accent = prem ? DS.color.greenEnd : Colors.accent;
  const accentFg = prem ? '#0A0A0A' : '#fff';

  return (
    <View style={[styles.card, { backgroundColor: cardBg, borderColor: cardBorder }, prem && DS.shadow.card]}>
      <TouchableOpacity style={styles.header} onPress={handleToggle} activeOpacity={0.7}>
        <View style={styles.headerLeft}>
          {expanded ? (
            <ChevronDown size={18} color={textSecondary} />
          ) : (
            <ChevronRight size={18} color={textSecondary} />
          )}
          <View style={styles.headerText}>
            <Text style={[styles.itemName, { color: textPrimary }]}>{menuItem.name}</Text>
            {menuItem.category ? (
              <Text style={[styles.itemCategory, { color: textSecondary }]}>{menuItem.category}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.headerRight}>
          {menuItem.pos_id ? (
            <View style={[styles.posLinkedBadge, prem && styles.posLinkedBadgePrem]}>
              <Barcode size={11} color={prem ? DS.color.greenEnd : '#16A34A'} />
              <Text style={[styles.posLinkedText, prem && { color: DS.color.greenEnd }]}>POS</Text>
            </View>
          ) : null}
          {totalCount > 0 && (
            <View style={[styles.badge, badgeStyle]}>
              <Text style={[styles.badgeText, prem && { color: DS.color.heading }]}>
                {inStockCount}/{totalCount} na stanie
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={[styles.body, { borderTopColor: divider }]}>
          <View style={styles.posSection}>
            <View style={styles.posLabelRow}>
              <Barcode size={14} color={textSecondary} />
              <Text style={[styles.posLabel, { color: textSecondary }]}>
                Identyfikator / Kod SKU z systemu POS
              </Text>
            </View>
            <View style={styles.posInputRow}>
              <TextInput
                style={[
                  styles.posInput,
                  { backgroundColor: inputBg, borderColor: inputBorder, color: textPrimary },
                  posIdDirty && (prem ? styles.posInputDirtyPrem : styles.posInputDirty),
                ]}
                value={posIdInput}
                onChangeText={(v) => {
                  setPosIdInput(v);
                  setPosIdDirty(true);
                }}
                placeholder="np. ZUPA-01 lub 1234"
                placeholderTextColor={textMuted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {posIdDirty && (
                <TouchableOpacity
                  style={[styles.posSaveBtn, { backgroundColor: accent }]}
                  onPress={handleSavePosId}
                  disabled={posIdSaving}
                  activeOpacity={0.75}
                >
                  {posIdSaving ? (
                    <ActivityIndicator size="small" color={accentFg} />
                  ) : (
                    <Save size={14} color={accentFg} />
                  )}
                </TouchableOpacity>
              )}
              {!posIdDirty && posIdInput !== '' && (
                <View style={styles.posSavedIndicator}>
                  <Check size={14} color={prem ? DS.color.greenEnd : '#16A34A'} />
                </View>
              )}
            </View>
            <Text style={[styles.posHint, { color: textMuted }]}>
              Skopiuj ten kod z panelu POS. Gdy POS sprzeda tę pozycję, aplikacja automatycznie
              odliczy składniki z receptury.
            </Text>
          </View>

          <View style={[styles.ingredientsDivider, { backgroundColor: divider }]} />
          <View style={[styles.availRow, { borderBottomColor: divider }]}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.ingredientsTitle, { color: textSecondary }]}>
                Dostępność POS / sprzedaż
              </Text>
              <Text style={[styles.posHint, { color: textMuted }]}>
                {inStockCount === totalCount && totalCount > 0
                  ? 'Wszystkie składniki na stanie — danie może być dostępne automatycznie.'
                  : `Na stanie ${inStockCount}/${totalCount}. Brakujące składniki blokują auto-dostępność — możesz włączyć ręcznie.`}
              </Text>
            </View>
            <Switch
              value={isAvailable}
              onValueChange={(v) => void handleToggleAvailable(v)}
              disabled={availSaving}
              trackColor={{
                true: prem ? DS.color.greenEnd : '#16A34A',
                false: prem ? DS.color.borderSubtle : '#CBD5E1',
              }}
            />
          </View>

          <View style={styles.recipeHeaderRow}>
            <Text style={[styles.ingredientsTitle, { color: textSecondary, marginBottom: 0 }]}>
              Składniki receptury (1:1 z Menu)
            </Text>
            {recipeDirty ? (
              <TouchableOpacity
                style={[styles.saveRecipeBtn, { backgroundColor: accent }]}
                onPress={() => void handleSaveRecipe()}
                disabled={recipeSaving}
                activeOpacity={0.75}
              >
                {recipeSaving ? (
                  <ActivityIndicator size="small" color={accentFg} />
                ) : (
                  <>
                    <Save size={12} color={accentFg} />
                    <Text style={[styles.saveRecipeBtnText, { color: accentFg }]}>Zapisz</Text>
                  </>
                )}
              </TouchableOpacity>
            ) : null}
          </View>
          <Text style={[styles.posHint, { color: textMuted, marginBottom: 10 }]}>
            Edycja tutaj zmienia też recepturę w Menu — i odwrotnie. Przy sprzedaży POS odejmie te
            ilości z magazynu ({mappedCount}/{totalCount} zmapowanych).
          </Text>

          {loadingIngredients ? (
            <ActivityIndicator size="small" color={accent} style={styles.loader} />
          ) : drafts.length === 0 ? (
            <View style={styles.emptyBox}>
              <Text style={[styles.emptyText, { color: textMuted }]}>
                Brak składników w recepturze. Dodaj je poniżej albo pozwól AI zaproponować wzorcową
                recepturę z gramaturami.
              </Text>
              <TouchableOpacity
                style={[styles.suggestBtn, { backgroundColor: accent }]}
                onPress={() => void handleSuggestRecipe()}
                disabled={suggesting}
                activeOpacity={0.75}
              >
                {suggesting ? (
                  <ActivityIndicator size="small" color={accentFg} />
                ) : (
                  <Text style={[styles.suggestBtnText, { color: accentFg }]}>
                    Zaproponuj recepturę AI
                  </Text>
                )}
              </TouchableOpacity>
            </View>
          ) : (
            drafts.map((ing, index) => (
              <View
                key={ing.key}
                style={[
                  styles.ingredientCard,
                  {
                    backgroundColor: prem ? DS.color.bgTertiary : '#F8FAFC',
                    borderColor: prem ? DS.color.borderSubtle : '#E2E8F0',
                  },
                ]}
              >
                <View style={styles.ingredientTop}>
                  <View
                    style={[
                      styles.indexBadge,
                      prem && { backgroundColor: 'rgba(0,255,120,0.14)' },
                    ]}
                  >
                    <Text style={[styles.indexText, prem && { color: DS.color.greenEnd }]}>
                      {index + 1}
                    </Text>
                  </View>
                  <TextInput
                    style={[
                      styles.nameInput,
                      { backgroundColor: inputBg, borderColor: inputBorder, color: textPrimary },
                    ]}
                    value={ing.name}
                    onChangeText={(v) => updateDraft(ing.key, { name: v })}
                    placeholder="Nazwa składnika"
                    placeholderTextColor={textMuted}
                    autoCorrect={false}
                  />
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    onPress={() => handleRemoveIngredient(ing.key)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Trash2 size={15} color={prem ? DS.color.danger : '#DC2626'} />
                  </TouchableOpacity>
                </View>

                <View style={styles.qtyRow}>
                  <TextInput
                    style={[
                      styles.qtyInput,
                      { backgroundColor: inputBg, borderColor: inputBorder, color: textPrimary },
                    ]}
                    value={ing.quantity}
                    onChangeText={(v) => updateDraft(ing.key, { quantity: v })}
                    placeholder="Ilość"
                    placeholderTextColor={textMuted}
                    keyboardType="decimal-pad"
                  />
                  <View style={styles.unitWrap}>
                    {UNIT_OPTIONS.map((u) => {
                      const active = ing.unit === u;
                      return (
                        <TouchableOpacity
                          key={u}
                          style={[
                            styles.unitBtn,
                            {
                              backgroundColor: prem ? DS.color.bgSecondary : '#fff',
                              borderColor: prem ? DS.color.borderSubtle : '#E2E8F0',
                            },
                            active && {
                              backgroundColor: accent,
                              borderColor: accent,
                            },
                          ]}
                          onPress={() => updateDraft(ing.key, { unit: u })}
                          activeOpacity={0.7}
                        >
                          <Text
                            style={[
                              styles.unitBtnText,
                              { color: textSecondary },
                              active && { color: accentFg, fontWeight: '700' },
                            ]}
                          >
                            {u}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>

                {(ing.unit === 'szt' || ing.unit === 'sztuka') && (
                  <View
                    style={[
                      styles.pieceWeightBox,
                      {
                        backgroundColor: prem ? 'rgba(0,255,120,0.06)' : '#F8FAFC',
                        borderColor: prem ? DS.color.borderSubtle : '#E2E8F0',
                      },
                    ]}
                  >
                    <Text style={[styles.pieceWeightLabel, { color: textMuted }]}>
                      Wzorcowa waga 1 sztuki (g)
                    </Text>
                    <TextInput
                      style={[
                        styles.pieceWeightInput,
                        { backgroundColor: inputBg, borderColor: inputBorder, color: textPrimary },
                      ]}
                      value={ing.pieceWeightG ?? ''}
                      onChangeText={(v) => updateDraft(ing.key, { pieceWeightG: v })}
                      placeholder="opcjonalnie, np. 180"
                      placeholderTextColor={textMuted}
                      keyboardType="decimal-pad"
                    />
                    <Text style={[styles.pieceWeightHint, { color: textMuted }]}>
                      {PIECE_WEIGHT_HINT}
                    </Text>
                  </View>
                )}

                <View style={styles.mapRow}>
                  <Text
                    style={[
                      styles.stockHint,
                      { color: ing.in_stock ? (prem ? DS.color.greenEnd : '#16A34A') : (prem ? DS.color.danger : '#DC2626') },
                    ]}
                  >
                    {ing.warehouse_product_id
                      ? ing.in_stock
                        ? `Na stanie (${ing.stock_qty ?? 0})`
                        : 'Zmapowano — brak na magazynie'
                      : 'Nie zmapowano do magazynu'}
                  </Text>
                  <View style={styles.ingredientAction}>
                    {ing.warehouse_product_id ? (
                      <>
                        <View style={[styles.linkedBadge, prem && styles.linkedBadgePrem]}>
                          <Link size={11} color={prem ? DS.color.greenEnd : '#16A34A'} />
                          <Text
                            style={[styles.linkedBadgeText, prem && { color: DS.color.greenEnd }]}
                            numberOfLines={1}
                          >
                            {ing.warehouse_product_name || 'magazyn'}
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={[styles.changeBtn, prem && styles.changeBtnPrem]}
                          onPress={() => openPicker(ing.key)}
                          activeOpacity={0.7}
                        >
                          <Text style={[styles.changeBtnText, prem && { color: DS.color.greenEnd }]}>
                            Zmień
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.unlinkBtn}
                          onPress={() => void handleUnmap(ing.key)}
                          activeOpacity={0.7}
                        >
                          <Link2Off size={14} color={textSecondary} />
                        </TouchableOpacity>
                      </>
                    ) : (
                      <TouchableOpacity
                        style={[
                          styles.mapBtn,
                          prem && {
                            backgroundColor: DS.color.bgSecondary,
                            borderColor: DS.color.borderSubtle,
                          },
                        ]}
                        onPress={() => openPicker(ing.key)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.mapBtnText, { color: textSecondary }]}>Mapuj</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>
            ))
          )}

          <View style={styles.footerActions}>
            <TouchableOpacity
              style={[
                styles.addIngBtn,
                prem && {
                  backgroundColor: DS.color.bgTertiary,
                  borderColor: DS.color.borderSubtle,
                },
              ]}
              onPress={handleAddIngredient}
              activeOpacity={0.75}
            >
              <Plus size={14} color={accent} />
              <Text style={[styles.addIngBtnText, { color: accent }]}>Dodaj składnik</Text>
            </TouchableOpacity>
            {drafts.length === 0 ? null : (
              <TouchableOpacity
                style={[styles.suggestBtnSmall, { borderColor: accent }]}
                onPress={() => void handleSuggestRecipe()}
                disabled={suggesting}
                activeOpacity={0.75}
              >
                {suggesting ? (
                  <ActivityIndicator size="small" color={accent} />
                ) : (
                  <Text style={[styles.suggestBtnSmallText, { color: accent }]}>AI receptura</Text>
                )}
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      <Modal visible={pickerOpen} animationType="slide" presentationStyle="pageSheet">
        <View style={[styles.modal, { backgroundColor: prem ? DS.color.bgPrimary : '#fff' }]}>
          <View style={[styles.modalHeader, { borderBottomColor: divider }]}>
            <Text style={[styles.modalTitle, { color: textPrimary }]}>
              Wybierz produkt z magazynu
            </Text>
            <TouchableOpacity onPress={() => setPickerOpen(false)}>
              <X size={22} color={textPrimary} />
            </TouchableOpacity>
          </View>
          <View style={[styles.searchBar, { borderBottomColor: divider }]}>
            <TextInput
              style={[
                styles.searchInput,
                { backgroundColor: inputBg, borderColor: inputBorder, color: textPrimary },
              ]}
              value={pickerSearch}
              onChangeText={setPickerSearch}
              placeholder="Szukaj produktu..."
              placeholderTextColor={textMuted}
              autoFocus
            />
          </View>
          {saving ? (
            <ActivityIndicator size="large" color={accent} style={styles.loader} />
          ) : (
            <FlatList
              data={filteredInventory}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => void handleMapIngredient(item.id)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.pickerName, { color: textPrimary }]}>{item.name}</Text>
                  <Text style={[styles.pickerUnit, { color: textSecondary }]}>{item.unit}</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => (
                <View style={[styles.separator, { backgroundColor: divider }]} />
              )}
              ListEmptyComponent={
                <Text style={[styles.emptyText, { color: textMuted }]}>Brak wyników</Text>
              }
              contentContainerStyle={{ paddingBottom: 32 }}
            />
          )}
        </View>
      </Modal>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  headerText: { flex: 1 },
  itemName: {
    fontSize: 15,
    fontWeight: '600',
  },
  itemCategory: {
    fontSize: 12,
    marginTop: 1,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  posLinkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#DCFCE7',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  posLinkedBadgePrem: {
    backgroundColor: 'rgba(0,255,120,0.12)',
  },
  posLinkedText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#16A34A',
  },
  badge: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeGray: { backgroundColor: '#F1F5F9' },
  badgeGreen: { backgroundColor: '#DCFCE7' },
  badgeOrange: { backgroundColor: '#FEF3C7' },
  badgeRed: { backgroundColor: '#FEE2E2' },
  badgeGrayPrem: { backgroundColor: 'rgba(255,255,255,0.06)' },
  badgeGreenPrem: { backgroundColor: 'rgba(0,255,120,0.14)' },
  badgeOrangePrem: { backgroundColor: 'rgba(245,197,66,0.14)' },
  badgeRedPrem: { backgroundColor: 'rgba(255,90,90,0.14)' },
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderTopWidth: 1,
  },
  posSection: {
    paddingTop: 14,
    paddingBottom: 4,
  },
  posLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  posLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  posInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  posInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
  },
  posInputDirty: {
    borderColor: '#3B82F6',
    backgroundColor: '#EFF6FF',
  },
  posInputDirtyPrem: {
    borderColor: DS.color.greenEnd,
  },
  posSaveBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posSavedIndicator: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  posHint: {
    fontSize: 11,
    marginTop: 6,
    lineHeight: 16,
  },
  ingredientsDivider: {
    height: 1,
    marginVertical: 12,
  },
  ingredientsTitle: {
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  recipeHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
    gap: 8,
  },
  saveRecipeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  saveRecipeBtnText: {
    fontSize: 12,
    fontWeight: '700',
  },
  availRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
  },
  stockHint: {
    fontSize: 11,
    fontWeight: '600',
    flex: 1,
  },
  loader: { marginVertical: 16 },
  emptyBox: {
    paddingVertical: 8,
    gap: 10,
  },
  emptyText: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 4,
    lineHeight: 18,
  },
  suggestBtn: {
    alignSelf: 'center',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 200,
    alignItems: 'center',
  },
  suggestBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  ingredientCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 10,
    marginBottom: 8,
    gap: 8,
  },
  ingredientTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  indexBadge: {
    width: 24,
    height: 24,
    borderRadius: 8,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  indexText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#475569',
  },
  nameInput: {
    flex: 1,
    height: 36,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 13,
  },
  deleteBtn: {
    padding: 4,
  },
  qtyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  qtyInput: {
    minWidth: 78,
    width: 86,
    height: 44,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
  pieceWeightBox: {
    marginTop: 2,
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    gap: 6,
  },
  pieceWeightLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  pieceWeightInput: {
    width: 100,
    height: 40,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: '600',
  },
  pieceWeightHint: {
    fontSize: 10,
    lineHeight: 14,
  },
  unitWrap: {
    flex: 1,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  unitBtn: {
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
  unitBtnText: {
    fontSize: 11,
    fontWeight: '600',
  },
  mapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ingredientAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  linkedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
    maxWidth: 100,
  },
  linkedBadgePrem: {
    backgroundColor: 'rgba(0,255,120,0.12)',
  },
  linkedBadgeText: {
    fontSize: 11,
    color: '#15803D',
    fontWeight: '500',
    flexShrink: 1,
  },
  changeBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
  },
  changeBtnPrem: {
    backgroundColor: 'rgba(0,255,120,0.1)',
  },
  changeBtnText: {
    fontSize: 11,
    color: '#3B82F6',
    fontWeight: '600',
  },
  unlinkBtn: {
    padding: 4,
  },
  mapBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 7,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  mapBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  footerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  addIngBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F8FAFC',
  },
  addIngBtnText: {
    fontSize: 13,
    fontWeight: '700',
  },
  suggestBtnSmall: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderWidth: 1,
  },
  suggestBtnSmallText: {
    fontSize: 12,
    fontWeight: '700',
  },
  modal: {
    flex: 1,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  searchBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  searchInput: {
    height: 40,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    borderWidth: 1,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  pickerName: {
    fontSize: 15,
    fontWeight: '500',
  },
  pickerUnit: {
    fontSize: 13,
  },
  separator: {
    height: 1,
    marginLeft: 20,
  },
});
