import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  FlatList,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import {
  ChevronDown,
  ChevronRight,
  Plus,
  Trash2,
  X,
  Check,
  Search,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { supabase } from '@/lib/supabase';
import type { PosProduct } from '@/lib/types';

const UNITS = ['kg', 'l', 'szt', 'g', 'ml', 'opak'];

export interface InventoryItemForRecipe {
  id: string;
  name: string;
  unit: string;
  category_name?: string | null;
}

interface RecipeWithInventory {
  id: string;
  pos_product_id: string;
  warehouse_product_id: string;
  quantity_per_portion: number;
  unit: string;
  inventory_items: { id: string; name: string; unit: string } | null;
}

type ListRow =
  | { kind: 'header'; category: string }
  | { kind: 'item'; data: InventoryItemForRecipe };

interface Props {
  posProduct: PosProduct;
  inventoryItems: InventoryItemForRecipe[];
}

export function RecipeMappingRow({ posProduct, inventoryItems }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [recipes, setRecipes] = useState<RecipeWithInventory[]>([]);
  const [loading, setLoading] = useState(false);

  const [showModal, setShowModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedItem, setSelectedItem] = useState<InventoryItemForRecipe | null>(null);
  const [quantityInput, setQuantityInput] = useState('');
  const [selectedUnit, setSelectedUnit] = useState('kg');
  const [saving, setSaving] = useState(false);

  const fetchRecipes = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('recipes')
      .select(
        'id, pos_product_id, warehouse_product_id, quantity_per_portion, unit, inventory_items(id, name, unit)'
      )
      .eq('pos_product_id', posProduct.id);
    if (data) setRecipes(data as RecipeWithInventory[]);
    setLoading(false);
  }, [posProduct.id]);

  useEffect(() => {
    if (expanded && recipes.length === 0) fetchRecipes();
  }, [expanded, fetchRecipes, recipes.length]);

  const handleDelete = (recipeId: string) => {
    Alert.alert(
      'Usuń składnik',
      'Czy na pewno chcesz usunąć ten składnik z receptury?',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
          style: 'destructive',
          onPress: async () => {
            await supabase.from('recipes').delete().eq('id', recipeId);
            setRecipes((prev) => prev.filter((r) => r.id !== recipeId));
          },
        },
      ]
    );
  };

  const closeModal = () => {
    setShowModal(false);
    setSelectedItem(null);
    setQuantityInput('');
    setSelectedUnit('kg');
    setSearchQuery('');
  };

  const handleAddIngredient = async () => {
    if (!selectedItem) { Alert.alert('Błąd', 'Wybierz składnik z listy.'); return; }
    const qty = parseFloat(quantityInput.replace(',', '.'));
    if (isNaN(qty) || qty <= 0) { Alert.alert('Błąd', 'Podaj prawidłową ilość na porcję (np. 0.15).'); return; }
    setSaving(true);
    const { error } = await supabase.from('recipes').insert({
      pos_product_id: posProduct.id,
      warehouse_product_id: selectedItem.id,
      quantity_per_portion: qty,
      unit: selectedUnit,
    });
    setSaving(false);
    if (error) {
      Alert.alert(
        'Błąd',
        error.code === '23505'
          ? 'Ten składnik jest już przypisany do tego dania.'
          : error.message
      );
      return;
    }
    closeModal();
    fetchRecipes();
  };

  const alreadyLinkedIds = useMemo(
    () => new Set(recipes.map((r) => r.warehouse_product_id)),
    [recipes]
  );

  // Build grouped flat list with category headers, sorted by category name
  const groupedRows = useMemo<ListRow[]>(() => {
    const q = searchQuery.toLowerCase();
    const available = inventoryItems.filter(
      (item) =>
        !alreadyLinkedIds.has(item.id) &&
        item.name.toLowerCase().includes(q)
    );

    const groups = new Map<string, InventoryItemForRecipe[]>();
    available.forEach((item) => {
      const cat = item.category_name ?? 'Inne';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(item);
    });

    const sortedCategories = Array.from(groups.keys()).sort((a, b) =>
      a.localeCompare(b, 'pl')
    );

    const rows: ListRow[] = [];
    sortedCategories.forEach((cat) => {
      const items = groups.get(cat)!.sort((a, b) => a.name.localeCompare(b.name, 'pl'));
      rows.push({ kind: 'header', category: cat });
      items.forEach((item) => rows.push({ kind: 'item', data: item }));
    });
    return rows;
  }, [inventoryItems, alreadyLinkedIds, searchQuery]);

  const hasItems = groupedRows.length > 0;

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.rowHeader}
        onPress={() => setExpanded((v) => !v)}
        activeOpacity={0.75}
      >
        <View style={styles.rowHeaderLeft}>
          {expanded ? (
            <ChevronDown size={18} color={Colors.textSecondary} strokeWidth={2} />
          ) : (
            <ChevronRight size={18} color={Colors.textSecondary} strokeWidth={2} />
          )}
          <View style={styles.productInfo}>
            <Text style={styles.productName}>{posProduct.name}</Text>
            <Text style={styles.productMeta}>
              {posProduct.pos_external_id} · {posProduct.price_pln.toFixed(2)} zł
            </Text>
          </View>
        </View>
        <View style={[styles.countBadge, recipes.length > 0 && styles.countBadgeActive]}>
          <Text style={[styles.countText, recipes.length > 0 && styles.countTextActive]}>
            {recipes.length > 0 ? recipes.length : '—'}
          </Text>
        </View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.body}>
          {loading ? (
            <ActivityIndicator color={Colors.accent} style={{ paddingVertical: 12 }} />
          ) : (
            <>
              {recipes.length === 0 && (
                <Text style={styles.noRecipes}>Brak przypisanych składników</Text>
              )}
              {recipes.map((recipe) => (
                <View key={recipe.id} style={styles.recipeRow}>
                  <View style={styles.recipeLeft}>
                    <Text style={styles.recipeIngredient}>
                      {recipe.inventory_items?.name ?? '—'}
                    </Text>
                    <Text style={styles.recipePortion}>
                      {recipe.quantity_per_portion} {recipe.unit} / porcja
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleDelete(recipe.id)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Trash2 size={16} color={Colors.danger} strokeWidth={2} />
                  </TouchableOpacity>
                </View>
              ))}
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => setShowModal(true)}
                activeOpacity={0.8}
              >
                <Plus size={15} color={Colors.accent} strokeWidth={2.5} />
                <Text style={styles.addBtnText}>Dodaj składnik z magazynu</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      <Modal
        visible={showModal}
        animationType="slide"
        transparent
        presentationStyle="overFullScreen"
        onRequestClose={closeModal}
      >
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalSheet}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Dodaj składnik</Text>
              <TouchableOpacity onPress={closeModal}>
                <X size={22} color={Colors.textSecondary} strokeWidth={2} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalDishLabel}>
              Danie: <Text style={{ color: Colors.accent }}>{posProduct.name}</Text>
            </Text>

            <View style={styles.searchBox}>
              <Search size={16} color={Colors.textTertiary} strokeWidth={2} />
              <TextInput
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="Szukaj składnika..."
                placeholderTextColor={Colors.textTertiary}
                autoCapitalize="none"
              />
            </View>

            <FlatList
              data={groupedRows}
              keyExtractor={(row) =>
                row.kind === 'header' ? `hdr_${row.category}` : row.data.id
              }
              style={styles.itemList}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item: row }) => {
                if (row.kind === 'header') {
                  return <Text style={styles.catHeader}>{row.category}</Text>;
                }
                const item = row.data;
                const isSelected = selectedItem?.id === item.id;
                return (
                  <TouchableOpacity
                    style={[styles.inventoryItem, isSelected && styles.inventoryItemSelected]}
                    onPress={() => {
                      setSelectedItem(item);
                      setSelectedUnit(item.unit || 'kg');
                    }}
                  >
                    <Text style={[styles.inventoryItemText, isSelected && styles.inventoryItemTextSelected]}>
                      {item.name}
                    </Text>
                    {isSelected && (
                      <Check size={16} color={Colors.accent} strokeWidth={2.5} />
                    )}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={
                <Text style={styles.noItems}>
                  {searchQuery ? 'Brak wyników' : 'Wszystkie składniki już przypisane'}
                </Text>
              }
            />

            {selectedItem && (
              <View style={styles.portionSection}>
                <Text style={styles.portionLabel}>Ilość na porcję</Text>
                <TextInput
                  style={styles.portionInput}
                  value={quantityInput}
                  onChangeText={setQuantityInput}
                  placeholder="np. 0.15"
                  placeholderTextColor={Colors.textTertiary}
                  keyboardType="decimal-pad"
                />
                <View style={styles.unitRow}>
                  {UNITS.map((u) => (
                    <TouchableOpacity
                      key={u}
                      style={[styles.unitPill, selectedUnit === u && styles.unitPillActive]}
                      onPress={() => setSelectedUnit(u)}
                    >
                      <Text style={[styles.unitPillText, selectedUnit === u && styles.unitPillTextActive]}>{u}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>
            )}

            <TouchableOpacity
              style={[
                styles.saveBtn,
                (!selectedItem || !quantityInput || saving) && styles.btnDisabled,
              ]}
              onPress={handleAddIngredient}
              disabled={!selectedItem || !quantityInput || saving}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator size="small" color={Colors.white} />
              ) : (
                <Text style={styles.saveBtnText}>Dodaj do receptury</Text>
              )}
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { backgroundColor: Colors.card, borderRadius: 14, marginBottom: 8, overflow: 'hidden', shadowColor: Colors.shadow, shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 4, elevation: 2 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14 },
  rowHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  productInfo: { flex: 1 },
  productName: { fontSize: 15, fontWeight: '600', color: Colors.textPrimary },
  productMeta: { fontSize: 12, color: Colors.textTertiary, marginTop: 2 },
  countBadge: { backgroundColor: Colors.borderLight, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 3, minWidth: 32, alignItems: 'center' },
  countBadgeActive: { backgroundColor: Colors.accentLight },
  countText: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  countTextActive: { color: Colors.accent },
  body: { borderTopWidth: 1, borderTopColor: Colors.borderLight, padding: 14, gap: 8 },
  noRecipes: { fontSize: 13, color: Colors.textTertiary, textAlign: 'center', paddingVertical: 8 },
  recipeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: Colors.background, borderRadius: 10, padding: 12 },
  recipeLeft: { flex: 1 },
  recipeIngredient: { fontSize: 14, fontWeight: '600', color: Colors.textPrimary },
  recipePortion: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.accent, borderStyle: 'dashed', justifyContent: 'center', backgroundColor: Colors.accentLight, marginTop: 4 },
  addBtnText: { fontSize: 13, fontWeight: '600', color: Colors.accent },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  modalSheet: { backgroundColor: Colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, maxHeight: '85%' },
  modalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  modalTitle: { fontSize: 18, fontWeight: '700', color: Colors.textPrimary },
  modalDishLabel: { fontSize: 13, color: Colors.textSecondary, marginBottom: 14 },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: Colors.borderLight, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6, borderWidth: 1, borderColor: Colors.border },
  searchInput: { flex: 1, fontSize: 14, color: Colors.textPrimary },
  itemList: { maxHeight: 220 },
  catHeader: { fontSize: 10, fontWeight: '700', color: Colors.textTertiary, textTransform: 'uppercase', letterSpacing: 0.6, paddingHorizontal: 10, paddingTop: 10, paddingBottom: 3, backgroundColor: Colors.background },
  inventoryItem: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 11, paddingHorizontal: 12, borderRadius: 8, marginBottom: 2, backgroundColor: Colors.background },
  inventoryItemSelected: { backgroundColor: Colors.accentLight },
  inventoryItemText: { fontSize: 14, color: Colors.textPrimary },
  inventoryItemTextSelected: { color: Colors.accent, fontWeight: '600' },
  noItems: { textAlign: 'center', color: Colors.textTertiary, fontSize: 13, paddingVertical: 16 },
  portionSection: { marginTop: 14, borderTopWidth: 1, borderTopColor: Colors.borderLight, paddingTop: 14, gap: 10 },
  portionLabel: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  portionInput: { backgroundColor: Colors.borderLight, borderRadius: 10, paddingHorizontal: 14, paddingVertical: Platform.OS === 'ios' ? 12 : 10, fontSize: 16, color: Colors.textPrimary, borderWidth: 1, borderColor: Colors.border },
  unitRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  unitPill: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: Colors.borderLight, borderWidth: 1.5, borderColor: 'transparent' },
  unitPillActive: { backgroundColor: Colors.accentLight, borderColor: Colors.accent },
  unitPillText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  unitPillTextActive: { color: Colors.accent },
  saveBtn: { backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  btnDisabled: { opacity: 0.5 },
  saveBtnText: { color: Colors.white, fontSize: 15, fontWeight: '700' },
});
