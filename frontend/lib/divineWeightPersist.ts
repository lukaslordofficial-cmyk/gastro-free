/**
 * Persist „Boska Waga w Ręku” attempts + aggregate stats per account_key (Supabase).
 */
import { supabase } from '@/lib/supabase';
import { getAccountKey } from '@/lib/accountKey';
import type { AttemptResult, CultivationRankId } from '@/lib/divineWeightGame';
import { betterRank } from '@/lib/divineWeightGame';

export type DivineWeightStats = {
  account_key: string;
  total_attempts: number;
  total_points: number;
  current_streak: number;
  current_rank: CultivationRankId;
  best_rank: CultivationRankId;
  last_abs_error_g: number | null;
  updated_at?: string;
};

export type DivineWeightAttemptRow = {
  id: string;
  account_key: string;
  estimate_g: number;
  actual_g: number;
  abs_error_g: number;
  signed_error_g: number;
  points: number;
  streak: number;
  rank_id: number;
  improved: boolean;
  item_name: string | null;
  created_at: string;
};

const DEFAULT_STATS: Omit<DivineWeightStats, 'account_key'> = {
  total_attempts: 0,
  total_points: 0,
  current_streak: 0,
  current_rank: 1,
  best_rank: 1,
  last_abs_error_g: null,
};

export async function fetchDivineWeightStats(): Promise<DivineWeightStats> {
  const ak = getAccountKey();
  try {
    const { data, error } = await supabase
      .from('divine_weight_stats')
      .select('*')
      .eq('account_key', ak)
      .maybeSingle();
    if (error) throw error;
    if (!data) return { account_key: ak, ...DEFAULT_STATS };
    return {
      account_key: ak,
      total_attempts: Number(data.total_attempts) || 0,
      total_points: Number(data.total_points) || 0,
      current_streak: Number(data.current_streak) || 0,
      current_rank: (Number(data.current_rank) || 1) as CultivationRankId,
      best_rank: (Number(data.best_rank) || 1) as CultivationRankId,
      last_abs_error_g:
        data.last_abs_error_g == null ? null : Number(data.last_abs_error_g),
      updated_at: data.updated_at,
    };
  } catch {
    return { account_key: ak, ...DEFAULT_STATS };
  }
}

export async function fetchDivineWeightAttempts(limit = 40): Promise<DivineWeightAttemptRow[]> {
  const ak = getAccountKey();
  try {
    const { data, error } = await supabase
      .from('divine_weight_attempts')
      .select('*')
      .eq('account_key', ak)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (error) throw error;
    return (data as DivineWeightAttemptRow[]) ?? [];
  } catch {
    return [];
  }
}

export async function persistDivineWeightAttempt(opts: {
  result: AttemptResult;
  itemName?: string | null;
  previousStats: DivineWeightStats;
}): Promise<{ stats: DivineWeightStats; ok: boolean }> {
  const ak = getAccountKey();
  const { result, itemName, previousStats } = opts;
  const nextRank = result.rank.id;
  const nextBest = betterRank(previousStats.best_rank, nextRank);
  const nextStats: DivineWeightStats = {
    account_key: ak,
    total_attempts: previousStats.total_attempts + 1,
    total_points: previousStats.total_points + result.pointsEarned,
    current_streak: result.streakAfter,
    current_rank: nextRank,
    best_rank: nextBest,
    last_abs_error_g: result.absErrorG,
  };

  try {
    const { error: insErr } = await supabase.from('divine_weight_attempts').insert({
      account_key: ak,
      estimate_g: result.estimateG,
      actual_g: result.actualG,
      abs_error_g: result.absErrorG,
      signed_error_g: result.signedErrorG,
      points: result.pointsEarned,
      streak: result.streakAfter,
      rank_id: result.rank.id,
      improved: result.improved,
      item_name: itemName?.trim() || null,
    });
    if (insErr) throw insErr;

    const { error: upErr } = await supabase.from('divine_weight_stats').upsert(
      {
        account_key: ak,
        total_attempts: nextStats.total_attempts,
        total_points: nextStats.total_points,
        current_streak: nextStats.current_streak,
        current_rank: nextStats.current_rank,
        best_rank: nextStats.best_rank,
        last_abs_error_g: nextStats.last_abs_error_g,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'account_key' },
    );
    if (upErr) throw upErr;
    return { stats: nextStats, ok: true };
  } catch {
    // Soft-fail: game still works locally for this session
    return { stats: nextStats, ok: false };
  }
}
