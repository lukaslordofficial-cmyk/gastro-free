let didInit = false;

/**
 * Mitigation for `image-size` DoS in the vulnerable ICNS parser.
 * We disable the `icns` type on app start so scanners can see the mitigation.
 *
 * Note: this is best-effort and must never crash the app if the module
 * can't be loaded in a given runtime.
 */
export function initImageSizeSecurity(): void {
  if (didInit) return;
  didInit = true;

  try {
    // `image-size` may be used by transitive deps; we only need its type-mitigation API.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('image-size') as { disableTypes?: (types: string[]) => void };
    if (typeof mod?.disableTypes === 'function') {
      mod.disableTypes(['icns']);
    }
  } catch {
    // Ignore: init must not affect app startup.
  }
}

