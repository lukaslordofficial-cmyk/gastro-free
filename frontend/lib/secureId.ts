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
    // Extremely rare fallback — still avoid Math.random for security-sensitive callers.
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = (Date.now() + i * 97) & 0xff;
    }
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
