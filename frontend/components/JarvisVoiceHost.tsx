/**
 * Globalny host sterowania głosowego — cichy nasłuch hasła.
 * Po usłyszeniu hasła od razu otwiera modal nagrywania (bez pływających przycisków).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { VoiceReportModal } from '@/components/VoiceReportModal';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import {
  getJarvisWakeListenEnabled,
  getJarvisWakeWord,
  setJarvisWakeListenEnabled,
  transcriptContainsWakeWord,
} from '@/lib/jarvisWakeWord';

export function JarvisVoiceHost() {
  const {
    voiceVisible,
    voiceOpts,
    openVoiceReport,
    closeVoiceReport,
    wakeListenEnabled,
    setWakeListenEnabled,
  } = useUiOverlay();

  const [wakeWord, setWakeWord] = useState('Gastro');
  const recognitionRef = useRef<any>(null);
  const listeningRef = useRef(false);

  useEffect(() => {
    void (async () => {
      const [w, on] = await Promise.all([getJarvisWakeWord(), getJarvisWakeListenEnabled()]);
      setWakeWord(w);
      setWakeListenEnabled(on);
    })();
  }, [setWakeListenEnabled]);

  const stopWebListen = useCallback(() => {
    listeningRef.current = false;
    try { recognitionRef.current?.stop?.(); } catch { /* */ }
    try { recognitionRef.current?.abort?.(); } catch { /* */ }
    recognitionRef.current = null;
  }, []);

  const startWebListen = useCallback(() => {
    if (Platform.OS !== 'web' || voiceVisible) return;
    const SR =
      (typeof window !== 'undefined' &&
        ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)) ||
      null;
    if (!SR) return;

    stopWebListen();
    listeningRef.current = true;

    const attach = () => {
      if (!listeningRef.current || voiceVisible) return;
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
        listeningRef.current = false;
        try { rec.stop?.(); } catch { /* */ }
        recognitionRef.current = null;
        // Od razu modal nagrywania — bez FAB / dodatkowych przycisków
        openVoiceReport({ autoStartRecording: true });
      };

      rec.onerror = (ev: any) => {
        const code = String(ev?.error || '');
        if (code === 'no-speech' || code === 'aborted') return;
        if (code === 'not-allowed') {
          listeningRef.current = false;
          void setJarvisWakeListenEnabled(false);
          setWakeListenEnabled(false);
        }
      };

      rec.onend = () => {
        if (!listeningRef.current || voiceVisible) return;
        setTimeout(() => {
          if (listeningRef.current && !voiceVisible) attach();
        }, 180);
      };

      recognitionRef.current = rec;
      try { rec.start(); } catch { /* */ }
    };

    attach();
  }, [openVoiceReport, setWakeListenEnabled, stopWebListen, voiceVisible, wakeWord]);

  useEffect(() => {
    if (!wakeListenEnabled || voiceVisible) {
      stopWebListen();
      return;
    }
    if (Platform.OS === 'web') startWebListen();
    return () => stopWebListen();
  }, [wakeListenEnabled, voiceVisible, startWebListen, stopWebListen]);

  useEffect(() => {
    if (!voiceVisible) {
      void getJarvisWakeWord().then(setWakeWord);
    }
  }, [voiceVisible]);

  return (
    <VoiceReportModal
      visible={voiceVisible}
      onClose={closeVoiceReport}
      autoStartRecording={!!voiceOpts.autoStartRecording}
      autoStartWakeListen={!!voiceOpts.autoStartWakeListen}
      contextHint="Globalnie"
    />
  );
}
