import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Platform } from 'react-native';
import { useAudioRecorder, RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { useRouter } from 'expo-router';
import { DS } from '@/constants/premiumTheme';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import {
  getJarvisWakeWord,
  setJarvisWakeWord,
  setJarvisWakeListenEnabled,
  transcriptContainsWakeWord,
  stripWakeWord,
} from '@/lib/jarvisWakeWord';
import { DealHunterModal } from './DealHunterModal';
import { labelForSelections, parsePeriodHintToSelection, type PeriodSelection } from './PeriodPickerTree';
import { type OptimizeResult, normalizeOptimizeResult } from '@/lib/bargainHunter';
import { fetchJson } from '@/lib/safeFetch';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { usePremiumAlert } from '@/components/PremiumAlert';
import {
  DEAL_HUNTER_GATE_MESSAGE,
  DEAL_HUNTER_GATE_TITLE,
  isDealHunterIntent,
} from '@/lib/dealHunterGate';
import { useAuth } from '@/contexts/AuthContext';
import { emitAppDataChanged, refreshHintForIntent } from '@/lib/appRefresh';
import { applyWasteQuantityToPayload } from './voiceReport/applyWastePayload';

import type { Intent, Interpretation, Props, Stage } from './voiceReport/types';
import { BACKEND_URL, COMMAND_EXAMPLES, CONFIRM_WORD, DESTRUCTIVE_INTENTS, INTENT_META, INTENT_SEARCH_ALIASES, NAV_INTENTS, PERIOD_INTENTS, UPLOAD_INTENTS } from './voiceReport/constants';
import { correctPeriodIntentFromTranscript, extractAmountFromText, seedPayload } from './voiceReport/helpers';
import { performNavigation } from './voiceReport/performNavigation';
import { VoiceModalChrome } from './voiceReport/VoiceModalChrome';
import { VoiceIdleStage } from './voiceReport/VoiceIdleStage';
import { VoiceRecordingStage } from './voiceReport/VoiceRecordingStage';
import { VoiceWorkingStage } from './voiceReport/VoiceWorkingStage';
import { VoiceReviewStage } from './voiceReport/VoiceReviewStage';
import { VoiceDoneStage } from './voiceReport/VoiceDoneStage';

export type { Intent } from './voiceReport/types';

export function VoiceReportModal({
  visible,
  onClose,
  onApplied,
  contextHint,
  autoStartRecording,
  autoStartWakeListen,
}: Props) {
  // Jarvis zawsze w Black Premium: zielone CTA, czarny tekst na przyciskach
  const jarvisAccent = DS.color.greenEnd;
  const jarvisCtaText = '#0A0A0A';
  const { credits, dealHunterUnlocked } = useSubscription();
  const commandsUnlocked = credits > 0;
  const visibleCommands = useMemo(() => {
    if (!commandsUnlocked) return [];
    // Łowca: wyłącznie tier ≥ 2 lub aktywny trial Premium (dealHunterUnlocked)
    return COMMAND_EXAMPLES.filter((c) => {
      if (!dealHunterUnlocked && isDealHunterIntent(c.intent)) return false;
      return true;
    });
  }, [commandsUnlocked, dealHunterUnlocked]);
  const router = useRouter();
  const { openProductCascade, setWakeListenEnabled, openDocumentScan, openMenuScan } = useUiOverlay();
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
  const [menuCategories, setMenuCategories] = useState<string[]>([]);
  // Bulk Deal Hunter — po zatwierdzeniu order_critical_items_by_category
  // otwieramy Modal Łowcy Okazji z gotowym zestawieniem.
  const [bulkCompare, setBulkCompare] = useState<OptimizeResult | null>(null);
  const [bulkContextLabel, setBulkContextLabel] = useState<string>('');
  const [creditsNotice, setCreditsNotice] = useState<string | null>(null);
  const [wakeWord, setWakeWordState] = useState('Gastro');
  const [wakeDraft, setWakeDraft] = useState('Gastro');
  const [wakeListening, setWakeListening] = useState(false);
  const [wakeStatus, setWakeStatus] = useState<string | null>(null);
  const [showCommands, setShowCommands] = useState(false);
  const [commandHint, setCommandHint] = useState<string | null>(null);
  const [clarifyQuery, setClarifyQuery] = useState('');
  const { alert: premiumAlert } = usePremiumAlert();
  const { accountKey } = useAuth();
  const wakeListeningRef = useRef(false);
  const autoStartedRef = useRef(false);
  const followUpModeRef = useRef(false);
  const followUpReturnStageRef = useRef<Stage>('review');
  const stageRef = useRef<Stage>('idle');
  stageRef.current = stage;
  /** Monotonic — odrzuca odpowiedzi AI / apply po zamknięciu lub zmianie konta. */
  const requestGenRef = useRef(0);
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  const accountKeyRef = useRef(accountKey);
  accountKeyRef.current = accountKey;
  // Aktualne wartości do apply (drzewko dat / legenda) — bez stale closure
  const editedRef = useRef<Record<string, any>>({});
  const interpRef = useRef<Interpretation | null>(null);
  const transcriptRef = useRef('');
  useEffect(() => { editedRef.current = edited; }, [edited]);
  useEffect(() => { interpRef.current = interp; }, [interp]);
  useEffect(() => { transcriptRef.current = transcript; }, [transcript]);

  // Web-only refs
  const mediaRecorderRef = useRef<any>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<any>(null);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    void getJarvisWakeWord().then((w) => {
      setWakeWordState(w);
      setWakeDraft(w);
    });
  }, []);

  useEffect(() => {
    if (!visible) {
      requestGenRef.current += 1;
      cleanup();
      autoStartedRef.current = false;
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
      setCreditsNotice(null);
      return;
    }
    if (autoStartedRef.current) return;
    if (autoStartRecording) {
      autoStartedRef.current = true;
      const t = setTimeout(() => void startRecording(), 250);
      return () => clearTimeout(t);
    }
    if (autoStartWakeListen) {
      autoStartedRef.current = true;
      const t = setTimeout(() => startWakeListen(), 250);
      return () => clearTimeout(t);
    }
  }, [visible, autoStartRecording, autoStartWakeListen]);

  // Zmiana tenanta: natychmiast unieważnij in-flight interpret/apply i wyczyść stan.
  useEffect(() => {
    requestGenRef.current += 1;
    cleanup();
    autoStartedRef.current = false;
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
    setCreditsNotice(null);
    setCommandHint(null);
    setClarifyQuery('');
  }, [accountKey]);

  // Load inventory + menu categories when modal opens
  useEffect(() => {
    if (!visible || !isSupabaseConfigured) return;
    (async () => {
      try {
        const { data } = await supabase
          .from('inventory_categories')
          .select('id, name, color')
          .eq('account_key', accountKey)
          .order('sort_order');
        if (data) setCategories(data as any);
      } catch { /* non-critical */ }
      try {
        const { data } = await supabase
          .from('menu_items')
          .select('category')
          .eq('account_key', accountKey)
          .eq('is_active', true)
          .limit(2000);
        const set = new Set<string>();
        for (const r of data || []) {
          const c = String((r as any).category || '').trim();
          if (c) set.add(c);
        }
        setMenuCategories(Array.from(set).sort((a, b) => a.localeCompare(b, 'pl')));
      } catch { /* non-critical */ }
    })();
  }, [visible, accountKey]);

  function cleanup() {
    wakeListeningRef.current = false;
    try { mediaRecorderRef.current?.stop?.(); } catch {}
    try { streamRef.current?.getTracks?.().forEach((t) => t.stop()); } catch {}
    try { if (audioRecorder.isRecording) audioRecorder.stop(); } catch {}
    try { recognitionRef.current?.stop?.(); } catch {}
    try { recognitionRef.current?.abort?.(); } catch {}
    recognitionRef.current = null;
    streamRef.current = null;
    mediaRecorderRef.current = null;
    chunksRef.current = [];
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setWakeListening(false);
    setWakeStatus(null);
  }

  async function saveWakeWord() {
    const next = (wakeDraft || '').trim() || 'Gastro';
    await setJarvisWakeWord(next);
    setWakeWordState(next);
    setWakeDraft(next);
    await setJarvisWakeListenEnabled(true);
    setWakeListenEnabled(true);
    setWakeStatus(`Hasło zapisane: „${next}”. Aplikacja czeka na komendę głosową.`);
    // Od razu włącz nasłuch (web) / przygotuj nagrywanie
    startWakeListen();
  }

  function stopWakeListen() {
    wakeListeningRef.current = false;
    try { recognitionRef.current?.stop?.(); } catch {}
    try { recognitionRef.current?.abort?.(); } catch {}
    recognitionRef.current = null;
    setWakeListening(false);
    setWakeStatus(null);
    void setJarvisWakeListenEnabled(false);
    setWakeListenEnabled(false);
  }

  function startWakeListen() {
    void setJarvisWakeListenEnabled(true);
    setWakeListenEnabled(true);
    // Natywny iOS/Android: brak ciągłego SR — nagranie hasło+komenda w jednym ujęciu
    if (Platform.OS !== 'web') {
      wakeListeningRef.current = true;
      setWakeListening(true);
      setWakeStatus(`Nagrywam… powiedz „${wakeWord}” i komendę w jednym nagraniu.`);
      void startRecording();
      return;
    }

    const SR =
      (typeof window !== 'undefined' &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) {
      setWakeStatus('Przeglądarka nie wspiera rozpoznawania mowy — użyj przycisku mikrofonu.');
      return;
    }

    try {
      // Restart lokalnego SR bez wyłączania globalnego nasłuchu
      wakeListeningRef.current = false;
      try { recognitionRef.current?.stop?.(); } catch {}
      try { recognitionRef.current?.abort?.(); } catch {}
      recognitionRef.current = null;

      wakeListeningRef.current = true;
      setWakeListening(true);
      setWakeStatus(`Nasłuchuję hasła „${wakeWord}”… mów wyraźnie (działa też poza tym oknem).`);

      const attach = () => {
        if (!wakeListeningRef.current) return;
        const rec = new SR();
        rec.lang = 'pl-PL';
        rec.continuous = true;
        rec.interimResults = true;
        rec.maxAlternatives = 3;

        rec.onresult = (ev: any) => {
          let text = '';
          for (let i = ev.resultIndex; i < ev.results.length; i++) {
            text += ev.results[i][0]?.transcript || '';
          }
          if (!transcriptContainsWakeWord(text, wakeWord)) return;

          wakeListeningRef.current = false;
          try { rec.stop?.(); } catch {}
          recognitionRef.current = null;
          setWakeListening(false);
          setWakeStatus(`Usłyszano „${wakeWord}” — nagrywam komendę…`);
          // SR i getUserMedia kolidują — krótka przerwa przed MediaRecorder
          setTimeout(() => {
            void startRecording();
          }, 200);
        };

        rec.onerror = (ev: any) => {
          const code = String(ev?.error || '');
          // no-speech / aborted = normalne w continuous — restart
          if (code === 'no-speech' || code === 'aborted') return;
          if (code === 'not-allowed') {
            wakeListeningRef.current = false;
            setWakeListening(false);
            setWakeStatus('Brak zgody na mikrofon — zezwól w przeglądarce.');
            return;
          }
          setWakeStatus(`Nasłuch: ${code || 'błąd'} — ponawiam…`);
        };

        rec.onend = () => {
          if (!wakeListeningRef.current) return;
          // Chrome kończy sesję po ciszy — restart
          setTimeout(() => {
            if (!wakeListeningRef.current) return;
            try {
              attach();
            } catch {
              setWakeStatus('Nasłuch przerwany — kliknij ponownie „Nasłuchuj”.');
              wakeListeningRef.current = false;
              setWakeListening(false);
            }
          }, 120);
        };

        recognitionRef.current = rec;
        try {
          rec.start();
        } catch (e: any) {
          // "already started" — ignore
          if (!String(e?.message || '').includes('started')) {
            throw e;
          }
        }
      };

      attach();
    } catch {
      wakeListeningRef.current = false;
      setWakeListening(false);
      setWakeStatus('Nie udało się uruchomić nasłuchu — sprawdź mikrofon / HTTPS.');
    }
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
      setErrorMsg('Brak adresu backendu. Ustaw EXPO_PUBLIC_BACKEND_URL w pliku frontend/.env (port 8001) i zrestartuj Expo.');
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
      const result = await fetchJson<{ text?: string }>(`${BACKEND_URL}/api/voice/transcribe`, {
        method: 'POST',
        headers: await (await import('@/lib/apiHeaders')).apiMultipartHeaders(),
        body: form,
      });
      if (!result.ok) throw new Error(result.error);
      const text = (result.data?.text ?? '').trim();
      if (!text) throw new Error('Nie wykryto mowy w nagraniu.');
      const cleaned = stripWakeWord(text, wakeWord) || text;
      setTranscript(cleaned);

      // Dalsze sterowanie głosem w podglądzie / kalkulatorze
      if (followUpModeRef.current) {
        followUpModeRef.current = false;
        await handleVoiceFollowUp(cleaned);
        return;
      }

      await handleInterpret(cleaned);
    } catch (e: any) {
      setErrorMsg(e?.message ?? 'Błąd transkrypcji.');
      setStage('error');
    }
  }

  function foldPl(s: string): string {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async function handleVoiceFollowUp(text: string) {
    const t = foldPl(text);
    // Zatwierdź / zapisz
    if (/\b(zatwierdz|zapisz|potwierdz|ok|okej|wykonaj|wlacz danie|wylacz danie|otworz kalkulator)\b/.test(t)
      || t === 'tak' || t === 'jasne') {
      if (followUpReturnStageRef.current === 'review') {
        setStage('review');
        // krótkie opóźnienie żeby canApply z aktualnego stanu zadziałał po setState
        setTimeout(() => { void handleApply(); }, 50);
        return;
      }
      if (followUpReturnStageRef.current === 'done') {
        onClose();
        return;
      }
    }
    // Anuluj
    if (/\b(anuluj|cofnij|stop|rezygnuj|zamknij)\b/.test(t)) {
      if (followUpReturnStageRef.current === 'done') {
        onClose();
        return;
      }
      resetAll();
      return;
    }
    // Porcje w kalkulatorze
    const porcje = t.match(/(?:na\s+)?(\d+)\s*porcj/);
    if (porcje && interp?.intent === 'scale_recipe' && applyResult?.extras) {
      const p = Math.max(1, parseInt(porcje[1], 10));
      const extras = applyResult.extras;
      const ingredients = (extras.ingredients as any[] || []).map((s) => {
        const per = Number(s.per_portion) || 0;
        const total = Math.round(per * p * 100) / 100;
        const have = s.in_stock != null ? Number(s.in_stock) : null;
        return { ...s, total_needed: total, enough: have != null ? have >= total : s.enough };
      });
      setApplyResult({
        ...applyResult,
        extras: {
          ...extras,
          portions: p,
          ingredients,
          message: `Przeliczono „${extras.dish_name || 'danie'}” na ${p} porcji.`,
        },
      });
      setStage('done');
      return;
    }

    // Uzupełnij pola — ponowna interpretacja i merge
    const gen = ++requestGenRef.current;
    const startedAccount = accountKeyRef.current;
    setStage('interpreting');
    try {
      const result = await fetchJson<Interpretation>(`${BACKEND_URL}/api/voice/interpret`, {
        method: 'POST',
        headers: await (await import('@/lib/apiHeaders')).apiJsonHeaders(),
              body: JSON.stringify({ text }),
      });
      if (gen !== requestGenRef.current || !visibleRef.current || accountKeyRef.current !== startedAccount) {
        return;
      }
      if (!result.ok) throw new Error(result.error);
      const data = result.data;
      if (data.intent === interp?.intent || data.intent !== 'unknown') {
        const seeded = seedPayload(data.intent, data.payload || {}, { transcript: text });
        setEdited((prev) => ({ ...prev, ...seeded }));
        if (data.intent !== interp?.intent && data.intent !== 'unknown') {
          setInterp(data);
        }
      }
      setStage('review');
    } catch (e: any) {
      if (gen !== requestGenRef.current || !visibleRef.current || accountKeyRef.current !== startedAccount) {
        return;
      }
      setErrorMsg(e?.message ?? 'Nie zrozumiano uzupełnienia głosowego.');
      setStage('review');
    }
  }

  function startFollowUpRecording() {
    followUpModeRef.current = true;
    followUpReturnStageRef.current = stageRef.current === 'done' ? 'done' : 'review';
    void startRecording();
  }

  async function handleInterpret(text: string) {
    const gen = ++requestGenRef.current;
    const startedAccount = accountKeyRef.current;
    setStage('interpreting');
    try {
      const result = await fetchJson<Interpretation>(`${BACKEND_URL}/api/voice/interpret`, {
        method: 'POST',
        headers: await (await import('@/lib/apiHeaders')).apiJsonHeaders(),
              body: JSON.stringify({ text }),
      });
      if (gen !== requestGenRef.current || !visibleRef.current || accountKeyRef.current !== startedAccount) {
        return;
      }
      if (!result.ok) throw new Error(result.error);
      const data = correctPeriodIntentFromTranscript(text, result.data);
      if (data.credits_deducted && data.credits_deducted > 0) {
        const rem = data.credits_remaining ?? '—';
        setCreditsNotice(`Ta akcja kosztowała: ${data.credits_deducted} kredytów. Pozostałe saldo: ${rem}.`);
      }
      setInterp(data);
      setClarifyQuery('');
      // Intencje nawigacji/filtrów wykonujemy natychmiast (bez ekranu potwierdzenia).
      if (NAV_INTENTS.has(data.intent)) {
        performNavigation(data.intent, data.payload || {}, {
          transcript,
          onClose,
          router,
          openProductCascade,
          fetchInventoryRows,
        });
        return;
      }
      // Seed editable form state with AI defaults — user may freely change values.
      // AI often returns 0 when it did not recognise a numeric value; convert 0 → null
      // so the TextInput shows the placeholder and the user notices they must type it.
      setEdited(seedPayload(data.intent, data.payload || {}, { transcript: text }));
      setStage('review');
    } catch (e: any) {
      if (gen !== requestGenRef.current || !visibleRef.current || accountKeyRef.current !== startedAccount) {
        return;
      }
      setErrorMsg(e?.message ?? 'Błąd interpretacji AI.');
      setStage('error');
    }
  }

  async function fetchInventoryRows() {
    const ak = accountKeyRef.current;
    if (!ak || ak === 'default') return [];
    const { data } = await supabase
      .from('inventory_items')
      .select('id, name, quantity, min_quantity, unit')
      .eq('account_key', ak)
      .order('name');
    return (data ?? []).map((i: any) => ({
      id: String(i.id),
      name: String(i.name || 'Produkt'),
      quantity: Number(i.quantity) || 0,
      minQuantity: Number(i.min_quantity) || 0,
      unit: String(i.unit || 'szt'),
    }));
  }

  async function handleApply(opts?: {
    interp?: Interpretation;
    edited?: Record<string, any>;
    transcript?: string;
  }) {
    const curInterp = opts?.interp ?? interpRef.current ?? interp;
    const curEdited = opts?.edited ?? editedRef.current ?? edited;
    const curTranscript = opts?.transcript ?? transcriptRef.current ?? transcript;
    if (!curInterp || curInterp.intent === 'unknown') return;
    const gen = ++requestGenRef.current;
    const startedAccount = accountKeyRef.current;

    // Free / tier 1 bez trialu → PremiumAlert, bez compare-offers / Łowcy
    if (isDealHunterIntent(curInterp.intent) && !dealHunterUnlocked) {
      premiumAlert(DEAL_HUNTER_GATE_TITLE, DEAL_HUNTER_GATE_MESSAGE);
      return;
    }

    if (curInterp.intent === 'add_expiration_batch') {
      const stock = Number(curEdited.current_stock ?? 0);
      const batches = Array.isArray(curEdited.batches) ? curEdited.batches : [];
      const sum = batches.reduce(
        (s: number, b: any) => s + (Number(b?.quantity) || 0),
        0,
      );
      if (!curEdited.inventory_id) {
        setErrorMsg('Wybierz produkt z magazynu przed zapisaniem dat ważności.');
        setStage('error');
        return;
      }
      if (stock <= 0) {
        setErrorMsg('Nie ma już tego produktu w magazynie (stan 0). Najpierw dodaj go na stan.');
        setStage('error');
        return;
      }
      if (sum > stock + 0.001) {
        setErrorMsg(`Nie masz tylu sztuk w magazynie (suma partii ${sum} > stan ${stock}).`);
        setStage('error');
        return;
      }
    }

    // Wgrywanie dokumentów — otwórz skaner (bez zbędnego round-tripu, jeśli BE i tak tylko open_scan).
    if (UPLOAD_INTENTS.has(curInterp.intent)) {
      if (curInterp.intent === 'upload_menu') {
        openMenuScan();
        onApplied?.(curInterp.intent);
        onClose();
        return;
      }
      const kind =
        curInterp.intent === 'upload_invoice'
          ? 'invoice'
          : curInterp.intent === 'upload_offer'
            ? 'offer'
            : 'document';
      openDocumentScan(kind);
      onApplied?.(curInterp.intent);
      onClose();
      return;
    }

      setStage('applying');
    try {
      let applyIntent: Intent = curInterp.intent;
      if (applyIntent === 'bulk_edit_menu_prices_percentage' || applyIntent === 'bulk_edit_menu_prices_fixed') {
        applyIntent = curEdited.price_mode === 'fixed'
          ? 'bulk_edit_menu_prices_fixed'
          : 'bulk_edit_menu_prices_percentage';
      }
      if (applyIntent === 'navigate_screen' || applyIntent === 'filter_ui_inventory' || applyIntent === 'filter_ui_menu_blocked') {
        performNavigation(applyIntent, curEdited, {
          transcript,
          onClose,
          router,
          openProductCascade,
          fetchInventoryRows,
        });
        return;
      }

      // Zamówienie produktów → zawsze /compare-offers (nie zależymy od starego /actions/apply).
      if (applyIntent === 'order_product') {
        const rawItems = Array.isArray(curEdited.items) ? curEdited.items : [];
        const compareItems = rawItems
          .map((it: any) => ({
            product_name_or_id: String(it?.product_name || it?.name || '').trim(),
            quantity: Number(it?.quantity) > 0 ? Number(it.quantity) : 1,
            unit: String(it?.unit || 'szt').trim() || 'szt',
          }))
          .filter((it: { product_name_or_id: string }) => !!it.product_name_or_id);
        if (!compareItems.length) {
          setErrorMsg('Dodaj co najmniej jeden produkt do zamówienia.');
          setStage('error');
          return;
        }
        const cmp = await fetchJson<Record<string, any>>(`${BACKEND_URL}/api/orders/compare-offers`, {
          method: 'POST',
          headers: await (await import('@/lib/apiHeaders')).apiJsonHeaders(),
                body: JSON.stringify({
                  items: compareItems,
                  search_scope: curEdited.search_scope || 'suppliers_only',
                }),
        });
        if (!cmp.ok) throw new Error(cmp.error);
        const compare = cmp.data;
        const found = Array.isArray(compare?.items_requested)
          ? compare.items_requested.filter((x: any) => x?.found).length
          : 0;
        setApplyResult({
          detail: `Koszyk: ${compareItems.length} · oferty ${found}/${compareItems.length}`,
          extras: {
            ok: true,
            action: 'order_product',
            compare,
            message: `Znaleziono oferty dla ${found}/${compareItems.length}. Otwieram Łowcę Okazji.`,
          },
          warnings: [],
        });
        setStage('done');
        onApplied?.(applyIntent);
        setBulkContextLabel('Zamówienie u dostawcy');
        setBulkCompare(normalizeOptimizeResult(compare));
        return;
      }

      // Drzewko dat → zawsze wyślij czyste selected_periods (liczby, nie stringi)
      // Dodatkowo: jeśli transcript ma jawny rok (np. 2025), wymuś go na zaznaczeniach
      let rawSels = Array.isArray(curEdited.selected_periods) ? curEdited.selected_periods : [];
      const trYear = (curTranscript || '').match(/\b(20\d{2})\b/);
      if (trYear && rawSels.length) {
        const y = Number(trYear[1]);
        rawSels = rawSels.map((s: any) => ({ ...s, year: y }));
      } else if (trYear && !rawSels.length) {
        const parsed = parsePeriodHintToSelection(curTranscript, { preferYear: Number(trYear[1]) });
        if (parsed) rawSels = [parsed];
      }
      const selected_periods = rawSels
        .filter((s: any) => s && typeof s === 'object' && s.kind && s.year != null)
        .map((s: any) => ({
          kind: String(s.kind),
          year: Number(s.year),
          ...(s.month != null ? { month: Number(s.month) } : {}),
          ...(s.week != null ? { week: Number(s.week) } : {}),
          ...(s.day != null ? { day: Number(s.day) } : {}),
        }));
      let categories = curEdited.categories;
      if (applyIntent === 'order_critical_items_by_category') {
        // NIGDY nie wstrzykuj categories=['all'] gdy puste — to dokładało
        // wszystkie braki magazynowe do koszyka (np. przy samym „ser kozi”
        // albo MIX bez rozpoznanej kategorii). „all” tylko gdy użytkownik/LLM
        // jawnie wybrał „Wszystkie” / „wszystkie braki”.
        if (!Array.isArray(categories)) categories = [];
        const namedItems = Array.isArray(curEdited.items)
          ? curEdited.items.filter((it: any) =>
              String(it?.product_name || it?.name || '').trim())
          : [];
        if (categories.length === 0 && namedItems.length === 0) {
          setErrorMsg(
            'Wybierz kategorię braków (lub „Wszystkie”) albo dodaj produkt z nazwy.',
          );
          setStage('error');
          return;
        }
        if (!curEdited.cart_objective) {
          setErrorMsg(
            'Wybierz preferencję koszyka: szybki czas dostawy, minimalna liczba dostaw albo najniższa cena.',
          );
          setStage('error');
          return;
        }
      }
      const payload: Record<string, any> = {
        ...curEdited,
        categories,
        selected_periods,
        period_1: selected_periods.length
          ? labelForSelections(selected_periods as PeriodSelection[])
          : curEdited.period_1,
      };

      // Waste: visual size → kg for produce counted as pieces
      if (applyIntent === 'waste') {
        const itype = String(payload.item_type || 'ingredient');
        if (!payload.related_id) {
          setErrorMsg(
            itype === 'dish'
              ? 'Wybierz danie z podpowiedzi przed zapisaniem straty.'
              : 'Wybierz produkt z magazynu z podpowiedzi — inaczej odejdziemy zły towar.',
          );
          setStage('error');
          return;
        }
        applyWasteQuantityToPayload(payload);
      }

      const result = await fetchJson<{
        ok?: boolean;
        detail?: string;
        extras?: Record<string, any>;
        warnings?: string[];
      }>(`${BACKEND_URL}/api/actions/apply`, {
        method: 'POST',
        headers: await (await import('@/lib/apiHeaders')).apiJsonHeaders(),
              body: JSON.stringify({
          intent: applyIntent,
          payload,
          transcript: curTranscript,
          source: 'voice',
        }),
      });
      if (gen !== requestGenRef.current || !visibleRef.current || accountKeyRef.current !== startedAccount) {
        return;
      }
      if (!result.ok) throw new Error(result.error);
      const data = result.data;
      const extras = data.extras ?? {};
      if (data.ok === false) {
        // Analizy okresu: pokaż komunikat (np. brak danych POS) zamiast „martwego” błędu
        if (PERIOD_INTENTS.has(applyIntent)) {
          setApplyResult({
            detail: data.detail ?? extras.message ?? extras.assistant_speech ?? 'Brak danych',
            extras: {
              ...extras,
              message: extras.message || extras.assistant_speech || data.detail,
            },
            warnings: data.warnings ?? [],
          });
          setStage('done');
          emitAppDataChanged(refreshHintForIntent(applyIntent));
          onApplied?.(applyIntent);
          return;
        }
        setErrorMsg(data.detail ?? 'Operacja nie powiodła się.');
        setStage('error');
        return;
      }
      // BE może zwrócić open_scan także po apply
      if (extras.open_scan) {
        if (extras.doc_kind === 'menu') {
          openMenuScan();
        } else {
          openDocumentScan(
            extras.doc_kind === 'offer' ? 'offer' : extras.doc_kind === 'document' ? 'document' : 'invoice',
          );
        }
        emitAppDataChanged(refreshHintForIntent(applyIntent));
        onApplied?.(applyIntent);
        onClose();
        return;
      }
      setApplyResult({
        detail: data.detail ?? 'OK',
        extras,
        warnings: data.warnings ?? [],
      });
      if (applyIntent === 'add_expiration_batch') {
        try {
          const { scheduleExpiryReminders } = require('@/lib/pushNotifications') as typeof import('@/lib/pushNotifications');
          const name = String(curEdited.item_name_resolved || curEdited.item_name || curEdited.product_name || 'Produkt');
          const alertDays = Array.isArray(curEdited.alert_days) ? curEdited.alert_days.map(Number) : [7, 3, 1];
          const batches = Array.isArray(curEdited.batches) ? curEdited.batches : [{ expiration_date: curEdited.expiration_date }];
          void scheduleExpiryReminders(
            name,
            batches
              .filter((b: any) => b?.expiration_date)
              .map((b: any) => ({
                expirationDate: String(b.expiration_date),
                alertDays,
              })),
          );
        } catch {
          /* best-effort */
        }
      }
      emitAppDataChanged(refreshHintForIntent(applyIntent));
      onApplied?.(applyIntent);
      // Bulk: od razu Łowca z edytowalnym koszykiem — nie trzymaj użytkownika na „done”.
      if (applyIntent === 'order_critical_items_by_category') {
        const compare = extras.compare;
        if (compare) {
          const label = Array.isArray(extras.matched_categories) && extras.matched_categories.length > 0
            ? (extras.matched_categories.includes('all')
                ? 'Braki: wszystkie kategorie'
                : `Braki: ${extras.matched_categories.join(', ')}`)
            : 'Zbiorcze zamówienie braków';
          setBulkContextLabel(label);
          setBulkCompare(normalizeOptimizeResult(compare));
          // Łowca na wierzchu z edytowalnym koszykiem od razu (bez dodatkowego klikania).
          setStage('done');
          return;
        }
      }
      setStage('done');
    } catch (e: any) {
      if (gen !== requestGenRef.current || !visibleRef.current || accountKeyRef.current !== startedAccount) {
        return;
      }
      setErrorMsg(e?.message ?? 'Błąd zapisu.');
      setStage('error');
    }
  }

  /** Klik w legendzie — bez STT / interpret (0 kredytów głosowych). */
  async function runLegendCommand(c: { intent: Intent; example: string }) {
    const text = c.example;
    const seeded = seedPayload(c.intent, {}, { transcript: text, fromLegend: true });
    const data: Interpretation = {
      intent: c.intent,
      confidence: 1,
      reason: 'Wybrane z listy komend (bez głosu)',
      payload: seeded,
    };
    setShowCommands(false);
    setCommandHint(null);
    setCreditsNotice(null);
    setErrorMsg(null);
    setTranscript(text);
    setInterp(data);
    setEdited(seeded);
    transcriptRef.current = text;
    interpRef.current = data;
    editedRef.current = seeded;

    // Filtry UI — od razu; nawigacja i reszta → formularz (użytkownik wybiera zakładkę / okres)
    if (c.intent === 'filter_ui_inventory' || c.intent === 'filter_ui_menu_blocked') {
      performNavigation(c.intent, seeded, {
        transcript,
        onClose,
        router,
        openProductCascade,
        fetchInventoryRows,
      });
      return;
    }
    if (c.intent === 'list_expiring_soon') {
      await handleApply({ interp: data, edited: seeded, transcript: text });
      return;
    }
    setStage('review');
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
    setClarifyQuery('');
  }

  function applyClarifiedIntent(nextIntent: Intent) {
    const prevPayload = { ...(interp?.payload || {}), ...(edited || {}) };
    const amountFromPayload = Number(prevPayload.amount_pln);
    const amountFromText = extractAmountFromText(transcript || '');
    const merged: Record<string, any> = { ...prevPayload };
    if (
      (nextIntent === 'add_revenue' || nextIntent === 'add_fixed_cost' || nextIntent === 'add_variable_cost')
      && !(amountFromPayload > 0)
      && amountFromText != null
    ) {
      merged.amount_pln = amountFromText;
    }
    const seeded = seedPayload(nextIntent, merged, { transcript });
    setInterp((prev) => (prev
      ? {
          ...prev,
          intent: nextIntent,
          confidence: 0.95,
          reason: 'Wybrane z podpowiedzi (wpis / autocomplete)',
          payload: seeded,
        }
      : {
          intent: nextIntent,
          confidence: 0.95,
          reason: 'Wybrane z podpowiedzi (wpis / autocomplete)',
          payload: seeded,
        }));
    setEdited(seeded);
    setClarifyQuery('');
  }

  const needsIntentClarify = !!interp && (
    interp.intent === 'unknown'
    || (Array.isArray(interp.alternate_intents) && interp.alternate_intents.length >= 2)
    || (typeof interp.confidence === 'number' && interp.confidence < 0.7)
  );

  const clarifySuggestions = useMemo(() => {
    const q = clarifyQuery.trim().toLowerCase();
    if (q.length < 1) return [];
    const pool = visibleCommands.length
      ? visibleCommands
      : COMMAND_EXAMPLES.filter((c) => !isDealHunterIntent(c.intent) || dealHunterUnlocked);
    const scored: { id: string; name: string; hint?: string; intent: Intent; score: number }[] = [];
    for (const c of pool) {
      if (c.intent === 'unknown') continue;
      const meta = INTENT_META[c.intent];
      const aliases = INTENT_SEARCH_ALIASES[c.intent] || [];
      const hay = [
        meta.label,
        c.example,
        c.intent.replace(/_/g, ' '),
        ...aliases,
      ].join(' ').toLowerCase();
      if (!hay.includes(q) && !q.split(/\s+/).every((tok) => hay.includes(tok))) continue;
      const starts =
        meta.label.toLowerCase().startsWith(q)
        || aliases.some((a) => a.startsWith(q))
        || c.example.toLowerCase().startsWith(q);
      scored.push({
        id: c.intent,
        name: `${meta.icon} ${meta.label}`,
        hint: c.example,
        intent: c.intent,
        score: starts ? 0 : 1,
      });
    }
    scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name, 'pl'));
    return scored.slice(0, 8).map(({ id, name, hint, intent }) => ({ id, name, hint, intent }));
  }, [clarifyQuery, visibleCommands, dealHunterUnlocked]);

  const patchEdited = (patch: Record<string, any>) => {
    setEdited((prev) => {
      const next = { ...prev, ...patch };
      editedRef.current = next;
      return next;
    });
  };

  const isDestructive = interp ? DESTRUCTIVE_INTENTS.has(interp.intent) : false;
  const confirmOk = confirmText.trim().toUpperCase() === CONFIRM_WORD;
  const canApply = !!interp && interp.intent !== 'unknown' && (!isDestructive || confirmOk)
    && (interp.intent !== 'scale_recipe' || (!!edited.dish_id && edited.dish_accepted === true))
    && (interp.intent !== 'toggle_menu_item_availability' || (!!edited.dish_id && edited.dish_accepted === true))
    && (interp.intent !== 'edit_menu_item_price' || (!!edited.dish_id && edited.dish_accepted === true))
    && (interp.intent !== 'delete_menu_item' || (!!edited.dish_id && edited.dish_accepted === true))
    && (interp.intent !== 'navigate_screen' || !!edited.screen)
    && (!PERIOD_INTENTS.has(interp.intent)
      || (Array.isArray(edited.selected_periods) && edited.selected_periods.length > 0))
    && (!(interp.intent === 'bulk_edit_menu_prices_percentage' || interp.intent === 'bulk_edit_menu_prices_fixed')
      || ((edited.price_mode === 'fixed'
        ? Number(edited.amount) > 0
        : Number(edited.percentage) > 0)))
    && (interp.intent !== 'order_product'
      || (Array.isArray(edited.items) && edited.items.some((it: any) => String(it?.product_name || '').trim())))
    && (interp.intent !== 'order_critical_items_by_category'
      || (((Array.isArray(edited.categories) && edited.categories.length > 0)
        || (Array.isArray(edited.items) && edited.items.some((it: any) => String(it?.product_name || '').trim())))
        && !!edited.cart_objective));
  const meta = interp ? INTENT_META[interp.intent] : INTENT_META.unknown;
  const dealHunterApplying =
    stage === 'applying'
    && (interp?.intent === 'order_critical_items_by_category' || interp?.intent === 'order_product');
  const workingMessage =
    stage === 'transcribing' ? 'Zamieniam mowę na tekst (Whisper)…'
      : stage === 'interpreting' ? 'AI klasyfikuje intencję (GPT-4o mini)…'
      : stage === 'applying'
        ? (dealHunterApplying
          ? 'Analizuję oferty dostawców…'
          : (PERIOD_INTENTS.has(interp?.intent as Intent) ? 'Analizuję dane…' : 'Zapisuję do Supabase…'))
      : '';

  return (
    <VoiceModalChrome
      visible={visible}
      onClose={onClose}
      contextHint={contextHint}
      jarvisAccent={jarvisAccent}
      jarvisCtaText={jarvisCtaText}
      creditsNotice={creditsNotice}
      footer={
        bulkCompare ? (
          <DealHunterModal
            visible={!!bulkCompare}
            product={null}
            restaurantName={undefined}
            initialCompare={bulkCompare}
            bulkContextLabel={bulkContextLabel}
            onClose={() => { setBulkCompare(null); setBulkContextLabel(''); }}
          />
        ) : null
      }
    >
      {(stage === 'idle' || stage === 'error') && (
        <VoiceIdleStage
          stage={stage}
          errorMsg={errorMsg}
          commandHint={commandHint}
          commandsUnlocked={commandsUnlocked}
          showCommands={showCommands}
          onToggleCommands={() => setShowCommands((v) => !v)}
          visibleCommands={visibleCommands}
          onLegendCommand={(c) => { void runLegendCommand(c); }}
          onStartRecording={startRecording}
          jarvisAccent={jarvisAccent}
        />
      )}

      {stage === 'recording' && (
        <VoiceRecordingStage elapsed={elapsed} onStopRecording={stopRecording} />
      )}

      {(stage === 'transcribing' || stage === 'interpreting' || stage === 'applying') && (
        <VoiceWorkingStage
          workingMessage={workingMessage}
          transcript={transcript}
          showTranscript={stage !== 'transcribing'}
        />
      )}

      {stage === 'review' && interp && (
        <VoiceReviewStage
          transcript={transcript}
          interp={interp}
          meta={meta}
          needsIntentClarify={needsIntentClarify}
          clarifyQuery={clarifyQuery}
          onClarifyQueryChange={setClarifyQuery}
          clarifySuggestions={clarifySuggestions}
          onApplyClarifiedIntent={applyClarifiedIntent}
          isDestructive={isDestructive}
          confirmText={confirmText}
          onConfirmTextChange={setConfirmText}
          edited={edited}
          patchEdited={patchEdited}
          categories={categories}
          menuCategories={menuCategories}
          canApply={canApply}
          onResetAll={resetAll}
          onApply={() => { void handleApply(); }}
        />
      )}

      {stage === 'done' && applyResult && interp && (
        <VoiceDoneStage
          interp={interp}
          meta={meta}
          applyResult={applyResult}
          onExtrasChange={(next) => setApplyResult((prev) => prev ? { ...prev, extras: next } : prev)}
          onResetAll={resetAll}
          onClose={onClose}
          onFollowUpRecording={startFollowUpRecording}
        />
      )}
    </VoiceModalChrome>
  );
}
