/**
 * Vision AI Expiration Date Scanner — Magazyn
 * Zdjęcie etykiety → GPT-4o (backend) → partia w warehouse_inventory
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  Image,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import {
  X,
  Camera,
  Image as ImageIcon,
  Sparkles,
  Check,
  CircleAlert,
  CalendarClock,
  Package,
} from 'lucide-react-native';
import { Colors } from '@/constants/colors';
import { useAppTheme } from '@/hooks/useAppTheme';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { CreditsGateModal } from '@/components/ads/CreditsGateModal';
import { supabase } from '@/lib/supabase';
import { apiMultipartHeaders } from '@/lib/apiHeaders';
import { emitAppDataChanged } from '@/lib/appRefresh';

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL ?? '';

type Stage = 'capture' | 'review' | 'submitting' | 'done';

type ScanResult = {
  product_name: string;
  expiration_date: string;
  confidence_score: number;
  status: string;
  quantity: number;
  unit: string;
  message: string;
  inventory_matched_name?: string | null;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirmed: () => void;
  restaurantId?: string | null;
};

export function ExpirationScanModal({ visible, onClose, onConfirmed, restaurantId }: Props) {
  const theme = useAppTheme();
  const { setCameraOverlay } = useUiOverlay();
  const { tier, credits } = useSubscription();
  const [showCreditsGate, setShowCreditsGate] = useState(false);

  const [stage, setStage] = useState<Stage>('capture');
  const [error, setError] = useState<string | null>(null);
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoMime, setPhotoMime] = useState('image/jpeg');
  const [photoName, setPhotoName] = useState('expiry.jpg');
  const [quantity, setQuantity] = useState('1');
  const [result, setResult] = useState<ScanResult | null>(null);

  const reset = useCallback(() => {
    setStage('capture');
    setError(null);
    setPhotoUri(null);
    setPhotoMime('image/jpeg');
    setPhotoName('expiry.jpg');
    setQuantity('1');
    setResult(null);
  }, []);

  useEffect(() => {
    setCameraOverlay(visible);
    return () => setCameraOverlay(false);
  }, [visible, setCameraOverlay]);

  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [reset, onClose]);

  const ensureCredits = useCallback((): boolean => {
    if (tier === 0 && credits <= 0) {
      setShowCreditsGate(true);
      return false;
    }
    return true;
  }, [tier, credits]);

  const takePhoto = useCallback(async () => {
    setError(null);
    let perm = await ImagePicker.getCameraPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) {
      perm = await ImagePicker.requestCameraPermissionsAsync();
    }
    if (!perm.granted) {
      setError('Brak dostępu do aparatu. Włącz uprawnienia w Ustawieniach.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      mediaTypes: ['images'],
      exif: false,
    });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    setPhotoUri(a.uri);
    setPhotoMime(a.mimeType ?? 'image/jpeg');
    setPhotoName(a.fileName ?? 'expiry.jpg');
    setStage('review');
  }, []);

  const pickGallery = useCallback(async () => {
    setError(null);
    const r = await ImagePicker.launchImageLibraryAsync({
      quality: 0.7,
      mediaTypes: ['images'],
    });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    setPhotoUri(a.uri);
    setPhotoMime(a.mimeType ?? 'image/jpeg');
    setPhotoName(a.fileName ?? 'expiry.jpg');
    setStage('review');
  }, []);

  const submitToWarehouse = useCallback(async () => {
    if (!photoUri) return;
    if (!ensureCredits()) return;

    const qty = parseFloat(quantity.replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Podaj poprawną ilość (liczba > 0).');
      return;
    }

    setStage('submitting');
    setError(null);

    try {
      // 1) Prefer FastAPI (główny backend aplikacji)
      if (BACKEND_URL) {
        const form = new FormData();
        form.append('file', { uri: photoUri, name: photoName, type: photoMime } as any);
        form.append('quantity', String(qty));
        form.append('unit', 'szt');
        if (restaurantId) form.append('restaurant_id', restaurantId);

        const res = await fetch(`${BACKEND_URL}/api/inventory/scan-expiration`, {
          method: 'POST',
          headers: await apiMultipartHeaders(),
          body: form,
        });
        if (!res.ok) {
          const txt = await res.text();
          let detail = txt;
          try {
            detail = JSON.parse(txt).detail ?? txt;
          } catch { /* keep */ }
          throw new Error(typeof detail === 'string' ? detail : `Błąd serwera (${res.status})`);
        }
        const data = await res.json();
        setResult({
          product_name: data.product_name,
          expiration_date: data.expiration_date,
          confidence_score: Number(data.confidence_score ?? 0),
          status: data.status,
          quantity: Number(data.quantity ?? qty),
          unit: data.unit ?? 'szt',
          message: data.message ?? 'Zapisano w magazynie.',
          inventory_matched_name: data.inventory_matched_name,
        });
        setStage('done');
        onConfirmed();
        return;
      }

      // 2) Fallback: Supabase Edge Function (base64)
      const base64 = await FileSystem.readAsStringAsync(photoUri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const { data, error: fnErr } = await supabase.functions.invoke('scan-expiration', {
        body: {
          image_base64: base64,
          quantity: qty,
          restaurant_id: restaurantId ?? null,
          unit: 'szt',
        },
      });
      if (fnErr) throw new Error(fnErr.message);
      if (data?.error) throw new Error(String(data.error));
      setResult({
        product_name: data.product_name,
        expiration_date: data.expiration_date,
        confidence_score: Number(data.confidence_score ?? 0),
        status: data.status,
        quantity: Number(data.quantity ?? qty),
        unit: data.unit ?? 'szt',
        message: data.message ?? 'Zapisano w magazynie.',
        inventory_matched_name: data.inventory_matched_name,
      });
      setStage('done');
      emitAppDataChanged('inventory');
      onConfirmed();
    } catch (e: any) {
      setError(e?.message ?? 'Nie udało się zeskanować daty ważności.');
      setStage('review');
    }
  }, [
    photoUri,
    photoName,
    photoMime,
    quantity,
    restaurantId,
    ensureCredits,
    onConfirmed,
  ]);

  const prem = theme.isPremium;
  const c = prem
    ? {
        bg: theme.bg,
        card: theme.card,
        text: theme.text,
        muted: theme.textSecondary,
        tertiary: theme.textMuted,
        accent: theme.accent,
        accentSoft: theme.accentSoft,
        border: theme.border,
        danger: theme.danger,
        success: theme.success,
        ctaText: '#0A0A0A' as const,
      }
    : {
        bg: Colors.background,
        card: Colors.card,
        text: Colors.textPrimary,
        muted: Colors.textSecondary,
        tertiary: Colors.textTertiary,
        accent: Colors.accent,
        accentSoft: Colors.accentLight,
        border: Colors.border,
        danger: Colors.danger,
        success: Colors.success,
        ctaText: '#fff' as const,
      };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <SafeAreaView style={[styles.safe, { backgroundColor: c.bg }]} edges={['top', 'bottom']}>
        <View style={[styles.header, { backgroundColor: c.card, borderBottomColor: c.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.title, { color: c.text }]}>Skaner daty ważności</Text>
            <Text style={[styles.sub, { color: c.muted }]}>
              Zrób zdjęcie etykiety (data + produkt)
            </Text>
          </View>
          <TouchableOpacity
            onPress={handleClose}
            style={[styles.closeBtn, { backgroundColor: theme.isPremium ? 'rgba(255,255,255,0.08)' : Colors.borderLight }]}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <X size={20} color={c.muted} strokeWidth={2} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {error ? (
              <View style={[styles.errorBox, { backgroundColor: theme.isPremium ? 'rgba(255,61,0,0.12)' : Colors.dangerLight, borderColor: c.danger }]}>
                <CircleAlert size={16} color={c.danger} strokeWidth={2.2} />
                <Text style={[styles.errorText, { color: c.danger }]}>{error}</Text>
              </View>
            ) : null}

            {stage === 'capture' && (
              <View style={styles.captureBlock}>
                <View style={[styles.heroIcon, { backgroundColor: c.accentSoft }]}>
                  <CalendarClock size={36} color={c.accent} strokeWidth={2} />
                </View>
                <Text style={[styles.heroTitle, { color: c.text }]}>
                  Zrób zdjęcie daty ważności
                </Text>
                <Text style={[styles.heroHint, { color: c.muted }]}>
                  Ustaw etykietę w kadrze (EXP / najlepiej spożyć przed). Potem wpisz ilość sztuk.
                </Text>
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: c.accent }]}
                  onPress={takePhoto}
                  activeOpacity={0.85}
                  testID="expiry-scan-camera"
                >
                  <Camera size={18} color={c.ctaText} strokeWidth={2.2} />
                  <Text style={[styles.primaryBtnText, { color: c.ctaText }]}>Zrób zdjęcie</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryBtn, { borderColor: c.accent, backgroundColor: c.accentSoft }]}
                  onPress={pickGallery}
                  activeOpacity={0.85}
                >
                  <ImageIcon size={17} color={c.accent} strokeWidth={2.2} />
                  <Text style={[styles.secondaryBtnText, { color: c.accent }]}>Wybierz z galerii</Text>
                </TouchableOpacity>
              </View>
            )}

            {(stage === 'review' || stage === 'submitting') && photoUri && (
              <View style={styles.reviewBlock}>
                <Image source={{ uri: photoUri }} style={[styles.preview, { borderColor: c.border }]} resizeMode="cover" />
                <TouchableOpacity onPress={() => { setPhotoUri(null); setStage('capture'); }} style={{ alignSelf: 'center' }}>
                  <Text style={{ color: c.accent, fontWeight: '700', fontSize: 13 }}>Zmień zdjęcie</Text>
                </TouchableOpacity>

                <Text style={[styles.fieldLabel, { color: c.muted }]}>Ilość sztuk (ta data ważności)</Text>
                <TextInput
                  style={[
                    styles.qtyInput,
                    {
                      backgroundColor: c.card,
                      borderColor: c.accent,
                      color: c.text,
                    },
                  ]}
                  value={quantity}
                  onChangeText={setQuantity}
                  keyboardType="decimal-pad"
                  placeholder="np. 12"
                  placeholderTextColor={c.tertiary}
                  editable={stage === 'review'}
                  testID="expiry-scan-qty"
                />

                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: c.accent, opacity: stage === 'submitting' ? 0.7 : 1 }]}
                  onPress={() => void submitToWarehouse()}
                  disabled={stage === 'submitting'}
                  activeOpacity={0.85}
                  testID="expiry-scan-submit"
                >
                  {stage === 'submitting' ? (
                    <ActivityIndicator color={c.ctaText} />
                  ) : (
                    <>
                      <Sparkles size={17} color={c.ctaText} strokeWidth={2.2} />
                      <Text style={[styles.primaryBtnText, { color: c.ctaText }]}>Wyślij do magazynu</Text>
                    </>
                  )}
                </TouchableOpacity>
                {stage === 'submitting' ? (
                  <Text style={[styles.heroHint, { color: c.muted, marginTop: 8 }]}>
                    AI odczytuje nazwę i datę ważności…
                  </Text>
                ) : null}
              </View>
            )}

            {stage === 'done' && result && (
              <View style={styles.doneBlock}>
                <View style={[styles.successIcon, { backgroundColor: c.accentSoft }]}>
                  <Check size={28} color={c.success} strokeWidth={2.5} />
                </View>
                <Text style={[styles.heroTitle, { color: c.text }]}>Zapisano w magazynie</Text>
                <View style={[styles.resultCard, { backgroundColor: c.card, borderColor: c.border }]}>
                  <View style={styles.resultRow}>
                    <Package size={15} color={c.accent} strokeWidth={2.2} />
                    <Text style={[styles.resultName, { color: c.text }]}>{result.product_name}</Text>
                  </View>
                  <Text style={[styles.resultMeta, { color: c.muted }]}>
                    Ilość: {result.quantity} {result.unit}
                  </Text>
                  <Text style={[styles.resultMeta, { color: c.muted }]}>
                    Ważne do: {result.expiration_date}
                  </Text>
                  <Text style={[styles.resultMeta, { color: c.muted }]}>
                    Status: {result.status}
                    {result.confidence_score > 0
                      ? ` · pewność ${(result.confidence_score * 100).toFixed(0)}%`
                      : ''}
                  </Text>
                  {result.inventory_matched_name ? (
                    <Text style={[styles.resultMeta, { color: c.accent }]}>
                      Dopasowano: {result.inventory_matched_name}
                    </Text>
                  ) : null}
                </View>
                <Text style={[styles.heroHint, { color: c.muted }]}>{result.message}</Text>
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: c.accent }]}
                  onPress={() => { reset(); }}
                  activeOpacity={0.85}
                >
                  <Camera size={17} color={c.ctaText} strokeWidth={2.2} />
                  <Text style={[styles.primaryBtnText, { color: c.ctaText }]}>Skanuj kolejny</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.secondaryBtn, { borderColor: c.border, backgroundColor: c.card }]}
                  onPress={handleClose}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.secondaryBtnText, { color: c.text }]}>Zamknij</Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>

        <CreditsGateModal visible={showCreditsGate} onClose={() => setShowCreditsGate(false)} />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    gap: 12,
  },
  title: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  sub: { fontSize: 12, marginTop: 2 },
  closeBtn: {
    width: 34, height: 34, borderRadius: 17,
    alignItems: 'center', justifyContent: 'center',
  },
  body: { padding: 20, gap: 14, paddingBottom: 40 },
  errorBox: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    borderRadius: 10, padding: 12, borderWidth: 1,
  },
  errorText: { flex: 1, fontSize: 13, fontWeight: '500', lineHeight: 18 },
  captureBlock: { alignItems: 'center', gap: 12, paddingTop: 24 },
  heroIcon: {
    width: 72, height: 72, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  heroTitle: { fontSize: 18, fontWeight: '800', textAlign: 'center' },
  heroHint: { fontSize: 13, textAlign: 'center', lineHeight: 19, maxWidth: 320 },
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, paddingVertical: 14, paddingHorizontal: 20, width: '100%', marginTop: 8,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderRadius: 12, paddingVertical: 13, paddingHorizontal: 20, width: '100%',
    borderWidth: 1.5,
  },
  secondaryBtnText: { fontSize: 14, fontWeight: '700' },
  reviewBlock: { gap: 12 },
  preview: {
    width: '100%', height: 240, borderRadius: 14, borderWidth: 1,
    backgroundColor: '#111',
  },
  fieldLabel: { fontSize: 12, fontWeight: '700', letterSpacing: 0.3, marginTop: 4 },
  qtyInput: {
    borderWidth: 2, borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16,
    fontSize: 22, fontWeight: '800', textAlign: 'center',
  },
  doneBlock: { alignItems: 'center', gap: 12, paddingTop: 16 },
  successIcon: {
    width: 64, height: 64, borderRadius: 32,
    alignItems: 'center', justifyContent: 'center',
  },
  resultCard: {
    width: '100%', borderRadius: 14, borderWidth: 1, padding: 14, gap: 6,
  },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultName: { flex: 1, fontSize: 16, fontWeight: '800' },
  resultMeta: { fontSize: 13, lineHeight: 18 },
});
