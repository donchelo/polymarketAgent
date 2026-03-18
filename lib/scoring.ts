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
  const freqPts   = Math.min((tradesPerDay / 3) * 35, 35);
  const divPts    = Math.min((uniqueMarkets / 30) * 25, 25);
  const wrPts     = winRate * 25;
  const profitPts = Math.min((Math.log10(Math.max(profit, 1)) / 5) * 15, 15);
  const penalty   = Math.min(daysSinceActive * 2, 20);
  return Math.max(freqPts + divPts + wrPts + profitPts - penalty, 0);
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
