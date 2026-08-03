/**
 * Host modala głosowego Jarvisa.
 * Nasłuch hasła wywoławczego jest wyłączony — komendy tylko przez ręczne nagrywanie.
 */
import React, { useEffect } from 'react';
import { VoiceReportModal } from '@/components/VoiceReportModal';
import { useUiOverlay } from '@/contexts/UiOverlayContext';
import { setJarvisWakeListenEnabled } from '@/lib/jarvisWakeWord';

export function JarvisVoiceHost() {
  const {
    voiceVisible,
    voiceOpts,
    closeVoiceReport,
    setWakeListenEnabled,
  } = useUiOverlay();

  useEffect(() => {
    // Trwale wyłącz cichy nasłuch hasła (opcja usunięta z UI).
    void setJarvisWakeListenEnabled(false);
    setWakeListenEnabled(false);
  }, [setWakeListenEnabled]);

  return (
    <VoiceReportModal
      visible={voiceVisible}
      onClose={closeVoiceReport}
      autoStartRecording={!!voiceOpts.autoStartRecording}
      autoStartWakeListen={false}
      contextHint="Globalnie"
    />
  );
}
