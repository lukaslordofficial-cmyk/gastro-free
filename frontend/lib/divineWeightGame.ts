/**
 * „Boska Waga w Ręku” — cultivation ranks, streak & Fibonacci points.
 *
 * STREAK-BREAK RULE (CRITICAL vs ChatGPT default):
 * When the user worsens (abs error ≥ previous attempt), do NOT zero Qi / reset to
 * mortal streak 1. Instead rewind the streak counter to the *start of the number
 * chain for their current rank class* (symbolic reset within the same rank).
 *
 * Rank → chain-start mapping (aligned to scoring stages 1 / 9 / 19):
 *   Rank 1 Śmiertelnik  → streak rewind to 1  (Etap Inicjacji)
 *   Rank 2 Adept        → streak rewind to 1  (Etap Inicjacji)
 *   Rank 3 Mistrz       → streak rewind to 9  (Etap Skupienia Umysłu)
 *   Rank 4 Arcymag      → streak rewind to 9  (Etap Skupienia Umysłu)
 *   Rank 5 Nieśmiertelny→ streak rewind to 19 (Etap Boskiego Ciągu)
 *
 * On worsen: points awarded = 0; streak := chainStart(rankHeld); total Qi kept.
 * On improve: streak += 1; points = pointsForStreakAttempt(streak).
 * First ever attempt: treated as improvement, streak = 1, points = 1.
 */

export type CultivationRankId = 1 | 2 | 3 | 4 | 5;

export type CultivationRank = {
  id: CultivationRankId;
  namePl: string;
  /** Inclusive min abs error in grams; null = no lower bound */
  minErrorG: number | null;
  /** Exclusive max? We use inclusive ranges from the paste */
  maxErrorG: number | null;
  descriptionPl: string;
  /** Streak attempt number to rewind to on worsen (see file header). */
  streakChainStart: number;
};

export const CULTIVATION_RANKS: CultivationRank[] = [
  {
    id: 1,
    namePl: 'Śmiertelnik Ślepej Dłoni',
    minErrorG: 301,
    maxErrorG: null,
    descriptionPl:
      'Twoje zmysły są zablokowane przez ziemski pył. Mylisz kilogram ziemniaków z piórkiem.',
    streakChainStart: 1,
  },
  {
    id: 2,
    namePl: 'Adept Wyczucia Masy',
    minErrorG: 150,
    maxErrorG: 300,
    descriptionPl:
      'Otwierasz swój pierwszy Południk Wagi. Twoja ręka zaczyna odróżniać ciężar kości od ciężaru mięsa.',
    streakChainStart: 1,
  },
  {
    id: 3,
    namePl: 'Mistrz Harmonii Oka i Dłoni',
    minErrorG: 50,
    maxErrorG: 149,
    descriptionPl:
      'Twoja percepcja rzuca wyzwanie prawom fizyki. Widzisz strukturę molekularną marchewki przed jej dotknięciem.',
    streakChainStart: 9,
  },
  {
    id: 4,
    namePl: 'Arcymag Grawitacyjnego Rdzenia',
    minErrorG: 10,
    maxErrorG: 49,
    descriptionPl:
      'Dotykając przedmiotu, stajesz się jednością z grawitacją planety. Twoja dłoń to certyfikowana waga laboratoryjna.',
    streakChainStart: 9,
  },
  {
    id: 5,
    namePl: 'Nieśmiertelny Przeznaczony Boga Wag',
    minErrorG: null,
    maxErrorG: 9,
    descriptionPl:
      'Osiągnąłeś stan Ascendencji. Jarvis kłania się przed Twoim majestatem. Ważysz intencją, a Wszechświat potwierdza Twój werdykt.',
    streakChainStart: 19,
  },
];

/** Absolute error in grams → rank (higher id = better). */
export function rankFromAbsErrorG(absErrorG: number): CultivationRank {
  const e = Math.abs(absErrorG);
  if (e < 10) return CULTIVATION_RANKS[4];
  if (e < 50) return CULTIVATION_RANKS[3];
  if (e < 150) return CULTIVATION_RANKS[2];
  if (e <= 300) return CULTIVATION_RANKS[1];
  return CULTIVATION_RANKS[0];
}

export function rankById(id: CultivationRankId): CultivationRank {
  return CULTIVATION_RANKS.find((r) => r.id === id) ?? CULTIVATION_RANKS[0];
}

/**
 * Fibonacci-like explosion for attempts 19+ (from product paste):
 * 2,4,6,10,16,26,42,68,110,173,283,456,739… then a[n]=a[n-1]+a[n-2]
 */
const FIB_EXPLOSION_SEED = [
  2, 4, 6, 10, 16, 26, 42, 68, 110, 173, 283, 456, 739,
];

export function pointsForStreakAttempt(streakAttempt: number): number {
  const n = Math.max(1, Math.floor(streakAttempt));
  // Attempts 1–8: points = attempt number
  if (n <= 8) return n;
  // Attempts 9–18: constant 9 pts
  if (n <= 18) return 9;
  // Attempts 19+: Fibonacci-like explosion
  const idx = n - 19;
  if (idx < FIB_EXPLOSION_SEED.length) return FIB_EXPLOSION_SEED[idx];
  // Extend: a[n] = a[n-1] + a[n-2]
  let a = FIB_EXPLOSION_SEED[FIB_EXPLOSION_SEED.length - 2];
  let b = FIB_EXPLOSION_SEED[FIB_EXPLOSION_SEED.length - 1];
  for (let i = FIB_EXPLOSION_SEED.length; i <= idx; i++) {
    const next = a + b;
    a = b;
    b = next;
  }
  return b;
}

export type AttemptInput = {
  estimateG: number;
  actualG: number;
  /** Absolute error of the previous attempt; null if first ever */
  previousAbsErrorG: number | null;
  /** Streak counter before this attempt */
  previousStreak: number;
  /**
   * Rank held going into this attempt (for streak rewind on worsen).
   * Prefer stored current_rank; falls back to previous error's rank.
   */
  rankHeldId: CultivationRankId;
};

export type AttemptResult = {
  estimateG: number;
  actualG: number;
  /** Signed: estimate − actual */
  signedErrorG: number;
  absErrorG: number;
  improved: boolean;
  /** First attempt has no baseline — counts as improvement */
  isFirst: boolean;
  pointsEarned: number;
  streakAfter: number;
  rank: CultivationRank;
  flavorLine: string;
};

export function evaluateAttempt(input: AttemptInput): AttemptResult {
  const estimateG = Number(input.estimateG);
  const actualG = Number(input.actualG);
  const signedErrorG = Math.round((estimateG - actualG) * 10) / 10;
  const absErrorG = Math.round(Math.abs(signedErrorG) * 10) / 10;
  const rank = rankFromAbsErrorG(absErrorG);
  const isFirst = input.previousAbsErrorG == null;

  let improved: boolean;
  let streakAfter: number;
  let pointsEarned: number;

  if (isFirst) {
    improved = true;
    streakAfter = 1;
    pointsEarned = pointsForStreakAttempt(1);
  } else if (absErrorG < (input.previousAbsErrorG as number)) {
    // Improvement vs previous absolute error
    improved = true;
    streakAfter = Math.max(1, (input.previousStreak || 0) + 1);
    pointsEarned = pointsForStreakAttempt(streakAfter);
  } else {
    // Worsen or equal — rewind to rank chain start (NOT wipe to 0 / mortal)
    improved = false;
    const held = rankById(input.rankHeldId);
    streakAfter = held.streakChainStart;
    pointsEarned = 0;
  }

  const sign = signedErrorG >= 0 ? '+' : '−';
  const mag = Math.abs(signedErrorG);
  let flavorLine: string;
  if (absErrorG < 10) {
    flavorLine = `Rozbieżność percepcji: ${sign}${mag} g. Qi krąży jak rzeka niebios.`;
  } else if (absErrorG < 50) {
    flavorLine = `Rozbieżność percepcji: ${sign}${mag} g. Rdzeń grawitacji drży, lecz trzyma kurs.`;
  } else if (absErrorG < 150) {
    flavorLine = `Rozbieżność percepcji: ${sign}${mag} g. Harmonia oka i dłoni jeszcze się kalibruje.`;
  } else if (absErrorG <= 300) {
    flavorLine = `Rozbieżność percepcji: ${sign}${mag} g. Południk Wagi dopiero się otwiera.`;
  } else {
    flavorLine = `Rozbieżność percepcji: ${sign}${mag} g. Twoje Qi jest niestabilne!`;
  }

  return {
    estimateG,
    actualG,
    signedErrorG,
    absErrorG,
    improved,
    isFirst,
    pointsEarned,
    streakAfter,
    rank,
    flavorLine,
  };
}

/** Needle deflection 0..1 for compass UI (0 = north/perfect, 1 = max wobble). */
export function compassDeflection(absErrorG: number): number {
  // Map 0..400g+ → 0..1
  return Math.min(1, Math.abs(absErrorG) / 400);
}

export function betterRank(a: CultivationRankId, b: CultivationRankId): CultivationRankId {
  return a >= b ? a : b;
}
