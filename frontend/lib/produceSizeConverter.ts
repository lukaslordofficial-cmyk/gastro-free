/**
 * Visual size → kg converter for produce often counted as pieces but stored in kg.
 * Extensible catalog — match by product name aliases (PL + common variants).
 */

export type ProduceSizeKey = 'S' | 'M' | 'L';

export type ProduceSizeTier = {
  key: ProduceSizeKey;
  labelPl: string;
  avgWeightG: number;
  /** Approximate pieces per 1 kg */
  pcsPerKg: number;
  pcsPerKgLabel: string;
  visualPl: string;
};

export type ProduceConverter = {
  id: string;
  namePl: string;
  /** Lowercase aliases for fuzzy name match */
  aliases: string[];
  sizes: ProduceSizeTier[];
};

/** Default carrot tiers (Jarvis data). */
export const CARROT_SIZES: ProduceSizeTier[] = [
  {
    key: 'S',
    labelPl: 'Mała (S)',
    avgWeightG: 60,
    pcsPerKg: 16.5,
    pcsPerKgLabel: '~16–17 szt.',
    visualPl: 'Grubość palca, krótka',
  },
  {
    key: 'M',
    labelPl: 'Średnia (M)',
    avgWeightG: 125,
    pcsPerKg: 8,
    pcsPerKgLabel: '8 szt.',
    visualPl: 'Klasyczna, marketowa',
  },
  {
    key: 'L',
    labelPl: 'Duża (L)',
    avgWeightG: 250,
    pcsPerKg: 4,
    pcsPerKgLabel: '4 szt.',
    visualPl: 'Gruba, długa, do ciężkich dań',
  },
];

function tier(
  key: ProduceSizeKey,
  labelPl: string,
  avgWeightG: number,
  pcsPerKg: number,
  pcsPerKgLabel: string,
  visualPl: string,
): ProduceSizeTier {
  return { key, labelPl, avgWeightG, pcsPerKg, pcsPerKgLabel, visualPl };
}

/**
 * Catalog of produce converters. Start with marchewka + common veggies; append freely.
 */
export const PRODUCE_SIZE_CATALOG: ProduceConverter[] = [
  {
    id: 'carrot',
    namePl: 'Marchewka',
    aliases: ['marchew', 'marchewka', 'marchewki', 'carrot', 'carrots'],
    sizes: CARROT_SIZES,
  },
  {
    id: 'potato',
    namePl: 'Ziemniak',
    aliases: ['ziemniak', 'ziemniaki', 'kartofel', 'kartofle', 'potato', 'potatoes'],
    sizes: [
      tier('S', 'Mały (S)', 80, 12.5, '~12–13 szt.', 'Jak jajko kurze'),
      tier('M', 'Średni (M)', 150, 6.5, '~6–7 szt.', 'Klasyczny obiadowy'),
      tier('L', 'Duży (L)', 300, 3.3, '~3–4 szt.', 'Duży, pieczony / frytki'),
    ],
  },
  {
    id: 'onion',
    namePl: 'Cebula',
    aliases: ['cebula', 'cebule', 'onion', 'onions'],
    sizes: [
      tier('S', 'Mała (S)', 70, 14, '~14 szt.', 'Jak orzech włoski / mała'),
      tier('M', 'Średnia (M)', 140, 7, '~7 szt.', 'Klasyczna kuchenna'),
      tier('L', 'Duża (L)', 250, 4, '4 szt.', 'Duża, do duszenia'),
    ],
  },
  {
    id: 'tomato',
    namePl: 'Pomidor',
    aliases: ['pomidor', 'pomidory', 'tomato', 'tomatoes'],
    sizes: [
      tier('S', 'Mały (S)', 60, 16.5, '~16–17 szt.', 'Koktajlowy / mały'),
      tier('M', 'Średni (M)', 120, 8, '8 szt.', 'Klasyczny marketowy'),
      tier('L', 'Duży (L)', 220, 4.5, '~4–5 szt.', 'Duży, sałatkowy / beef'),
    ],
  },
  {
    id: 'cucumber',
    namePl: 'Ogórek',
    aliases: ['ogórek', 'ogorek', 'ogórki', 'ogorki', 'cucumber', 'cucumbers'],
    sizes: [
      tier('S', 'Mały (S)', 80, 12.5, '~12–13 szt.', 'Krótki, sałatkowy'),
      tier('M', 'Średni (M)', 160, 6, '~6 szt.', 'Klasyczny długi'),
      tier('L', 'Duży (L)', 280, 3.5, '~3–4 szt.', 'Gruby, długi'),
    ],
  },
  {
    id: 'pepper',
    namePl: 'Papryka',
    aliases: ['papryka', 'papryki', 'pepper', 'peppers', 'bell pepper'],
    sizes: [
      tier('S', 'Mała (S)', 100, 10, '10 szt.', 'Niewielka, wąska'),
      tier('M', 'Średnia (M)', 160, 6, '~6 szt.', 'Klasyczna blokowa'),
      tier('L', 'Duża (L)', 250, 4, '4 szt.', 'Duża, mięsista'),
    ],
  },
  {
    id: 'apple',
    namePl: 'Jabłko',
    aliases: ['jabłko', 'jablko', 'jabłka', 'jablka', 'apple', 'apples'],
    sizes: [
      tier('S', 'Małe (S)', 100, 10, '10 szt.', 'Jak piłka golfowa / małe'),
      tier('M', 'Średnie (M)', 160, 6, '~6 szt.', 'Klasyczne deserowe'),
      tier('L', 'Duże (L)', 250, 4, '4 szt.', 'Duże, pieczone'),
    ],
  },
];

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ł/g, 'l')
    .trim();
}

/** Find converter by product / inventory item name. */
export function findProduceConverter(productName: string | null | undefined): ProduceConverter | null {
  if (!productName?.trim()) return null;
  const n = normalizeName(productName);
  for (const entry of PRODUCE_SIZE_CATALOG) {
    for (const alias of entry.aliases) {
      const a = normalizeName(alias);
      if (n === a || n.includes(a) || a.includes(n)) return entry;
    }
  }
  return null;
}

/** Pieces × avg weight → kg (and grams). Example: 4 × L carrot (250g) = 1.0 kg. */
export function piecesToKg(pieceCount: number, tier: ProduceSizeTier): {
  kg: number;
  grams: number;
} {
  const grams = Math.max(0, pieceCount) * tier.avgWeightG;
  const kg = grams / 1000;
  return {
    grams: Math.round(grams * 10) / 10,
    kg: Math.round(kg * 1000) / 1000,
  };
}

export type ProduceSizeCounts = Partial<Record<ProduceSizeKey, number>>;

/** Sumuje mieszane rozmiary: np. 2S + 2M + 2L → sztuki + przybliżona waga. */
export function mixedPiecesToKg(
  counts: ProduceSizeCounts,
  converter: ProduceConverter,
): { pieces: number; grams: number; kg: number; counts: Record<ProduceSizeKey, number> } {
  const normalized: Record<ProduceSizeKey, number> = { S: 0, M: 0, L: 0 };
  let pieces = 0;
  let grams = 0;
  for (const tier of converter.sizes) {
    const n = Math.max(0, Math.floor(Number(counts[tier.key]) || 0));
    normalized[tier.key] = n;
    pieces += n;
    grams += n * tier.avgWeightG;
  }
  return {
    pieces,
    grams: Math.round(grams * 10) / 10,
    kg: Math.round((grams / 1000) * 1000) / 1000,
    counts: normalized,
  };
}

/** Whether waste UI should offer the size picker (ingredient + piece-like unit). */
export function shouldOfferSizeConverter(
  itemType: string | null | undefined,
  unit: string | null | undefined,
  productName: string | null | undefined,
): ProduceConverter | null {
  if (itemType === 'dish') return null;
  const u = (unit || '').toLowerCase().trim();
  if (u && u !== 'szt' && u !== 'op' && u !== 'pcs' && u !== 'pc') {
    // Still offer if name matches and unit is kg — user may switch to pieces
    if (u !== 'kg' && u !== 'g') return null;
  }
  return findProduceConverter(productName);
}

export function formatKg(kg: number): string {
  if (kg >= 1) return `${kg % 1 === 0 ? kg.toFixed(0) : kg.toFixed(2)} kg`;
  const g = Math.round(kg * 1000);
  return `${g} g`;
}
