import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import {
  X,
  Sparkles,
  Check,
  CircleAlert,
  ScanLine,
  ChefHat,
} from 'lucide-react-native';
import { parsePln, formatPlnNumber } from '@/lib/format';
import { parseOptionalPieceWeightG, normalizeRecipeQuantity } from '@/lib/recipeUnits';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { useAds } from '@/contexts/AdsProvider';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { CreditsGateModal } from '@/components/ads/CreditsGateModal';
import { extractDishContextTags } from '@/lib/dishImageMatch';
import { MenuScanAskSuggest } from '@/components/menuScan/MenuScanAskSuggest';
import { MenuScanChooseStage } from '@/components/menuScan/MenuScanChooseStage';
import { MenuScanDishCard } from '@/components/menuScan/MenuScanDishCard';
import { MenuScanDoneStage } from '@/components/menuScan/MenuScanDoneStage';
import { MenuScanCategoryPicker } from '@/components/menuScan/MenuScanCategoryPicker';
import {
  MENU_SCAN_BACKEND_URL as BACKEND_URL,
  friendlyMenuScanApiError as friendlyApiError,
  parseMenuScanErrorDetail as parseErrorDetail,
  fetchMenuSuggestionsChunked as fetchSuggestionsChunked,
} from '@/components/menuScan/menuScanApi';
import {
  dishesMissingHelp,
  applySuggestionsToDishes,
} from '@/components/menuScan/menuScanHelpers';
import { MENU_SCAN_C as C } from '@/components/menuScan/menuScanColors';
import { menuScanStyles as styles } from '@/components/menuScan/menuScanStyles';
import {
  MENU_CATEGORIES,
  newIngredient,
  newIngredientKey,
  type DraftDish,
  type Ingredient,
  type MenuScanStage,
  type WeightUnit,
} from '@/components/menuScan/menuScanTypes';

interface Props {
  visible: boolean;
  onClose: () => void;
  /** Odśwież Menu/Magazyn — wywoływane zaraz po zapisie (może być async). */
  onConfirmed: () => void | Promise<void>;
}

export function MenuScanModal({ visible, onClose, onConfirmed }: Props) {
  const insets = useSafeAreaInsets();
  const { setCameraOverlay } = useUiOverlay();
  const { showInterstitial } = useAds();
  const { tier, credits, loading: creditsLoading, refresh: refreshCredits, trialActive } =
    useSubscription();
  const [showCreditsGate, setShowCreditsGate] = useState(false);
  const [stage, setStage] = useState<MenuScanStage>('choose');
  const [error, setError] = useState<string | null>(null);
  const [dishes, setDishes] = useState<DraftDish[]>([]);
  const [categoryPickerFor, setCategoryPickerFor] = useState<string | null>(null);
  const [result, setResult] = useState<{
    inserted: number;
    warnings: string[];
    inventoryCreated: number;
    inventoryItems: { name: string; category: string }[];
  } | null>(null);
  const [dishesNeedingIngredients, setDishesNeedingIngredients] = useState<string[]>([]);
  const [dishesNeedingWeight, setDishesNeedingWeight] = useState<string[]>([]);
  const [suggestingInline, setSuggestingInline] = useState(false);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  const savingRef = useRef(false);

  const footerPad = Math.max(insets.bottom, 12) + 8;

  const reset = useCallback(() => {
    setStage('choose');
    setError(null);
    setSaveHint(null);
    setDishes([]);
    setCategoryPickerFor(null);
    setResult(null);
    setDishesNeedingIngredients([]);
    setDishesNeedingWeight([]);
    setSuggestingInline(false);
    savingRef.current = false;
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  useEffect(() => {
    setCameraOverlay(visible);
    return () => setCameraOverlay(false);
  }, [visible, setCameraOverlay]);

  /** Gate tylko dla operacji AI. Nie blokuj gdy portfel jeszcze się ładuje (credits domyślnie 0). */
  const ensureCredits = useCallback((): boolean => {
    if (creditsLoading) return true;
    if (trialActive || tier > 0) {
      // Płatny / trial: backend i tak zweryfikuje saldo; nie blokuj UI na stale 0.
      if (credits > 0) return true;
      // Saldo 0 przy aktywnym planie — pozwól spróbować; 403 złapie friendlyApiError.
      return true;
    }
    if (credits <= 0) {
      setShowCreditsGate(true);
      return false;
    }
    return true;
  }, [tier, credits, creditsLoading, trialActive]);

  const handleFinishDone = useCallback(async () => {
    await showInterstitial();
    reset();
    onClose();
  }, [onClose, reset, showInterstitial]);

  const processFile = useCallback(async (uri: string, name: string, mimeType: string) => {
    if (!ensureCredits()) return;
    if (!BACKEND_URL) {
      setError('Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).');
      return;
    }
    setStage('scanning');
    setError(null);
    setSaveHint(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 720_000);
    try {
      const form = new FormData();
      form.append('file', { uri, name, type: mimeType } as any);
      const { apiMultipartHeaders } = await import('@/lib/apiHeaders');
      const res = await fetch(`${BACKEND_URL}/api/menu/scan`, {
        method: 'POST',
        headers: await apiMultipartHeaders(),
        body: form,
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const detail = await parseErrorDetail(res);
        throw new Error(friendlyApiError(res.status, detail));
      }
      const data = await res.json();
      // Odśwież portfel po skanie AI — saldo mogło spaść; unikamy stale 0/starych wartości.
      void refreshCredits();
      const parsedDishes: DraftDish[] = (data.dishes ?? []).map((d: any) => {
        const name = d.name ?? '';
        const fromApi = Array.isArray(d.image_context_tags)
          ? d.image_context_tags.map(String)
          : [];
        return {
          key: newIngredientKey(),
          name,
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
          imageContextTags: fromApi.length ? fromApi : extractDishContextTags(name),
        };
      });
      setDishes(parsedDishes);
      if (parsedDishes.length === 0) {
        setError('AI nie rozpoznało żadnej potrawy. Spróbuj wgrać wyraźniejsze zdjęcie/PDF.');
        setStage('choose');
        return;
      }
      const deducted = Number(data.credits_deducted ?? 0);
      const warn =
        Array.isArray(data.warnings) && data.warnings.length
          ? ` ${data.warnings.filter((w: any) => typeof w === 'string').join(' ')}`
          : '';
      if (deducted > 0) {
        const rem = data.credits_remaining != null ? Number(data.credits_remaining) : null;
        setSaveHint(
          rem != null
            ? `Skan AI: −${deducted} kredytów (saldo ${rem}). Zapis potraw nie wymaga dodatkowych kredytów.${warn}`
            : `Skan AI: −${deducted} kredytów. Zapis potraw nie wymaga dodatkowych kredytów.${warn}`
        );
      } else if (warn) {
        setSaveHint(warn.trim());
      }
      setStage('edit');
    } catch (e: any) {
      const msg =
        e?.name === 'AbortError'
          ? 'Skan menu przekroczył limit czasu. Przy bardzo długim PDF spróbuj podzielić plik.'
          : e.message ?? 'Nie udało się przetworzyć menu.';
      setError(msg);
      setStage('choose');
    } finally {
      clearTimeout(timer);
    }
  }, [ensureCredits, refreshCredits]);

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

  const preparePayloadDishes = () => {
    return dishes.map((d) => ({
      name: d.name.trim(),
      category: d.category,
      price_pln: parsePln(d.priceInput),
      portion_weight_value: d.portionWeightInput.trim() ? parsePln(d.portionWeightInput) : null,
      portion_weight_unit: d.portionWeightUnit,
      ingredients: d.ingredients
        .filter((i) => i.name.trim())
        .map((i) => {
          const row: {
            name: string;
            quantity: number | null;
            unit: string;
            piece_weight_g?: number | null;
          } = {
            name: i.name.trim(),
            quantity: i.quantity.trim()
              ? normalizeRecipeQuantity(parsePln(i.quantity))
              : null,
            unit: i.unit,
          };
          if (i.unit === 'szt') {
            const pw = parseOptionalPieceWeightG(i.pieceWeightG);
            if (pw != null) row.piece_weight_g = pw;
          }
          return row;
        }),
    }));
  };

  /** Top "Sugestie AI" — fill missing fields in the edit form. */
  const handleInlineSuggest = useCallback(async () => {
    if (!ensureCredits()) return;
    const { needIng, needQty, needWeight } = dishesMissingHelp(dishes);
    if (needIng.length === 0 && needQty.length === 0 && needWeight.length === 0) {
      setError('Wszystkie potrawy mają już składniki i gramaturę — nie ma czego uzupełniać.');
      return;
    }
    setSuggestingInline(true);
    setError(null);
    try {
      const askKeys = new Set([...needIng, ...needQty, ...needWeight]);
      const askDishes = dishes
        .filter((d) => askKeys.has(d.key))
        .map((d) => ({
          name: d.name.trim(),
          category: d.category,
          ingredients: d.ingredients
            .filter((i) => i.name.trim())
            .map((i) => ({
              name: i.name.trim(),
              quantity: i.quantity.trim()
              ? normalizeRecipeQuantity(parsePln(i.quantity))
              : null,
              unit: i.unit,
            })),
          portion_weight_value: d.portionWeightInput.trim() ? parsePln(d.portionWeightInput) : null,
          portion_weight_unit: d.portionWeightUnit,
        }));
      const byName = await fetchSuggestionsChunked(askDishes);
      setDishes((prev) => applySuggestionsToDishes(prev, byName, needIng, needQty, needWeight));
    } catch (e: any) {
      setError(e?.message ?? 'Nie udało się pobrać sugestii AI.');
    } finally {
      setSuggestingInline(false);
    }
  }, [dishes, ensureCredits]);

  const confirmSave = useCallback(async (withSuggestions: boolean) => {
    // Zapis bez AI NIGDY nie wymaga kredytów — confirm-scan nie woła OpenAI.
    let useAi = withSuggestions;
    if (useAi && !ensureCredits()) {
      useAi = false;
      setSaveHint(
        'Brak lokalnego salda kredytów AI — zapisuję bez sugestii AI. '
          + 'Potrawy i produkty magazynowe i tak trafią do bazy.'
      );
    }
    if (savingRef.current) return;
    if (!BACKEND_URL) {
      setError('Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).');
      setStage('edit');
      return;
    }
    savingRef.current = true;
    setStage(useAi ? 'suggesting' : 'confirming');
    setError(null);
    try {
      let finalPayload = preparePayloadDishes();
      // Dedup w payloadzie — ta sama potrawa 2× w skanie nie tworzy 2 wierszy.
      const seenNames = new Set<string>();
      finalPayload = finalPayload.filter((d) => {
        const k = (d.name || '').trim().toLowerCase();
        if (!k || seenNames.has(k)) return false;
        seenNames.add(k);
        return true;
      });
      if (finalPayload.length === 0) {
        throw new Error('Brak potraw do zapisania (puste nazwy po deduplikacji).');
      }
      const { needIng, needQty, needWeight } = dishesMissingHelp(dishes);

      if (useAi) {
        const askKeys = new Set([
          ...dishesNeedingIngredients,
          ...dishesNeedingWeight,
          ...needIng,
          ...needQty,
          ...needWeight,
        ]);
        const askDishes = dishes
          .filter((d) => askKeys.has(d.key))
          .map((d) => ({
            name: d.name.trim(),
            category: d.category,
            ingredients: d.ingredients
              .filter((i) => i.name.trim())
              .map((i) => {
                const row: {
                  name: string;
                  quantity: number | null;
                  unit: string;
                  piece_weight_g?: number | null;
                } = {
                  name: i.name.trim(),
                  quantity: i.quantity.trim()
              ? normalizeRecipeQuantity(parsePln(i.quantity))
              : null,
                  unit: i.unit,
                };
                if (i.unit === 'szt') {
                  const pw = parseOptionalPieceWeightG(i.pieceWeightG);
                  if (pw != null) row.piece_weight_g = pw;
                }
                return row;
              }),
            portion_weight_value: d.portionWeightInput.trim() ? parsePln(d.portionWeightInput) : null,
            portion_weight_unit: d.portionWeightUnit,
          }));

        if (askDishes.length > 0) {
          try {
            const byName = await fetchSuggestionsChunked(askDishes);
            finalPayload = finalPayload.map((d) => {
              const s = byName[d.name.toLowerCase()];
              if (!s) return d;
              const suggested = s.suggested_ingredients ?? [];

              let ingredients = d.ingredients;
              if (ingredients.length === 0 && suggested.length > 0) {
                ingredients = suggested.map((si) => ({
                  name: si.name,
                  quantity: normalizeRecipeQuantity(Number(si.quantity ?? 1)),
                  unit: si.unit || 'g',
                  piece_weight_g: null as number | null,
                }));
              } else if (suggested.length > 0) {
                const bySugName = new Map(
                  suggested.map((si) => [si.name.trim().toLowerCase(), si]),
                );
                ingredients = ingredients.map((ing, idx) => {
                  if (ing.quantity != null && Number(ing.quantity) > 0) return ing;
                  const hit =
                    bySugName.get((ing.name || '').trim().toLowerCase()) ??
                    suggested[idx];
                  return {
                    ...ing,
                    quantity: normalizeRecipeQuantity(Number(hit?.quantity ?? 1)),
                    unit: hit?.unit || ing.unit || 'g',
                  };
                });
              }

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
          } catch (suggestErr: any) {
            const msg = String(suggestErr?.message ?? suggestErr ?? '');
            setSaveHint(
              `Sugestie AI pominięte (${msg.slice(0, 120)}). Zapisuję potrawy bez uzupełnień AI.`
            );
            setStage('confirming');
          }
        }
      }

      // Ostatnia bramka: żadna ilość nie może być null/0 przed zapisem.
      finalPayload = finalPayload.map((d) => ({
        ...d,
        ingredients: d.ingredients.map((ing) => ({
          ...ing,
          quantity: normalizeRecipeQuantity(ing.quantity),
        })),
      }));

      const { apiJsonHeaders } = await import('@/lib/apiHeaders');
      const res = await fetch(`${BACKEND_URL}/api/menu/confirm-scan`, {
        method: 'POST',
        headers: await apiJsonHeaders(),
        body: JSON.stringify({
          dishes: finalPayload,
          // Tylko po TAK — NIE zostawia puste pola bez serwerowego AI.
          fill_empty_with_ai: useAi,
        }),
      });
      if (!res.ok) {
        const detail = await parseErrorDetail(res);
        throw new Error(friendlyApiError(res.status, detail));
      }
      const data = await res.json();
      const inserted = Number(data.inserted ?? 0);
      const skipped = Number(data.skipped_duplicates ?? 0);
      const warnings: string[] = [...(data.warnings ?? [])];
      if (inserted === 0 && skipped > 0) {
        warnings.unshift(
          `Żadna nowa potrawa nie została dodana — ${skipped} pozycji uznano za duplikaty już w menu. `
            + 'Składniki i tak mogły trafić do magazynu (onboarding).'
        );
      }
      setResult({
        inserted,
        warnings,
        inventoryCreated: Number(data.inventory_created ?? 0),
        inventoryItems: data.inventory_items ?? [],
      });
      // Odśwież listy zaraz po zapisie — użytkownik nie musi wracać do zakładki.
      setStage('syncing');
      try {
        await Promise.resolve(onConfirmed());
      } catch {
        /* refresh best-effort */
      }
      void refreshCredits();
      setStage('done');
    } catch (e: any) {
      setError(e.message ?? 'Nie udało się zapisać potraw.');
      setStage('edit');
    } finally {
      savingRef.current = false;
    }
  }, [
    dishes,
    dishesNeedingIngredients,
    dishesNeedingWeight,
    ensureCredits,
    onConfirmed,
    refreshCredits,
  ]);

  const handleConfirmClick = useCallback(() => {
    const invalid = dishes.some((d) => !d.name.trim());
    if (invalid) {
      setError('Każda potrawa musi mieć nazwę.');
      return;
    }
    setError(null);

    const { needIng, needQty, needWeight } = dishesMissingHelp(dishes);
    if (needIng.length === 0 && needQty.length === 0 && needWeight.length === 0) {
      void confirmSave(false);
      return;
    }
    // Przywrócony dialog jak w gastro-manager-15 — użytkownik świadomie wybiera AI.
    setDishesNeedingIngredients([...needIng, ...needQty]);
    setDishesNeedingWeight(needWeight);
    setStage('ask_suggest');
  }, [dishes, confirmSave]);

  const suggestionCount =
    dishesNeedingIngredients.length + dishesNeedingWeight.length;
  const bothMissing = dishesNeedingIngredients.length > 0 && dishesNeedingWeight.length > 0;
  const askMessage = bothMissing
    ? `Dla ${dishesNeedingIngredients.length} potraw brakuje składników lub gramatur, a dla ${dishesNeedingWeight.length} brakuje gramatury porcji. Czy AI ma zaproponować brakujące wartości na podstawie wzorcowych przepisów?`
    : dishesNeedingIngredients.length > 0
    ? `Dla ${dishesNeedingIngredients.length} potraw brakuje składników lub gramatur. Czy AI ma zaproponować składniki i gramatury na podstawie wzorcowych przepisów?`
    : `Dla ${dishesNeedingWeight.length} potraw nie podano gramatury porcji. Czy AI ma zaproponować gramatury na podstawie wzorcowych przepisów?`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <View style={styles.headerIcon}>
              <ScanLine size={18} color={C.green} strokeWidth={2} />
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
            <X size={22} color={C.muted} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {error && (
          <View style={styles.errorBox} testID="menu-scan-error">
            <CircleAlert size={15} color={C.danger} strokeWidth={2} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
        {!!saveHint && !error && (
          <View style={styles.saveHintBox} testID="menu-scan-save-hint">
            <Text style={styles.saveHintText}>{saveHint}</Text>
          </View>
        )}

        {stage === 'choose' && (
          <MenuScanChooseStage
            footerPad={footerPad}
            onCamera={() => void handleCamera()}
            onPickFile={() => void handlePickFile()}
          />
        )}

        {stage === 'scanning' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={C.green} />
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
                  <ChefHat size={13} color={C.green} strokeWidth={2} />
                  <Text style={styles.editHintText}>
                    Popraw nazwy/ceny, dodaj lub usuń składniki i gramaturę. Puste pola AI może uzupełnić
                    proponowanymi wartościami po Twojej akceptacji.
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.aiSuggestBtn, suggestingInline && { opacity: 0.7 }]}
                  onPress={() => void handleInlineSuggest()}
                  activeOpacity={0.85}
                  disabled={suggestingInline || dishes.length === 0}
                  testID="menu-scan-ai-suggest"
                >
                  {suggestingInline ? (
                    <ActivityIndicator size="small" color={C.blackOnGreen} />
                  ) : (
                    <Sparkles size={16} color={C.blackOnGreen} strokeWidth={2.5} />
                  )}
                  <Text style={styles.aiSuggestBtnText}>
                    {suggestingInline ? 'AI uzupełnia…' : 'Sugestie AI'}
                  </Text>
                </TouchableOpacity>

                {dishes.map((d, idx) => (
                  <MenuScanDishCard
                    key={d.key}
                    dish={d}
                    index={idx}
                    onPatchDish={patchDish}
                    onRemoveDish={removeDish}
                    onOpenCategory={setCategoryPickerFor}
                    onPatchIngredient={patchIngredient}
                    onRemoveIngredient={removeIngredient}
                    onAddIngredient={addIngredient}
                  />
                ))}

                <View style={{ height: 24 }} />
              </ScrollView>
              <View style={[styles.footer, { paddingBottom: footerPad }]}>
                <TouchableOpacity
                  style={[styles.confirmBtn, dishes.length === 0 && { opacity: 0.5 }]}
                  onPress={handleConfirmClick}
                  activeOpacity={0.85}
                  disabled={dishes.length === 0}
                  testID="menu-scan-confirm"
                >
                  <Check size={18} color={C.blackOnGreen} strokeWidth={2.5} />
                  <Text style={styles.confirmBtnText}>Zapisz {dishes.length} potraw do menu</Text>
                </TouchableOpacity>
              </View>
            </KeyboardAvoidingView>

            <MenuScanCategoryPicker
              categoryPickerFor={categoryPickerFor}
              dishes={dishes}
              footerPad={footerPad}
              onClose={() => setCategoryPickerFor(null)}
              onSelect={(dishKey, category) => patchDish(dishKey, { category })}
            />
          </>
        )}

        {stage === 'ask_suggest' && (
          <MenuScanAskSuggest
            askMessage={askMessage}
            suggestionCount={suggestionCount}
            dishesCount={dishes.length}
            footerPad={footerPad}
            onNo={() => void confirmSave(false)}
            onYes={() => void confirmSave(true)}
          />
        )}

        {(stage === 'suggesting' || stage === 'confirming' || stage === 'syncing') && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={C.green} />
            <Text style={styles.analyzingTitle}>
              {stage === 'suggesting'
                ? 'AI proponuje składniki…'
                : stage === 'syncing'
                  ? 'Zapisywanie potraw…'
                  : 'Zapisywanie potraw…'}
            </Text>
            <Text style={styles.analyzingSub}>
              {stage === 'syncing'
                ? 'Odświeżam menu i magazyn — chwilkę…'
                : 'Chwilkę…'}
            </Text>
          </View>
        )}

        {stage === 'done' && result && (
          <MenuScanDoneStage
            result={result}
            footerPad={footerPad}
            onFinish={() => void handleFinishDone()}
          />
        )}
        <CreditsGateModal
          visible={showCreditsGate}
          onClose={() => setShowCreditsGate(false)}
          actionLabel="to skanowanie menu"
        />
      </SafeAreaView>
    </Modal>
  );
}

