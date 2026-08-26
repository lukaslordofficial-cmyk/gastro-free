/**
 * Etykieta produktu magazynowego z opcjonalną odmianą (Ziemniak + Irys → „Ziemniak (Irys)”).
 */
export function inventoryDisplayName(name: string, variant?: string | null): string {
  const n = String(name || '').trim();
  const v = String(variant || '').trim();
  if (!n) return v;
  if (!v) return n;
  const nl = n.toLowerCase();
  const vl = v.toLowerCase();
  if (nl.includes(vl)) return n;
  return `${n} (${v})`;
}

/** Tekst do fuzzy-search (nazwa + odmiana). */
export function inventorySearchBlob(name: string, variant?: string | null): string {
  return `${String(name || '')} ${String(variant || '')}`.trim();
}
