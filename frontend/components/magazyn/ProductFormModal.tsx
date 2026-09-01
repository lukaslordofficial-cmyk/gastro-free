import React from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Modal,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { X, Check, FlaskConical } from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import type { CategoryRow, ComboIngredientDraft, MockInventoryItem } from './types';
import { BLANK_FORM, FALLBACK_COLOR, UNIT_OPTIONS } from './constants';
import { newComboIngredient } from './helpers';
import { FieldLabel, NumericInput, formStyles } from './formFields';
import { ComboIngredientsEditor } from './ComboIngredientsEditor';
import { ItemCard } from './ItemCard';
import { magazynScreenStyles as styles } from './magazynScreenStyles';

export type ProductFormState = typeof BLANK_FORM;

export type ProductFormModalProps = {
  visible: boolean;
  editingId: string | null;
  form: ProductFormState;
  setForm: React.Dispatch<React.SetStateAction<ProductFormState>>;
  comboIngredients: ComboIngredientDraft[];
  setComboIngredients: React.Dispatch<React.SetStateAction<ComboIngredientDraft[]>>;
  formCategories: string[];
  categoryColorMap: Record<string, string>;
  categoryProductCounts: Record<string, number>;
  uniqueCategories: CategoryRow[];
  categoryIdMap: Record<string, string>;
  inventory: MockInventoryItem[];
  saving: boolean;
  onSave: () => void;
  onClose: () => void;
  onDeleteCategory: (cat: CategoryRow) => void;
};

export function ProductFormModal({
  visible,
  editingId,
  form,
  setForm,
  comboIngredients,
  setComboIngredients,
  formCategories,
  categoryColorMap,
  categoryProductCounts,
  uniqueCategories,
  categoryIdMap,
  inventory,
  saving,
  onSave,
  onClose,
  onDeleteCategory,
}: ProductFormModalProps) {
  const theme = useAppTheme();

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <SafeAreaView
        style={[
          styles.modalSafe,
          theme.isPremium && { backgroundColor: DS.color.bgPrimary },
        ]}
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
              {editingId ? 'Edytuj produkt' : 'Nowy Produkt'}
            </Text>
            <Text style={[styles.modalSubtitle, theme.isPremium && { color: DS.color.muted }]}>
              {editingId ? 'Zmień progi i stan magazynowy' : 'Uzupełnij dane magazynowe'}
            </Text>
          </View>
          <TouchableOpacity
            style={[
              styles.closeBtn,
              theme.isPremium && { backgroundColor: DS.color.bgTertiary },
            ]}
            onPress={onClose}
          >
            <X size={20} color={theme.isPremium ? DS.color.muted : Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        </View>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.formScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            <Text style={[styles.formSection, theme.isPremium && { color: DS.color.heading }]}>Podstawowe dane</Text>
            <View style={styles.fieldWrap}>
              <FieldLabel text="Nazwa produktu" required />
              <TextInput
                style={[
                  formStyles.input,
                  theme.isPremium && {
                    backgroundColor: DS.color.bgTertiary,
                    borderColor: DS.color.borderSubtle,
                    color: DS.color.heading,
                  },
                ]}
                placeholder="np. Kurczak filet"
                placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                value={form.name}
                onChangeText={(v) => setForm((f) => ({ ...f, name: v }))}
                returnKeyType="next"
              />
            </View>
            <View style={styles.fieldWrap}>
              <FieldLabel text="Odmiana / wariant (opcjonalnie)" />
              <TextInput
                style={[
                  formStyles.input,
                  theme.isPremium && {
                    backgroundColor: DS.color.bgTertiary,
                    borderColor: DS.color.borderSubtle,
                    color: DS.color.heading,
                  },
                ]}
                placeholder="np. Irys, Jonagold, Premium, BIO, bezglutenowy"
                placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                value={form.variant}
                onChangeText={(v) => setForm((f) => ({ ...f, variant: v }))}
                returnKeyType="next"
                testID="add-product-variant"
              />
              <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                Doprecyzuj produkt — Łowca Okazji najpierw poszuka dokładnie tej odmiany, a inne odmiany zaproponuje jako zamiennik.
              </Text>
            </View>
            <View style={styles.fieldWrap}>
              <FieldLabel text="Kategoria" required />
              {formCategories.length === 0 ? (
                <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                  Brak kategorii — dodaj je przyciskiem "Dodaj kategorię"
                </Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
                  {formCategories.map((cat) => {
                    const active = form.category === cat;
                    const color = categoryColorMap[cat] ?? FALLBACK_COLOR;
                    const count = categoryProductCounts[cat] ?? 0;
                    const catRow = uniqueCategories.find((c) => c.name === cat);
                    return (
                      <View
                        key={cat}
                        style={[
                          styles.formPill,
                          theme.isPremium && !active && {
                            backgroundColor: DS.color.bgTertiary,
                            borderColor: DS.color.borderSubtle,
                          },
                          active && { backgroundColor: color, borderColor: color },
                        ]}
                      >
                        <TouchableOpacity
                          style={styles.formPillMain}
                          onPress={() => setForm((f) => ({ ...f, category: cat }))}
                          activeOpacity={0.7}
                        >
                          {active && <Check size={11} color={Colors.white} strokeWidth={3} />}
                          <Text
                            style={[
                              styles.formPillText,
                              theme.isPremium && !active && { color: DS.color.muted },
                              active && { color: Colors.white, fontWeight: '700' },
                            ]}
                          >
                            {cat}
                          </Text>
                          {count > 0 && (
                            <Text
                              style={[
                                styles.formPillCount,
                                theme.isPremium && !active && { color: DS.color.muted },
                                active && { color: Colors.white },
                              ]}
                            >
                              {count}
                            </Text>
                          )}
                        </TouchableOpacity>
                        {catRow && (
                          <TouchableOpacity
                            onPress={() => onDeleteCategory(catRow)}
                            hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                            style={styles.formPillDelete}
                          >
                            <X
                              size={10}
                              color={
                                active
                                  ? 'rgba(255,255,255,0.75)'
                                  : theme.isPremium
                                    ? DS.color.muted
                                    : Colors.textTertiary
                              }
                              strokeWidth={2.5}
                            />
                          </TouchableOpacity>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
            <Text style={[styles.formSection, theme.isPremium && { color: DS.color.heading }]}>Stan magazynowy</Text>
            <View style={styles.fieldRow}>
              <View style={[styles.fieldWrap, { flex: 1 }]}>
                <FieldLabel text="Aktualna ilość" required />
                <NumericInput value={form.currentQty} onChange={(v) => setForm((f) => ({ ...f, currentQty: v }))} placeholder="np. 1500" />
                <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                  Ile jest teraz w magazynie
                </Text>
              </View>
              <View style={[styles.fieldWrap, { flex: 1 }]}>
                <FieldLabel text="Próg krytyczny" required />
                <NumericInput value={form.criticalThreshold} onChange={(v) => setForm((f) => ({ ...f, criticalThreshold: v }))} placeholder="np. 2000" />
                <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                  Poniżej → trzeba zamówić
                </Text>
              </View>
            </View>
            <View style={styles.fieldWrap}>
              <FieldLabel text="Próg optymalny" />
              <NumericInput
                value={form.optimalThreshold}
                onChange={(v) => setForm((f) => ({ ...f, optimalThreshold: v }))}
                placeholder="np. 5000 (docelowy zapas)"
              />
              <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                Docelowa ilość, do której Łowca okazji będzie robił zakupy, gdy produkt spadnie poniżej stanu krytycznego.
              </Text>
            </View>
            <View style={styles.fieldWrap}>
              <FieldLabel text="Jednostka" required />
              <View style={styles.unitRow}>
                {UNIT_OPTIONS.map((u) => {
                  const active = form.unit === u;
                  return (
                    <TouchableOpacity
                      key={u}
                      style={[
                        styles.unitBtn,
                        theme.isPremium && {
                          backgroundColor: DS.color.bgTertiary,
                          borderColor: DS.color.borderSubtle,
                        },
                        active && (theme.isPremium
                          ? { backgroundColor: DS.color.greenEnd, borderColor: DS.color.greenEnd }
                          : styles.unitBtnActive),
                      ]}
                      onPress={() => setForm((f) => ({ ...f, unit: u }))}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[
                          styles.unitBtnText,
                          theme.isPremium && { color: DS.color.muted },
                          active && (theme.isPremium
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
            </View>
            {(form.unit === 'szt' || form.unit === 'opak') && (
              <View style={styles.fieldWrap}>
                <FieldLabel text={`Waga/objętość jednej ${form.unit === 'opak' ? 'op.' : 'szt.'}`} />
                <View style={styles.wvRow}>
                  <TextInput
                    style={[
                      formStyles.input,
                      { flex: 1 },
                      theme.isPremium && {
                        backgroundColor: DS.color.bgTertiary,
                        borderColor: DS.color.borderSubtle,
                        color: DS.color.heading,
                      },
                    ]}
                    value={form.unitWeightVolume}
                    onChangeText={(v) => setForm((f) => ({ ...f, unitWeightVolume: v.replace(',', '.') }))}
                    placeholder="np. 400"
                    placeholderTextColor={theme.isPremium ? DS.color.muted : Colors.textTertiary}
                    keyboardType="decimal-pad"
                    testID="add-product-unit-weight"
                  />
                  <View
                    style={[
                      styles.wvToggle,
                      theme.isPremium && {
                        backgroundColor: DS.color.bgSecondary,
                        borderColor: DS.color.borderSubtle,
                      },
                    ]}
                  >
                    {(['g', 'ml'] as const).map((u) => {
                      const active = form.weightVolumeUnit === u;
                      return (
                        <TouchableOpacity
                          key={u}
                          style={[
                            styles.wvToggleBtn,
                            active && (theme.isPremium
                              ? { backgroundColor: DS.color.greenEnd }
                              : styles.wvToggleBtnActive),
                          ]}
                          onPress={() => setForm((f) => ({ ...f, weightVolumeUnit: u }))}
                          activeOpacity={0.7}
                          testID={`add-product-wv-unit-${u}`}
                        >
                          <Text
                            style={[
                              styles.wvToggleText,
                              theme.isPremium && !active && { color: DS.color.muted },
                              active && (theme.isPremium
                                ? { color: '#0A0A0A', fontWeight: '800' }
                                : styles.wvToggleTextActive),
                            ]}
                          >
                            {u}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
                <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                  Pozwala przeliczać zapas na porcje potraw liczonych w {form.weightVolumeUnit} (np. 1 szt. = 400 g).
                </Text>
              </View>
            )}
            <View
              style={[
                styles.portionInfoBox,
                theme.isPremium && {
                  backgroundColor: 'rgba(0,230,118,0.08)',
                  borderLeftColor: DS.color.greenEnd,
                },
              ]}
            >
              <Text style={[styles.portionInfoText, theme.isPremium && { color: DS.color.body }]}>
                Porcje wyliczane są{' '}
                <Text style={{ fontWeight: '700', color: theme.isPremium ? DS.color.heading : Colors.textPrimary }}>
                  automatycznie
                </Text>{' '}
                na podstawie receptur z Menu. Otwórz produkt → „Dostępność w menu", aby zobaczyć na ile porcji każdej potrawy wystarczy zapas.
              </Text>
            </View>
            <Text style={[styles.formSection, theme.isPremium && { color: DS.color.heading }]}>Typ produktu</Text>
            <View
              style={[
                styles.switchRow,
                theme.isPremium && {
                  backgroundColor: DS.color.bgTertiary,
                  borderColor: DS.color.borderSubtle,
                },
              ]}
            >
              <View style={styles.switchInfo}>
                <FlaskConical size={16} color={theme.isPremium ? DS.color.greenEnd : Colors.accent} strokeWidth={2} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.switchLabel, theme.isPremium && { color: DS.color.heading }]}>
                    Półprodukt / Combo
                  </Text>
                  <Text style={[styles.switchHint, theme.isPremium && { color: DS.color.muted }]}>
                    Przygotowywany wewnętrznie z innych produktów z magazynu np. Sos kurkowy do Penne z kurkami i kozim serem.
                  </Text>
                </View>
              </View>
              <Switch
                value={form.isCombo}
                onValueChange={(v) => {
                  setForm((f) => ({
                    ...f,
                    isCombo: v,
                    unit: v ? 'porcja' : (f.unit === 'porcja' ? 'szt' : f.unit),
                    category: v && (!f.category || f.category === 'Inne')
                      ? 'Półprodukty'
                      : f.category,
                  }));
                  if (v && comboIngredients.length === 0) {
                    setComboIngredients([newComboIngredient()]);
                  }
                }}
                trackColor={{
                  false: theme.isPremium ? DS.color.borderSubtle : Colors.borderLight,
                  true: theme.isPremium ? 'rgba(0,230,118,0.45)' : Colors.accentLight,
                }}
                thumbColor={
                  form.isCombo
                    ? theme.isPremium
                      ? DS.color.greenEnd
                      : Colors.accent
                    : theme.isPremium
                      ? DS.color.muted
                      : Colors.textTertiary
                }
              />
            </View>

            {form.isCombo && (
              <ComboIngredientsEditor
                theme={theme}
                inventory={inventory}
                editingId={editingId}
                comboIngredients={comboIngredients}
                setComboIngredients={setComboIngredients}
                shelfLifeDays={form.shelfLifeDays}
                onShelfLifeChange={(v) => setForm((f) => ({ ...f, shelfLifeDays: v }))}
              />
            )}

            <View style={styles.fieldWrap}>
              <FieldLabel text={`Bufor bezpieczeństwa (%) — min 10, domyślnie 20`} />
              <NumericInput
                value={form.safetyBuffer}
                onChange={(v) => setForm((f) => ({ ...f, safetyBuffer: v }))}
                placeholder="20"
              />
              <Text style={[styles.fieldHint, theme.isPremium && { color: DS.color.muted }]}>
                Ostrzeżenie o niskim stanie włączone wcześniej o {form.safetyBuffer || 20}% jako
                bufor na ubytki naturalne i straty (min. 10%).
              </Text>
            </View>
            {form.name.trim() !== '' && form.currentQty !== '' && form.criticalThreshold !== '' && (
              <View style={styles.previewWrap}>
                <Text style={[styles.previewLabel, theme.isPremium && { color: DS.color.muted }]}>
                  Pogląd karty produktu
                </Text>
                <ItemCard
                  item={{
                    id: '__preview__',
                    product_name: form.name.trim(),
                    category: form.category,
                    category_id: categoryIdMap[form.category] ?? null,
                    current_qty: parseFloat(form.currentQty) || 0,
                    critical_threshold: parseFloat(form.criticalThreshold) || 1,
                    optimal_threshold: parseFloat(form.optimalThreshold) || 0,
                    unit: form.unit,
                    is_combo_półprodukt: form.isCombo,
                    portion_size: null,
                    safety_buffer_percent: parseFloat(form.safetyBuffer) || 20,
                    shelf_life_days: form.shelfLifeDays ? parseInt(form.shelfLifeDays, 10) : null,
                  }}
                  catColor={categoryColorMap[form.category] ?? FALLBACK_COLOR}
                />
              </View>
            )}
            <TouchableOpacity
              style={[
                styles.saveBtn,
                theme.isPremium && { backgroundColor: DS.color.greenEnd, shadowColor: DS.color.greenEnd },
                saving && { opacity: 0.6 },
              ]}
              onPress={onSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Check size={18} color={theme.isPremium ? '#0A0A0A' : Colors.white} strokeWidth={2.5} />
              <Text style={[styles.saveBtnText, theme.isPremium && { color: '#0A0A0A' }]}>
                {saving ? 'Zapisywanie...' : (editingId ? 'Zapisz zmiany' : 'Zapisz Produkt')}
              </Text>
            </TouchableOpacity>
            <View style={{ height: 32 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}
