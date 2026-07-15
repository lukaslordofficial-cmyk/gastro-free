import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  TextInput,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  X,
  FileText,
  Camera,
  Sparkles,
  Check,
  CircleAlert,
  ScanLine,
  ChefHat,
  ChevronDown,
  Plus,
  Trash2,
  Scale,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { parsePln, formatPlnNumber } from '@/lib/format';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

const MENU_CATEGORIES = [
  'Przystawki', 'Zupy', 'Sałatki', 'Burgery', 'Dania główne',
  'Makarony', 'Pizza', 'Desery', 'Napoje', 'Alkohole', 'Inne',
];

const WEIGHT_UNITS = ['g', 'ml', 'szt'] as const;
type WeightUnit = typeof WEIGHT_UNITS[number];

const INGREDIENT_UNITS = ['g', 'ml', 'szt'] as const;
type IngredientUnit = typeof INGREDIENT_UNITS[number];

interface Ingredient {
  key: string;
  name: string;
  quantity: string;      // string state for editable input
  unit: IngredientUnit;
}

interface DraftDish {
  key: string;
  name: string;
  category: string;
  priceInput: string;
  portionWeightInput: string;
  portionWeightUnit: WeightUnit | null;
  ingredients: Ingredient[];
}

interface Suggestion {
  suggested_ingredients: { name: string; quantity: number; unit: string }[];
  suggested_portion_weight_value: number | null;
  suggested_portion_weight_unit: string | null;
}

type Stage = 'choose' | 'scanning' | 'edit' | 'ask_suggest' | 'suggesting' | 'confirming' | 'done';

function newIngredientKey(): string {
  return String(Date.now() + Math.random());
}

function newIngredient(name = '', quantity = '', unit: IngredientUnit = 'g'): Ingredient {
  return { key: newIngredientKey(), name, quantity, unit };
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirmed: () => void;
}

export function MenuScanModal({ visible, onClose, onConfirmed }: Props) {
  const [stage, setStage] = useState<Stage>('choose');
  const [error, setError] = useState<string | null>(null);
  const [dishes, setDishes] = useState<DraftDish[]>([]);
  const [categoryPickerFor, setCategoryPickerFor] = useState<string | null>(null);
  const [result, setResult] = useState<{ inserted: number; warnings: string[]; inventoryCreated: number; inventoryItems: { name: string; category: string }[] } | null>(null);

  // Bookkeeping for the "ask AI to suggest?" flow
  const [dishesNeedingIngredients, setDishesNeedingIngredients] = useState<string[]>([]);
  const [dishesNeedingWeight, setDishesNeedingWeight] = useState<string[]>([]);

  const reset = useCallback(() => {
    setStage('choose');
    setError(null);
    setDishes([]);
    setCategoryPickerFor(null);
    setResult(null);
    setDishesNeedingIngredients([]);
    setDishesNeedingWeight([]);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const processFile = useCallback(async (uri: string, name: string, mimeType: string) => {
    setStage('scanning');
    setError(null);
    try {
      const form = new FormData();
      form.append('file', { uri, name, type: mimeType } as any);
      const res = await fetch(`${BACKEND_URL}/api/menu/scan`, { method: 'POST', body: form });
      if (!res.ok) {
        const txt = await res.text();
        let detail = txt;
        try { detail = JSON.parse(txt).detail ?? txt; } catch {}
        throw new Error(detail || `Błąd serwera (${res.status})`);
      }
      const data = await res.json();
      const parsedDishes: DraftDish[] = (data.dishes ?? []).map((d: any) => ({
        key: newIngredientKey(),
        name: d.name ?? '',
        category: MENU_CATEGORIES.includes(d.category) ? d.category : 'Inne',
        priceInput: formatPlnNumber(d.price_pln ?? 0),
        portionWeightInput:
          d.portion_weight_value != null ? String(d.portion_weight_value) : '',
        portionWeightUnit:
          d.portion_weight_unit === 'g' || d.portion_weight_unit === 'ml' || d.portion_weight_unit === 'szt'
            ? d.portion_weight_unit
            : null,
        ingredients: (d.ingredients ?? []).map((i: any) =>
          newIngredient(
            i.name ?? '',
            i.quantity != null ? String(i.quantity) : '',
            i.unit === 'ml' || i.unit === 'szt' ? i.unit : 'g'
          )
        ),
      }));
      setDishes(parsedDishes);
      if (parsedDishes.length === 0) {
        setError('AI nie rozpoznało żadnej potrawy. Spróbuj wgrać wyraźniejsze zdjęcie/PDF.');
        setStage('choose');
        return;
      }
      setStage('edit');
    } catch (e: any) {
      setError(e.message ?? 'Nie udało się przetworzyć menu.');
      setStage('choose');
    }
  }, []);

  const handlePickFile = useCallback(async () => {
    const r = await DocumentPicker.getDocumentAsync({
      type: ['application/pdf', 'image/jpeg', 'image/png', 'image/jpg'],
      copyToCacheDirectory: true,
    });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    await processFile(a.uri, a.name ?? 'menu', a.mimeType ?? 'application/pdf');
  }, [processFile]);

  const handleCamera = useCallback(async () => {
    let perm = await ImagePicker.getCameraPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Brak dostępu do aparatu. Włącz uprawnienia aparatu w Ustawieniach.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.85, mediaTypes: ['images'] });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    await processFile(a.uri, a.fileName ?? 'menu.jpg', a.mimeType ?? 'image/jpeg');
  }, [processFile]);

  // ── Dish/ingredient editing ────────────────────────────────────────────────
  const patchDish = useCallback((key: string, patch: Partial<DraftDish>) => {
    setDishes((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }, []);

  const removeDish = useCallback((key: string) => {
    setDishes((prev) => prev.filter((d) => d.key !== key));
  }, []);

  const addIngredient = useCallback((dishKey: string) => {
    setDishes((prev) =>
      prev.map((d) => (d.key === dishKey ? { ...d, ingredients: [...d.ingredients, newIngredient()] } : d))
    );
  }, []);

  const patchIngredient = useCallback((dishKey: string, ingKey: string, patch: Partial<Ingredient>) => {
    setDishes((prev) =>
      prev.map((d) =>
        d.key === dishKey
          ? { ...d, ingredients: d.ingredients.map((i) => (i.key === ingKey ? { ...i, ...patch } : i)) }
          : d
      )
    );
  }, []);

  const removeIngredient = useCallback((dishKey: string, ingKey: string) => {
    setDishes((prev) =>
      prev.map((d) => (d.key === dishKey ? { ...d, ingredients: d.ingredients.filter((i) => i.key !== ingKey) } : d))
    );
  }, []);

  // ── Confirm flow ───────────────────────────────────────────────────────────
  const preparePayloadDishes = () => {
    return dishes.map((d) => ({
      name: d.name.trim(),
      category: d.category,
      price_pln: parsePln(d.priceInput),
      portion_weight_value: d.portionWeightInput.trim() ? parsePln(d.portionWeightInput) : null,
      portion_weight_unit: d.portionWeightUnit,
      ingredients: d.ingredients
        .filter((i) => i.name.trim())
        .map((i) => ({
          name: i.name.trim(),
          quantity: i.quantity.trim() ? parsePln(i.quantity) : null,
          unit: i.unit,
        })),
    }));
  };

  const handleConfirmClick = useCallback(() => {
    const invalid = dishes.some((d) => !d.name.trim());
    if (invalid) {
      setError('Każda potrawa musi mieć nazwę.');
      return;
    }
    setError(null);

    // Detect dishes needing help
    const needIng: string[] = [];
    const needWeight: string[] = [];
    dishes.forEach((d) => {
      const hasIngredients = d.ingredients.some((i) => i.name.trim());
      const hasWeight = !!d.portionWeightInput.trim() && !!d.portionWeightUnit;
      if (!hasIngredients) needIng.push(d.key);
      if (!hasWeight) needWeight.push(d.key);
    });

    if (needIng.length === 0 && needWeight.length === 0) {
      void confirmSave(false);
      return;
    }
    setDishesNeedingIngredients(needIng);
    setDishesNeedingWeight(needWeight);
    setStage('ask_suggest');
  }, [dishes]);

  const confirmSave = useCallback(async (withSuggestions: boolean) => {
    setStage(withSuggestions ? 'suggesting' : 'confirming');
    setError(null);
    try {
      let finalPayload = preparePayloadDishes();

      if (withSuggestions) {
        // Ask AI for missing fields
        const askDishes = dishes
          .filter(
            (d) => dishesNeedingIngredients.includes(d.key) || dishesNeedingWeight.includes(d.key)
          )
          .map((d) => ({
            name: d.name.trim(),
            category: d.category,
            ingredients: d.ingredients
              .filter((i) => i.name.trim())
              .map((i) => ({
                name: i.name.trim(),
                quantity: i.quantity.trim() ? parsePln(i.quantity) : null,
                unit: i.unit,
              })),
            portion_weight_value: d.portionWeightInput.trim() ? parsePln(d.portionWeightInput) : null,
            portion_weight_unit: d.portionWeightUnit,
          }));

        if (askDishes.length > 0) {
          const res = await fetch(`${BACKEND_URL}/api/menu/suggest-recipe`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dishes: askDishes }),
          });
          if (!res.ok) {
            const txt = await res.text();
            let detail = txt;
            try { detail = JSON.parse(txt).detail ?? txt; } catch {}
            throw new Error(detail || `Sugestie AI: błąd (${res.status})`);
          }
          const sug = await res.json();
          const byName: Record<string, Suggestion> = {};
          for (const s of sug.dishes ?? []) {
            byName[(s.name ?? '').trim().toLowerCase()] = s;
          }
          finalPayload = finalPayload.map((d) => {
            const key = d.name.toLowerCase();
            const s = byName[key];
            if (!s) return d;

            // Ingredients: only fill if user provided none
            let ingredients = d.ingredients;
            if (ingredients.length === 0 && (s.suggested_ingredients ?? []).length > 0) {
              ingredients = s.suggested_ingredients.map((si) => ({
                name: si.name,
                quantity: Number(si.quantity ?? 0),
                unit: si.unit || 'g',
              }));
            }

            // Portion weight: only fill if user didn't provide
            let portion_weight_value = d.portion_weight_value;
            let portion_weight_unit = d.portion_weight_unit;
            if (
              (portion_weight_value == null || !portion_weight_unit) &&
              s.suggested_portion_weight_value != null &&
              s.suggested_portion_weight_unit
            ) {
              portion_weight_value = Number(s.suggested_portion_weight_value);
              portion_weight_unit = s.suggested_portion_weight_unit as WeightUnit;
            }

            return { ...d, ingredients, portion_weight_value, portion_weight_unit };
          });
        }
      }

      const res = await fetch(`${BACKEND_URL}/api/menu/confirm-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dishes: finalPayload }),
      });
      if (!res.ok) {
        const txt = await res.text();
        let detail = txt;
        try { detail = JSON.parse(txt).detail ?? txt; } catch {}
        throw new Error(detail || `Zapis: błąd (${res.status})`);
      }
      const data = await res.json();
      setResult({
        inserted: Number(data.inserted ?? 0),
        warnings: data.warnings ?? [],
        inventoryCreated: Number(data.inventory_created ?? 0),
        inventoryItems: data.inventory_items ?? [],
      });
      setStage('done');
    } catch (e: any) {
      setError(e.message ?? 'Nie udało się zapisać potraw.');
      setStage('edit');
    }
  }, [dishes, dishesNeedingIngredients, dishesNeedingWeight]);

  const handleFinishDone = useCallback(() => {
    onConfirmed();
    reset();
  }, [onConfirmed, reset]);

  // ── Render ────────────────────────────────────────────────────────────────
  const suggestionCount =
    dishesNeedingIngredients.length + dishesNeedingWeight.length;
  const bothMissing = dishesNeedingIngredients.length > 0 && dishesNeedingWeight.length > 0;
  const askMessage = bothMissing
    ? `Dla ${dishesNeedingIngredients.length} potraw brakuje składników, a dla ${dishesNeedingWeight.length} brakuje gramatury. Czy AI ma zaproponować brakujące wartości na podstawie wzorcowych przepisów?`
    : dishesNeedingIngredients.length > 0
    ? `Dla ${dishesNeedingIngredients.length} potraw nie podano składników. Czy AI ma zaproponować składniki i gramatury na podstawie wzorcowych przepisów?`
    : `Dla ${dishesNeedingWeight.length} potraw nie podano gramatury porcji. Czy AI ma zaproponować gramatury na podstawie wzorcowych przepisów?`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}>
              <ScanLine size={18} color={Colors.accent} strokeWidth={2} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Skan menu AI</Text>
              <Text style={styles.subtitle} numberOfLines={1}>
                {stage === 'edit' ? `${dishes.length} potraw rozpoznanych` : 'Wgraj menu w PDF/JPG'}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            onPress={handleClose}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            testID="menu-scan-close"
          >
            <X size={22} color={Colors.textSecondary} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {error && (
          <View style={styles.errorBox} testID="menu-scan-error">
            <CircleAlert size={15} color={Colors.danger} strokeWidth={2} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {stage === 'choose' && (
          <ScrollView contentContainerStyle={styles.chooseWrap}>
            <View style={styles.hintCard}>
              <Sparkles size={16} color={Colors.warning} strokeWidth={2} />
              <Text style={styles.hintText}>
                Wgraj <Text style={styles.b}>menu restauracji</Text> (PDF lub zdjęcie). AI odczyta nazwy dań, ceny,
                kategorie oraz — jeśli są w menu — składniki i gramaturę. Wszystko pokażemy do edycji.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.sourceBtn}
              onPress={handleCamera}
              testID="menu-scan-camera"
              activeOpacity={0.85}
            >
              <View style={[styles.sourceIcon, { backgroundColor: Colors.accentLight }]}>
                <Camera size={22} color={Colors.accent} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceTitle}>Zrób zdjęcie</Text>
                <Text style={styles.sourceSub}>Sfotografuj menu aparatem</Text>
              </View>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sourceBtn}
              onPress={handlePickFile}
              testID="menu-scan-file"
              activeOpacity={0.85}
            >
              <View style={[styles.sourceIcon, { backgroundColor: '#F0FDF4' }]}>
                <FileText size={22} color={Colors.success} strokeWidth={2} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sourceTitle}>Wgraj plik</Text>
                <Text style={styles.sourceSub}>PDF, JPG lub PNG</Text>
              </View>
            </TouchableOpacity>
          </ScrollView>
        )}

        {stage === 'scanning' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.analyzingTitle}>Odczytuję menu…</Text>
            <Text style={styles.analyzingSub}>GPT-4o rozpoznaje potrawy i ceny</Text>
          </View>
        )}

        {stage === 'edit' && (
          <>
            <KeyboardAvoidingView
              style={{ flex: 1 }}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={styles.editContent}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
                <View style={styles.editHint}>
                  <ChefHat size={13} color={Colors.accent} strokeWidth={2} />
                  <Text style={styles.editHintText}>
                    Popraw nazwy/ceny, dodaj lub usuń składniki i gramaturę. Puste pola AI może uzupełnić
                    proponowanymi wartościami po Twojej akceptacji.
                  </Text>
                </View>

                {dishes.map((d, idx) => (
                  <View key={d.key} style={styles.dishCard} testID={`menu-scan-dish-${idx}`}>
                    <View style={styles.dishHeader}>
                      <TextInput
                        style={styles.dishName}
                        value={d.name}
                        placeholder="Nazwa potrawy"
                        placeholderTextColor={Colors.textTertiary}
                        onChangeText={(v) => patchDish(d.key, { name: v })}
                        testID={`menu-scan-name-${idx}`}
                      />
                      <TouchableOpacity
                        onPress={() => removeDish(d.key)}
                        style={styles.dishRemove}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        testID={`menu-scan-remove-${idx}`}
                      >
                        <Trash2 size={15} color={Colors.danger} strokeWidth={2} />
                      </TouchableOpacity>
                    </View>

                    <View style={styles.dishMetaRow}>
                      <TouchableOpacity
                        style={styles.catChip}
                        onPress={() => setCategoryPickerFor(d.key)}
                        testID={`menu-scan-category-${idx}`}
                        activeOpacity={0.7}
                      >
                        <Text style={styles.catChipText}>{d.category}</Text>
                        <ChevronDown size={13} color={Colors.accent} strokeWidth={2.5} />
                      </TouchableOpacity>

                      <View style={styles.priceField}>
                        <TextInput
                          style={styles.priceInput}
                          value={d.priceInput}
                          keyboardType="decimal-pad"
                          onChangeText={(v) => patchDish(d.key, { priceInput: v })}
                          selectTextOnFocus
                          testID={`menu-scan-price-${idx}`}
                        />
                        <Text style={styles.priceSuffix}>zł</Text>
                      </View>
                    </View>

                    <View style={styles.weightRow}>
                      <View style={styles.weightLabelWrap}>
                        <Scale size={12} color={Colors.textSecondary} strokeWidth={2} />
                        <Text style={styles.weightLabel}>Gramatura porcji</Text>
                      </View>
                      <View style={styles.weightControls}>
                        <TextInput
                          style={styles.weightInput}
                          value={d.portionWeightInput}
                          placeholder="np. 350"
                          placeholderTextColor={Colors.textTertiary}
                          keyboardType="decimal-pad"
                          onChangeText={(v) => patchDish(d.key, { portionWeightInput: v })}
                          testID={`menu-scan-weight-${idx}`}
                        />
                        <View style={styles.weightUnitToggle}>
                          {WEIGHT_UNITS.map((u) => {
                            const active = d.portionWeightUnit === u;
                            return (
                              <TouchableOpacity
                                key={u}
                                style={[styles.weightUnitBtn, active && styles.weightUnitBtnActive]}
                                onPress={() => patchDish(d.key, { portionWeightUnit: u })}
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
                        <View key={ing.key} style={styles.ingRow}>
                          <TextInput
                            style={[styles.ingInput, styles.ingName]}
                            value={ing.name}
                            placeholder="Nazwa"
                            placeholderTextColor={Colors.textTertiary}
                            onChangeText={(v) => patchIngredient(d.key, ing.key, { name: v })}
                            testID={`menu-scan-ing-name-${idx}-${ingIdx}`}
                          />
                          <TextInput
                            style={[styles.ingInput, styles.ingQty]}
                            value={ing.quantity}
                            placeholder="ilość"
                            placeholderTextColor={Colors.textTertiary}
                            keyboardType="decimal-pad"
                            onChangeText={(v) => patchIngredient(d.key, ing.key, { quantity: v })}
                            testID={`menu-scan-ing-qty-${idx}-${ingIdx}`}
                          />
                          <View style={styles.ingUnitToggle}>
                            {INGREDIENT_UNITS.map((u) => {
                              const active = ing.unit === u;
                              return (
                                <TouchableOpacity
                                  key={u}
                                  style={[styles.ingUnitBtn, active && styles.ingUnitBtnActive]}
                                  onPress={() => patchIngredient(d.key, ing.key, { unit: u })}
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
                            onPress={() => removeIngredient(d.key, ing.key)}
                            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                          >
                            <Trash2 size={13} color={Colors.danger} strokeWidth={2} />
                          </TouchableOpacity>
                        </View>
                      ))
                    )}
                    <TouchableOpacity
                      style={styles.addIngBtn}
                      onPress={() => addIngredient(d.key)}
                      activeOpacity={0.8}
                      testID={`menu-scan-add-ing-${idx}`}
                    >
                      <Plus size={13} color={Colors.accent} strokeWidth={2.5} />
                      <Text style={styles.addIngText}>Dodaj składnik</Text>
                    </TouchableOpacity>
                  </View>
                ))}

                <View style={{ height: 24 }} />
              </ScrollView>
              <View style={styles.footer}>
                <TouchableOpacity
                  style={[styles.confirmBtn, dishes.length === 0 && { opacity: 0.5 }]}
                  onPress={handleConfirmClick}
                  activeOpacity={0.85}
                  disabled={dishes.length === 0}
                  testID="menu-scan-confirm"
                >
                  <Check size={18} color={Colors.white} strokeWidth={2.5} />
                  <Text style={styles.confirmBtnText}>Zapisz {dishes.length} potraw do menu</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>

            <Modal
              visible={categoryPickerFor !== null}
              transparent
              animationType="fade"
              onRequestClose={() => setCategoryPickerFor(null)}
            >
              <TouchableOpacity
                style={styles.pickerOverlay}
                activeOpacity={1}
                onPress={() => setCategoryPickerFor(null)}
              >
                <View style={styles.pickerSheet}>
                  <Text style={styles.pickerTitle}>Wybierz kategorię</Text>
                  <ScrollView style={{ maxHeight: 400 }}>
                    {MENU_CATEGORIES.map((cat) => {
                      const currentDish = dishes.find((d) => d.key === categoryPickerFor);
                      const active = currentDish?.category === cat;
                      return (
                        <TouchableOpacity
                          key={cat}
                          style={[styles.pickerRow, active && styles.pickerRowActive]}
                          onPress={() => {
                            if (categoryPickerFor) {
                              patchDish(categoryPickerFor, { category: cat });
                            }
                            setCategoryPickerFor(null);
                          }}
                          testID={`menu-scan-category-option-${cat}`}
                        >
                          <Text style={[styles.pickerRowText, active && styles.pickerRowTextActive]}>
                            {cat}
                          </Text>
                          {active && <Check size={16} color={Colors.accent} strokeWidth={2.5} />}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </TouchableOpacity>
            </Modal>
          </>
        )}

        {stage === 'ask_suggest' && (
          <View style={styles.askWrap}>
            <View style={styles.askIcon}>
              <Sparkles size={30} color={Colors.warning} strokeWidth={2} />
            </View>
            <Text style={styles.askTitle}>Uzupełnić dane AI?</Text>
            <Text style={styles.askText}>{askMessage}</Text>
            <Text style={styles.askMeta}>
              Dotknij TAK, aby AI dopisał brakujące składniki i gramatury. Dotknij NIE, aby zapisać tylko to
              co teraz jest w formularzu.
            </Text>
            <View style={styles.askButtons}>
              <TouchableOpacity
                style={[styles.askBtn, styles.askBtnSecondary]}
                onPress={() => void confirmSave(false)}
                activeOpacity={0.85}
                testID="menu-scan-suggest-no"
              >
                <Text style={styles.askBtnSecondaryText}>Nie, zapisz jak jest</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.askBtn, styles.askBtnPrimary]}
                onPress={() => void confirmSave(true)}
                activeOpacity={0.85}
                testID="menu-scan-suggest-yes"
              >
                <Sparkles size={15} color={Colors.white} strokeWidth={2.5} />
                <Text style={styles.askBtnPrimaryText}>Tak, AI dopisz</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.askCount}>Dotyczy {suggestionCount} pól z {dishes.length} potraw.</Text>
          </View>
        )}

        {(stage === 'suggesting' || stage === 'confirming') && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.analyzingTitle}>
              {stage === 'suggesting' ? 'AI proponuje składniki…' : 'Zapisuję potrawy…'}
            </Text>
            <Text style={styles.analyzingSub}>Chwilkę…</Text>
          </View>
        )}

        {stage === 'done' && result && (
          <ScrollView contentContainerStyle={styles.resultWrap} testID="menu-scan-done">
            <View style={styles.successCircle}>
              <Check size={38} color={Colors.success} strokeWidth={2.5} />
            </View>
            <Text style={styles.resultTitle}>Menu zapisane!</Text>
            <Text style={styles.resultSub}>
              Dodano {result.inserted} {result.inserted === 1 ? 'potrawę' : 'potraw'} do zakładki Menu.
            </Text>
            {result.inventoryCreated > 0 && (
              <View style={styles.inventoryBox} testID="menu-scan-inventory-box">
                <Text style={styles.inventoryTitle}>
                  🏬 Magazyn gotowy! Utworzyliśmy {result.inventoryCreated}{' '}
                  {result.inventoryCreated === 1 ? 'nowy produkt' : 'nowych produktów'} ze stanem 0 i buforem 20%.
                </Text>
                <Text style={styles.inventorySub}>
                  Twój magazyn jest gotowy na przyjęcie pierwszej faktury.
                </Text>
                {result.inventoryItems.slice(0, 12).map((it, i) => (
                  <Text key={i} style={styles.inventoryItem}>• {it.name} → {it.category}</Text>
                ))}
                {result.inventoryItems.length > 12 && (
                  <Text style={styles.inventoryItem}>…i {result.inventoryItems.length - 12} więcej</Text>
                )}
              </View>
            )}
            {result.warnings.length > 0 && (
              <View style={styles.warnBox}>
                {result.warnings.map((w, i) => (
                  <Text key={i} style={styles.warnText}>• {w}</Text>
                ))}
              </View>
            )}
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={handleFinishDone}
              testID="menu-scan-finish"
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Gotowe</Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  b: { fontWeight: '700', color: Colors.textPrimary },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: Colors.border, backgroundColor: Colors.card,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.accentLight, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  errorBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.dangerLight, borderColor: '#FECACA', borderWidth: 1, marginHorizontal: 16, marginTop: 12, borderRadius: 10, padding: 12 },
  errorText: { flex: 1, fontSize: 12, color: Colors.danger, lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  chooseWrap: { padding: 16, gap: 12 },
  hintCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', backgroundColor: Colors.warningLight, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FDE68A' },
  hintText: { flex: 1, fontSize: 13, color: Colors.textSecondary, lineHeight: 19 },
  sourceBtn: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: Colors.card, borderRadius: 14, padding: 16, borderWidth: 1.5, borderColor: Colors.border },
  sourceIcon: { width: 48, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sourceTitle: { fontSize: 15, fontWeight: '700', color: Colors.textPrimary },
  sourceSub: { fontSize: 12, color: Colors.textSecondary, marginTop: 2 },
  analyzingTitle: { fontSize: 16, fontWeight: '700', color: Colors.textPrimary, marginTop: 6 },
  analyzingSub: { fontSize: 13, color: Colors.textTertiary },

  editContent: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 },
  editHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: Colors.accentLight, borderRadius: 10, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#BFDBFE' },
  editHintText: { flex: 1, fontSize: 12, color: Colors.textSecondary, lineHeight: 16 },
  dishCard: { backgroundColor: Colors.card, borderRadius: 12, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: Colors.border, gap: 10 },
  dishHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dishName: { flex: 1, fontSize: 15, fontWeight: '700', color: Colors.textPrimary, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  dishRemove: { width: 30, height: 30, borderRadius: 8, backgroundColor: Colors.dangerLight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FECACA' },
  dishMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: Colors.accentLight, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: '#BFDBFE' },
  catChipText: { fontSize: 12, fontWeight: '700', color: Colors.accent },
  priceField: { flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.background, borderRadius: 8, borderWidth: 1, borderColor: Colors.border, paddingHorizontal: 10, paddingVertical: 6 },
  priceInput: { flex: 1, fontSize: 14, fontWeight: '700', color: Colors.textPrimary, paddingVertical: 0 },
  priceSuffix: { fontSize: 12, fontWeight: '600', color: Colors.textTertiary, marginLeft: 4 },
  weightRow: { gap: 6 },
  weightLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  weightLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4 },
  weightControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weightInput: { flex: 1, fontSize: 14, color: Colors.textPrimary, backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8 },
  weightUnitToggle: { flexDirection: 'row', backgroundColor: Colors.borderLight, borderRadius: 8, padding: 2 },
  weightUnitBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  weightUnitBtnActive: { backgroundColor: Colors.accent },
  weightUnitText: { fontSize: 12, fontWeight: '700', color: Colors.textSecondary },
  weightUnitTextActive: { color: Colors.white },

  sectionLabel: { fontSize: 11, fontWeight: '700', color: Colors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.4, marginTop: 6, marginBottom: 4 },
  emptyIngredients: { fontSize: 12, color: Colors.textTertiary, fontStyle: 'italic', paddingVertical: 6 },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  ingInput: { backgroundColor: Colors.background, borderWidth: 1, borderColor: Colors.border, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 7, fontSize: 12, color: Colors.textPrimary },
  ingName: { flex: 1 },
  ingQty: { width: 58, textAlign: 'right' },
  ingUnitToggle: { flexDirection: 'row', backgroundColor: Colors.borderLight, borderRadius: 6, padding: 2 },
  ingUnitBtn: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 4 },
  ingUnitBtnActive: { backgroundColor: Colors.accent },
  ingUnitText: { fontSize: 10, fontWeight: '700', color: Colors.textSecondary },
  ingUnitTextActive: { color: Colors.white },
  ingRemove: { width: 26, height: 26, borderRadius: 6, backgroundColor: Colors.dangerLight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FECACA' },
  addIngBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, paddingVertical: 8, borderRadius: 8, borderWidth: 1.5, borderColor: Colors.accent, borderStyle: 'dashed', backgroundColor: Colors.accentLight, marginTop: 4 },
  addIngText: { fontSize: 12, fontWeight: '700', color: Colors.accent },

  footer: { padding: 12, paddingBottom: Platform.OS === 'ios' ? 24 : 12, borderTopWidth: 1, borderTopColor: Colors.border, backgroundColor: Colors.card },
  confirmBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 15 },
  confirmBtnText: { fontSize: 15, fontWeight: '700', color: Colors.white },

  askWrap: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 12 },
  askIcon: { width: 72, height: 72, borderRadius: 36, backgroundColor: Colors.warningLight, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FDE68A' },
  askTitle: { fontSize: 20, fontWeight: '800', color: Colors.textPrimary, textAlign: 'center' },
  askText: { fontSize: 14, color: Colors.textSecondary, textAlign: 'center', lineHeight: 20 },
  askMeta: { fontSize: 12, color: Colors.textTertiary, textAlign: 'center', lineHeight: 17 },
  askButtons: { flexDirection: 'row', gap: 10, marginTop: 12, alignSelf: 'stretch' },
  askBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 12 },
  askBtnPrimary: { backgroundColor: Colors.accent },
  askBtnPrimaryText: { fontSize: 14, fontWeight: '700', color: Colors.white },
  askBtnSecondary: { backgroundColor: Colors.card, borderWidth: 1.5, borderColor: Colors.border },
  askBtnSecondaryText: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary },
  askCount: { fontSize: 11, color: Colors.textTertiary, marginTop: 4 },

  resultWrap: { padding: 24, alignItems: 'center', gap: 10 },
  successCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: Colors.successLight, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  resultTitle: { fontSize: 19, fontWeight: '800', color: Colors.textPrimary, marginTop: 4 },
  resultSub: { fontSize: 13, color: Colors.textSecondary, textAlign: 'center' },
  warnBox: { alignSelf: 'stretch', backgroundColor: Colors.warningLight, borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#FDE68A', gap: 4 },
  warnText: { fontSize: 11, color: Colors.warning, lineHeight: 16 },
  inventoryBox: { alignSelf: 'stretch', backgroundColor: '#ECFDF5', borderRadius: 12, padding: 14, marginTop: 14, borderWidth: 1, borderColor: '#A7F3D0', gap: 3 },
  inventoryTitle: { fontSize: 13, fontWeight: '800', color: '#047857', lineHeight: 19 },
  inventorySub: { fontSize: 12, color: '#059669', marginBottom: 6 },
  inventoryItem: { fontSize: 11.5, color: '#065F46', lineHeight: 17 },
  primaryBtn: { alignSelf: 'stretch', backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 15, alignItems: 'center', marginTop: 20, marginBottom: Platform.OS === 'ios' ? 20 : 8 },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: Colors.white },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  pickerSheet: { backgroundColor: Colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: Platform.OS === 'ios' ? 32 : 20 },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary, marginBottom: 10 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13, paddingHorizontal: 12, borderRadius: 10 },
  pickerRowActive: { backgroundColor: Colors.accentLight },
  pickerRowText: { fontSize: 14, color: Colors.textPrimary, fontWeight: '500' },
  pickerRowTextActive: { color: Colors.accent, fontWeight: '700' },
});
