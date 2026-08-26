import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { Plus, Trash2 } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { FieldLabel, NumericInput, formStyles } from './formFields';
import { COMBO_UNIT_OPTIONS } from './constants';
import { newComboIngredient } from './helpers';
import type { ComboIngredientDraft, MockInventoryItem } from './types';

type ThemeLite = { isPremium: boolean };

export function ComboIngredientsEditor({
  theme,
  inventory,
  editingId,
  comboIngredients,
  setComboIngredients,
  shelfLifeDays,
  onShelfLifeChange,
}: {
  theme: ThemeLite;
  inventory: MockInventoryItem[];
  editingId: string | null;
  comboIngredients: ComboIngredientDraft[];
  setComboIngredients: React.Dispatch<React.SetStateAction<ComboIngredientDraft[]>>;
  shelfLifeDays: string;
  onShelfLifeChange: (v: string) => void;
}) {
  return (
    <View style={{ gap: 10, marginBottom: 8 }}>
      <Text style={[styles.formSection, theme.isPremium && { color: DS.color.heading }]}>
        Receptura półproduktu
      </Text>
      {comboIngredients.map((ing, idx) => {
        const q = ing.name.trim().toLowerCase();
        const suggestions =
          q.length >= 2
            ? inventory
                .filter((p) => p.id !== editingId && p.product_name.toLowerCase().includes(q))
                .slice(0, 5)
            : [];
        return (
          <View
            key={ing.key}
            style={[
              styles.comboIngCard,
              theme.isPremium && {
                backgroundColor: DS.color.surfaceCard,
                borderColor: DS.color.borderSubtle,
              },
            ]}
          >
            <Text
              style={[
                styles.comboIngIndex,
                theme.isPremium && { color: DS.color.greenEnd },
              ]}
            >
              {idx + 1}
            </Text>
            <View style={{ flex: 1, gap: 8 }}>
              <TextInput
                style={[
                  formStyles.input,
                  { marginBottom: 0 },
                  theme.isPremium && {
                    backgroundColor: DS.color.bgTertiary,
                    borderColor: DS.color.borderSubtle,
                    color: DS.color.heading,
                  },
                ]}
                value={ing.name}
                onChangeText={(v) =>
                  setComboIngredients((prev) =>
                    prev.map((x) =>
                      x.key === ing.key
                        ? { ...x, name: v, warehouse_product_id: null }
                        : x,
                    ),
                  )
                }
                placeholder="Nazwa składnika"
                placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
              />
              {suggestions.length > 0 && (
                <View
                  style={[
                    styles.comboSuggestBox,
                    theme.isPremium && {
                      backgroundColor: DS.color.bgTertiary,
                      borderColor: DS.color.borderSubtle,
                    },
                  ]}
                >
                  {suggestions.map((s) => (
                    <TouchableOpacity
                      key={s.id}
                      onPress={() =>
                        setComboIngredients((prev) =>
                          prev.map((x) =>
                            x.key === ing.key
                              ? {
                                  ...x,
                                  name: s.product_name,
                                  unit: s.unit === 'opak' ? 'szt' : s.unit,
                                  warehouse_product_id: s.id,
                                }
                              : x,
                          ),
                        )
                      }
                      style={styles.comboSuggestRow}
                    >
                      <Text
                        style={[
                          styles.comboSuggestText,
                          theme.isPremium && { color: DS.color.heading },
                        ]}
                      >
                        {s.product_name}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput
                  style={[
                    formStyles.input,
                    { flex: 1, marginBottom: 0 },
                    theme.isPremium && {
                      backgroundColor: DS.color.bgTertiary,
                      borderColor: DS.color.borderSubtle,
                      color: DS.color.heading,
                    },
                  ]}
                  value={ing.quantity}
                  onChangeText={(v) =>
                    setComboIngredients((prev) =>
                      prev.map((x) =>
                        x.key === ing.key ? { ...x, quantity: v.replace(',', '.') } : x,
                      ),
                    )
                  }
                  placeholder="Ilość"
                  placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                  keyboardType="decimal-pad"
                />
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4, flex: 1.4 }}>
                  {COMBO_UNIT_OPTIONS.map((u) => {
                    const active = ing.unit === u;
                    return (
                      <TouchableOpacity
                        key={u}
                        style={[
                          styles.unitBtn,
                          { paddingHorizontal: 8, paddingVertical: 6 },
                          theme.isPremium && {
                            backgroundColor: DS.color.bgTertiary,
                            borderColor: DS.color.borderSubtle,
                          },
                          active &&
                            (theme.isPremium
                              ? {
                                  backgroundColor: DS.color.greenEnd,
                                  borderColor: DS.color.greenEnd,
                                }
                              : styles.unitBtnActive),
                        ]}
                        onPress={() =>
                          setComboIngredients((prev) =>
                            prev.map((x) =>
                              x.key === ing.key ? { ...x, unit: u } : x,
                            ),
                          )
                        }
                      >
                        <Text
                          style={[
                            styles.unitBtnText,
                            theme.isPremium && !active && { color: DS.color.muted },
                            active &&
                              (theme.isPremium
                                ? { color: '#0A0A0A', fontWeight: '800' }
                                : styles.unitBtnTextActive),
                          ]}
                        >
                          {u}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TouchableOpacity
                  onPress={() =>
                    setComboIngredients((prev) =>
                      prev.length <= 1
                        ? [newComboIngredient()]
                        : prev.filter((x) => x.key !== ing.key),
                    )
                  }
                  hitSlop={8}
                >
                  <Trash2 size={14} color={Colors.danger} strokeWidth={2} />
                </TouchableOpacity>
              </View>
            </View>
          </View>
        );
      })}
      <TouchableOpacity
        style={[
          styles.addIngBtn,
          theme.isPremium && {
            borderColor: DS.color.greenEnd,
            backgroundColor: 'rgba(0,255,120,0.1)',
          },
        ]}
        onPress={() => setComboIngredients((prev) => [...prev, newComboIngredient()])}
        activeOpacity={0.8}
      >
        <Plus size={15} color={theme.isPremium ? DS.color.greenEnd : Colors.accent} strokeWidth={2.5} />
        <Text style={[styles.addIngBtnText, theme.isPremium && { color: DS.color.greenEnd }]}>
          Dodaj składnik
        </Text>
      </TouchableOpacity>
      <View style={styles.fieldWrap}>
        <FieldLabel text="Trwałość (dni w chłodni)" />
        <NumericInput
          value={shelfLifeDays}
          onChange={onShelfLifeChange}
          placeholder="np. 3"
        />
        <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
          Ile dni półprodukt utrzymuje jakość w idealnych warunkach chłodniczych.
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  formSection: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, letterSpacing: 0.5, marginBottom: 12, marginTop: 20 },
  fieldWrap: { marginBottom: 14 },
  fieldHint: { fontSize: 11, color: Colors.textTertiary, marginTop: 5 },
  unitBtn: { paddingHorizontal: 16, paddingVertical: 11, borderRadius: 10, borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center', minWidth: 48 },
  unitBtnActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  unitBtnText: { fontSize: 14, fontWeight: '600', color: Colors.textSecondary },
  unitBtnTextActive: { color: Colors.white },
  comboIngCard: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.card,
  },
  comboIngIndex: { fontSize: 12, fontWeight: '800', color: Colors.accent, marginTop: 10, width: 18 },
  comboSuggestBox: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 8,
    backgroundColor: Colors.card,
  },
  comboSuggestRow: { paddingHorizontal: 10, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: Colors.borderLight },
  comboSuggestText: { fontSize: 13, color: Colors.textPrimary, fontWeight: '500' },
  addIngBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderColor: Colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    backgroundColor: Colors.accentLight,
  },
  addIngBtnText: { fontSize: 13, fontWeight: '700', color: Colors.accent },
});
