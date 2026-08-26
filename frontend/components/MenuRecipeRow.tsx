import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
  Switch,
} from 'react-native';
import {
  Barcode,
  Check,
  Save,
  X,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { emitRecipeIngredientsChanged } from '@/lib/recipeSync';
import { bestProductMatch } from '@/lib/fuzzyProductMatch';
import { normalizeRecipeQuantity, parseOptionalPieceWeightG } from '@/lib/recipeUnits';
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
import {
  loadSoftMap,
  saveSoftMap,
  normName,
  toEditable,
  newEditable,
} from '@/components/menu/menuRecipeHelpers';
import type {
  MenuItemForMapping,
  RecipeIngredientRow,
  InventoryItemForRecipe,
  EditableIngredient,
} from '@/components/menu/menuRecipeTypes';
import { MenuRecipeRowHeader } from '@/components/menu/MenuRecipeRowHeader';
import { MenuRecipeIngredientEditor } from '@/components/menu/MenuRecipeIngredientEditor';
import { menuRecipeRowStyles as styles } from '@/components/menu/menuRecipeRowStyles';

export type { MenuItemForMapping, RecipeIngredientRow, InventoryItemForRecipe } from '@/components/menu/menuRecipeTypes';

interface Props {
  menuItem: MenuItemForMapping;
  inventoryItems: InventoryItemForRecipe[];
  onChanged: () => void;
}

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
      <MenuRecipeRowHeader
        menuItem={menuItem}
        expanded={expanded}
        prem={prem}
        textPrimary={textPrimary}
        textSecondary={textSecondary}
        inStockCount={inStockCount}
        totalCount={totalCount}
        badgeStyle={badgeStyle}
        onToggle={handleToggle}
      />


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

          <MenuRecipeIngredientEditor
            prem={prem}
            accent={accent}
            accentFg={accentFg}
            textPrimary={textPrimary}
            textSecondary={textSecondary}
            textMuted={textMuted}
            inputBg={inputBg}
            inputBorder={inputBorder}
            drafts={drafts}
            loadingIngredients={loadingIngredients}
            recipeDirty={recipeDirty}
            recipeSaving={recipeSaving}
            suggesting={suggesting}
            mappedCount={mappedCount}
            totalCount={totalCount}
            onSaveRecipe={() => void handleSaveRecipe()}
            onSuggestRecipe={() => void handleSuggestRecipe()}
            onUpdateDraft={updateDraft}
            onRemoveIngredient={handleRemoveIngredient}
            onAddIngredient={handleAddIngredient}
            onOpenPicker={openPicker}
            onUnmap={(key) => void handleUnmap(key)}
          />

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

