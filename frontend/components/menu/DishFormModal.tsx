import React from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Check, Plus, X } from 'lucide-react-native';
import { IngredientRow } from '@/components/menu/IngredientRow';
import { menuScreenStyles as styles } from '@/components/menu/menuScreenStyles';
import { BLANK_DISH_FORM } from '@/constants/menuFormDefaults';
import { CATEGORY_COLORS, FORM_CATEGORIES } from '@/constants/menuUi';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { newDraftIngredient } from '@/lib/menuScreenHelpers';
import type { IngredientDraft, StockStatus } from '@/types/menu';

export type DishFormState = typeof BLANK_DISH_FORM;

export function DishFormModal({
  visible,
  isEditing,
  editingName,
  form,
  setForm,
  ingredients,
  setIngredients,
  inventoryCount,
  getSuggestions,
  getStockStatus,
  onIngredientChange,
  onIngredientRemove,
  onSelectSuggestion,
  onSave,
  saving,
  onClose,
}: {
  visible: boolean;
  isEditing: boolean;
  editingName?: string | null;
  form: DishFormState;
  setForm: React.Dispatch<React.SetStateAction<DishFormState>>;
  ingredients: IngredientDraft[];
  setIngredients: React.Dispatch<React.SetStateAction<IngredientDraft[]>>;
  inventoryCount: number;
  getSuggestions: (draftName: string) => string[];
  getStockStatus: (name: string) => StockStatus | null;
  onIngredientChange: (key: string, field: keyof IngredientDraft, value: string) => void;
  onIngredientRemove: (key: string) => void;
  onSelectSuggestion: (key: string, name: string) => void;
  onSave: () => void;
  saving: boolean;
  onClose: () => void;
}) {
  const theme = useAppTheme();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
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
              {isEditing ? `Zmiana: ${editingName}` : 'Uzupełnij dane i recepturę'}
            </Text>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
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
              <TextInput
                style={[
                  styles.input,
                  { marginTop: 8 },
                  theme.isPremium && {
                    backgroundColor: DS.color.bgTertiary,
                    borderColor: DS.color.borderSubtle,
                    color: DS.color.heading,
                  },
                ]}
                placeholder="lub wpisz nową kategorię…"
                placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                value={form.category}
                onChangeText={(v) => setForm((f) => ({ ...f, category: v }))}
                returnKeyType="next"
                autoCapitalize="sentences"
                testID="menu-new-category-input"
              />
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
                Podpowiedzi pobierane z magazynu ({inventoryCount} produktów). Nieznane składniki będziesz mógł dodać na bieżąco.
              </Text>
            </View>

            {ingredients.map((ing, idx) => (
              <IngredientRow
                key={ing.key}
                draft={ing}
                index={idx}
                suggestions={getSuggestions(ing.name)}
                stock={getStockStatus(ing.name)}
                onChange={onIngredientChange}
                onRemove={onIngredientRemove}
                onSelectSuggestion={onSelectSuggestion}
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
              onPress={onSave}
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
  );
}
