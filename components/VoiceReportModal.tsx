/**
 * VoiceReportModal
 *
 * Uniwersalny modal głosowego raportowania w Gastro Manager.
 *
 * Flow:
 *   1. użytkownik naciska mikrofon → nagrywa audio
 *      • WEB → MediaRecorder API
 *      • iOS / Android → expo-av Audio.Recording (natywne)
 *   2. blob/plik → POST /api/voice/transcribe (Whisper-1)
 *   3. tekst → POST /api/voice/interpret (GPT-4o mini, Structured Outputs)
 *        → zwraca { intent, payload, confidence, reason }
 *   4. użytkownik EDYTUJE dane w formularzu (nazwa, kategoria, ilość, bufor itd.)
 *   5. potwierdza podgląd → POST /api/actions/apply
 *        → zapisuje do właściwej tabeli Supabase (waste_logs, revenue_entries,
 *          fixed_costs, variable_cost_entries, inventory_items, menu_items+recipe,
 *          suppliers, supplier_catalog)
 *
 * Obsługiwane intencje: waste | add_revenue | add_fixed_cost | add_variable_cost |
 *   add_inventory_item | add_menu_item | add_supplier | add_supplier_product | unknown
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Platform, ScrollView, TextInput,
} from 'react-native';
import { Mic, Square, X, Check, AlertTriangle, RefreshCw, Send, Info, Plus, Trash2, ShieldAlert } from 'lucide-react-native';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { useRouter } from 'expo-router';
import { Colors } from '@/constants/colors';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { DealHunterModal } from './DealHunterModal';

type Stage =
  | 'idle' | 'recording' | 'transcribing' | 'interpreting'
  | 'review' | 'applying' | 'done' | 'error';

export type Intent =
  | 'waste' | 'add_revenue' | 'add_fixed_cost' | 'add_variable_cost'
  | 'add_inventory_item' | 'add_menu_item' | 'add_supplier'
  | 'add_supplier_product'
  // Voice CRUD (edycja parametrów istniejących obiektów)
  | 'edit_menu_item_price' | 'add_recipe_ingredient'
  | 'edit_recipe_ingredient_qty' | 'edit_inventory_item'
  // Dostawcy / zamówienia
  | 'order_product' | 'order_critical_items_by_category'
  | 'supplier_flip_order' | 'budget_cap_order'
  | 'compare_catalogs_top_savings' | 'predictive_weekend_restock'
  | 'check_minimum_order_value'
  // Masowe / destrukcyjne / dostępność / skalowanie / nawigacja (v2)
  | 'bulk_delete_menu' | 'bulk_delete_suppliers' | 'bulk_reset_inventory'
  | 'bulk_delete_inventory' | 'restore_last_deleted_menu'
  | 'delete_menu_item' | 'delete_supplier' | 'delete_inventory_item'
  | 'toggle_menu_item_availability'
  | 'bulk_edit_menu_prices_percentage' | 'bulk_edit_menu_prices_fixed'
  | 'bulk_edit_inventory_buffers'
  | 'edit_menu_item_category' | 'rename_menu_item' | 'scale_recipe'
  | 'navigate_screen' | 'filter_ui_inventory' | 'filter_ui_menu_blocked'
  | 'summarize_custom_period' | 'compare_two_periods'
  | 'unknown';

/** Intencje NIEODWRACALNE / masowe — wymagają czerwonego modalu z wpisaniem „POTWIERDZAM". */
const DESTRUCTIVE_INTENTS = new Set<Intent>([
  'bulk_delete_menu', 'bulk_delete_suppliers', 'bulk_reset_inventory', 'bulk_delete_inventory',
]);
/** Intencje sterowania UI — wykonywane natychmiast na froncie (nawigacja/filtry). */
const NAV_INTENTS = new Set<Intent>([
  'navigate_screen', 'filter_ui_inventory', 'filter_ui_menu_blocked',
]);
const CONFIRM_WORD = 'POTWIERDZAM';

interface FuzzyMatch {
  field: string;
  matched_to: string;
  score: number;
  resolved_id: string;
}

interface Interpretation {
  intent: Intent;
  confidence: number;
  reason?: string | null;
  payload: Record<string, any>;
  fuzzy_matches?: FuzzyMatch[];
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onApplied?: (intent: Intent) => void;
  contextHint?: string;
}

const BACKEND_URL =
  process.env.EXPO_PUBLIC_BACKEND_URL ??
  process.env.REACT_APP_BACKEND_URL ??
  '';

const UNIT_OPTIONS = ['kg', 'g', 'l', 'ml', 'szt', 'op'];

/** Meta per intent — labels shown in preview */
const INTENT_META: Record<Intent, { icon: string; label: string; color: string }> = {
  waste:                { icon: '🗑️', label: 'Strata magazynowa',            color: '#DC2626' },
  add_revenue:          { icon: '💰', label: 'Nowy przychód',                 color: '#059669' },
  add_fixed_cost:       { icon: '🏢', label: 'Koszt stały',                   color: '#7C3AED' },
  add_variable_cost:    { icon: '📦', label: 'Koszt zmienny',                 color: '#EA580C' },
  add_inventory_item:   { icon: '📥', label: 'Nowy produkt w magazynie',      color: '#0284C7' },
  add_menu_item:        { icon: '🍽️', label: 'Nowa pozycja w menu',           color: '#DB2777' },
  add_supplier:         { icon: '🚚', label: 'Nowy dostawca',                 color: '#0891B2' },
  add_supplier_product: { icon: '🏷️', label: 'Produkt w cenniku dostawcy',    color: '#2563EB' },
  edit_menu_item_price: { icon: '✏️', label: 'Zmiana ceny w menu',            color: '#DB2777' },
  add_recipe_ingredient:{ icon: '➕', label: 'Dodaj składnik do receptury',   color: '#F59E0B' },
  edit_recipe_ingredient_qty: { icon: '⚖️', label: 'Zmień gramaturę składnika', color: '#F59E0B' },
  edit_inventory_item:  { icon: '🛠️', label: 'Zmień parametry produktu',      color: '#0284C7' },
  order_product:        { icon: '🛒', label: 'Zamówienie u dostawcy',         color: '#2563EB' },
  order_critical_items_by_category: { icon: '📦', label: 'Zbiorcze zamówienie braków (Łowca Okazji)', color: '#8B5CF6' },
  supplier_flip_order:  { icon: '🔄', label: 'Przerzucenie koszyka',          color: '#F97316' },
  budget_cap_order:     { icon: '💸', label: 'Zamówienie do limitu',          color: '#0891B2' },
  compare_catalogs_top_savings: { icon: '📊', label: 'TOP 5 promocji',        color: '#059669' },
  predictive_weekend_restock:   { icon: '🔮', label: 'Prognoza zamówienia',   color: '#7C3AED' },
  check_minimum_order_value:    { icon: '📦', label: 'Minimum darmowej dostawy', color: '#0284C7' },
  bulk_delete_menu:      { icon: '💣', label: 'Wyczyść całe menu',            color: '#B91C1C' },
  bulk_delete_suppliers: { icon: '💣', label: 'Usuń wszystkich dostawców',    color: '#B91C1C' },
  bulk_reset_inventory:  { icon: '💣', label: 'Reset magazynu do zera',       color: '#B91C1C' },
  bulk_delete_inventory: { icon: '💣', label: 'Usuń cały magazyn',            color: '#B91C1C' },
  restore_last_deleted_menu: { icon: '↩️', label: 'Przywróć usunięte menu',   color: '#059669' },
  delete_menu_item:      { icon: '🗑️', label: 'Usuń danie z menu',            color: '#DC2626' },
  delete_supplier:       { icon: '🗑️', label: 'Usuń dostawcę',                color: '#DC2626' },
  delete_inventory_item: { icon: '🗑️', label: 'Usuń produkt z magazynu',      color: '#DC2626' },
  toggle_menu_item_availability: { icon: '🔀', label: 'Dostępność dania (POS)', color: '#0891B2' },
  bulk_edit_menu_prices_percentage: { icon: '📈', label: 'Masowa zmiana cen (%)', color: '#059669' },
  bulk_edit_menu_prices_fixed:      { icon: '💵', label: 'Masowa zmiana cen (zł)', color: '#059669' },
  bulk_edit_inventory_buffers:      { icon: '🛡️', label: 'Masowa zmiana buforów', color: '#7C3AED' },
  edit_menu_item_category: { icon: '🏷️', label: 'Zmiana kategorii dania',     color: '#DB2777' },
  rename_menu_item:        { icon: '✏️', label: 'Zmiana nazwy dania',          color: '#DB2777' },
  scale_recipe:            { icon: '🧮', label: 'Kalkulator porcji',           color: '#F59E0B' },
  navigate_screen:         { icon: '🧭', label: 'Nawigacja po aplikacji',      color: '#2563EB' },
  filter_ui_inventory:     { icon: '🔍', label: 'Filtr magazynu',             color: '#0284C7' },
  filter_ui_menu_blocked:  { icon: '🔍', label: 'Filtr: zablokowane dania',   color: '#DC2626' },
  summarize_custom_period: { icon: '📊', label: 'Analiza okresu (AI)',       color: '#2563EB' },
  compare_two_periods:     { icon: '📈', label: 'Porównanie okresów (AI)',   color: '#0891B2' },
  unknown:              { icon: '❓', label: 'Nie rozpoznano intencji',       color: '#6B7280' },
};

export function VoiceReportModal({ visible, onClose, onApplied, contextHint }: Props) {
  const router = useRouter();
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [stage, setStage] = useState<Stage>('idle');
  const [transcript, setTranscript] = useState('');
  const [interp, setInterp] = useState<Interpretation | null>(null);
  const [edited, setEdited] = useState<Record<string, any>>({});
  const [confirmText, setConfirmText] = useState('');
  const [applyResult, setApplyResult] = useState<{ detail: string; extras: any; warnings: string[] } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [categories, setCategories] = useState<{ id: string; name: string; color: string }[]>([]);
  // Bulk Deal Hunter — po zatwierdzeniu order_critical_items_by_category
  // otwieramy Modal Łowcy Okazji z gotowym zestawieniem.
  const [bulkCompare, setBulkCompare] = useState<any | null>(null);
  const [bulkContextLabel, setBulkContextLabel] = useState<string>('');

  // Web-only refs
  const mediaRecorderRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);

  useEffect(() => {
    if (!visible) {
      cleanup();
      setStage('idle');
      setTranscript('');
      setInterp(null);
      setEdited({});
      setConfirmText('');
      setApplyResult(null);
      setErrorMsg(null);
      setElapsed(0);
      setBulkCompare(null);
      setBulkContextLabel('');
    }
  }, [visible]);

  // Load inventory categories once when modal opens (used by add_inventory_item)
  useEffect(() => {
    if (!visible || !isSupabaseConfigured) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('inventory_categories')
          .select('id, name, color')
          .order('sort_order');
        if (data) setCategories(data as any);
      } catch { /* non-critical */ }
    })();
  }, [visible]);

  function cleanup() {
    try { mediaRecorderRef.current?.stop?.(); } catch {}
    try { streamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch {}
    try { if (audioRecorder.isRecording) audioRecorder.stop(); } catch {}
    streamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }

  async function startRecording() {
    setErrorMsg(null);
    try {
      if (Platform.OS === 'web') {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const mime =
          (window as any).MediaRecorder?.isTypeSupported?.('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
            : (window as any).MediaRecorder?.isTypeSupported?.('audio/webm') ? 'audio/webm'
            : 'audio/mp4';
        const mr = new (window as any).MediaRecorder(stream, { mimeType: mime });
        mediaRecorderRef.current = mr;
        chunksRef.current = [];
        mr.ondataavailable = (e: any) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
        mr.onstop = async () => {
          const blob = new Blob(chunksRef.current, { type: mime });
          cleanup();
          await handleAudioReady(blob, mime);
        };
        mr.start();
      } else {
        // Native (iOS / Android) via expo-audio
        const perm = await requestRecordingPermissionsAsync();
        if (!perm.granted) {
          throw new Error('Brak zgody na dostęp do mikrofonu. Włącz w ustawieniach systemu.');
        }
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
        await audioRecorder.prepareToRecordAsync();
        audioRecorder.record();
      }
      setStage('recording');
      setElapsed(0);
      timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Nie udało się uruchomić mikrofonu.');
      setStage('error');
    }
  }

  async function stopRecording() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (Platform.OS === 'web') {
      try { mediaRecorderRef.current?.stop?.(); } catch {}
      // onstop callback fires handleAudioReady
    } else {
      try {
        await audioRecorder.stop();
        const uri = audioRecorder.uri;
        if (!uri) throw new Error('Brak URI nagrania.');
        // Expo Go / RN: FormData wymaga { uri, name, type }, nie Blob
        await handleAudioReady(uri, 'audio/m4a');
      } catch (e: any) {
        setErrorMsg(e?.message ?? 'Nie udało się zatrzymać nagrywania.');
        setStage('error');
      }
    }
  }

  async function handleAudioReady(source: Blob | string, mime: string) {
    if (!BACKEND_URL) {
      setErrorMsg('Brak adresu backendu. Ustaw EXPO_PUBLIC_BACKEND_URL w pliku frontend/.env i zrestartuj Expo.');
      setStage('error');
      return;
    }
    setStage('transcribing');
    try {
      const form = new FormData();
      const ext = mime.includes('webm') ? 'webm'
        : mime.includes('m4a') || mime.includes('mp4') ? 'm4a'
        : mime.includes('wav') ? 'wav' : 'webm';
      if (typeof source === 'string') {
        // @ts-ignore  React Native FormData — natywny upload z pliku na dysku
        form.append('audio', { uri: source, name: `voice.${ext}`, type: mime } as any);
      } else {
        // @ts-ignore  Web — MediaRecorder Blob
        form.append('audio', source as any, `voice.${ext}`);
      }
      form.append('language', 'pl');
      const r = await fetch(`${BACKEND_URL}/api/voice/transcribe`, { method: 'POST', body: form });
      if (!r.ok) throw new Error(`Transcribe HTTP ${r.status}: ${await r.text()}`);
      const data = await r.json();
      const text = (data?.text ?? '').trim();
      if (!text) throw new Error('Nie wykryto mowy w nagraniu.');
      setTranscript(text);
      await handleInterpret(text);
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Błąd transkrypcji.');
      setStage('error');
    }
  }

  async function handleInterpret(text: string) {
    setStage('interpreting');
    try {
      const r = await fetch(`${BACKEND_URL}/api/voice/interpret`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!r.ok) throw new Error(`Interpret HTTP ${r.status}: ${await r.text()}`);
      const data: Interpretation = await r.json();
      setInterp(data);
      // Intencje nawigacji/filtrów wykonujemy natychmiast (bez ekranu potwierdzenia).
      if (NAV_INTENTS.has(data.intent)) {
        performNavigation(data.intent, data.payload || {});
        return;
      }
      // Seed editable form state with AI defaults — user may freely change values.
      // AI often returns 0 when it did not recognise a numeric value; convert 0 → null
      // so the TextInput shows the placeholder and the user notices they must type it.
      setEdited(seedPayload(data.intent, data.payload || {}));
      setStage('review');
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Błąd interpretacji AI.');
      setStage('error');
    }
  }

  function performNavigation(intent: Intent, payload: Record<string, any>) {
    try {
      if (intent === 'navigate_screen') {
        const map: Record<string, any> = {
          index: '/(tabs)', menu: '/(tabs)/menu', magazyn: '/(tabs)/magazyn',
          dostawcy: '/(tabs)/dostawcy', ustawienia: '/(tabs)/ustawienia',
        };
        router.push(map[payload.screen] ?? '/(tabs)');
      } else if (intent === 'filter_ui_inventory') {
        router.push({ pathname: '/(tabs)/magazyn', params: { voiceCategory: payload.category ?? '' } });
      } else if (intent === 'filter_ui_menu_blocked') {
        router.push({ pathname: '/(tabs)/menu', params: { voiceBlocked: '1' } });
      }
    } catch { /* navigation best-effort */ }
    onClose();
  }

  async function handleApply() {
    if (!interp || interp.intent === 'unknown') return;
    setStage('applying');
    try {
      const r = await fetch(`${BACKEND_URL}/api/actions/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: interp.intent,
          // IMPORTANT: send user-edited values, not raw AI payload
          payload: edited,
          transcript, source: 'voice',
        }),
      });
      if (!r.ok) throw new Error(`Apply HTTP ${r.status}: ${await r.text()}`);
      const data = await r.json();
      if (data.ok === false) {
        setErrorMsg(data.detail ?? 'Operacja nie powiodła się.');
        setStage('error');
        return;
      }
      setApplyResult({
        detail: data.detail ?? 'OK',
        extras: data.extras ?? {},
        warnings: data.warnings ?? [],
      });
      setStage('done');
      onApplied?.(interp.intent);
      // Bulk Category-Targeted Orders — otwórz Łowcę Okazji z gotowym compare.
      if (interp.intent === 'order_critical_items_by_category') {
        const extras = data.extras ?? {};
        const compare = extras.compare;
        if (compare) {
          const label = Array.isArray(extras.matched_categories) && extras.matched_categories.length > 0
            ? (extras.matched_categories.includes('all')
                ? 'Braki: wszystkie kategorie'
                : `Braki: ${extras.matched_categories.join(', ')}`)
            : 'Zbiorcze zamówienie braków';
          setBulkContextLabel(label);
          setBulkCompare(compare);
        }
      }
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Błąd zapisu.');
      setStage('error');
    }
  }

  function resetAll() {
    cleanup();
    setStage('idle');
    setTranscript('');
    setInterp(null);
    setEdited({});
    setConfirmText('');
    setApplyResult(null);
    setErrorMsg(null);
    setElapsed(0);
  }

  const patchEdited = (patch: Record<string, any>) => setEdited((prev) => ({ ...prev, ...patch }));

  const isDestructive = interp ? DESTRUCTIVE_INTENTS.has(interp.intent) : false;
  const confirmOk = confirmText.trim().toUpperCase() === CONFIRM_WORD;
  const canApply = !!interp && interp.intent !== 'unknown' && (!isDestructive || confirmOk);
  const meta = interp ? INTENT_META[interp.intent] : INTENT_META.unknown;
  const workingMessage =
    stage === 'transcribing' ? 'Zamieniam mowę na tekst (Whisper)…'
      : stage === 'interpreting' ? 'AI klasyfikuje intencję (GPT-4o mini)…'
      : stage === 'applying' ? 'Zapisuję do Supabase…'
      : '';

  return (
    <Modal visible={visible} animationType="slide" transparent presentationStyle="overFullScreen" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.iconBadge}>
                <Mic size={16} color={Colors.white} strokeWidth={2.5} />
              </View>
              <View>
                <Text style={styles.title} testID="voice-modal-title">Zgłoś informację</Text>
                <Text style={styles.subtitle}>
                  {contextHint ? `${contextHint} · ` : ''}dyktowanie AI
                </Text>
              </View>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn} testID="voice-modal-close">
              <X size={20} color={Colors.textSecondary} strokeWidth={2} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {(stage === 'idle' || stage === 'error') && (
              <View style={styles.idleWrap}>
                <Text style={styles.idleHint}>
                  Powiedz jedną z komend, np.:{'\n'}
                  „Wyrzuciłem 5 litrów zupy ogórkowej, bo skwaśniała"{'\n'}
                  „Dodaj do menu pizzę margherita za 32 zł"{'\n'}
                  „Podnieś ceny wszystkich dań o 10 procent"{'\n'}
                  „Wyłącz danie Burger Bacon"{'\n'}
                  „Przelicz Sałatkę Grecką na 50 porcji"{'\n'}
                  „Otwórz zakładkę magazyn"{'\n'}
                  „Usuń całe menu" / „Usuń wszystkich dostawców" (wymaga potwierdzenia)
                </Text>
                <TouchableOpacity
                  style={[styles.recBtn, styles.recBtnStart]}
                  onPress={startRecording}
                  activeOpacity={0.85}
                  testID="voice-record-start"
                >
                  <Mic size={30} color={Colors.white} strokeWidth={2.5} />
                </TouchableOpacity>
                <Text style={styles.recBtnLabel}>Rozpocznij nagrywanie</Text>
                {stage === 'error' && errorMsg && (
                  <View style={styles.errorBox} testID="voice-error-box">
                    <AlertTriangle size={14} color={Colors.danger} strokeWidth={2.5} />
                    <Text style={styles.errorText}>{errorMsg}</Text>
                  </View>
                )}
              </View>
            )}

            {stage === 'recording' && (
              <View style={styles.idleWrap}>
                <View style={styles.pulseRing}>
                  <TouchableOpacity
                    style={[styles.recBtn, styles.recBtnStop]}
                    onPress={stopRecording}
                    activeOpacity={0.85}
                    testID="voice-record-stop"
                  >
                    <Square size={22} color={Colors.white} strokeWidth={2.5} />
                  </TouchableOpacity>
                </View>
                <Text style={[styles.recBtnLabel, { color: Colors.danger }]}>
                  Nagrywanie… {elapsed}s
                </Text>
                <Text style={styles.idleHint}>Kliknij ponownie aby zakończyć</Text>
              </View>
            )}

            {(stage === 'transcribing' || stage === 'interpreting' || stage === 'applying') && (
              <View style={styles.workingWrap}>
                <ActivityIndicator size="large" color={Colors.accent} />
                <Text style={styles.workingText}>{workingMessage}</Text>
                {transcript && stage !== 'transcribing' && (
                  <View style={styles.transcriptBox}>
                    <Text style={styles.transcriptLabel}>Rozpoznany tekst:</Text>
                    <Text style={styles.transcriptText}>{transcript}</Text>
                  </View>
                )}
              </View>
            )}

            {stage === 'review' && interp && (
              <View>
                <View style={styles.transcriptBox}>
                  <Text style={styles.transcriptLabel}>Rozpoznany tekst</Text>
                  <Text style={styles.transcriptText}>{transcript}</Text>
                </View>

                <Text style={styles.sectionLabel}>Intencja AI</Text>
                <View style={[styles.intentBadge, { backgroundColor: `${meta.color}18`, borderColor: `${meta.color}55` }]}>
                  <Text style={styles.intentBadgeIcon}>{meta.icon}</Text>
                  <Text style={[styles.intentBadgeText, { color: meta.color }]}>{meta.label}</Text>
                  <Text style={styles.intentBadgeConf}>{Math.round((interp.confidence ?? 0) * 100)}%</Text>
                </View>

                {interp.reason ? (
                  <Text style={styles.intentReason}>{interp.reason}</Text>
                ) : null}

                {interp.intent !== 'unknown' && !isDestructive && (
                  <Text style={styles.editHint}>
                    Sprawdź i popraw dane przed zapisem — możesz edytować każde pole.
                  </Text>
                )}

                {isDestructive && (
                  <View style={styles.dangerBox} testID="voice-danger-box">
                    <View style={styles.dangerHeader}>
                      <ShieldAlert size={20} color="#FFFFFF" strokeWidth={2.5} />
                      <Text style={styles.dangerTitle}>⚠️ Uwaga! Operacja nieodwracalna</Text>
                    </View>
                    <Text style={styles.dangerText}>
                      Jarvis wykrył intencję masowego usunięcia / resetu danych
                      („{meta.label}"). Aby kontynuować, wpisz poniżej słowo{'\n'}
                      <Text style={styles.dangerWord}>{CONFIRM_WORD}</Text>.
                    </Text>
                    <TextInput
                      style={styles.dangerInput}
                      value={confirmText}
                      onChangeText={setConfirmText}
                      placeholder={CONFIRM_WORD}
                      placeholderTextColor="rgba(255,255,255,0.5)"
                      autoCapitalize="characters"
                      autoCorrect={false}
                      testID="voice-confirm-input"
                    />
                  </View>
                )}

                {!isDestructive && (
                  <IntentEditor
                    intent={interp.intent}
                    edited={edited}
                    patch={patchEdited}
                    categories={categories}
                  />
                )}

                {interp.intent === 'unknown' && (
                  <View style={styles.errorBox}>
                    <AlertTriangle size={14} color={Colors.danger} strokeWidth={2.5} />
                    <Text style={styles.errorText}>
                      AI nie rozpoznało jednoznacznej intencji. Nagraj ponownie
                      z konkretnymi słowami: „wyrzuciłem", „dodaj do menu",
                      „rachunek za…", „nowy dostawca…".
                    </Text>
                  </View>
                )}

                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={resetAll} activeOpacity={0.85} testID="voice-review-retry">
                    <RefreshCw size={14} color={Colors.textSecondary} strokeWidth={2.5} />
                    <Text style={styles.secondaryBtnText}>Nagraj jeszcze raz</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      isDestructive && styles.dangerBtn,
                      !canApply && styles.primaryBtnDisabled,
                    ]}
                    onPress={handleApply}
                    disabled={!canApply}
                    activeOpacity={0.85}
                    testID="voice-review-apply"
                  >
                    {isDestructive
                      ? <Trash2 size={14} color={Colors.white} strokeWidth={2.5} />
                      : <Send size={14} color={Colors.white} strokeWidth={2.5} />}
                    <Text style={styles.primaryBtnText}>
                      {isDestructive ? 'Usuń bezpowrotnie'
                        : interp.intent === 'restore_last_deleted_menu' ? 'Przywróć menu'
                        : 'Zapisz'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {stage === 'done' && applyResult && interp && (
              <View>
                <View style={[styles.successBox, { backgroundColor: meta.color }]}>
                  <Check size={20} color={Colors.white} strokeWidth={3} />
                  <Text style={styles.successText}>{meta.label} — zapisano</Text>
                </View>

                <IntentDoneSummary intent={interp.intent} extras={applyResult.extras} />

                {applyResult.warnings.length > 0 && (
                  <View style={styles.warnBox}>
                    <AlertTriangle size={13} color={Colors.warning} strokeWidth={2.5} />
                    <View style={{ flex: 1 }}>
                      {applyResult.warnings.map((w, i) => (
                        <Text key={i} style={styles.warnText}>• {w}</Text>
                      ))}
                    </View>
                  </View>
                )}

                <View style={styles.actionsRow}>
                  <TouchableOpacity style={styles.secondaryBtn} onPress={resetAll} activeOpacity={0.85} testID="voice-done-again">
                    <Mic size={14} color={Colors.textSecondary} strokeWidth={2.5} />
                    <Text style={styles.secondaryBtnText}>Zgłoś kolejną</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.primaryBtn} onPress={onClose} activeOpacity={0.85} testID="voice-done-close">
                    <Check size={14} color={Colors.white} strokeWidth={2.5} />
                    <Text style={styles.primaryBtnText}>Zamknij</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}
          </ScrollView>
        </View>
      </View>
      {/* Bulk Deal Hunter — otwierany po zbiorczym zamówieniu braków. */}
      {bulkCompare ? (
        <DealHunterModal
          visible={!!bulkCompare}
          product={null}
          restaurantName={undefined}
          initialCompare={bulkCompare}
          bulkContextLabel={bulkContextLabel}
          onClose={() => { setBulkCompare(null); setBulkContextLabel(''); onClose(); }}
        />
      ) : null}
    </Modal>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Intent-specific EDITORS (user can modify AI defaults before confirming)
// ────────────────────────────────────────────────────────────────────────────

interface EditorProps {
  intent: Intent;
  edited: Record<string, any>;
  patch: (p: Record<string, any>) => void;
  categories: { id: string; name: string; color: string }[];
}

function IntentEditor({ intent, edited, patch, categories }: EditorProps) {
  if (intent === 'waste') {
    const isDish = (edited.item_type ?? 'ingredient') === 'dish';
    // Danie z menu → jednostki liczone z receptury (porcja) + gramatura płynów/wagi.
    // Składnik z magazynu → jednostki magazynowe.
    const wasteUnits = isDish ? ['porcja', 'l', 'kg', 'g', 'ml'] : ['szt', 'op', 'l', 'ml', 'g', 'kg'];
    const changeType = (v: string) => {
      const next: Record<string, any> = { item_type: v };
      const validNow = (v === 'dish' ? ['porcja', 'l', 'kg', 'g', 'ml'] : ['szt', 'op', 'l', 'ml', 'g', 'kg']);
      if (!validNow.includes(edited.unit)) {
        next.unit = v === 'dish' ? 'porcja' : 'szt';
      }
      patch(next);
    };
    return (
      <Card>
        <SegmentedField
          label="Typ"
          value={edited.item_type ?? 'ingredient'}
          onChange={changeType}
          options={[
            { key: 'ingredient', label: 'Składnik z magazynu' },
            { key: 'dish', label: 'Danie z menu' },
          ]}
        />
        <EditRow label="Pozycja" value={edited.item_name ?? ''} onChangeText={(v) => patch({ item_name: v })} placeholder={isDish ? 'np. Krem z dyni' : 'np. Mleko'} />
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <EditRow label="Ilość" value={edited.quantity == null ? '' : String(edited.quantity)} onChangeText={(v) => patch({ quantity: numOrNull(v) })} keyboardType="decimal-pad" placeholder="0" />
          </View>
          <View style={{ flex: 1 }}>
            <UnitField value={edited.unit ?? ''} onChange={(v) => patch({ unit: v })} options={wasteUnits} />
          </View>
        </View>
        {isDish && (
          <Text style={styles.editHint2}>
            Jednostka „porcja” odejmie składniki z receptury × liczba porcji. Litr/kg/g/ml odejmie wg wielkości porcji dania.
          </Text>
        )}
        <EditRow label="Powód" value={edited.reason_text ?? ''} onChangeText={(v) => patch({ reason_text: v })} placeholder="np. skwaśniało" multiline />
      </Card>
    );
  }
  if (intent === 'add_revenue') {
    return (
      <Card>
        <EditRow label="Opis" value={edited.description ?? ''} onChangeText={(v) => patch({ description: v })} placeholder="np. Utarg dzienny" />
        <EditRow label="Kwota (PLN)" value={edited.amount_pln == null ? '' : String(edited.amount_pln)} onChangeText={(v) => patch({ amount_pln: numOrNull(v) })} keyboardType="decimal-pad" placeholder="0.00" />
        <EditRow label="Notatka" value={edited.note ?? ''} onChangeText={(v) => patch({ note: v })} placeholder="opcjonalnie" multiline />
      </Card>
    );
  }
  if (intent === 'add_fixed_cost' || intent === 'add_variable_cost') {
    return (
      <Card>
        <EditRow label="Nazwa" value={edited.cost_name ?? ''} onChangeText={(v) => patch({ cost_name: v })} placeholder="np. Rachunek za prąd" />
        <EditRow label="Kategoria" value={edited.cost_type ?? ''} onChangeText={(v) => patch({ cost_type: v })} placeholder="other" />
        <EditRow label="Kwota (PLN)" value={edited.amount_pln == null ? '' : String(edited.amount_pln)} onChangeText={(v) => patch({ amount_pln: numOrNull(v) })} keyboardType="decimal-pad" placeholder="0.00" />
      </Card>
    );
  }
  if (intent === 'add_inventory_item') {
    return (
      <Card>
        <EditRow
          label="Nazwa produktu"
          value={edited.product_name ?? ''}
          onChangeText={(v) => patch({ product_name: v })}
          placeholder="np. Mleko"
          testID="voice-edit-product-name"
        />

        <FieldLabel text="Kategoria" />
        {categories.length === 0 ? (
          <TextInput
            style={styles.editInput}
            value={edited.category_name ?? ''}
            onChangeText={(v) => patch({ category_name: v })}
            placeholder="np. Nabiał (wpisz ręcznie)"
            placeholderTextColor={Colors.textTertiary}
            testID="voice-edit-category-text"
          />
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
            {categories.map((cat) => {
              const active = (edited.category_name ?? '').toLowerCase() === cat.name.toLowerCase();
              return (
                <TouchableOpacity
                  key={cat.id}
                  style={[styles.pill, active && { backgroundColor: cat.color, borderColor: cat.color }]}
                  onPress={() => patch({ category_name: cat.name })}
                  activeOpacity={0.7}
                  testID={`voice-edit-category-${cat.name}`}
                >
                  {active && <Check size={11} color={Colors.white} strokeWidth={3} />}
                  <Text style={[styles.pillText, active && { color: Colors.white, fontWeight: '700' }]}>{cat.name}</Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        <View style={[styles.twoCol, { marginTop: 12 }]}>
          <View style={{ flex: 1 }}>
            <EditRow
              label="Ilość"
              value={edited.quantity == null ? '' : String(edited.quantity)}
              onChangeText={(v) => patch({ quantity: numOrNull(v) })}
              keyboardType="decimal-pad"
              placeholder="0"
              testID="voice-edit-quantity"
            />
          </View>
          <View style={{ flex: 1 }}>
            <UnitField value={edited.unit ?? ''} onChange={(v) => patch({ unit: v })} />
          </View>
        </View>

        <EditRow
          label="Próg krytyczny"
          value={edited.min_quantity == null ? '' : String(edited.min_quantity)}
          onChangeText={(v) => patch({ min_quantity: numOrNull(v) })}
          keyboardType="decimal-pad"
          placeholder="np. 2"
          testID="voice-edit-min-quantity"
          hint={`Alarm o niskim stanie włącza się poniżej tej wartości (${edited.unit ?? 'jednostki'})`}
        />

        <EditRow
          label="Bufor bezpieczeństwa (%)"
          value={String(edited.safety_buffer_percent ?? 20)}
          onChangeText={(v) => patch({ safety_buffer_percent: numOrNull(v) })}
          keyboardType="number-pad"
          placeholder="20"
          testID="voice-edit-safety-buffer"
        />
        <View style={styles.bufferInfoBox}>
          <Info size={12} color={Colors.textSecondary} strokeWidth={2} />
          <Text style={styles.bufferInfoText}>
            💡 <Text style={styles.bufferInfoBold}>Bufor bezpieczeństwa</Text> – Zapas na niezgłoszone straty i ubytki. Ostrzeżenie o braku towaru włączy się o tyle % wcześniej.
          </Text>
        </View>
      </Card>
    );
  }
  if (intent === 'add_menu_item') {
    const ingredients: any[] = Array.isArray(edited.ingredients) ? edited.ingredients : [];
    const updateIngredient = (idx: number, changes: Record<string, any>) => {
      const next = ingredients.map((ing, i) => (i === idx ? { ...ing, ...changes } : ing));
      patch({ ingredients: next });
    };
    const removeIngredient = (idx: number) => {
      patch({ ingredients: ingredients.filter((_, i) => i !== idx) });
    };
    const addIngredient = () => {
      patch({ ingredients: [...ingredients, { ingredient_name: '', quantity: null, unit: 'g' }] });
    };
    return (
      <Card>
        <EditRow
          label="Nazwa dania"
          value={edited.product_name ?? ''}
          onChangeText={(v) => patch({ product_name: v })}
          placeholder="np. Sałatka grecka"
          testID="voice-edit-menu-name"
        />
        <EditRow
          label="Kategoria menu"
          value={edited.menu_category ?? ''}
          onChangeText={(v) => patch({ menu_category: v })}
          placeholder="np. Sałatki, Zupy, Dania główne"
          testID="voice-edit-menu-category"
        />
        <EditRow
          label="Cena (PLN)"
          value={edited.price_pln == null ? '' : String(edited.price_pln)}
          onChangeText={(v) => patch({ price_pln: numOrNull(v) })}
          keyboardType="decimal-pad"
          placeholder="np. 32.00"
          testID="voice-edit-menu-price"
          hint="Cena sprzedaży dania w karcie menu"
        />

        <View style={styles.ingHeader}>
          <Text style={styles.editLabel}>Składniki ({ingredients.length})</Text>
          <TouchableOpacity onPress={addIngredient} style={styles.ingAddBtn} activeOpacity={0.8} testID="voice-edit-ingredient-add">
            <Plus size={12} color={Colors.accent} strokeWidth={2.5} />
            <Text style={styles.ingAddText}>Dodaj składnik</Text>
          </TouchableOpacity>
        </View>

        {ingredients.length === 0 ? (
          <Text style={styles.ingEmpty}>Brak składników — kliknij „Dodaj składnik".</Text>
        ) : ingredients.map((ing, idx) => (
          <View key={idx} style={styles.ingCard} testID={`voice-edit-ingredient-${idx}`}>
            <View style={styles.ingCardHead}>
              <Text style={styles.ingCardIdx}>#{idx + 1}</Text>
              <TouchableOpacity onPress={() => removeIngredient(idx)} style={styles.ingRemoveBtn} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }} testID={`voice-edit-ingredient-remove-${idx}`}>
                <X size={13} color={Colors.danger} strokeWidth={2.5} />
              </TouchableOpacity>
            </View>
            <TextInput
              style={styles.editInput}
              value={ing.ingredient_name ?? ''}
              onChangeText={(v) => updateIngredient(idx, { ingredient_name: v })}
              placeholder="Nazwa składnika, np. Ser feta"
              placeholderTextColor={Colors.textTertiary}
              testID={`voice-edit-ingredient-name-${idx}`}
            />
            <View style={[styles.twoCol, { marginTop: 8 }]}>
              <View style={{ flex: 1 }}>
                <TextInput
                  style={styles.editInput}
                  value={ing.quantity == null ? '' : String(ing.quantity)}
                  onChangeText={(v) => updateIngredient(idx, { quantity: numOrNull(v) })}
                  keyboardType="decimal-pad"
                  placeholder="Ilość"
                  placeholderTextColor={Colors.textTertiary}
                  testID={`voice-edit-ingredient-qty-${idx}`}
                />
              </View>
              <View style={{ flex: 1.2 }}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
                  {UNIT_OPTIONS.map((u) => {
                    const active = ing.unit === u;
                    return (
                      <TouchableOpacity
                        key={u}
                        style={[styles.unitPillSm, active && styles.unitPillActive]}
                        onPress={() => updateIngredient(idx, { unit: u })}
                        activeOpacity={0.7}
                        testID={`voice-edit-ingredient-unit-${idx}-${u}`}
                      >
                        <Text style={[styles.unitPillTextSm, active && styles.unitPillTextActive]}>{u}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          </View>
        ))}
      </Card>
    );
  }
  if (intent === 'add_supplier') {
    return (
      <Card>
        <EditRow label="Nazwa" value={edited.supplier_name ?? ''} onChangeText={(v) => patch({ supplier_name: v })} placeholder="np. Warzywa Adam" />
        <EditRow label="Osoba kontaktowa" value={edited.contact_person ?? ''} onChangeText={(v) => patch({ contact_person: v })} placeholder="opcjonalnie" />
        <EditRow label="Telefon" value={edited.phone ?? ''} onChangeText={(v) => patch({ phone: v })} keyboardType="phone-pad" placeholder="500 100 200" />
        <EditRow label="E-mail" value={edited.email ?? ''} onChangeText={(v) => patch({ email: v })} keyboardType="email-address" placeholder="opcjonalnie" />
        <EditRow label="Kategoria dostawcy" value={edited.supplier_category ?? ''} onChangeText={(v) => patch({ supplier_category: v })} placeholder="np. Warzywa" />
        <EditRow label="NIP" value={edited.nip ?? ''} onChangeText={(v) => patch({ nip: v })} keyboardType="number-pad" placeholder="opcjonalnie" />
      </Card>
    );
  }
  if (intent === 'add_supplier_product') {
    return (
      <Card>
        <EditRow label="Dostawca" value={edited.supplier_name ?? ''} onChangeText={(v) => patch({ supplier_name: v })} placeholder="np. Makro" />
        <EditRow label="Produkt" value={edited.product_name ?? ''} onChangeText={(v) => patch({ product_name: v })} placeholder="np. Piwo Tyskie" />
        <EditRow label="Wariant" value={edited.variant ?? ''} onChangeText={(v) => patch({ variant: v })} placeholder="opcjonalnie" />
        <EditRow label="Opakowanie" value={edited.volume_label ?? ''} onChangeText={(v) => patch({ volume_label: v })} placeholder="np. zgrzewka 24szt" />
        <EditRow label="Cena (PLN)" value={edited.price_pln == null ? '' : String(edited.price_pln)} onChangeText={(v) => patch({ price_pln: numOrNull(v) })} keyboardType="decimal-pad" placeholder="0.00" />
      </Card>
    );
  }

  // ── Voice CRUD (edycja istniejących obiektów) ─────────────────────────────
  if (intent === 'edit_menu_item_price') {
    return (
      <Card>
        <JarvisMatchBanner
          label="danie z menu"
          matched={edited.dish_name_resolved || edited.dish_name}
          question={`Czy zapisać nową cenę: ${edited.new_price ?? '?'} zł?`}
        />
        <EditRow
          label="Nazwa dania"
          value={edited.dish_name_resolved ?? edited.dish_name ?? ''}
          onChangeText={(v) => patch({ dish_name: v, dish_name_resolved: v, dish_id: null })}
          placeholder="np. Panna cotta z owocami"
          testID="voice-edit-dish-name"
        />
        <EditRow
          label="Nowa cena (PLN)"
          value={edited.new_price == null ? '' : String(edited.new_price)}
          onChangeText={(v) => patch({ new_price: numOrNull(v) })}
          keyboardType="decimal-pad"
          placeholder="0.00"
          testID="voice-edit-new-price"
          hint="⭐ Pole podświetlone — Jarvis wypełnił z komendy głosowej"
        />
      </Card>
    );
  }
  if (intent === 'add_recipe_ingredient' || intent === 'edit_recipe_ingredient_qty') {
    const isEdit = intent === 'edit_recipe_ingredient_qty';
    return (
      <Card>
        <JarvisMatchBanner
          label="składnik receptury"
          matched={edited.dish_name_resolved || edited.dish_name}
          question={isEdit ? `Zmienić gramaturę ${edited.ingredient_name} na ${edited.quantity} ${edited.unit || 'g'}?`
                          : `Dodać ${edited.quantity} ${edited.unit || 'g'} składnika "${edited.ingredient_name}" do dania?`}
        />
        <EditRow label="Danie" value={edited.dish_name_resolved ?? edited.dish_name ?? ''}
          onChangeText={(v) => patch({ dish_name: v, dish_name_resolved: v, dish_id: null })}
          placeholder="np. Sałatka Grecka" />
        <EditRow label="Składnik"
          value={edited.ingredient_name_resolved ?? edited.ingredient_name ?? ''}
          onChangeText={(v) => patch({ ingredient_name: v, ingredient_name_resolved: v })}
          placeholder="np. Feta" />
        <View style={styles.twoCol}>
          <View style={{ flex: 1 }}>
            <EditRow
              label="Gramatura"
              value={edited.quantity == null ? '' : String(edited.quantity)}
              onChangeText={(v) => patch({ quantity: numOrNull(v) })}
              keyboardType="decimal-pad"
              placeholder="0"
              testID="voice-edit-recipe-qty"
              hint="⭐ Pole podświetlone"
            />
          </View>
          <View style={{ flex: 1 }}>
            <UnitField value={edited.unit ?? 'g'} onChange={(v) => patch({ unit: v })} />
          </View>
        </View>
      </Card>
    );
  }
  if (intent === 'edit_inventory_item') {
    return (
      <Card>
        <JarvisMatchBanner
          label="produkt w magazynie"
          matched={edited.item_name_resolved || edited.item_name}
          question="Czy zapisać nowe parametry?"
        />
        <EditRow label="Nazwa produktu"
          value={edited.item_name_resolved ?? edited.item_name ?? ''}
          onChangeText={(v) => patch({ item_name: v, item_name_resolved: v, inventory_id: null })}
          placeholder="np. Mleko" />
        <EditRow label="Nowy próg krytyczny"
          value={edited.min_quantity == null ? '' : String(edited.min_quantity)}
          onChangeText={(v) => patch({ min_quantity: numOrNull(v) })}
          keyboardType="decimal-pad" placeholder="pozostaw puste, aby nie zmieniać"
          testID="voice-edit-min-qty"
          hint={edited.min_quantity != null ? '⭐ Wypełnione z komendy' : undefined}
        />
        <EditRow label="Nowy stan magazynu"
          value={edited.current_quantity == null ? '' : String(edited.current_quantity)}
          onChangeText={(v) => patch({ current_quantity: numOrNull(v) })}
          keyboardType="decimal-pad" placeholder="pozostaw puste"
          testID="voice-edit-current-qty"
          hint={edited.current_quantity != null ? '⭐ Wypełnione z komendy' : undefined}
        />
        <EditRow label="Bufor bezpieczeństwa (%)"
          value={edited.safety_buffer_percent == null ? '' : String(edited.safety_buffer_percent)}
          onChangeText={(v) => patch({ safety_buffer_percent: numOrNull(v) })}
          keyboardType="decimal-pad" placeholder="np. 20"
          testID="voice-edit-buffer"
          hint={edited.safety_buffer_percent != null ? '⭐ Wypełnione z komendy' : undefined}
        />
        <UnitField value={edited.unit ?? 'szt'} onChange={(v) => patch({ unit: v })} />
      </Card>
    );
  }

  // ── Dostawcy: podgląd akcji (nie edycja formularza — użytkownik zatwierdza wykonanie).
  if (intent === 'supplier_flip_order' || intent === 'budget_cap_order' ||
      intent === 'compare_catalogs_top_savings' || intent === 'predictive_weekend_restock' ||
      intent === 'check_minimum_order_value' || intent === 'order_product' ||
      intent === 'order_critical_items_by_category' ||
      intent === 'summarize_custom_period' || intent === 'compare_two_periods') {
    return (
      <Card>
        <View style={styles.supplierActionInfo} testID={`voice-supplier-action-${intent}`}>
          <Text style={styles.supplierActionTitle}>{INTENT_META[intent].label}</Text>
          {intent === 'order_critical_items_by_category' && (
            <>
              <EditRow
                label="Kategorie (rozdzielone przecinkiem)"
                value={Array.isArray(edited.categories) ? edited.categories.join(', ') : (edited.categories ?? '')}
                onChangeText={(v) => patch({
                  categories: v.split(',').map((s) => s.trim()).filter(Boolean),
                })}
                placeholder={'np. Mięso i wędliny, Nabiał lub „all"'}
                testID="voice-edit-order-categories"
                hint={
                  Array.isArray(edited.categories) && edited.categories.includes('all')
                    ? '⭐ Wszystkie braki (globalnie)'
                    : '⭐ Puste = wszystkie krytyczne braki'
                }
              />
              <Text style={styles.supplierActionHint}>
                Po zatwierdzeniu system znajdzie wszystkie produkty krytyczne
                w wybranych kategoriach, wyliczy deficyty i otworzy Łowcę Okazji
                z gotowym zestawieniem najtańszych ofert dostawców.
              </Text>
            </>
          )}
          {intent === 'supplier_flip_order' && (
            <>
              <EditRow label="Z dostawcy" value={edited.from_supplier_resolved ?? edited.from_supplier ?? ''}
                onChangeText={(v) => patch({ from_supplier: v, from_supplier_resolved: v })} placeholder="np. Makro" />
              <EditRow label="Do dostawcy" value={edited.to_supplier_resolved ?? edited.to_supplier ?? ''}
                onChangeText={(v) => patch({ to_supplier: v, to_supplier_resolved: v })} placeholder="np. Sokołów" />
              <EditRow label="Kategoria (opcjonalnie)" value={edited.category ?? ''}
                onChangeText={(v) => patch({ category: v })} placeholder="mięso, napoje…" />
            </>
          )}
          {intent === 'budget_cap_order' && (
            <>
              <EditRow label="Maks. budżet (PLN)" value={edited.max_budget == null ? '' : String(edited.max_budget)}
                onChangeText={(v) => patch({ max_budget: numOrNull(v) })} keyboardType="decimal-pad" placeholder="np. 500"
                hint="⭐ Pole podświetlone — Jarvis wypełnił z komendy" />
              <EditRow label="Kategoria (opcjonalnie)" value={edited.category ?? ''}
                onChangeText={(v) => patch({ category: v })} placeholder="mięso, napoje…" />
            </>
          )}
          {intent === 'check_minimum_order_value' && (
            <>
              <EditRow label="Dostawca" value={edited.supplier_name_resolved ?? edited.supplier_name ?? ''}
                onChangeText={(v) => patch({ supplier_name: v, supplier_name_resolved: v })} placeholder="np. Makro" />
              <EditRow label="Aktualna wartość koszyka (PLN)"
                value={edited.current_cart_total == null ? '' : String(edited.current_cart_total)}
                onChangeText={(v) => patch({ current_cart_total: numOrNull(v) })} keyboardType="decimal-pad" placeholder="0.00" />
            </>
          )}
          {(intent === 'compare_catalogs_top_savings' || intent === 'predictive_weekend_restock') && (
            <Text style={styles.supplierActionHint}>
              Po zatwierdzeniu Jarvis wykona akcję i pokaże wynik na dole.
            </Text>
          )}
          {intent === 'order_product' && (
            <Text style={styles.supplierActionHint}>
              Produkty w koszyku: {(edited.items || []).length}. Zatwierdź, aby przejść do Łowcy Okazji.
            </Text>
          )}
          {(intent === 'summarize_custom_period' || intent === 'compare_two_periods') && (
            <Text style={styles.supplierActionHint}>
              Po zatwierdzeniu Jarvis przeanalizuje dane finansowe z raportów dobowych i pokaże wynik poniżej.
            </Text>
          )}
        </View>
      </Card>
    );
  }
  return null;
}

// Banner "Jarvis dopasował: X. Czy zapisać …?" — wyświetla wynik fuzzy matchingu.
function JarvisMatchBanner({ label, matched, question }:
  { label: string; matched?: string | null; question: string }) {
  if (!matched) return null;
  return (
    <View style={styles.jarvisBanner} testID="jarvis-match-banner">
      <Text style={styles.jarvisBannerIcon}>🎙️</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.jarvisBannerText}>
          Jarvis dopasował {label}:{' '}<Text style={styles.jarvisBannerMatched}>{matched}</Text>
        </Text>
        <Text style={styles.jarvisBannerQuestion}>{question}</Text>
      </View>
    </View>
  );
}

function IntentDoneSummary({ intent, extras }: { intent: Intent; extras: any }) {
  if (intent === 'waste' && Array.isArray(extras?.deductions) && extras.deductions.length > 0) {
    return (
      <>
        <Text style={styles.sectionLabel}>Odjęto z magazynu ({extras.deductions.length})</Text>
        {extras.deductions.map((d: any, i: number) => (
          <View key={i} style={styles.deductRow}>
            <Text style={styles.deductName}>{d.name}</Text>
            <Text style={styles.deductQty}>−{Number(d.deducted).toFixed(2)} {d.unit}</Text>
          </View>
        ))}
      </>
    );
  }
  if (intent === 'scale_recipe' && Array.isArray(extras?.ingredients)) {
    return (
      <>
        {extras.message ? <Text style={styles.doneMessage}>{extras.message}</Text> : null}
        <Text style={styles.sectionLabel}>Składniki na {extras.portions} porcji</Text>
        {extras.ingredients.map((s: any, i: number) => (
          <View key={i} style={styles.deductRow}>
            <Text style={styles.deductName}>{s.ingredient_name}</Text>
            <Text style={[styles.deductQty, { color: s.enough ? '#059669' : Colors.danger }]}>
              {Number(s.total_needed).toFixed(2)} {s.unit}{s.enough ? ' ✓' : ' ⚠︎'}
            </Text>
          </View>
        ))}
      </>
    );
  }
  if (Array.isArray(extras?.changes) && extras.changes.length > 0) {
    return (
      <>
        {extras.message ? <Text style={styles.doneMessage}>{extras.message}</Text> : null}
        <Text style={styles.sectionLabel}>Zmiany ({extras.affected})</Text>
        {extras.changes.map((c: any, i: number) => (
          <View key={i} style={styles.deductRow}>
            <Text style={styles.deductName}>{c.name}</Text>
            <Text style={styles.deductQty}>{Number(c.old).toFixed(2)} → {Number(c.new).toFixed(2)}</Text>
          </View>
        ))}
      </>
    );
  }
  if (typeof extras?.message === 'string' && extras.message) {
    return <Text style={styles.doneMessage} testID="voice-done-message">{extras.message}</Text>;
  }
  return null;
}

function Card({ children }: { children: React.ReactNode }) {
  return <View style={styles.reviewCard} testID="voice-review-card">{children}</View>;
}

function FieldLabel({ text }: { text: string }) {
  return <Text style={styles.editLabel}>{text}</Text>;
}

interface EditRowProps {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'decimal-pad' | 'number-pad' | 'email-address' | 'phone-pad';
  multiline?: boolean;
  testID?: string;
  hint?: string;
}
function EditRow({ label, value, onChangeText, placeholder, keyboardType, multiline, testID, hint }: EditRowProps) {
  return (
    <View style={styles.editRow}>
      <FieldLabel text={label} />
      <TextInput
        style={[styles.editInput, multiline && styles.editInputMulti]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={Colors.textTertiary}
        keyboardType={keyboardType ?? 'default'}
        multiline={!!multiline}
        testID={testID}
      />
      {hint ? <Text style={styles.editHint2}>{hint}</Text> : null}
    </View>
  );
}

function UnitField({ value, onChange, options }: { value: string; onChange: (v: string) => void; options?: string[] }) {
  const units = options ?? UNIT_OPTIONS;
  return (
    <View style={styles.editRow}>
      <FieldLabel text="Jednostka" />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pillRow}>
        {units.map((u) => {
          const active = value === u;
          return (
            <TouchableOpacity
              key={u}
              style={[styles.unitPill, active && styles.unitPillActive]}
              onPress={() => onChange(u)}
              activeOpacity={0.7}
              testID={`voice-edit-unit-${u}`}
            >
              <Text style={[styles.unitPillText, active && styles.unitPillTextActive]}>{u}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

function SegmentedField({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { key: string; label: string }[];
}) {
  return (
    <View style={styles.editRow}>
      <FieldLabel text={label} />
      <View style={styles.segmentRow}>
        {options.map((opt) => {
          const active = value === opt.key;
          return (
            <TouchableOpacity
              key={opt.key}
              style={[styles.segmentBtn, active && styles.segmentBtnActive]}
              onPress={() => onChange(opt.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

function numOrNull(v: string): number | null {
  if (v === '' || v == null) return null;
  const n = Number(v.replace(',', '.'));
  return isFinite(n) ? n : null;
}

/**
 * Sanitize AI-returned payload before showing editable form.
 * AI returns 0 for numeric fields it couldn't recognise (price, amount, quantity).
 * Convert those 0s to null so the TextInput shows placeholder — makes the user
 * notice they must fill it in instead of silently saving zero.
 */
function seedPayload(intent: Intent, payload: Record<string, any>): Record<string, any> {
  const p = { ...payload };
  const NUMERIC_ZERO_TO_NULL = [
    'price_pln', 'amount_pln', 'quantity', 'min_quantity',
    'new_price', 'current_quantity', 'safety_buffer_percent', 'max_budget',
  ];
  for (const k of NUMERIC_ZERO_TO_NULL) {
    if (p[k] === 0) p[k] = null;
  }
  // Menu item: also clean ingredient quantities so 0 → null
  if (intent === 'add_menu_item' && Array.isArray(p.ingredients)) {
    p.ingredients = p.ingredients.map((ing: any) => ({
      ingredient_name: ing?.ingredient_name ?? '',
      quantity: ing?.quantity === 0 ? null : ing?.quantity ?? null,
      unit: ing?.unit ?? 'g',
    }));
  }
  // Zbiorcze zamówienie braków — jeśli AI nie wypełniło kategorii,
  // domyślnie leć "all" (globalnie wszystkie krytyczne braki).
  if (intent === 'order_critical_items_by_category') {
    const raw = p.categories;
    let cats: string[] = [];
    if (Array.isArray(raw)) cats = raw.filter((x) => typeof x === 'string' && x.trim());
    else if (typeof raw === 'string' && raw.trim()) cats = [raw.trim()];
    if (cats.length === 0) cats = ['all'];
    p.categories = cats;
  }
  return p;
}

// ────────────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.card,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 18,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    maxHeight: '92%',
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 20, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconBadge: {
    width: 34, height: 34, borderRadius: 10, backgroundColor: '#8B5CF6',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#8B5CF6', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.35, shadowRadius: 6, elevation: 4,
  },
  title: { fontSize: 17, fontWeight: '800', color: Colors.textPrimary, letterSpacing: -0.3 },
  subtitle: { fontSize: 12, color: Colors.textSecondary, marginTop: 1 },
  closeBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: Colors.borderLight, alignItems: 'center', justifyContent: 'center' },

  body: { paddingHorizontal: 20, paddingTop: 18, paddingBottom: 10 },

  idleWrap: { alignItems: 'center', gap: 12, paddingVertical: 8 },
  idleHint: { fontSize: 12, color: Colors.textSecondary, textAlign: 'left', lineHeight: 18, marginBottom: 6, alignSelf: 'stretch' },
  recBtn: {
    width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center',
    shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.35, shadowRadius: 14, elevation: 8,
  },
  recBtnStart: { backgroundColor: '#8B5CF6', shadowColor: '#8B5CF6' },
  recBtnStop: { backgroundColor: Colors.danger, shadowColor: Colors.danger },
  recBtnLabel: { fontSize: 14, fontWeight: '700', color: Colors.textPrimary, letterSpacing: 0.2 },
  pulseRing: {
    padding: 12, borderRadius: 60,
    backgroundColor: 'rgba(220, 38, 38, 0.12)',
    borderWidth: 2, borderColor: 'rgba(220, 38, 38, 0.35)',
  },

  workingWrap: { alignItems: 'center', gap: 14, paddingVertical: 24 },
  workingText: { fontSize: 14, color: Colors.textSecondary, fontWeight: '500', textAlign: 'center' },

  transcriptBox: {
    backgroundColor: Colors.borderLight, borderRadius: 12, padding: 12,
    borderLeftWidth: 3, borderLeftColor: Colors.accent, marginBottom: 14,
  },
  transcriptLabel: { fontSize: 10, fontWeight: '800', color: Colors.textTertiary, letterSpacing: 0.5, marginBottom: 4, textTransform: 'uppercase' },
  transcriptText: { fontSize: 14, color: Colors.textPrimary, lineHeight: 20, fontStyle: 'italic' },

  doneMessage: { fontSize: 14, color: Colors.textPrimary, lineHeight: 20, fontWeight: '600', marginBottom: 12 },

  dangerBox: {
    backgroundColor: '#7F1D1D', borderRadius: 16, padding: 16, marginBottom: 16,
    borderWidth: 2, borderColor: '#DC2626',
  },
  dangerHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  dangerTitle: { flex: 1, fontSize: 15, fontWeight: '800', color: '#FFFFFF', letterSpacing: -0.2 },
  dangerText: { fontSize: 13, color: '#FEE2E2', lineHeight: 19, marginBottom: 12 },
  dangerWord: { fontWeight: '900', color: '#FFFFFF', letterSpacing: 1 },
  dangerInput: {
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 16, fontWeight: '800', color: '#FFFFFF', letterSpacing: 2, textAlign: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)',
  },
  dangerBtn: { backgroundColor: '#B91C1C' },


  sectionLabel: { fontSize: 11, fontWeight: '800', color: Colors.textSecondary, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 10, marginTop: 6 },

  intentBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, alignSelf: 'flex-start', marginBottom: 8,
  },
  intentBadgeIcon: { fontSize: 16 },
  intentBadgeText: { fontSize: 13, fontWeight: '800' },
  intentBadgeConf: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, marginLeft: 4 },
  intentReason: { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic', marginBottom: 8, lineHeight: 17 },
  editHint: { fontSize: 12, color: Colors.textSecondary, marginBottom: 10, lineHeight: 17 },

  reviewCard: {
    backgroundColor: Colors.background, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 14,
  },

  editRow: { marginBottom: 12 },
  editLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: '600', marginBottom: 6 },
  editInput: {
    backgroundColor: Colors.card, borderRadius: 10, paddingHorizontal: 12,
    paddingVertical: Platform.OS === 'ios' ? 11 : 9, fontSize: 14, color: Colors.textPrimary,
    borderWidth: 1.5, borderColor: Colors.border,
  },
  editInputMulti: { minHeight: 60, textAlignVertical: 'top' },
  editHint2: { fontSize: 11, color: Colors.textTertiary, marginTop: 4 },
  editHelper: { fontSize: 12, color: Colors.textSecondary, marginTop: 4 },

  twoCol: { flexDirection: 'row', gap: 10 },

  pillRow: { flexDirection: 'row', gap: 8, paddingRight: 8 },
  pill: {
    flexShrink: 0, flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card,
  },
  pillText: { fontSize: 12, fontWeight: '500', color: Colors.textSecondary },

  unitPill: {
    flexShrink: 0, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card, minWidth: 44, alignItems: 'center',
  },
  unitPillActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  unitPillText: { fontSize: 13, fontWeight: '600', color: Colors.textSecondary },
  unitPillTextActive: { color: Colors.white },

  segmentRow: { flexDirection: 'row', gap: 8 },
  segmentBtn: {
    flex: 1, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card, alignItems: 'center',
  },
  segmentBtnActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  segmentText: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },
  segmentTextActive: { color: Colors.white },

  bufferInfoBox: {
    flexDirection: 'row', gap: 6, backgroundColor: Colors.borderLight,
    borderRadius: 10, padding: 10, marginTop: -6, marginBottom: 2,
    borderLeftWidth: 3, borderLeftColor: Colors.accent,
  },
  bufferInfoText: { flex: 1, fontSize: 11, color: Colors.textSecondary, lineHeight: 16 },
  bufferInfoBold: { fontWeight: '700', color: Colors.textPrimary },

  ingLine: { fontSize: 12, color: Colors.textSecondary, marginTop: 4, marginLeft: 4 },

  ingHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 8, marginBottom: 8,
  },
  ingAddBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: Colors.accentLight, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: '#BFDBFE',
  },
  ingAddText: { fontSize: 12, fontWeight: '700', color: Colors.accent },
  ingEmpty: {
    fontSize: 12, color: Colors.textTertiary, fontStyle: 'italic',
    textAlign: 'center', paddingVertical: 12,
  },
  ingCard: {
    backgroundColor: Colors.card, borderRadius: 10, padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: Colors.border,
  },
  ingCardHead: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginBottom: 6,
  },
  ingCardIdx: { fontSize: 11, fontWeight: '700', color: Colors.textTertiary, letterSpacing: 0.5 },
  ingRemoveBtn: {
    width: 22, height: 22, borderRadius: 11, backgroundColor: Colors.dangerLight,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#FECACA',
  },
  unitPillSm: {
    flexShrink: 0, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 8,
    borderWidth: 1.5, borderColor: Colors.border, backgroundColor: Colors.card,
    minWidth: 38, alignItems: 'center',
  },
  unitPillTextSm: { fontSize: 12, fontWeight: '600', color: Colors.textSecondary },

  errorBox: {
    flexDirection: 'row', gap: 8, backgroundColor: Colors.dangerLight,
    borderWidth: 1, borderColor: '#FECACA', borderRadius: 10, padding: 12, alignItems: 'flex-start', marginTop: 10,
  },
  errorText: { flex: 1, fontSize: 12, color: Colors.danger, lineHeight: 17, fontWeight: '500' },

  warnBox: {
    flexDirection: 'row', gap: 8, backgroundColor: Colors.warningLight,
    borderWidth: 1, borderColor: '#FDE68A', borderRadius: 10, padding: 12, alignItems: 'flex-start', marginTop: 10,
  },
  warnText: { fontSize: 12, color: Colors.warning, lineHeight: 17, fontWeight: '500' },

  successBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginBottom: 14,
  },
  successText: { fontSize: 15, fontWeight: '700', color: Colors.white },

  deductRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: Colors.background, borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: Colors.border, marginBottom: 6,
  },
  deductName: { flex: 1, fontSize: 13, color: Colors.textPrimary, fontWeight: '500' },
  deductQty: { fontSize: 13, fontWeight: '800', color: Colors.danger },

  actionsRow: { flexDirection: 'row', gap: 8, marginTop: 16 },
  primaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: Colors.accent, borderRadius: 12, paddingVertical: 13,
    shadowColor: Colors.accent, shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.25, shadowRadius: 6, elevation: 4,
  },
  primaryBtnDisabled: { opacity: 0.5 },
  primaryBtnText: { color: Colors.white, fontSize: 14, fontWeight: '700' },
  secondaryBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7,
    backgroundColor: Colors.borderLight, borderRadius: 12, paddingVertical: 13,
    borderWidth: 1, borderColor: Colors.border,
  },
  secondaryBtnText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '700' },

  // Voice CRUD — Jarvis fuzzy-match banner + supplier action tiles
  jarvisBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 10,
    backgroundColor: '#F5F3FF', borderRadius: 12, padding: 12,
    borderLeftWidth: 3, borderLeftColor: '#8B5CF6', marginBottom: 12,
  },
  jarvisBannerIcon: { fontSize: 20, marginTop: 2 },
  jarvisBannerText: { fontSize: 13, color: Colors.textPrimary, fontWeight: '500', lineHeight: 18 },
  jarvisBannerMatched: { fontWeight: '800', color: '#7C3AED' },
  jarvisBannerQuestion: { fontSize: 13, color: Colors.textSecondary, marginTop: 3, fontStyle: 'italic' },

  supplierActionInfo: { gap: 8 },
  supplierActionTitle: { fontSize: 15, fontWeight: '800', color: Colors.textPrimary, marginBottom: 6 },
  supplierActionHint: { fontSize: 12, color: Colors.textSecondary, fontStyle: 'italic', marginTop: 4, lineHeight: 17 },
});
