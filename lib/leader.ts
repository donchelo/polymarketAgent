export const LEADER_CRITERIA = {
  MIN_SCORE: 55,
  MIN_WIN_RATE: 0.54,
  MIN_TRADES_PER_DAY: 2.0,
};

export function computeLeaderScore(w: {
  win_rate: number;
  trades_per_day: number;
  score: number;
}): number {
  return w.win_rate * w.trades_per_day * (w.score / 100);
}

export function selectBestLeader<
  T extends { score: number; trades_per_day: number; win_rate: number }
>(candidates: T[]): T | null {
  const eligible = candidates.filter(
    (w) =>
      w.score >= LEADER_CRITERIA.MIN_SCORE &&
      w.trades_per_day >= LEADER_CRITERIA.MIN_TRADES_PER_DAY &&
      w.win_rate >= LEADER_CRITERIA.MIN_WIN_RATE
  );
  if (!eligible.length) return null;
  return eligible.sort(
    (a, b) => computeLeaderScore(b) - computeLeaderScore(a)
  )[0];
}
