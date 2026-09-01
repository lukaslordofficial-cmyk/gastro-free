/**
 * Karta potrawy w edycji skanu menu.
 */
import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { ChevronDown, Plus, Trash2, Scale } from 'lucide-react-native';
import { WEIGHT_UNITS, INGREDIENT_UNITS, type DraftDish, type Ingredient } from './menuScanTypes';
import { MENU_SCAN_C as C } from './menuScanColors';
import { menuScanStyles as styles } from './menuScanStyles';

type Props = {
  dish: DraftDish;
  index: number;
  onPatchDish: (key: string, patch: Partial<DraftDish>) => void;
  onRemoveDish: (key: string) => void;
  onOpenCategory: (key: string) => void;
  onPatchIngredient: (dishKey: string, ingKey: string, patch: Partial<Ingredient>) => void;
  onRemoveIngredient: (dishKey: string, ingKey: string) => void;
  onAddIngredient: (dishKey: string) => void;
};

export function MenuScanDishCard({
  dish: d,
  index: idx,
  onPatchDish,
  onRemoveDish,
  onOpenCategory,
  onPatchIngredient,
  onRemoveIngredient,
  onAddIngredient,
}: Props) {
  return (
    <View style={styles.dishCard} testID={`menu-scan-dish-${idx}`}>
      <View style={styles.dishHeader}>
        <TextInput
          style={styles.dishName}
          value={d.name}
          placeholder="Nazwa potrawy"
          placeholderTextColor={C.muted}
          onChangeText={(v) => onPatchDish(d.key, { name: v })}
          testID={`menu-scan-name-${idx}`}
        />
        <TouchableOpacity
          onPress={() => onRemoveDish(d.key)}
          style={styles.dishRemove}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          testID={`menu-scan-remove-${idx}`}
        >
          <Trash2 size={15} color={C.danger} strokeWidth={2} />
        </TouchableOpacity>
      </View>

      <View style={styles.dishMetaRow}>
        <TouchableOpacity
          style={styles.catChip}
          onPress={() => onOpenCategory(d.key)}
          testID={`menu-scan-category-${idx}`}
          activeOpacity={0.7}
        >
          <Text style={styles.catChipText}>{d.category}</Text>
          <ChevronDown size={13} color={C.green} strokeWidth={2.5} />
        </TouchableOpacity>

        <View style={styles.priceField}>
          <TextInput
            style={styles.priceInput}
            value={d.priceInput}
            keyboardType="decimal-pad"
            onChangeText={(v) => onPatchDish(d.key, { priceInput: v })}
            selectTextOnFocus
            testID={`menu-scan-price-${idx}`}
          />
          <Text style={styles.priceSuffix}>zł</Text>
        </View>
      </View>

      <View style={styles.weightRow}>
        <View style={styles.weightLabelWrap}>
          <Scale size={12} color={C.muted} strokeWidth={2} />
          <Text style={styles.weightLabel}>Gramatura porcji</Text>
        </View>
        <View style={styles.weightControls}>
          <TextInput
            style={styles.weightInput}
            value={d.portionWeightInput}
            placeholder="np. 350"
            placeholderTextColor={C.muted}
            keyboardType="decimal-pad"
            onChangeText={(v) => onPatchDish(d.key, { portionWeightInput: v })}
            testID={`menu-scan-weight-${idx}`}
          />
          <View style={styles.weightUnitToggle}>
            {WEIGHT_UNITS.map((u) => {
              const active = d.portionWeightUnit === u;
              return (
                <TouchableOpacity
                  key={u}
                  style={[styles.weightUnitBtn, active && styles.weightUnitBtnActive]}
                  onPress={() => onPatchDish(d.key, { portionWeightUnit: u })}
                  activeOpacity={0.7}
                  testID={`menu-scan-weight-unit-${idx}-${u}`}
                >
                  <Text
                    style={[
                      styles.weightUnitText,
                      active && styles.weightUnitTextActive,
                    ]}
                  >
                    {u}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      </View>

      <Text style={styles.sectionLabel}>Składniki ({d.ingredients.length})</Text>
      {d.ingredients.length === 0 ? (
        <Text style={styles.emptyIngredients}>
          Brak składników — możesz dodać ręcznie lub pozwolić AI zaproponować przy zapisie.
        </Text>
      ) : (
        d.ingredients.map((ing, ingIdx) => (
          <View key={ing.key} style={styles.ingBlock}>
            <View style={styles.ingRow}>
              <TextInput
                style={[styles.ingInput, styles.ingName]}
                value={ing.name}
                placeholder="Nazwa"
                placeholderTextColor={C.muted}
                onChangeText={(v) => onPatchIngredient(d.key, ing.key, { name: v })}
                testID={`menu-scan-ing-name-${idx}-${ingIdx}`}
              />
              <TextInput
                style={[styles.ingInput, styles.ingQty]}
                value={ing.quantity}
                placeholder="ilość"
                placeholderTextColor={C.muted}
                keyboardType="decimal-pad"
                onChangeText={(v) => onPatchIngredient(d.key, ing.key, { quantity: v })}
                testID={`menu-scan-ing-qty-${idx}-${ingIdx}`}
              />
              <View style={styles.ingUnitToggle}>
                {INGREDIENT_UNITS.map((u) => {
                  const active = ing.unit === u;
                  return (
                    <TouchableOpacity
                      key={u}
                      style={[styles.ingUnitBtn, active && styles.ingUnitBtnActive]}
                      onPress={() => onPatchIngredient(d.key, ing.key, { unit: u })}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.ingUnitText,
                          active && styles.ingUnitTextActive,
                        ]}
                      >
                        {u}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                style={styles.ingRemove}
                onPress={() => onRemoveIngredient(d.key, ing.key)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Trash2 size={13} color={C.danger} strokeWidth={2} />
              </TouchableOpacity>
            </View>
            {ing.unit === 'szt' && (
              <View style={styles.pieceWeightRow}>
                <Text style={styles.pieceWeightLabel}>Waga 1 szt. (g)</Text>
                <TextInput
                  style={[styles.ingInput, styles.pieceWeightInput]}
                  value={ing.pieceWeightG}
                  placeholder="np. 180"
                  placeholderTextColor={C.muted}
                  keyboardType="decimal-pad"
                  onChangeText={(v) =>
                    onPatchIngredient(d.key, ing.key, { pieceWeightG: v })
                  }
                  testID={`menu-scan-ing-piece-wt-${idx}-${ingIdx}`}
                />
              </View>
            )}
          </View>
        ))
      )}
      <TouchableOpacity
        style={styles.addIngBtn}
        onPress={() => onAddIngredient(d.key)}
        activeOpacity={0.8}
        testID={`menu-scan-add-ing-${idx}`}
      >
        <Plus size={13} color={C.green} strokeWidth={2.5} />
        <Text style={styles.addIngText}>Dodaj składnik</Text>
      </TouchableOpacity>
    </View>
  );
}
