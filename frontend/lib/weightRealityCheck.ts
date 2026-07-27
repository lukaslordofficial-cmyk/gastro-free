/**
 * Reality-check oceny wagi „na oko” — 5 rang zawodowych (bez punktów / streaków).
 * Błąd = |szacunek − wynik z wagi| w gramach.
 */

export type WeightSkillRank = 1 | 2 | 3 | 4 | 5;

export type WeightSkillResult = {
  absErrorG: number;
  signedErrorG: number;
  rank: WeightSkillRank;
  title: string;
  description: string;
  headline: string;
};

const RANKS: Record<
  WeightSkillRank,
  { maxExclusive: number | null; title: string; description: string }
> = {
  5: {
    maxExclusive: 1, // 0 g only (abs < 1)
    title: 'Idealne trafienie',
    description:
      'Szacunek zgadza się z wagą. Taki poziom utrzymuje food cost i stany magazynowe pod kontrolą.',
  },
  4: {
    maxExclusive: 10, // 1–9 g
    title: 'Bardzo dobra ocena',
    description:
      'Margines 1–9 g — wystarczający przy większości produktów. Przy mięsach trzymaj się wagi przy porcjowaniu.',
  },
  3: {
    maxExclusive: 50, // 10–49 g
    title: 'Akceptowalna ocena',
    description:
      'Margines 10–49 g. Do raportu strat i kosztu porcji warto zawsze zweryfikować wynik na wadze.',
  },
  2: {
    maxExclusive: 150, // 50–149 g
    title: 'Słaba ocena na oko',
    description:
      'Margines 50–149 g zaburza pomiary magazynu. Przy stratach waż produkt przed wpisem.',
  },
  1: {
    maxExclusive: null, // ≥150 g
    title: 'Ocena niewiarygodna',
    description:
      'Różnica ≥150 g. Bez wagi system nie odzwierciedli rzeczywistości — zważ stratę i popraw wpis.',
  },
};

export function rankFromAbsErrorG(absErrorG: number): WeightSkillRank {
  const e = Math.abs(Number(absErrorG) || 0);
  if (e < 1) return 5;
  if (e < 10) return 4;
  if (e < 50) return 3;
  if (e < 150) return 2;
  return 1;
}

export function evaluateWeightGuess(estimateG: number, actualG: number): WeightSkillResult {
  const est = Number(estimateG);
  const act = Number(actualG);
  const signed = Math.round((est - act) * 10) / 10;
  const abs = Math.round(Math.abs(signed) * 10) / 10;
  const rank = rankFromAbsErrorG(abs);
  const meta = RANKS[rank];
  const signLabel = signed > 0 ? `+${abs} g (za wysoko)` : signed < 0 ? `−${abs} g (za nisko)` : '0 g';
  const headline =
    rank === 5
      ? 'Brawo — wstrzeliłeś się w gramaturę.'
      : `Rozbieżność: ${signLabel}. Poziom ${rank}/5 — ${meta.title}.`;
  return {
    absErrorG: abs,
    signedErrorG: signed,
    rank,
    title: meta.title,
    description: meta.description,
    headline,
  };
}

export function formatGramsInput(raw: string): number | null {
  const n = Number(String(raw).replace(',', '.').replace(/[^\d.-]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 10) / 10;
}
