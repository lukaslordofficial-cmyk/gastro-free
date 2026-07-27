/**
 * Reality-check oceny objętości „na oko” — 5 rang (bez punktów / streaków).
 * Błąd = |szacunek − odczyt z garnka| w mililitrach.
 * Pasma jak przy gramach: 0 / 1–9 / 10–49 / 50–149 / ≥150 ml.
 */

export type VolumeSkillRank = 1 | 2 | 3 | 4 | 5;

export type VolumeSkillResult = {
  absErrorMl: number;
  signedErrorMl: number;
  rank: VolumeSkillRank;
  title: string;
  description: string;
  headline: string;
};

const RANKS: Record<
  VolumeSkillRank,
  { maxExclusive: number | null; title: string; description: string }
> = {
  5: {
    maxExclusive: 1, // 0 ml only (abs < 1)
    title: 'Idealne trafienie',
    description:
      'Szacunek zgadza się ze znakiem na garnku. Taki poziom utrzymuje litraż zup i sosów pod kontrolą.',
  },
  4: {
    maxExclusive: 10, // 1–9 ml
    title: 'Bardzo dobra ocena',
    description:
      'Margines 1–9 ml — wystarczający przy większości płynów. Przy drogich sosach trzymaj się skali na garnku.',
  },
  3: {
    maxExclusive: 50, // 10–49 ml
    title: 'Akceptowalna ocena',
    description:
      'Margines 10–49 ml. Do raportu strat i food cost warto zawsze zweryfikować odczyt na znaku garnka.',
  },
  2: {
    maxExclusive: 150, // 50–149 ml
    title: 'Słaba ocena na oko',
    description:
      'Margines 50–149 ml zaburza pomiary magazynu. Przy stratach płynów odczytaj litraż ze znaku.',
  },
  1: {
    maxExclusive: null, // ≥150 ml
    title: 'Ocena niewiarygodna',
    description:
      'Różnica ≥150 ml. Bez skali na garnku system nie odzwierciedli rzeczywistości — sprawdź znak i popraw wpis.',
  },
};

export function rankFromAbsErrorMl(absErrorMl: number): VolumeSkillRank {
  const e = Math.abs(Number(absErrorMl) || 0);
  if (e < 1) return 5;
  if (e < 10) return 4;
  if (e < 50) return 3;
  if (e < 150) return 2;
  return 1;
}

export function evaluateVolumeGuess(estimateMl: number, actualMl: number): VolumeSkillResult {
  const est = Number(estimateMl);
  const act = Number(actualMl);
  const signed = Math.round((est - act) * 10) / 10;
  const abs = Math.round(Math.abs(signed) * 10) / 10;
  const rank = rankFromAbsErrorMl(abs);
  const meta = RANKS[rank];
  const signLabel =
    signed > 0 ? `+${abs} ml (za wysoko)` : signed < 0 ? `−${abs} ml (za nisko)` : '0 ml';
  const headline =
    rank === 5
      ? 'Brawo — wstrzeliłeś się w objętość.'
      : `Rozbieżność: ${signLabel}. Poziom ${rank}/5 — ${meta.title}.`;
  return {
    absErrorMl: abs,
    signedErrorMl: signed,
    rank,
    title: meta.title,
    description: meta.description,
    headline,
  };
}

export function formatMlInput(raw: string): number | null {
  const n = Number(String(raw).replace(',', '.').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10) / 10;
}

/** Preferuj volume check gdy jednostka to l/ml lub kontekst wskazuje zupę/sos. */
export function shouldPreferVolumeRealityCheck(opts: {
  unit?: string | null;
  itemName?: string | null;
  reason?: string | null;
}): boolean {
  const u = String(opts.unit || '')
    .trim()
    .toLowerCase();
  if (u === 'l' || u === 'ml' || u === 'lit' || u === 'litr' || u === 'litry') return true;
  const text = `${opts.itemName || ''} ${opts.reason || ''}`.toLowerCase();
  return /zupa|sos|soup|sauce|bulion|ros[oó]ł|krem(?:ówka)?|bisque|gazpacho|chowder/.test(text);
}

/** Hint ml z ilości zapisu straty. */
export function suggestedMlFromQty(qty: number, unit: string): number | null {
  const q = Number(qty);
  if (!Number.isFinite(q) || q <= 0) return null;
  const u = String(unit || '')
    .trim()
    .toLowerCase();
  if (u === 'ml') return Math.round(q * 10) / 10;
  if (u === 'l' || u === 'lit' || u === 'litr' || u === 'litry') return Math.round(q * 1000 * 10) / 10;
  return null;
}
