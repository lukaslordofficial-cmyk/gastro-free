/**
 * Formularz feedbacku testerów → POST /api/feedback (zapis + mail).
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { X, Paperclip, Check } from 'lucide-react-native';
import Constants from 'expo-constants';
import { DS } from '@/constants/premiumTheme';
import { apiMultipartHeaders } from '@/lib/apiHeaders';
import { fetchJson } from '@/lib/safeFetch';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').trim().replace(/\/$/, '');

export type FeedbackKind = 'bug' | 'usability' | 'improvement' | 'feature' | 'general';

const KIND_OPTIONS: { key: FeedbackKind; label: string }[] = [
  { key: 'bug', label: '🐛 Błąd / coś nie działa' },
  { key: 'usability', label: '⚠️ Problem z działaniem lub obsługą' },
  { key: 'improvement', label: '💡 Pomysł na usprawnienie' },
  { key: 'feature', label: '🚀 Pomysł na nową funkcję' },
  { key: 'general', label: '⭐ Ogólna opinia' },
];

const LOCATION_HINTS = [
  'Magazyn',
  'Wyniki',
  'Zakupy',
  'Faktury',
  'Menu',
  'AI',
  'Raporty',
  'Logowanie',
  'Dostawcy',
  'Inne',
];

type Attachment = {
  uri: string;
  name: string;
  mimeType: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  defaultLocation?: string;
};

export function FeedbackModal({ visible, onClose, defaultLocation }: Props) {
  const [kind, setKind] = useState<FeedbackKind | null>(null);
  const [message, setMessage] = useState('');
  const [location, setLocation] = useState(defaultLocation || '');
  const [expected, setExpected] = useState('');
  const [files, setFiles] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [doneMsg, setDoneMsg] = useState<string | null>(null);

  const appVersion = useMemo(() => {
    const v = Constants.expoConfig?.version || Constants.nativeAppVersion || '';
    const code = Constants.expoConfig?.android?.versionCode;
    return code != null ? `${v} (${code})` : String(v || '');
  }, []);

  const reset = useCallback(() => {
    setKind(null);
    setMessage('');
    setLocation(defaultLocation || '');
    setExpected('');
    setFiles([]);
    setBusy(false);
    setError(null);
    setDoneMsg(null);
  }, [defaultLocation]);

  const handleClose = () => {
    reset();
    onClose();
  };

  async function pickImages() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      setError('Brak dostępu do galerii.');
      return;
    }
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 0.85,
      allowsMultipleSelection: true,
      selectionLimit: Math.max(1, 5 - files.length),
    });
    if (r.canceled || !r.assets?.length) return;
    const next = r.assets.slice(0, 5 - files.length).map((a, i) => ({
      uri: a.uri,
      name: a.fileName || `screenshot-${Date.now()}-${i}.jpg`,
      mimeType: a.mimeType || 'image/jpeg',
    }));
    setFiles((prev) => [...prev, ...next].slice(0, 5));
  }

  async function pickDocuments() {
    const r = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: ['image/*', 'application/pdf', 'text/plain'],
    });
    if (r.canceled || !r.assets?.length) return;
    const next = r.assets.slice(0, 5 - files.length).map((a) => ({
      uri: a.uri,
      name: a.name || 'plik',
      mimeType: a.mimeType || 'application/octet-stream',
    }));
    setFiles((prev) => [...prev, ...next].slice(0, 5));
  }

  async function submit() {
    if (!kind) {
      setError('Wybierz rodzaj zgłoszenia.');
      return;
    }
    if (message.trim().length < 5) {
      setError('Opisz uwagę dokładniej (min. 5 znaków).');
      return;
    }
    if (!BACKEND_URL) {
      setError('Brak adresu backendu (EXPO_PUBLIC_BACKEND_URL).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('kind', kind);
      form.append('message', message.trim());
      if (location.trim()) form.append('location', location.trim());
      if (expected.trim()) form.append('expected_behavior', expected.trim());
      if (appVersion) form.append('app_version', appVersion);
      for (const f of files) {
        form.append('files', {
          uri: f.uri,
          name: f.name,
          type: f.mimeType,
        } as unknown as Blob);
      }
      const headers = await apiMultipartHeaders();
      const res = await fetchJson<{
        ok?: boolean;
        message?: string;
        detail?: string;
      }>(`${BACKEND_URL}/api/feedback`, {
        method: 'POST',
        headers,
        body: form,
      });
      if (!res.ok) {
        setError(res.error || 'Nie udało się wysłać zgłoszenia.');
        return;
      }
      setDoneMsg(
        res.data.message ||
          'Dziękujemy za zgłoszenie! Twoja opinia pomoże nam ulepszyć Gastro-Managera.',
      );
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Nie udało się wysłać zgłoszenia.';
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <View style={styles.root}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Zgłoś uwagi</Text>
            <Text style={styles.sub}>Feedback od użytkowników — błędy, pomysły, opinie</Text>
          </View>
          <TouchableOpacity onPress={handleClose} hitSlop={12} style={styles.close}>
            <X size={20} color={DS.color.heading} />
          </TouchableOpacity>
        </View>

        {doneMsg ? (
          <View style={styles.doneWrap}>
            <Check size={48} color={DS.color.greenEnd} strokeWidth={2.5} />
            <Text style={styles.doneTitle}>{doneMsg}</Text>
            <TouchableOpacity style={styles.submitBtn} onPress={handleClose} activeOpacity={0.85}>
              <Text style={styles.submitText}>Gotowe</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <ScrollView
              contentContainerStyle={styles.scroll}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            >
              {error ? (
                <View style={styles.errBox}>
                  <Text style={styles.errText}>{error}</Text>
                </View>
              ) : null}

              <Text style={styles.label}>Rodzaj zgłoszenia</Text>
              <View style={styles.kindList}>
                {KIND_OPTIONS.map((opt) => {
                  const active = kind === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      style={[styles.kindRow, active && styles.kindRowActive]}
                      onPress={() => setKind(opt.key)}
                      activeOpacity={0.85}
                      testID={`feedback-kind-${opt.key}`}
                    >
                      <Text style={[styles.kindText, active && styles.kindTextActive]}>{opt.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.label}>Opisz swoją uwagę</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={message}
                onChangeText={setMessage}
                placeholder="Co się stało / co warto poprawić?"
                placeholderTextColor="#666"
                multiline
                textAlignVertical="top"
                testID="feedback-message"
              />

              <Text style={styles.label}>Gdzie wystąpił problem? (opcjonalnie)</Text>
              <TextInput
                style={styles.input}
                value={location}
                onChangeText={setLocation}
                placeholder="np. Magazyn, Finanse, Menu…"
                placeholderTextColor="#666"
                testID="feedback-location"
              />
              <View style={styles.chipRow}>
                {LOCATION_HINTS.map((h) => (
                  <TouchableOpacity
                    key={h}
                    style={[styles.chip, location === h && styles.chipActive]}
                    onPress={() => setLocation(h)}
                  >
                    <Text style={[styles.chipText, location === h && styles.chipTextActive]}>{h}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Załączniki (opcjonalnie, max 5)</Text>
              <View style={styles.attachRow}>
                <TouchableOpacity style={styles.attachBtn} onPress={pickImages} disabled={files.length >= 5}>
                  <Paperclip size={16} color={DS.color.greenEnd} />
                  <Text style={styles.attachBtnText}>Zdjęcie / screenshot</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.attachBtn} onPress={pickDocuments} disabled={files.length >= 5}>
                  <Paperclip size={16} color={DS.color.greenEnd} />
                  <Text style={styles.attachBtnText}>Plik / PDF</Text>
                </TouchableOpacity>
              </View>
              {files.map((f, i) => (
                <View key={`${f.uri}-${i}`} style={styles.fileRow}>
                  <Text style={styles.fileName} numberOfLines={1}>
                    {f.name}
                  </Text>
                  <TouchableOpacity onPress={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}>
                    <Text style={styles.fileRemove}>Usuń</Text>
                  </TouchableOpacity>
                </View>
              ))}

              <Text style={styles.label}>Jak powinno to działać według Ciebie? (opcjonalnie)</Text>
              <TextInput
                style={[styles.input, styles.textAreaSm]}
                value={expected}
                onChangeText={setExpected}
                placeholder="Opisz oczekiwane zachowanie lub pomysł…"
                placeholderTextColor="#666"
                multiline
                textAlignVertical="top"
                testID="feedback-expected"
              />
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity
                style={[styles.submitBtn, busy && { opacity: 0.7 }]}
                onPress={submit}
                disabled={busy}
                activeOpacity={0.85}
                testID="feedback-submit"
              >
                {busy ? (
                  <ActivityIndicator color="#0A0A0A" />
                ) : (
                  <Text style={styles.submitText}>Wyślij zgłoszenie</Text>
                )}
              </TouchableOpacity>
            </View>
          </>
        )}
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
  scroll: { padding: 16, paddingBottom: 40 },
  label: {
    color: DS.color.muted,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 12,
  },
  kindList: { gap: 8 },
  kindRow: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: DS.color.surfaceCard,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
  },
  kindRowActive: {
    borderColor: DS.color.greenEnd,
    backgroundColor: 'rgba(0,230,118,0.10)',
  },
  kindText: { color: DS.color.heading, fontSize: 14, fontWeight: '600' },
  kindTextActive: { color: DS.color.greenEnd },
  input: {
    backgroundColor: DS.color.surfaceCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: DS.color.borderSubtle,
    color: DS.color.heading,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  textArea: { minHeight: 120 },
  textAreaSm: { minHeight: 80 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: DS.color.bgTertiary,
  },
  chipActive: { backgroundColor: 'rgba(0,230,118,0.18)' },
  chipText: { color: DS.color.muted, fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: DS.color.greenEnd },
  attachRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  attachBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: DS.color.greenEnd,
  },
  attachBtnText: { color: DS.color.greenEnd, fontSize: 12, fontWeight: '700' },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingVertical: 6,
  },
  fileName: { flex: 1, color: DS.color.heading, fontSize: 13 },
  fileRemove: { color: DS.color.danger, fontWeight: '700', fontSize: 12 },
  footer: {
    padding: 16,
    paddingBottom: 24,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DS.color.borderSubtle,
  },
  submitBtn: {
    backgroundColor: DS.color.greenEnd,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  submitText: { color: '#0A0A0A', fontWeight: '800', fontSize: 15 },
  errBox: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: 'rgba(255,90,90,0.12)',
    marginBottom: 8,
  },
  errText: { color: DS.color.danger, fontSize: 13 },
  doneWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 28,
    gap: 16,
  },
  doneTitle: {
    color: DS.color.heading,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 24,
  },
});
