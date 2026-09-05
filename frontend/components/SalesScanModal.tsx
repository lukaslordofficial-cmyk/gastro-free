/**
 * Skan ręcznie spisanej listy sprzedaży → match magazynu → odjęcie stanów.
 */
import React, { useCallback, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Switch,
  TextInput,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { Camera, FileUp, X, Check } from 'lucide-react-native';
import { DS } from '@/constants/premiumTheme';
import { apiMultipartHeaders, apiJsonHeaders } from '@/lib/apiHeaders';
import { fetchJson } from '@/lib/safeFetch';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

type SalesLine = {
  product_name: string;
  quantity: number;
  unit: string;
  matched_inventory_id?: string | null;
  matched_name?: string | null;
  match_score?: number | null;
  matched_menu_item_id?: string | null;
  match_kind?: string | null;
  current_qty?: number | null;
  stock_unit?: string;
  include: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  onConfirmed?: () => void;
};

export function SalesScanModal({ visible, onClose, onConfirmed }: Props) {
  const [stage, setStage] = useState<'choose' | 'processing' | 'review' | 'done'>('choose');
  const [error, setError] = useState<string | null>(null);
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [lines, setLines] = useState<SalesLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [resultMsg, setResultMsg] = useState('');

  const reset = useCallback(() => {
    setStage('choose');
    setError(null);
    setPreviewUri(null);
    setLines([]);
    setBusy(false);
    setResultMsg('');
  }, []);

  const handleClose = () => {
    reset();
    onClose();
  };

  async function processUri(uri: string) {
    if (!BACKEND_URL) {
      setError('Brak EXPO_PUBLIC_BACKEND_URL.');
      return;
    }
    setPreviewUri(uri);
    setStage('processing');
    setError(null);
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', {
        uri,
        name: 'sales.jpg',
        type: 'image/jpeg',
      } as any);
      const headers = await apiMultipartHeaders();
      const res = await fetchJson<{ lines?: SalesLine[]; detail?: string }>(
        `${BACKEND_URL}/api/documents/process-sales`,
        { method: 'POST', headers, body: form },
      );
      if (!res.ok) {
        setError(res.error);
        setStage('choose');
        return;
      }
      const next = (res.data.lines || []).map((l) => ({
        ...l,
        include: !!l.include,
        quantity: Number(l.quantity) || 0,
        unit: l.unit || 'g',
      }));
      setLines(next);
      setStage('review');
    } catch (e: any) {
      setError(e?.message || 'Skan nie powiódł się.');
      setStage('choose');
    } finally {
      setBusy(false);
    }
  }

  async function pickCamera() {
    let perm = await ImagePicker.getCameraPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      setError('Brak dostępu do aparatu.');
      return;
    }
    const r = await ImagePicker.launchCameraAsync({ quality: 0.85, mediaTypes: ['images'] });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    await processUri(r.assets[0].uri);
  }

  async function pickGallery() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Brak dostępu do galerii.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({ quality: 0.85, mediaTypes: ['images'] });
    if (r.canceled || !r.assets?.[0]?.uri) return;
    await processUri(r.assets[0].uri);
  }

  function patchLine(idx: number, patch: Partial<SalesLine>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  }

  async function confirm() {
    const payload = lines.filter(
      (l) =>
        l.include &&
        l.quantity > 0 &&
        (!!l.matched_inventory_id || !!l.matched_menu_item_id || l.match_kind === 'dish'),
    );
    if (!payload.length) {
      setError('Zaznacz przynajmniej jedną dopasowaną pozycję z ilością > 0.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const headers = await apiJsonHeaders();
      const res = await fetchJson<{
        applied_count?: number;
        skipped_count?: number;
        detail?: string;
      }>(`${BACKEND_URL}/api/documents/confirm-sales`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ lines: payload, note: 'Skan listy sprzedaży' }),
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResultMsg(
        `Odjęto ${res.data.applied_count ?? 0} pozycji` +
          (res.data.skipped_count ? ` (pominięto ${res.data.skipped_count})` : '') +
          '.',
      );
      setStage('done');
      onConfirmed?.();
    } catch (e: any) {
      setError(e?.message || 'Zapis nie powiódł się.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Skan sprzedaży</Text>
            <Text style={styles.sub}>Wydruk z krzyżykami / notatka → odjęcie z magazynu</Text>
          </View>
          <TouchableOpacity onPress={handleClose} hitSlop={12} style={styles.close}>
            <X size={20} color={DS.color.heading} />
          </TouchableOpacity>
        </View>

        {error ? (
          <View style={styles.errBox}>
            <Text style={styles.errText}>{error}</Text>
          </View>
        ) : null}

        {stage === 'choose' ? (
          <View style={styles.choose}>
            <TouchableOpacity style={styles.bigBtn} onPress={pickCamera} activeOpacity={0.85}>
              <Camera size={22} color="#0A0A0A" />
              <Text style={styles.bigBtnText}>Zrób zdjęcie notatki</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.bigBtn, styles.bigBtnAlt]} onPress={pickGallery} activeOpacity={0.85}>
              <FileUp size={22} color={DS.color.greenEnd} />
              <Text style={[styles.bigBtnText, { color: DS.color.greenEnd }]}>Wybierz z galerii</Text>
            </TouchableOpacity>
            <Text style={styles.hint}>
              Najłatwiej: wydrukuj listę z numerkami POS (Ustawienia → Mapowanie), zaznacz sprzedaż
              obok dań (x, ✓ albo kreski — każdy znacznik = 1 szt.) i zrób zdjęcie. Działa też notatka
              z nazwą/numerem i ilością (np. „kurczak 800 g”, „3 × 2”).
            </Text>
          </View>
        ) : null}

        {stage === 'processing' ? (
          <View style={styles.center}>
            {previewUri ? <Image source={{ uri: previewUri }} style={styles.preview} contentFit="cover" /> : null}
            <ActivityIndicator size="large" color={DS.color.greenEnd} style={{ marginTop: 16 }} />
            <Text style={styles.sub}>Odczytuję listę sprzedaży…</Text>
          </View>
        ) : null}

        {stage === 'review' ? (
          <>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }} keyboardShouldPersistTaps="handled">
              <Text style={styles.reviewLabel}>{lines.length} pozycji — sprawdź dopasowania</Text>
              {lines.map((l, idx) => (
                <View key={`${l.product_name}-${idx}`} style={styles.card}>
                  <View style={styles.cardTop}>
                    <Switch
                      value={l.include}
                      onValueChange={(v) => patchLine(idx, { include: v })}
                      trackColor={{ true: DS.color.greenEnd, false: '#333' }}
                    />
                    <View style={{ flex: 1, marginLeft: 10 }}>
                      <Text style={styles.cardName}>{l.product_name}</Text>
                      <Text style={styles.cardMatch}>
                        {l.match_kind === 'dish' || l.matched_menu_item_id
                          ? `→ danie: ${l.matched_name || '?'}${l.match_score != null ? ` (${Math.round(l.match_score)}%)` : ''} · receptura`
                          : l.matched_name
                            ? `→ ${l.matched_name}${l.match_score != null ? ` (${Math.round(l.match_score)}%)` : ''}`
                            : 'Brak dopasowania w magazynie / menu'}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.qtyRow}>
                    <TextInput
                      style={styles.qtyInput}
                      keyboardType="decimal-pad"
                      value={String(l.quantity || '')}
                      onChangeText={(t) => patchLine(idx, { quantity: parseFloat(t.replace(',', '.')) || 0 })}
                    />
                    <Text style={styles.unit}>{l.unit}</Text>
                    {l.current_qty != null ? (
                      <Text style={styles.stock}>stan {l.current_qty} {l.stock_unit || l.unit}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
              {!lines.length ? (
                <Text style={styles.hint}>Nie rozpoznano pozycji — zrób wyraźniejsze zdjęcie.</Text>
              ) : null}
            </ScrollView>
            <View style={styles.footer}>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirm} disabled={busy} activeOpacity={0.85}>
                {busy ? (
                  <ActivityIndicator color="#0A0A0A" />
                ) : (
                  <>
                    <Check size={18} color="#0A0A0A" strokeWidth={2.5} />
                    <Text style={styles.confirmText}>Odejmij z magazynu</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </>
        ) : null}

        {stage === 'done' ? (
          <View style={styles.center}>
            <Check size={48} color={DS.color.greenEnd} strokeWidth={2.5} />
            <Text style={styles.title}>{resultMsg || 'Zapisano.'}</Text>
            <TouchableOpacity style={styles.bigBtn} onPress={handleClose}>
              <Text style={styles.bigBtnText}>Gotowe</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: DS.color.bgPrimary },
  header: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 18,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DS.color.borderSubtle,
    gap: 12,
  },
  title: { color: DS.color.heading, fontSize: 18, fontWeight: '700' },
  sub: { color: DS.color.muted, fontSize: 12, marginTop: 4 },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DS.color.bgTertiary,
  },
  errBox: {
    margin: 16,
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,90,90,0.12)',
  },
  errText: { color: DS.color.danger, fontSize: 13 },
  choose: { padding: 24, gap: 14 },
  bigBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: DS.color.greenEnd,
    borderRadius: 12,
    paddingVertical: 16,
  },
  bigBtnAlt: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: DS.color.greenEnd,
  },
  bigBtnText: { color: '#0A0A0A', fontWeight: '800', fontSize: 15 },
  hint: { color: DS.color.muted, fontSize: 13, lineHeight: 18, marginTop: 8 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  preview: { width: 160, height: 160, borderRadius: 12 },
  reviewLabel: { color: DS.color.muted, fontSize: 12, marginBottom: 10, fontWeight: '600' },
  card: {
    backgroundColor: DS.color.surfaceCard,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DS.color.borderSubtle,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  cardName: { color: DS.color.heading, fontWeight: '700', fontSize: 14 },
  cardMatch: { color: DS.color.muted, fontSize: 12, marginTop: 2 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  qtyInput: {
    minWidth: 72,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: DS.color.heading,
    fontWeight: '700',
  },
  unit: { color: DS.color.muted, fontWeight: '600' },
  stock: { color: DS.color.muted, fontSize: 11, marginLeft: 'auto' },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    backgroundColor: DS.color.bgPrimary,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DS.color.borderSubtle,
  },
  confirmBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: DS.color.greenEnd,
    borderRadius: 12,
    paddingVertical: 14,
  },
  confirmText: { color: '#0A0A0A', fontWeight: '800', fontSize: 15 },
});
