/**
 * Modal Receptury — siatka kafelków + dodawanie z grafiką, składnikami i tekstem przepisu.
 * Tekst: ręcznie / skan notatek (OCR) / dyktowanie głosowe.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  FlatList,
  Image,
  TextInput,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Platform,
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  X,
  ChevronLeft,
  BookOpen,
  Plus,
  Trash2,
  Check,
  Camera,
  Mic,
  Square,
  Image as ImageIcon,
  UtensilsCrossed,
  Package,
} from 'lucide-react-native';
import * as ImagePicker from 'expo-image-picker';
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from 'expo-audio';
import { Colors } from '@/constants/colors';
import { DS } from '@/constants/premiumTheme';
import { useAppTheme } from '@/hooks/useAppTheme';
import { PremiumGlowCta } from '@/components/premium/PremiumUI';
import { usePremiumAlert } from '@/components/PremiumAlert';
import {
  deleteUserRecipe,
  loadUserRecipes,
  saveUserRecipe,
  type UserRecipe,
  type UserRecipeIngredient,
} from '@/lib/userRecipes';
import { DISH_IMAGE_CATALOG } from '@/lib/dishImagesCatalog';
import {
  categoryPlaceholderSlug,
  findSlugForDishName,
} from '@/lib/dishImageMatch';
import { fetchJson } from '@/lib/safeFetch';
import { useAuth } from '@/contexts/AuthContext';

const COLS = 2;
const GAP = 10;
const SCREEN_W = Dimensions.get('window').width;
const TILE_W = (SCREEN_W - 40 - GAP) / COLS;
const FALLBACK_IMG = require('@/assets/premium/placeholders/ph_kartony_brazowe.webp');

const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ?? process.env.REACT_APP_BACKEND_URL ?? '';

const INTRO_COPY =
  'Dodaj tutaj swoje przepisy i receptury, które używasz w swojej restauracji. Dzięki nim, wdrażanie nowych kucharzy, lub pomocników kuchennych będzie szybsze i łatwiejsze.';

type Stage = 'grid' | 'add' | 'detail';

type RecipeExportPayload = {
  dishName: string;
  ingredients: UserRecipeIngredient[];
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onUseInMenu?: (payload: RecipeExportPayload) => void;
  /** Półprodukt / sos → formularz Magazynu z nazwą receptury (+ składniki jako hint). */
  onAddToInventory?: (payload: RecipeExportPayload) => void;
};

function resolveThumb(name: string, slug?: string): number {
  if (slug) {
    const hit = DISH_IMAGE_CATALOG.find((d) => d.slug === slug);
    if (hit?.localAsset) return hit.localAsset as number;
  }
  const matched = findSlugForDishName(name, DISH_IMAGE_CATALOG);
  if (matched) {
    const hit = DISH_IMAGE_CATALOG.find((d) => d.slug === matched);
    if (hit?.localAsset) return hit.localAsset as number;
  }
  const phSlug = categoryPlaceholderSlug(name, DISH_IMAGE_CATALOG);
  if (phSlug) {
    const hit = DISH_IMAGE_CATALOG.find((d) => d.slug === phSlug);
    if (hit?.localAsset) return hit.localAsset as number;
  }
  return FALLBACK_IMG;
}

function findSlugForName(name: string): string | undefined {
  return findSlugForDishName(name, DISH_IMAGE_CATALOG);
}

export function RecipesModal({ visible, onClose, onUseInMenu, onAddToInventory }: Props) {
  const theme = useAppTheme();
  const { accountKey } = useAuth();
  const { alert: premiumAlert } = usePremiumAlert();
  const prem = theme.isPremium;
  const accent = prem ? DS.color.greenEnd : Colors.accent;
  const bg = prem ? DS.color.bgPrimary : Colors.background;
  const card = prem ? DS.color.surfaceCard : Colors.card;
  const text = prem ? DS.color.heading : Colors.textPrimary;
  const muted = prem ? DS.color.muted : Colors.textSecondary;
  const border = prem ? DS.color.borderSubtle : Colors.border;
  const sheetBg = prem ? DS.color.surfaceCard : Colors.card;
  const sheetTertiary = prem ? DS.color.bgTertiary : Colors.borderLight;

  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const mediaRecorderRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<any>(null);

  const [stage, setStage] = useState<Stage>('grid');
  const [recipes, setRecipes] = useState<UserRecipe[]>([]);
  const [selected, setSelected] = useState<UserRecipe | null>(null);
  const [name, setName] = useState('');
  const [instructions, setInstructions] = useState('');
  const [ings, setIngs] = useState<{ key: string; name: string; quantity: string; unit: string }[]>([
    { key: '1', name: '', quantity: '', unit: 'g' },
  ]);
  const [busyOcr, setBusyOcr] = useState(false);
  const [busyVoice, setBusyVoice] = useState(false);
  const [recording, setRecording] = useState(false);
  const [scanSheetVisible, setScanSheetVisible] = useState(false);

  const reload = useCallback(async () => {
    const list = await loadUserRecipes();
    setRecipes(list);
  }, []);

  useEffect(() => {
    if (visible) {
      void reload();
      setStage('grid');
      setSelected(null);
      resetAdd();
    }
    // accountKey: po przelogowaniu przeładuj listę tenanta (nie pokazuj receptur innego konta)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reload, accountKey]);

  const cleanupWebMic = () => {
    try {
      mediaRecorderRef.current?.stop?.();
    } catch {
      /* ignore */
    }
    mediaRecorderRef.current = null;
    streamRef.current?.getTracks?.().forEach((t) => t.stop());
    streamRef.current = null;
    chunksRef.current = [];
  };

  const resetAdd = () => {
    setName('');
    setInstructions('');
    setIngs([{ key: '1', name: '', quantity: '', unit: 'g' }]);
    setBusyOcr(false);
    setBusyVoice(false);
    setRecording(false);
    cleanupWebMic();
  };

  const handleClose = () => {
    resetAdd();
    setStage('grid');
    setSelected(null);
    onClose();
  };

  const previewAsset = useMemo(() => resolveThumb(name || 'danie', findSlugForName(name)), [name]);

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      premiumAlert(
        'Brak nazwy potrawy',
        'Wpisz nazwę u góry formularza w polu „Nazwa potrawy” (to nie to samo co wiersz składnika). Potem kliknij Zapisz.',
      );
      return;
    }
    const ingredients: UserRecipeIngredient[] = ings
      .filter((i) => i.name.trim() && parseFloat(String(i.quantity).replace(',', '.')) > 0)
      .map((i) => ({
        name: i.name.trim(),
        quantity: parseFloat(String(i.quantity).replace(',', '.')) || 0,
        unit: i.unit || 'g',
      }));
    const instr = instructions.trim();
    if (!ingredients.length && !instr) {
      premiumAlert('Treść', 'Dodaj składniki albo wpisz / zeskanuj / wygłoś przepis.');
      return;
    }
    const slug = findSlugForName(trimmed);
    await saveUserRecipe({
      name: trimmed,
      imageSlug: slug,
      ingredients,
      instructions: instr,
    });
    resetAdd();
    await reload();
    setStage('grid');
  };

  const handleDelete = (id: string) => {
    premiumAlert('Usuń recepturę', 'Na pewno usunąć tę recepturę?', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: async () => {
          await deleteUserRecipe(id);
          setSelected(null);
          setStage('grid');
          await reload();
        },
      },
    ]);
  };

  const appendInstructions = (chunk: string) => {
    const t = chunk.trim();
    if (!t) return;
    setInstructions((prev) => (prev.trim() ? `${prev.trim()}\n\n${t}` : t));
  };

  const runOcrFromUri = async (uri: string) => {
    if (!BACKEND_URL) {
      premiumAlert('Backend', 'Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).');
      return;
    }
    setBusyOcr(true);
    try {
      const form = new FormData();
      const nameGuess = uri.split('/').pop() || 'recipe.jpg';
      // @ts-expect-error RN FormData file
      form.append('file', { uri, name: nameGuess, type: 'image/jpeg' });
      const { apiMultipartHeaders } = await import('@/lib/apiHeaders');
      const result = await fetchJson<{ text?: string }>(`${BACKEND_URL}/api/recipes/ocr-text`, {
        method: 'POST',
        headers: await apiMultipartHeaders(),
        body: form,
      });
      if (!result.ok) throw new Error(result.error || 'Błąd OCR');
      const t = (result.data?.text ?? '').trim();
      if (!t) throw new Error('Nie odczytano tekstu ze zdjęcia.');
      appendInstructions(t);
    } catch (e: any) {
      premiumAlert('Skan przepisu', e?.message ?? 'Nie udało się odczytać notatek.');
    } finally {
      setBusyOcr(false);
    }
  };

  const pickFromCamera = async () => {
    setScanSheetVisible(false);
    let perm = await ImagePicker.getCameraPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) {
      perm = await ImagePicker.requestCameraPermissionsAsync();
    }
    if (!perm.granted) {
      premiumAlert('Aparat', 'Brak zgody na aparat.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.85, mediaTypes: ['images'] });
    if (!r.canceled && r.assets?.[0]?.uri) await runOcrFromUri(r.assets[0].uri);
  };

  const pickFromGallery = async () => {
    setScanSheetVisible(false);
    const r = await ImagePicker.launchImageLibraryAsync({
      quality: 0.85,
      mediaTypes: ['images'],
    });
    if (!r.canceled && r.assets?.[0]?.uri) await runOcrFromUri(r.assets[0].uri);
  };

  const handleScanRecipe = () => {
    setScanSheetVisible(true);
  };

  const transcribeAudio = async (source: Blob | string, mime: string) => {
    if (!BACKEND_URL) {
      premiumAlert('Backend', 'Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).');
      return;
    }
    setBusyVoice(true);
    try {
      const form = new FormData();
      const ext = mime.includes('webm')
        ? 'webm'
        : mime.includes('m4a') || mime.includes('mp4')
          ? 'm4a'
          : mime.includes('wav')
            ? 'wav'
            : 'webm';
      if (typeof source === 'string') {
        // @ts-expect-error RN FormData
        form.append('audio', { uri: source, name: `recipe.${ext}`, type: mime });
      } else {
        // @ts-expect-error web Blob
        form.append('audio', source, `recipe.${ext}`);
      }
      form.append('language', 'pl');
      const result = await fetchJson<{ text?: string }>(`${BACKEND_URL}/api/voice/transcribe`, {
        method: 'POST',
        body: form,
      });
      if (!result.ok) throw new Error(result.error || 'Błąd transkrypcji');
      const t = (result.data?.text ?? '').trim();
      if (!t) throw new Error('Nie wykryto mowy w nagraniu.');
      appendInstructions(t);
    } catch (e: any) {
      premiumAlert('Dyktowanie', e?.message ?? 'Nie udało się przetranskrybować.');
    } finally {
      setBusyVoice(false);
      setRecording(false);
    }
  };

  const startVoice = async () => {
    try {
      if (Platform.OS === 'web') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mime =
          (window as any).MediaRecorder?.isTypeSupported?.('audio/webm;codecs=opus')
            ? 'audio/webm;codecs=opus'
            : (window as any).MediaRecorder?.isTypeSupported?.('audio/webm')
              ? 'audio/webm'
              : 'audio/mp4';
        const mr = new (window as any).MediaRecorder(stream, { mimeType: mime });
        mediaRecorderRef.current = mr;
        chunksRef.current = [];
        mr.ondataavailable = (e: any) => {
          if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
        };
        mr.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: mime });
          cleanupWebMic();
          await transcribeAudio(blob, mime);
        };
        mr.start();
      } else {
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          premiumAlert('Mikrofon', 'Brak zgody na mikrofon.');
          return;
        }
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
        await audioRecorder.prepareToRecordAsync();
        audioRecorder.record();
      }
      setRecording(true);
    } catch (e: any) {
      premiumAlert('Mikrofon', e?.message ?? 'Nie udało się uruchomić nagrywania.');
      setRecording(false);
    }
  };

  const stopVoice = async () => {
    if (Platform.OS === 'web') {
      try {
        mediaRecorderRef.current?.stop?.();
      } catch {
        /* ignore */
      }
      return;
    }
    try {
      await audioRecorder.stop();
      const uri = audioRecorder.uri;
      if (!uri) throw new Error('Brak URI nagrania.');
      await transcribeAudio(uri, 'audio/m4a');
    } catch (e: any) {
      premiumAlert('Nagrywanie', e?.message ?? 'Nie udało się zatrzymać nagrania.');
      setRecording(false);
    }
  };

  const title =
    stage === 'add' ? 'Nowa receptura' : stage === 'detail' ? selected?.name ?? 'Receptura' : 'Receptury';

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: bg }]} edges={['top']}>
        <View style={[styles.header, { borderBottomColor: border }]}>
          {stage !== 'grid' ? (
            <TouchableOpacity
              onPress={() => {
                setStage('grid');
                setSelected(null);
                resetAdd();
              }}
              style={styles.iconBtn}
              hitSlop={8}
            >
              <ChevronLeft size={22} color={text} strokeWidth={2} />
            </TouchableOpacity>
          ) : (
            <View style={styles.iconBtn} />
          )}
          <View style={styles.headerCenter}>
            <BookOpen size={16} color={accent} strokeWidth={2.5} />
            <Text style={[styles.headerTitle, { color: text }]} numberOfLines={1}>
              {title}
            </Text>
          </View>
          <TouchableOpacity onPress={handleClose} style={styles.iconBtn} hitSlop={8}>
            <X size={20} color={muted} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        {stage === 'grid' && (
          <FlatList
            data={recipes}
            keyExtractor={(item) => item.id}
            numColumns={COLS}
            columnWrapperStyle={recipes.length ? { gap: GAP } : undefined}
            contentContainerStyle={styles.listPad}
            ListHeaderComponent={
              <View style={{ marginBottom: 14, gap: 10 }}>
                <Text style={[styles.intro, { color: muted }]}>{INTRO_COPY}</Text>
                <PremiumGlowCta
                  label="+ Dodaj recepturę"
                  onPress={() => {
                    resetAdd();
                    setStage('add');
                  }}
                  icon={<Plus size={16} color="#0A0A0A" strokeWidth={2.5} />}
                />
              </View>
            }
            ListEmptyComponent={
              <View style={styles.empty}>
                <BookOpen size={36} color={muted} strokeWidth={1.5} />
                <Text style={[styles.emptyText, { color: muted }]}>
                  Brak receptur — dodaj pierwszą zielonym przyciskiem powyżej.
                </Text>
              </View>
            }
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.tile, { width: TILE_W, backgroundColor: card, borderColor: border }]}
                onPress={() => {
                  setSelected(item);
                  setStage('detail');
                }}
                activeOpacity={0.88}
              >
                <Image
                  source={resolveThumb(item.name, item.imageSlug)}
                  style={styles.tileImg}
                  resizeMode="contain"
                />
                <Text style={[styles.tileLabel, { color: text }]} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={[styles.tileMeta, { color: muted }]}>
                  {item.ingredients.length} skł.
                  {item.instructions?.trim() ? ' · przepis' : ''}
                </Text>
              </TouchableOpacity>
            )}
          />
        )}

        {stage === 'add' && (
          <ScrollView contentContainerStyle={styles.formPad} keyboardShouldPersistTaps="handled">
            <Image source={previewAsset} style={styles.previewImg} resizeMode="contain" />
            <Text style={[styles.fieldLabel, { color: muted }]}>Nazwa potrawy (wymagana)</Text>
            <TextInput
              style={[styles.input, { backgroundColor: card, borderColor: border, color: text }]}
              value={name}
              onChangeText={setName}
              placeholder="np. Margherita"
              placeholderTextColor={muted}
              testID="recipe-dish-name"
              autoCorrect={false}
            />
            <Text style={[styles.fieldLabel, { color: muted, marginTop: 14 }]}>Składniki</Text>
            {ings.map((ing, idx) => (
              <View key={ing.key} style={styles.ingEditRow}>
                <TextInput
                  style={[styles.input, { flex: 1.4, backgroundColor: card, borderColor: border, color: text }]}
                  value={ing.name}
                  onChangeText={(v) =>
                    setIngs((prev) => prev.map((p, i) => (i === idx ? { ...p, name: v } : p)))
                  }
                  placeholder="Składnik"
                  placeholderTextColor={muted}
                />
                <TextInput
                  style={[styles.input, { flex: 0.7, backgroundColor: card, borderColor: border, color: text }]}
                  value={ing.quantity}
                  onChangeText={(v) =>
                    setIngs((prev) => prev.map((p, i) => (i === idx ? { ...p, quantity: v } : p)))
                  }
                  placeholder="Ilość"
                  placeholderTextColor={muted}
                  keyboardType="decimal-pad"
                />
                <TextInput
                  style={[styles.input, { flex: 0.5, backgroundColor: card, borderColor: border, color: text }]}
                  value={ing.unit}
                  onChangeText={(v) =>
                    setIngs((prev) => prev.map((p, i) => (i === idx ? { ...p, unit: v } : p)))
                  }
                  placeholder="g"
                  placeholderTextColor={muted}
                />
              </View>
            ))}
            <TouchableOpacity
              style={{ marginTop: 8, marginBottom: 16 }}
              onPress={() =>
                setIngs((prev) => [
                  ...prev,
                  { key: String(Date.now()), name: '', quantity: '', unit: 'g' },
                ])
              }
            >
              <Text style={{ color: accent, fontWeight: '700' }}>+ Dodaj składnik</Text>
            </TouchableOpacity>

            <Text style={[styles.fieldLabel, { color: muted }]}>Przepis (tekst)</Text>
            <TextInput
              style={[
                styles.input,
                styles.textArea,
                { backgroundColor: card, borderColor: border, color: text },
              ]}
              value={instructions}
              onChangeText={setInstructions}
              placeholder="Wpisz kroki przygotowania, czasy, uwagi dla kuchni…"
              placeholderTextColor={muted}
              multiline
              textAlignVertical="top"
            />
            <View style={styles.toolRow}>
              <TouchableOpacity
                style={[
                  styles.toolBtn,
                  { borderColor: border, backgroundColor: card, opacity: busyOcr ? 0.6 : 1 },
                ]}
                onPress={handleScanRecipe}
                disabled={busyOcr || busyVoice || recording}
                activeOpacity={0.8}
              >
                {busyOcr ? (
                  <ActivityIndicator size="small" color={accent} />
                ) : (
                  <Camera size={15} color={accent} strokeWidth={2.4} />
                )}
                <Text style={[styles.toolBtnText, { color: text }]}>Skan tekstu</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toolBtn,
                  {
                    borderColor: recording ? accent : border,
                    backgroundColor: recording ? 'rgba(0,230,118,0.18)' : card,
                    opacity: busyVoice && !recording ? 0.6 : 1,
                  },
                ]}
                onPress={() => {
                  if (recording) void stopVoice();
                  else void startVoice();
                }}
                disabled={busyOcr || (busyVoice && !recording)}
                activeOpacity={0.8}
              >
                {busyVoice && !recording ? (
                  <ActivityIndicator size="small" color={accent} />
                ) : recording ? (
                  <Square size={14} color={accent} strokeWidth={2.5} />
                ) : (
                  <Mic size={15} color={accent} strokeWidth={2.4} />
                )}
                <Text style={[styles.toolBtnText, { color: text }]}>
                  {recording ? 'Stop' : busyVoice ? 'Transkrypcja…' : 'Dyktuj głosem'}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.saveBtn, { backgroundColor: accent, marginTop: 18 }]}
              onPress={() => void handleSave()}
              activeOpacity={0.85}
            >
              <Check size={18} color="#0A0A0A" strokeWidth={2.5} />
              <Text style={styles.saveBtnText}>Zapisz recepturę</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {stage === 'detail' && selected && (
          <ScrollView contentContainerStyle={styles.formPad}>
            <Image
              source={resolveThumb(selected.name, selected.imageSlug)}
              style={styles.previewImg}
              resizeMode="contain"
            />
            <Text style={[styles.detailTitle, { color: text }]}>{selected.name}</Text>
            <Text style={[styles.fieldLabel, { color: muted }]}>Składniki porcji</Text>
            {selected.ingredients.length === 0 ? (
              <Text style={[styles.emptyText, { color: muted, textAlign: 'left', paddingHorizontal: 0 }]}>
                Brak składników — przepis tylko tekstowy.
              </Text>
            ) : (
              selected.ingredients.map((ing, i) => (
                <View key={`${ing.name}-${i}`} style={styles.ingRow}>
                  <Text style={[styles.ingName, { color: text }]}>{ing.name}</Text>
                  <Text style={[styles.ingQty, { color: accent }]}>
                    {ing.quantity} {ing.unit}
                  </Text>
                </View>
              ))
            )}
            {!!selected.instructions?.trim() && (
              <>
                <Text style={[styles.fieldLabel, { color: muted, marginTop: 18 }]}>Przepis</Text>
                <Text style={[styles.instrBody, { color: text, borderColor: border, backgroundColor: card }]}>
                  {selected.instructions.trim()}
                </Text>
              </>
            )}
            <View style={styles.ctaStack}>
              {onUseInMenu ? (
                <PremiumGlowCta
                  label="Dodaj do menu"
                  icon={<UtensilsCrossed size={16} color="#0A0A0A" strokeWidth={2.5} />}
                  onPress={() => {
                    onUseInMenu({
                      dishName: selected.name,
                      ingredients: selected.ingredients,
                    });
                    handleClose();
                  }}
                />
              ) : null}
              {onAddToInventory ? (
                <PremiumGlowCta
                  label="Dodaj na magazyn"
                  icon={<Package size={16} color="#0A0A0A" strokeWidth={2.5} />}
                  onPress={() => {
                    onAddToInventory({
                      dishName: selected.name,
                      ingredients: selected.ingredients,
                    });
                    handleClose();
                  }}
                />
              ) : null}
            </View>
            <TouchableOpacity
              style={[styles.delBtn, { borderColor: border }]}
              onPress={() => handleDelete(selected.id)}
            >
              <Trash2 size={16} color={prem ? DS.color.danger : Colors.danger} strokeWidth={2} />
              <Text style={{ color: prem ? DS.color.danger : Colors.danger, fontWeight: '700' }}>
                Usuń recepturę
              </Text>
            </TouchableOpacity>
          </ScrollView>
        )}
      </SafeAreaView>

      {/* Custom dark-premium source picker (replaces system Alert for OCR) */}
      <Modal
        visible={scanSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setScanSheetVisible(false)}
      >
        <Pressable style={styles.scanOverlay} onPress={() => setScanSheetVisible(false)}>
          <View
            style={[
              styles.scanSheet,
              {
                backgroundColor: sheetBg,
                borderColor: border,
              },
            ]}
          >
            <View style={[styles.scanHandle, { backgroundColor: prem ? 'rgba(255,255,255,0.18)' : Colors.border }]} />
            <Text style={[styles.scanTitle, { color: text }]}>Skan tekstu przepisu</Text>
            <Text style={[styles.scanMsg, { color: muted }]}>
              Wybierz źródło zdjęcia notatek — OCR odczyta przepis.
            </Text>
            <TouchableOpacity
              style={[
                styles.scanAction,
                prem
                  ? { backgroundColor: DS.color.greenEnd }
                  : { backgroundColor: Colors.accent },
              ]}
              onPress={() => void pickFromCamera()}
              activeOpacity={0.88}
              testID="recipe-scan-camera"
            >
              <Camera size={18} color={prem ? '#0A0A0A' : '#fff'} strokeWidth={2.4} />
              <Text style={[styles.scanActionText, { color: prem ? '#0A0A0A' : '#fff' }]}>Aparat</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.scanAction,
                prem
                  ? { backgroundColor: DS.color.bgTertiary, borderWidth: 1, borderColor: DS.color.greenEnd }
                  : { backgroundColor: Colors.accentLight, borderWidth: 1, borderColor: Colors.accent },
              ]}
              onPress={() => void pickFromGallery()}
              activeOpacity={0.88}
              testID="recipe-scan-gallery"
            >
              <ImageIcon size={18} color={accent} strokeWidth={2.4} />
              <Text style={[styles.scanActionText, { color: accent }]}>Galeria</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.scanCancel,
                { backgroundColor: sheetTertiary, borderColor: border },
              ]}
              onPress={() => setScanSheetVisible(false)}
              activeOpacity={0.85}
              testID="recipe-scan-cancel"
            >
              <Text style={[styles.scanCancelText, { color: muted }]}>Anuluj</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Modal>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerCenter: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  headerTitle: { fontSize: 16, fontWeight: '800', maxWidth: '80%' },
  listPad: { padding: 20, paddingBottom: 40 },
  intro: { fontSize: 13, lineHeight: 19 },
  empty: { alignItems: 'center', paddingVertical: 48, gap: 12 },
  emptyText: { fontSize: 13, textAlign: 'center', lineHeight: 19, paddingHorizontal: 12 },
  tile: {
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    marginBottom: GAP,
  },
  tileImg: { width: '100%', height: TILE_W, backgroundColor: '#111' },
  tileLabel: { fontSize: 12, fontWeight: '700', paddingHorizontal: 8, paddingTop: 8 },
  tileMeta: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingBottom: 8, marginTop: 2 },
  formPad: { padding: 20, paddingBottom: 48 },
  previewImg: {
    width: '100%',
    height: 180,
    borderRadius: 14,
    backgroundColor: '#111',
    marginBottom: 16,
  },
  fieldLabel: { fontSize: 12, fontWeight: '700', marginBottom: 6, letterSpacing: 0.3 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  textArea: { minHeight: 140, paddingTop: 12 },
  toolRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  toolBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    paddingVertical: 11,
    borderRadius: 10,
    borderWidth: 1,
  },
  toolBtnText: { fontSize: 12, fontWeight: '700' },
  ingEditRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  saveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 12,
  },
  saveBtnText: { color: '#0A0A0A', fontWeight: '800', fontSize: 15 },
  detailTitle: { fontSize: 20, fontWeight: '800', marginBottom: 16 },
  ingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  ingName: { fontSize: 14, fontWeight: '600', flex: 1 },
  ingQty: { fontSize: 14, fontWeight: '700' },
  instrBody: {
    fontSize: 14,
    lineHeight: 21,
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
  },
  ctaStack: { marginTop: 20, gap: 10 },
  delBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  scanOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },
  scanSheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 28,
    gap: 10,
  },
  scanHandle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    marginBottom: 6,
  },
  scanTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.2 },
  scanMsg: { fontSize: 13, lineHeight: 19, marginBottom: 4 },
  scanAction: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    minHeight: 50,
    borderRadius: 14,
    paddingVertical: 14,
  },
  scanActionText: { fontSize: 15, fontWeight: '800' },
  scanCancel: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 2,
  },
  scanCancelText: { fontSize: 14, fontWeight: '700' },
});
