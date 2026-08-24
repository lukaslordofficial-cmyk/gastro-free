/**
 * Cryptographically strong short IDs (replaces Math.random for persisted/API keys).
 *
 * Kolejność źródeł entropii (Expo / RN często nie ma `globalThis.crypto`):
 * 1. Web Crypto getRandomValues
 * 2. expo-crypto getRandomBytes (jeśli zainstalowane)
 * 3. unikalność lokalna (tylko klucze UI / draft — nie sekrety)
 */

let _fallbackCounter = 0;

function fillRandomBytes(bytes: Uint8Array): 'crypto' | 'expo' | 'fallback' {
  const webCrypto =
    typeof globalThis !== 'undefined'
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (webCrypto && typeof webCrypto.getRandomValues === 'function') {
    webCrypto.getRandomValues(bytes);
    return 'crypto';
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const ExpoCrypto = require('expo-crypto') as {
      getRandomBytes?: (size: number) => Uint8Array;
    };
    if (typeof ExpoCrypto.getRandomBytes === 'function') {
      bytes.set(ExpoCrypto.getRandomBytes(bytes.length));
      return 'expo';
    }
  } catch {
    /* expo-crypto niedostępne */
  }

  // Unikalność dla kluczy React / draftów receptury — nie używaj jako sekretu.
  _fallbackCounter += 1;
  let state =
    (Date.now() >>> 0) ^
    ((_fallbackCounter * 2654435761) >>> 0) ^
    (((typeof performance !== 'undefined' ? performance.now() : 0) * 1000) >>> 0);
  for (let i = 0; i < bytes.length; i += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[i] = state & 0xff;
  }
  return 'fallback';
}

function randomBytesHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  fillRandomBytes(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable-ish unique id: prefix_timestamp_randomhex */
export function secureId(prefix = 'id', randomBytes = 4): string {
  return `${prefix}_${Date.now()}_${randomBytesHex(randomBytes)}`;
}

/**
 * Stripe / billing idempotency key.
 * Preferuje CSPRNG; gdy brak (stary bundel bez expo-crypto) — zwraca null,
 * a backend generuje uuid4. NIGDY nie rzuca — inaczej blokuje upgrade/top-up.
 */
export function secureIdempotencyKey(prefix: string): string | null {
  const bytes = new Uint8Array(8);
  const source = fillRandomBytes(bytes);
  if (source === 'fallback') {
    return null;
  }
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${Date.now()}_${hex}`;
}

/** Uniform index in `[0, max)` — UI / pickery (nie sekrety). */
export function secureRandomIndex(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  const n = Math.floor(max);
  const bytes = new Uint32Array(1);
  fillRandomBytes(new Uint8Array(bytes.buffer));
  return bytes[0] % n;
}
