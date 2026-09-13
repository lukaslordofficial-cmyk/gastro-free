/**
 * Komunikaty błędów zdjęć — bez angielskich stacków Native/TurboModule.
 */
export function friendlyImageSaveError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || '');
  const m = raw.toLowerCase();
  if (
    m.includes('renderasync')
    || m.includes('manipulateasync')
    || m.includes('has been rejected')
    || m.includes('native module')
    || m.includes('imagemanipulator')
    || m.includes('webp')
    || m.includes('compress')
    || m.includes('encoding')
    || m.includes('out of memory')
    || m.includes('enoent')
    || m.includes('failed to')
  ) {
    return 'Nie udało się dodać obrazka. Spróbuj inny plik lub zrób zdjęcie ponownie.';
  }
  if (m.includes('brak katalogu') || m.includes('brak uri') || m.includes('brak id')) {
    return raw;
  }
  if (!raw.trim() || /[A-Z][a-z]+Error|Exception|TurboModule|RCT/.test(raw)) {
    return 'Nie udało się dodać obrazka. Spróbuj inny.';
  }
  // Krótki PL bez technicznego żargonu
  if (raw.length > 120 || /function|async|promise|native/i.test(raw)) {
    return 'Nie udało się dodać obrazka. Spróbuj inny.';
  }
  return raw;
}
