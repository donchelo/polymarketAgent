// Port exacto de ActivityAnalyzer.score() en whale_scanner.py

export const FILTERS = {
  MIN_PROFIT_USDC: 2_000,
  MIN_TRADES: 30,
  MIN_WIN_RATE: 0.52,
  MAX_ACTIVE_DAYS_AGO: 7,
  MIN_TRADES_PER_DAY: 0.5,
  MIN_UNIQUE_MARKETS: 5,
} as const;

export function computeScore({
  profit,
  winRate,
  tradesPerDay,
  uniqueMarkets,
  daysSinceActive,
}: {
  profit: number;
  winRate: number;
  tradesPerDay: number;
  uniqueMarkets: number;
  daysSinceActive: number;
}): number {
  // Frequency: 0-30 pts (3 trades/day = max)
  const freqPts   = Math.min((tradesPerDay / 3) * 30, 30);
  // Diversity: 0-20 pts (30 unique markets = max)
  const divPts    = Math.min((uniqueMarkets / 30) * 20, 20);
  // Profit: 0-30 pts (log scale — $1K=12pts, $100K=24pts, $10M=30pts)
  const profitPts = Math.min((Math.log10(Math.max(profit, 1)) / 7) * 30, 30);
  // Recency: 0-20 pts (active today=20, 7 days ago=6, 10+ days=0)
  const recencyPts = Math.max(20 - daysSinceActive * 2, 0);
  // Win rate bonus: only if we have real data (not the 0.55 proxy)
  const wrBonus   = winRate !== 0.55 ? Math.min(winRate * 20, 20) : 0;

  return Math.max(freqPts + divPts + profitPts + recencyPts + wrBonus, 0);
}

export function computeActivityMetrics(trades: Array<{
  timestamp?: number | string;
  created_at?: string;
  time?: string;
  conditionId?: string;
  market?: string;
  marketId?: string;
}>): {
  tradesPerDay: number;
  uniqueMarkets: number;
  daysSinceActive: number;
  isBot: boolean;
} {
  if (!trades.length) {
    return { tradesPerDay: 0, uniqueMarkets: 0, daysSinceActive: 999, isBot: false };
  }

  const timestamps: number[] = [];
  const markets = new Set<string>();

  for (const t of trades) {
    const ts = t.timestamp ?? t.created_at ?? t.time;
    if (ts != null) {
      const n = typeof ts === "string" ? parseFloat(ts) : ts;
      if (!isNaN(n)) timestamps.push(n);
    }
    const mid = t.conditionId ?? t.market ?? t.marketId ?? "";
    if (mid) markets.add(mid);
  }

  if (!timestamps.length) {
    return { tradesPerDay: 0, uniqueMarkets: markets.size, daysSinceActive: 999, isBot: false };
  }

  timestamps.sort((a, b) => a - b);
  const nowTs      = Date.now() / 1000;
  const latestTs   = Math.max(...timestamps);
  const earliestTs = Math.min(...timestamps);

  const daysSinceActive = (nowTs - latestTs) / 86400;
  const activeSpanDays  = Math.max((latestTs - earliestTs) / 86400, 1);
  const tradesPerDay    = timestamps.length / activeSpanDays;

  let isBot = false;
  if (timestamps.length >= 5) {
    const intervals = timestamps.slice(1).map((t, i) => t - timestamps[i]);
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    isBot = avgInterval < 30;
  }

  return {
    tradesPerDay:    Math.round(tradesPerDay * 100) / 100,
    uniqueMarkets:   markets.size,
    daysSinceActive: Math.round(daysSinceActive * 10) / 10,
    isBot,
  };
}
