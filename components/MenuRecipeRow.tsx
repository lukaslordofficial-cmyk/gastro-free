import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  ChevronDown,
  ChevronRight,
  Link,
  LinkOff,
  Barcode,
  Check,
  Save,
  X,
} from 'lucide-react-native';
import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/colors';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MenuItemForMapping {
  id: string;
  name: string;
  category: string | null;
  price_pln: number | null;
  pos_id: string | null;
}

export interface RecipeIngredientRow {
  id: string;
  ingredient_name: string;
  quantity: number;
  unit: string;
  warehouse_product_id: string | null;
  warehouse_product_name?: string | null;
}

export interface InventoryItemForRecipe {
  id: string;
  name: string;
  unit: string;
  category_name?: string | null;
}

interface Props {
  menuItem: MenuItemForMapping;
  inventoryItems: InventoryItemForRecipe[];
  onChanged: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function MenuRecipeRow({ menuItem, inventoryItems, onChanged }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [ingredients, setIngredients] = useState<RecipeIngredientRow[]>([]);
  const [loadingIngredients, setLoadingIngredients] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [activeIngredientId, setActiveIngredientId] = useState<string | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [saving, setSaving] = useState(false);

  // POS identifier state
  const [posIdInput, setPosIdInput] = useState(menuItem.pos_id ?? '');
  const [posIdDirty, setPosIdDirty] = useState(false);
  const [posIdSaving, setPosIdSaving] = useState(false);

  const loadIngredients = useCallback(async () => {
    setLoadingIngredients(true);
    const { data } = await supabase
      .from('recipe_ingredients')
      .select(`
        id,
        ingredient_name,
        quantity,
        unit,
        warehouse_product_id,
        inventory_items (name)
      `)
      .eq('menu_item_id', menuItem.id)
      .order('ingredient_name');

    setIngredients(
      (data ?? []).map((r: any) => ({
        id: r.id,
        ingredient_name: r.ingredient_name,
        quantity: r.quantity,
        unit: r.unit,
        warehouse_product_id: r.warehouse_product_id,
        warehouse_product_name: r.inventory_items?.name ?? null,
      }))
    );
    setLoadingIngredients(false);
  }, [menuItem.id]);

  const handleToggle = () => {
    const next = !expanded;
    setExpanded(next);
    if (next && ingredients.length === 0) loadIngredients();
  };

  const mappedCount = ingredients.filter((i) => i.warehouse_product_id).length;
  const totalCount = ingredients.length;

  const badgeStyle =
    totalCount === 0
      ? styles.badgeGray
      : mappedCount === totalCount
      ? styles.badgeGreen
      : mappedCount > 0
      ? styles.badgeOrange
      : styles.badgeRed;

  const openPicker = (ingredientId: string) => {
    setActiveIngredientId(ingredientId);
    setPickerSearch('');
    setPickerOpen(true);
  };

  const handleMapIngredient = async (warehouseItemId: string) => {
    if (!activeIngredientId) return;
    setSaving(true);
    const { error } = await supabase
      .from('recipe_ingredients')
      .update({ warehouse_product_id: warehouseItemId })
      .eq('id', activeIngredientId);

    setSaving(false);
    setPickerOpen(false);
    if (error) {
      Alert.alert('Błąd', error.message);
    } else {
      await loadIngredients();
      onChanged();
    }
  };

  const handleUnmap = async (ingredientId: string) => {
    const { error } = await supabase
      .from('recipe_ingredients')
      .update({ warehouse_product_id: null })
      .eq('id', ingredientId);
    if (!error) {
      await loadIngredients();
      onChanged();
    }
  };

  const handleSavePosId = async () => {
    setPosIdSaving(true);
    const value = posIdInput.trim() || null;
    const { error } = await supabase
      .from('menu_items')
      .update({ pos_id: value })
      .eq('id', menuItem.id);
    setPosIdSaving(false);
    if (error) {
      Alert.alert('Błąd', error.message);
    } else {
      setPosIdDirty(false);
      onChanged();
    }
  };

  const filteredInventory = inventoryItems.filter((i) =>
    i.name.toLowerCase().includes(pickerSearch.toLowerCase())
  );

  return (
    <View style={styles.card}>
      {/* ── Header ── */}
      <TouchableOpacity style={styles.header} onPress={handleToggle} activeOpacity={0.7}>
        <View style={styles.headerLeft}>
          {expanded ? (
            <ChevronDown size={18} color={Colors.textSecondary} />
          ) : (
            <ChevronRight size={18} color={Colors.textSecondary} />
          )}
          <View style={styles.headerText}>
            <Text style={styles.itemName}>{menuItem.name}</Text>
            {menuItem.category ? (
              <Text style={styles.itemCategory}>{menuItem.category}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.headerRight}>
          {menuItem.pos_id ? (
            <View style={styles.posLinkedBadge}>
              <Barcode size={11} color="#16A34A" />
              <Text style={styles.posLinkedText}>POS</Text>
            </View>
          ) : null}
          {totalCount > 0 && (
            <View style={[styles.badge, badgeStyle]}>
              <Text style={styles.badgeText}>
                {mappedCount}/{totalCount}
              </Text>
            </View>
          )}
        </View>
      </TouchableOpacity>

      {/* ── Expanded body ── */}
      {expanded && (
        <View style={styles.body}>
          {/* POS Identifier field */}
          <View style={styles.posSection}>
            <View style={styles.posLabelRow}>
              <Barcode size={14} color={Colors.textSecondary} />
              <Text style={styles.posLabel}>Identyfikator / Kod SKU z systemu POS</Text>
            </View>
            <View style={styles.posInputRow}>
              <TextInput
                style={[styles.posInput, posIdDirty && styles.posInputDirty]}
                value={posIdInput}
                onChangeText={(v) => {
                  setPosIdInput(v);
                  setPosIdDirty(true);
                }}
                placeholder="np. ZUPA-01 lub 1234"
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {posIdDirty && (
                <TouchableOpacity
                  style={styles.posSaveBtn}
                  onPress={handleSavePosId}
                  disabled={posIdSaving}
                  activeOpacity={0.75}
                >
                  {posIdSaving ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Save size={14} color="#fff" />
                  )}
                </TouchableOpacity>
              )}
              {!posIdDirty && posIdInput !== '' && (
                <View style={styles.posSavedIndicator}>
                  <Check size={14} color="#16A34A" />
                </View>
              )}
            </View>
            <Text style={styles.posHint}>
              Skopiuj ten kod z panelu POS. Gdy POS sprzeda tę pozycję, aplikacja automatycznie
              odliczy składniki z receptury.
            </Text>
          </View>

          {/* Recipe ingredients */}
          <View style={styles.ingredientsDivider} />
          <Text style={styles.ingredientsTitle}>Składniki receptury</Text>

          {loadingIngredients ? (
            <ActivityIndicator size="small" color={Colors.accent} style={styles.loader} />
          ) : ingredients.length === 0 ? (
            <Text style={styles.emptyText}>Brak składników w recepturze.</Text>
          ) : (
            ingredients.map((ing) => (
              <View key={ing.id} style={styles.ingredientRow}>
                <View style={styles.ingredientInfo}>
                  <Text style={styles.ingredientName}>{ing.ingredient_name}</Text>
                  <Text style={styles.ingredientQty}>
                    {ing.quantity} {ing.unit}
                  </Text>
                </View>
                <View style={styles.ingredientAction}>
                  {ing.warehouse_product_id ? (
                    <>
                      <View style={styles.linkedBadge}>
                        <Link size={11} color="#16A34A" />
                        <Text style={styles.linkedBadgeText}>{ing.warehouse_product_name}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.changeBtn}
                        onPress={() => openPicker(ing.id)}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.changeBtnText}>Zmień</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.unlinkBtn}
                        onPress={() => handleUnmap(ing.id)}
                        activeOpacity={0.7}
                      >
                        <LinkOff size={14} color={Colors.textSecondary} />
                      </TouchableOpacity>
                    </>
                  ) : (
                    <TouchableOpacity
                      style={styles.mapBtn}
                      onPress={() => openPicker(ing.id)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.mapBtnText}>Mapuj</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {/* ── Picker Modal ── */}
      <Modal visible={pickerOpen} animationType="slide" presentationStyle="pageSheet">
        <View style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Wybierz produkt z magazynu</Text>
            <TouchableOpacity onPress={() => setPickerOpen(false)}>
              <X size={22} color={Colors.textPrimary} />
            </TouchableOpacity>
          </View>
          <View style={styles.searchBar}>
            <TextInput
              style={styles.searchInput}
              value={pickerSearch}
              onChangeText={setPickerSearch}
              placeholder="Szukaj produktu..."
              placeholderTextColor={Colors.textTertiary}
              autoFocus
            />
          </View>
          {saving ? (
            <ActivityIndicator size="large" color={Colors.accent} style={styles.loader} />
          ) : (
            <FlatList
              data={filteredInventory}
              keyExtractor={(i) => i.id}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.pickerRow}
                  onPress={() => handleMapIngredient(item.id)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.pickerName}>{item.name}</Text>
                  <Text style={styles.pickerUnit}>{item.unit}</Text>
                </TouchableOpacity>
              )}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              ListEmptyComponent={
                <Text style={styles.emptyText}>Brak wyników</Text>
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
    backgroundColor: '#fff',
    borderRadius: 12,
    marginBottom: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
    color: '#1E293B',
  },
  itemCategory: {
    fontSize: 12,
    color: '#64748B',
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
  badgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
  },
  body: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },

  // POS section
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
    color: '#475569',
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
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#1E293B',
    backgroundColor: '#F8FAFC',
  },
  posInputDirty: {
    borderColor: '#3B82F6',
    backgroundColor: '#EFF6FF',
  },
  posSaveBtn: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#3B82F6',
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
    color: '#94A3B8',
    marginTop: 6,
    lineHeight: 16,
  },

  // Ingredients
  ingredientsDivider: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginVertical: 12,
  },
  ingredientsTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#475569',
    marginBottom: 8,
  },
  loader: { marginVertical: 16 },
  emptyText: {
    fontSize: 13,
    color: '#94A3B8',
    textAlign: 'center',
    paddingVertical: 12,
  },
  ingredientRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  ingredientInfo: { flex: 1 },
  ingredientName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1E293B',
  },
  ingredientQty: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
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
    maxWidth: 120,
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
    color: '#475569',
    fontWeight: '600',
  },

  // Modal
  modal: {
    flex: 1,
    backgroundColor: '#fff',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#1E293B',
  },
  searchBar: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  searchInput: {
    height: 40,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 14,
    color: '#1E293B',
    borderWidth: 1,
    borderColor: '#E2E8F0',
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
    color: '#1E293B',
    fontWeight: '500',
  },
  pickerUnit: {
    fontSize: 13,
    color: '#64748B',
  },
  separator: {
    height: 1,
    backgroundColor: '#F1F5F9',
    marginHorizontal: 20,
  },
});
