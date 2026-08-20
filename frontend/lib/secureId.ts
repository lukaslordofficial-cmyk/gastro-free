/**
 * Cryptographically strong short IDs (replaces Math.random for persisted/API keys).
 * Uses Web Crypto getRandomValues when available (Expo / modern RN).
 */
function randomBytesHex(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  const cryptoObj =
    typeof globalThis !== 'undefined'
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
  } else {
    throw new Error('Web Crypto getRandomValues jest niedostępne — nie wolno generować ID z Date.now().');
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable-ish unique id: prefix_timestamp_randomhex */
export function secureId(prefix = 'id', randomBytes = 4): string {
  return `${prefix}_${Date.now()}_${randomBytesHex(randomBytes)}`;
}

/** Stripe / billing idempotency key */
export function secureIdempotencyKey(prefix: string): string {
  return secureId(prefix, 5);
}

/** Uniform index in `[0, max)` without Math.random (UI / non-crypto pickers). */
export function secureRandomIndex(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 0;
  const n = Math.floor(max);
  const bytes = new Uint32Array(1);
  const cryptoObj =
    typeof globalThis !== 'undefined'
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    cryptoObj.getRandomValues(bytes);
    return bytes[0] % n;
  }
  return (Date.now() >>> 0) % n;
}
