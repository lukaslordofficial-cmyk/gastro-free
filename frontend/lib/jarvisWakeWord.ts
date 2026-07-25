/**
 * Hasło głosowe (wake word) — AsyncStorage.
 * Nasłuch globalny działa przy otwartej apce (web: SpeechRecognition;
 * native: pływający przycisk / nagranie). Przy zamkniętej apce iOS/Android
 * nie dają darmowego custom wake word bez natywnych uprawnień.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';

const KEY = '@gm/jarvis_wake_word';
const LISTEN_KEY = '@gm/jarvis_wake_listen';
const DEFAULT_WORD = 'Gastro';

/** Warianty ASR (PL/EN) dla popularnych haseł. */
const ASR_ALIASES: Record<string, string[]> = {
  jarvis: ['jarvis', 'jarwis', 'jarves', 'djarvis', 'dżarvis', 'dzarvis', 'jarwisie', 'jarvisa'],
  clyde: ['clyde', 'klajd', 'klaid', 'claid', 'klajda'],
  gastro: ['gastro', 'gastroo', 'gastro menager', 'gastromanager', 'gas tro'],
};

function fold(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function getJarvisWakeWord(): Promise<string> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    const t = (v || '').trim();
    return t || DEFAULT_WORD;
  } catch {
    return DEFAULT_WORD;
  }
}

export async function setJarvisWakeWord(word: string): Promise<string> {
  const t = (word || '').trim().slice(0, 32);
  const next = t || DEFAULT_WORD;
  await AsyncStorage.setItem(KEY, next);
  return next;
}

export async function getJarvisWakeListenEnabled(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(LISTEN_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function setJarvisWakeListenEnabled(on: boolean): Promise<void> {
  await AsyncStorage.setItem(LISTEN_KEY, on ? '1' : '0');
}

function wakeVariants(wakeWord: string): string[] {
  const w = fold(wakeWord);
  if (!w || w.length < 2) return [];
  const extras = ASR_ALIASES[w] || [];
  return Array.from(new Set([w, ...extras.map(fold)]));
}

export function transcriptContainsWakeWord(transcript: string, wakeWord: string): boolean {
  const t = fold(transcript);
  if (!t) return false;
  return wakeVariants(wakeWord).some((v) => v.length >= 2 && t.includes(v));
}

/** Usuń hasło z początku / środka transkrypcji przed interpretacją komendy. */
export function stripWakeWord(transcript: string, wakeWord: string): string {
  let out = transcript || '';
  for (const v of wakeVariants(wakeWord)) {
    if (v.length < 2) continue;
    const escaped = v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}[,.:!?]?\\s*`, 'i');
    out = out.replace(re, ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}
