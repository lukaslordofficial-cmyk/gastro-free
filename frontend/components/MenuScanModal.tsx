import React, { useState, useCallback, useEffect } from 'react';
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
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { DS } from '@/constants/premiumTheme';
import { parsePln, formatPlnNumber } from '@/lib/format';
import { parseOptionalPieceWeightG, normalizeRecipeQuantity } from '@/lib/recipeUnits';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { useAds } from '@/contexts/AdsProvider';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { CreditsGateModal } from '@/components/ads/CreditsGateModal';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

/** Chunk size for /api/menu/suggest-recipe — keeps each Railway request under proxy timeout. */
const SUGGEST_CHUNK = 4;

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
  quantity: string;
  unit: IngredientUnit;
  /** Wzorcowa waga 1 sztuki w gramach */
  pieceWeightG: string;
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

const C = {
  bg: '#0A120E',
  card: DS.color.surfaceCard,
  elevated: DS.color.surfaceElevated,
  border: DS.color.borderSubtle,
  text: DS.color.heading,
  body: DS.color.body,
  muted: DS.color.muted,
  green: DS.color.greenEnd,
  greenSoft: 'rgba(0,255,120,0.12)',
  greenDeep: DS.color.greenStart,
  danger: DS.color.danger,
  dangerSoft: DS.color.dangerSoft,
  warning: DS.color.warning,
  warningSoft: DS.color.warningSoft,
  warningBorder: DS.color.warningBorder,
  blackOnGreen: '#0A0A0A',
  inputBg: DS.color.bgTertiary,
};

function newIngredientKey(): string {
  return String(Date.now() + Math.random());
}

function newIngredient(name = '', quantity = '', unit: IngredientUnit = 'g', pieceWeightG = ''): Ingredient {
  return { key: newIngredientKey(), name, quantity, unit, pieceWeightG };
}

function friendlyApiError(status: number, detail: string): string {
  const raw = `${detail || ''}`.toLowerCase();
  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    raw.includes('application failed to respond') ||
    raw.includes('failed to respond') ||
    raw.includes('timeout') ||
    raw.includes('timed out')
  ) {
    return (
      'Serwer AI nie zdążył odpowiedzieć (timeout / 502). '
      + 'Spróbuj ponownie za chwilę albo użyj „Sugestie AI” przy mniejszej liczbie potraw.'
    );
  }
  if (!BACKEND_URL) {
    return 'Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).';
  }
  if (typeof detail === 'string' && detail.trim() && !raw.startsWith('<!')) {
    return detail.trim();
  }
  return `Błąd serwera (${status || '?'}). Spróbuj ponownie.`;
}

async function parseErrorDetail(res: Response): Promise<string> {
  const txt = await res.text();
  try {
    const j = JSON.parse(txt);
    const d = j?.detail ?? j?.message ?? j?.error ?? txt;
    return typeof d === 'string' ? d : JSON.stringify(d);
  } catch {
    return txt || `HTTP ${res.status}`;
  }
}

/** Fetch suggestions in chunks to avoid Railway proxy 502 on large menus. */
async function fetchSuggestionsChunked(
  askDishes: {
    name: string;
    category: string;
    ingredients: { name: string; quantity: number | null; unit: string }[];
    portion_weight_value: number | null;
    portion_weight_unit: WeightUnit | null;
  }[],
): Promise<Record<string, Suggestion>> {
  if (!BACKEND_URL) {
    throw new Error('Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).');
  }
  const { apiJsonHeaders } = await import('@/lib/apiHeaders');
  const headers = await apiJsonHeaders();
  const byName: Record<string, Suggestion> = {};
  for (let i = 0; i < askDishes.length; i += SUGGEST_CHUNK) {
    const chunk = askDishes.slice(i, i + SUGGEST_CHUNK);
    const res = await fetch(`${BACKEND_URL}/api/menu/suggest-recipe`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ dishes: chunk }),
    });
    if (!res.ok) {
      const detail = await parseErrorDetail(res);
      throw new Error(friendlyApiError(res.status, detail));
    }
    const sug = await res.json();
    for (const s of sug.dishes ?? []) {
      byName[(s.name ?? '').trim().toLowerCase()] = s;
    }
  }
  return byName;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onConfirmed: () => void;
}

export function MenuScanModal({ visible, onClose, onConfirmed }: Props) {
  const insets = useSafeAreaInsets();
  const { setCameraOverlay } = useUiOverlay();
  const { showInterstitial } = useAds();
  const { tier, credits } = useSubscription();
  const [showCreditsGate, setShowCreditsGate] = useState(false);
  const [stage, setStage] = useState<Stage>('choose');
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

  const footerPad = Math.max(insets.bottom, 12) + 8;

  const reset = useCallback(() => {
    setStage('choose');
    setError(null);
    setDishes([]);
    setCategoryPickerFor(null);
    setResult(null);
    setDishesNeedingIngredients([]);
    setDishesNeedingWeight([]);
    setSuggestingInline(false);
  }, []);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  useEffect(() => {
    setCameraOverlay(visible);
    return () => setCameraOverlay(false);
  }, [visible, setCameraOverlay]);

  const ensureCredits = useCallback((): boolean => {
    if (tier === 0 && credits <= 0) {
      setShowCreditsGate(true);
      return false;
    }
    return true;
  }, [tier, credits]);

  const handleFinishDone = useCallback(async () => {
    await showInterstitial();
    onConfirmed();
    reset();
  }, [onConfirmed, reset, showInterstitial]);

  const processFile = useCallback(async (uri: string, name: string, mimeType: string) => {
    if (!ensureCredits()) return;
    if (!BACKEND_URL) {
      setError('Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).');
      return;
    }
    setStage('scanning');
    setError(null);
    try {
      const form = new FormData();
      form.append('file', { uri, name, type: mimeType } as any);
      const { apiMultipartHeaders } = await import('@/lib/apiHeaders');
      const res = await fetch(`${BACKEND_URL}/api/menu/scan`, {
        method: 'POST',
        headers: await apiMultipartHeaders(),
        body: form,
      });
      if (!res.ok) {
        const detail = await parseErrorDetail(res);
        throw new Error(friendlyApiError(res.status, detail));
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
  }, [ensureCredits]);

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

  const dishesMissingHelp = useCallback((list: DraftDish[]) => {
    const needIng: string[] = [];
    const needWeight: string[] = [];
    list.forEach((d) => {
      const hasIngredients = d.ingredients.some((i) => i.name.trim());
      const hasWeight = !!d.portionWeightInput.trim() && !!d.portionWeightUnit;
      if (!hasIngredients) needIng.push(d.key);
      if (!hasWeight) needWeight.push(d.key);
    });
    return { needIng, needWeight };
  }, []);

  const applySuggestionsToDishes = useCallback(
    (current: DraftDish[], byName: Record<string, Suggestion>, needIng: string[], needWeight: string[]) => {
      return current.map((d) => {
        const s = byName[d.name.trim().toLowerCase()];
        if (!s) return d;
        let next = { ...d };

        if (needIng.includes(d.key) && (s.suggested_ingredients ?? []).length > 0) {
          next = {
            ...next,
            ingredients: s.suggested_ingredients.map((si) =>
              newIngredient(
                si.name,
                si.quantity != null ? String(normalizeRecipeQuantity(si.quantity)) : '',
                si.unit === 'ml' || si.unit === 'szt' ? si.unit : 'g'
              )
            ),
          };
        }

        if (
          needWeight.includes(d.key) &&
          s.suggested_portion_weight_value != null &&
          s.suggested_portion_weight_unit
        ) {
          const u = s.suggested_portion_weight_unit;
          next = {
            ...next,
            portionWeightInput: String(s.suggested_portion_weight_value),
            portionWeightUnit: u === 'g' || u === 'ml' || u === 'szt' ? u : null,
          };
        }
        return next;
      });
    },
    []
  );

  /** Top "Sugestie AI" — fill missing fields in the edit form. */
  const handleInlineSuggest = useCallback(async () => {
    if (!ensureCredits()) return;
    const { needIng, needWeight } = dishesMissingHelp(dishes);
    if (needIng.length === 0 && needWeight.length === 0) {
      setError('Wszystkie potrawy mają już składniki i gramaturę — nie ma czego uzupełniać.');
      return;
    }
    setSuggestingInline(true);
    setError(null);
    try {
      const askDishes = dishes
        .filter((d) => needIng.includes(d.key) || needWeight.includes(d.key))
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
      setDishes((prev) => applySuggestionsToDishes(prev, byName, needIng, needWeight));
    } catch (e: any) {
      setError(e?.message ?? 'Nie udało się pobrać sugestii AI.');
    } finally {
      setSuggestingInline(false);
    }
  }, [dishes, dishesMissingHelp, applySuggestionsToDishes, ensureCredits]);

  const handleConfirmClick = useCallback(() => {
    const invalid = dishes.some((d) => !d.name.trim());
    if (invalid) {
      setError('Każda potrawa musi mieć nazwę.');
      return;
    }
    setError(null);

    const { needIng, needWeight } = dishesMissingHelp(dishes);
    if (needIng.length === 0 && needWeight.length === 0) {
      void confirmSave(false);
      return;
    }
    setDishesNeedingIngredients(needIng);
    setDishesNeedingWeight(needWeight);
    setStage('ask_suggest');
  }, [dishes, dishesMissingHelp]);

  const confirmSave = useCallback(async (withSuggestions: boolean) => {
    if (!ensureCredits()) return;
    if (!BACKEND_URL) {
      setError('Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).');
      setStage('edit');
      return;
    }
    setStage(withSuggestions ? 'suggesting' : 'confirming');
    setError(null);
    try {
      let finalPayload = preparePayloadDishes();

      if (withSuggestions) {
        const askDishes = dishes
          .filter(
            (d) => dishesNeedingIngredients.includes(d.key) || dishesNeedingWeight.includes(d.key)
          )
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
          const byName = await fetchSuggestionsChunked(askDishes);
          finalPayload = finalPayload.map((d) => {
            const s = byName[d.name.toLowerCase()];
            if (!s) return d;

            let ingredients = d.ingredients;
            if (ingredients.length === 0 && (s.suggested_ingredients ?? []).length > 0) {
              ingredients = s.suggested_ingredients.map((si) => ({
                name: si.name,
                quantity: normalizeRecipeQuantity(Number(si.quantity ?? 0)),
                unit: si.unit || 'g',
                piece_weight_g: null as number | null,
              }));
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
        }
      }

      const { apiJsonHeaders } = await import('@/lib/apiHeaders');
      const res = await fetch(`${BACKEND_URL}/api/menu/confirm-scan`, {
        method: 'POST',
        headers: await apiJsonHeaders(),
        body: JSON.stringify({ dishes: finalPayload }),
      });
      if (!res.ok) {
        const detail = await parseErrorDetail(res);
        throw new Error(friendlyApiError(res.status, detail));
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
  }, [dishes, dishesNeedingIngredients, dishesNeedingWeight, ensureCredits]);

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

        {stage === 'choose' && (
          <ScrollView contentContainerStyle={[styles.chooseWrap, { paddingBottom: footerPad }]}>
            <View style={styles.hintCard}>
              <Sparkles size={16} color={C.warning} strokeWidth={2} />
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
              <View style={styles.sourceIcon}>
                <Camera size={22} color={C.green} strokeWidth={2} />
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
              <View style={styles.sourceIcon}>
                <FileText size={22} color={C.green} strokeWidth={2} />
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
                  <View key={d.key} style={styles.dishCard} testID={`menu-scan-dish-${idx}`}>
                    <View style={styles.dishHeader}>
                      <TextInput
                        style={styles.dishName}
                        value={d.name}
                        placeholder="Nazwa potrawy"
                        placeholderTextColor={C.muted}
                        onChangeText={(v) => patchDish(d.key, { name: v })}
                        testID={`menu-scan-name-${idx}`}
                      />
                      <TouchableOpacity
                        onPress={() => removeDish(d.key)}
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
                        onPress={() => setCategoryPickerFor(d.key)}
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
                          onChangeText={(v) => patchDish(d.key, { priceInput: v })}
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
                        <View key={ing.key} style={styles.ingBlock}>
                          <View style={styles.ingRow}>
                            <TextInput
                              style={[styles.ingInput, styles.ingName]}
                              value={ing.name}
                              placeholder="Nazwa"
                              placeholderTextColor={C.muted}
                              onChangeText={(v) => patchIngredient(d.key, ing.key, { name: v })}
                              testID={`menu-scan-ing-name-${idx}-${ingIdx}`}
                            />
                            <TextInput
                              style={[styles.ingInput, styles.ingQty]}
                              value={ing.quantity}
                              placeholder="ilość"
                              placeholderTextColor={C.muted}
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
                                  patchIngredient(d.key, ing.key, { pieceWeightG: v })
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
                      onPress={() => addIngredient(d.key)}
                      activeOpacity={0.8}
                      testID={`menu-scan-add-ing-${idx}`}
                    >
                      <Plus size={13} color={C.green} strokeWidth={2.5} />
                      <Text style={styles.addIngText}>Dodaj składnik</Text>
                    </TouchableOpacity>
                  </View>
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
                <View style={[styles.pickerSheet, { paddingBottom: footerPad + 8 }]}>
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
                          {active && <Check size={16} color={C.green} strokeWidth={2.5} />}
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
          <View style={[styles.askWrap, { paddingBottom: footerPad }]}>
            <View style={styles.askIcon}>
              <Sparkles size={30} color={C.green} strokeWidth={2} />
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
                <Sparkles size={15} color={C.blackOnGreen} strokeWidth={2.5} />
                <Text style={styles.askBtnPrimaryText}>Tak, AI dopisz</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.askCount}>Dotyczy {suggestionCount} pól z {dishes.length} potraw.</Text>
          </View>
        )}

        {(stage === 'suggesting' || stage === 'confirming') && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={C.green} />
            <Text style={styles.analyzingTitle}>
              {stage === 'suggesting' ? 'AI proponuje składniki…' : 'Zapisuję potrawy…'}
            </Text>
            <Text style={styles.analyzingSub}>Chwilkę…</Text>
          </View>
        )}

        {stage === 'done' && result && (
          <ScrollView
            contentContainerStyle={[styles.resultWrap, { paddingBottom: footerPad }]}
            testID="menu-scan-done"
          >
            <View style={styles.successCircle}>
              <Check size={38} color={C.green} strokeWidth={2.5} />
            </View>
            <Text style={styles.resultTitle}>Menu zapisane!</Text>
            <Text style={styles.resultSub}>
              Dodano {result.inserted} {result.inserted === 1 ? 'potrawę' : 'potraw'} do zakładki Menu.
            </Text>
            {result.inventoryCreated > 0 && (
              <View style={styles.inventoryBox} testID="menu-scan-inventory-box">
                <Text style={styles.inventoryTitle}>
                  Magazyn gotowy! Utworzyliśmy {result.inventoryCreated}{' '}
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
              onPress={() => void handleFinishDone()}
              testID="menu-scan-finish"
              activeOpacity={0.85}
            >
              <Text style={styles.primaryBtnText}>Zamknij i powróć do pulpitu</Text>
            </TouchableOpacity>
          </ScrollView>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  b: { fontWeight: '700', color: C.text },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    backgroundColor: C.card,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  headerIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: C.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 16, fontWeight: '700', color: C.text },
  subtitle: { fontSize: 12, color: C.muted, marginTop: 1 },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: C.dangerSoft,
    borderColor: 'rgba(255,90,90,0.35)',
    borderWidth: 1,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 10,
    padding: 12,
  },
  errorText: { flex: 1, fontSize: 12, color: C.danger, lineHeight: 17 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 32 },
  chooseWrap: { padding: 16, gap: 12 },
  hintCard: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: C.warningSoft,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.warningBorder,
  },
  hintText: { flex: 1, fontSize: 13, color: C.body, lineHeight: 19 },
  sourceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: C.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1.5,
    borderColor: C.border,
  },
  sourceIcon: {
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.greenSoft,
  },
  sourceTitle: { fontSize: 15, fontWeight: '700', color: C.text },
  sourceSub: { fontSize: 12, color: C.muted, marginTop: 2 },
  analyzingTitle: { fontSize: 16, fontWeight: '700', color: C.text, marginTop: 6 },
  analyzingSub: { fontSize: 13, color: C.muted },

  editContent: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 12 },
  editHint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: C.greenSoft,
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.25)',
  },
  editHintText: { flex: 1, fontSize: 12, color: C.body, lineHeight: 16 },
  aiSuggestBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.green,
    borderRadius: 12,
    paddingVertical: 14,
    marginBottom: 14,
    ...DS.shadow.greenGlow,
  },
  aiSuggestBtnText: { fontSize: 15, fontWeight: '800', color: C.blackOnGreen },
  dishCard: {
    backgroundColor: C.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
    gap: 10,
  },
  dishHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dishName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    color: C.text,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  dishRemove: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: C.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,90,90,0.35)',
  },
  dishMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: C.greenSoft,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.25)',
  },
  catChipText: { fontSize: 12, fontWeight: '700', color: C.green },
  priceField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.inputBg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  priceInput: { flex: 1, fontSize: 14, fontWeight: '700', color: C.text, paddingVertical: 0 },
  priceSuffix: { fontSize: 12, fontWeight: '600', color: C.muted, marginLeft: 4 },
  weightRow: { gap: 6 },
  weightLabelWrap: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  weightLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  weightControls: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  weightInput: {
    flex: 1,
    fontSize: 14,
    color: C.text,
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  weightUnitToggle: {
    flexDirection: 'row',
    backgroundColor: C.inputBg,
    borderRadius: 8,
    padding: 2,
    borderWidth: 1,
    borderColor: C.border,
  },
  weightUnitBtn: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  weightUnitBtnActive: { backgroundColor: C.green },
  weightUnitText: { fontSize: 12, fontWeight: '700', color: C.muted },
  weightUnitTextActive: { color: C.blackOnGreen },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: C.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 6,
    marginBottom: 4,
  },
  emptyIngredients: { fontSize: 12, color: C.muted, fontStyle: 'italic', paddingVertical: 6 },
  ingRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  ingBlock: { marginBottom: 8 },
  pieceWeightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -2,
    marginBottom: 4,
    paddingLeft: 4,
  },
  pieceWeightLabel: { fontSize: 11, fontWeight: '700', color: C.muted, minWidth: 88 },
  pieceWeightInput: { width: 88 },
  ingInput: {
    backgroundColor: C.inputBg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 7,
    fontSize: 12,
    color: C.text,
  },
  ingName: { flex: 1 },
  ingQty: { width: 58, textAlign: 'right' },
  ingUnitToggle: {
    flexDirection: 'row',
    backgroundColor: C.inputBg,
    borderRadius: 6,
    padding: 2,
    borderWidth: 1,
    borderColor: C.border,
  },
  ingUnitBtn: { paddingHorizontal: 7, paddingVertical: 4, borderRadius: 4 },
  ingUnitBtnActive: { backgroundColor: C.green },
  ingUnitText: { fontSize: 10, fontWeight: '700', color: C.muted },
  ingUnitTextActive: { color: C.blackOnGreen },
  ingRemove: {
    width: 26,
    height: 26,
    borderRadius: 6,
    backgroundColor: C.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,90,90,0.35)',
  },
  addIngBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: C.green,
    borderStyle: 'dashed',
    backgroundColor: C.greenSoft,
    marginTop: 4,
  },
  addIngText: { fontSize: 12, fontWeight: '700', color: C.green },

  footer: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: C.border,
    backgroundColor: C.card,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.green,
    borderRadius: 12,
    paddingVertical: 15,
  },
  confirmBtnText: { fontSize: 15, fontWeight: '700', color: C.blackOnGreen },

  askWrap: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 12 },
  askIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: C.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.3)',
  },
  askTitle: { fontSize: 20, fontWeight: '800', color: C.text, textAlign: 'center' },
  askText: { fontSize: 14, color: C.body, textAlign: 'center', lineHeight: 20 },
  askMeta: { fontSize: 12, color: C.muted, textAlign: 'center', lineHeight: 17 },
  askButtons: { flexDirection: 'row', gap: 10, marginTop: 12, alignSelf: 'stretch' },
  askBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    borderRadius: 12,
  },
  askBtnPrimary: { backgroundColor: C.green },
  askBtnPrimaryText: { fontSize: 14, fontWeight: '700', color: C.blackOnGreen },
  askBtnSecondary: { backgroundColor: C.elevated, borderWidth: 1.5, borderColor: C.border },
  askBtnSecondaryText: { fontSize: 14, fontWeight: '700', color: C.text },
  askCount: { fontSize: 11, color: C.muted, marginTop: 4 },

  resultWrap: { padding: 24, alignItems: 'center', gap: 10 },
  successCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: C.greenSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  resultTitle: { fontSize: 19, fontWeight: '800', color: C.text, marginTop: 4 },
  resultSub: { fontSize: 13, color: C.body, textAlign: 'center' },
  warnBox: {
    alignSelf: 'stretch',
    backgroundColor: C.warningSoft,
    borderRadius: 10,
    padding: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: C.warningBorder,
    gap: 4,
  },
  warnText: { fontSize: 11, color: C.warning, lineHeight: 16 },
  inventoryBox: {
    alignSelf: 'stretch',
    backgroundColor: C.greenSoft,
    borderRadius: 12,
    padding: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,255,136,0.28)',
    gap: 3,
  },
  inventoryTitle: { fontSize: 13, fontWeight: '800', color: C.green, lineHeight: 19 },
  inventorySub: { fontSize: 12, color: C.body, marginBottom: 6 },
  inventoryItem: { fontSize: 11.5, color: C.body, lineHeight: 17 },
  primaryBtn: {
    alignSelf: 'stretch',
    backgroundColor: C.green,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '700', color: C.blackOnGreen },

  pickerOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.65)', justifyContent: 'flex-end' },
  pickerSheet: {
    backgroundColor: C.elevated,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
  },
  pickerTitle: { fontSize: 15, fontWeight: '800', color: C.text, marginBottom: 10 },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 13,
    paddingHorizontal: 12,
    borderRadius: 10,
  },
  pickerRowActive: { backgroundColor: C.greenSoft },
  pickerRowText: { fontSize: 14, color: C.text, fontWeight: '500' },
  pickerRowTextActive: { color: C.green, fontWeight: '700' },
});
