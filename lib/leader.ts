export const LEADER_CRITERIA = {
  MIN_SCORE: 50,
  MIN_REAL_WIN_RATE: 0.54, // real, no proxy
  MIN_TRADES_PER_DAY: 2.0,
  PREFER_SHORT_TERM: true, // bonus para traders de mercados < 24h
};

export function computeLeaderScore(w: {
  win_rate: number;
  trades_per_day: number;
  score: number;
  real_win_rate?: number | null;
  pct_short_term?: number | null;
}): number {
  const wr = w.real_win_rate ?? w.win_rate ?? 0.52;
  const shortBonus = 1 + (w.pct_short_term ?? 0);
  return wr * w.trades_per_day * (w.score / 100) * shortBonus;
}

export function selectBestLeader<
  T extends {
    score: number;
    trades_per_day: number;
    win_rate: number;
    real_win_rate?: number | null;
    pct_short_term?: number | null;
  }
>(candidates: T[]): T | null {
  const eligible = candidates.filter(
    (w) =>
      w.score >= LEADER_CRITERIA.MIN_SCORE &&
      w.trades_per_day >= LEADER_CRITERIA.MIN_TRADES_PER_DAY &&
      (w.real_win_rate ?? w.win_rate ?? 0) >= LEADER_CRITERIA.MIN_REAL_WIN_RATE
  );
  if (!eligible.length) return null;
  return eligible.sort(
    (a, b) => computeLeaderScore(b) - computeLeaderScore(a)
  )[0];
}
