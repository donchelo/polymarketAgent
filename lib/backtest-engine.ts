// Pure backtest engine — no I/O, no DB, no fetch.
// All data must be pre-fetched and passed in.
import { computeLeaderScore } from "@/lib/leader";
import type { StrategyParams } from "@/lib/strategy";

const SPORTS_TAGS = [
  "nhl","nba","nfl","mlb","soccer","basketball","hockey",
  "baseball","football","sports","tennis","golf","ufc","mma",
];

export type MarketInfo = {
  title: string;
  closed: boolean;
  tokens: Array<{ outcome: string; price: number; winner?: boolean }>;
  tags: string[];
  endDateIso: string | null;
};

export type WhaleRecord = {
  address: string;
  user_name: string | null;
  score: number;
  trades_per_day: number;
  win_rate: number;
  real_win_rate: number | null;
  pct_short_term: number | null;
};

export type BacktestRunResult = {
  roi: number | null;
  totalBet: number;
  totalPnl: number;
  resolved: number;
  wins: number;
  losses: number;
  totalTrades: number;
  open: number;
  skipped: number;
};

function kellySize(
  price: number,
  winRate: number,
  score: number,
  params: StrategyParams
): number {
  if (price <= 0 || price >= 1) return 0;
  const edge = winRate - price;
  if (edge < params.MIN_EDGE) return 0;
  const f = edge / (1 - price);
  const scoreMult = 0.8 + Math.min(Math.max(score - 40, 0) / 125, 0.4);
  const size = f * 0.25 * scoreMult * params.BANKROLL;
  return Math.min(Math.max(size, params.MIN_SIZE), params.MAX_SIZE);
}

export function runBacktest(
  allWhales: WhaleRecord[],
  allTrades: Map<string, Record<string, unknown>[]>,
  allMarkets: Map<string, MarketInfo | null>,
  params: StrategyParams,
  window: { startSec: number; endSec: number }
): BacktestRunResult {
  const WR_PROXY = params.WIN_RATE_PROXY;

  // Filter + rank whales according to this param set
  const whales = allWhales
    .filter(w => {
      if (Number(w.score) < params.MIN_SCORE) return false;
      if (Number(w.trades_per_day) < params.MIN_TRADES_PER_DAY) return false;
      if (w.real_win_rate != null && Number(w.real_win_rate) < params.MIN_REAL_WIN_RATE) return false;
      return true;
    })
    .map(w => ({
      address: w.address,
      score: Number(w.score),
      winRate: Number(w.real_win_rate ?? w.win_rate ?? WR_PROXY),
      compositeScore: computeLeaderScore({
        score: Number(w.score),
        trades_per_day: Number(w.trades_per_day),
        win_rate: Number(w.win_rate ?? WR_PROXY),
        real_win_rate: w.real_win_rate != null ? Number(w.real_win_rate) : null,
        pct_short_term: w.pct_short_term != null ? Number(w.pct_short_term) : null,
      }),
    }))
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, params.TOP_WHALES);

  type Entry = {
    whaleAddress: string;
    whaleScore: number;
    whaleWinRate: number;
    marketId: string;
    outcome: string;
    entryPrice: number;
    betSize: number;
    tradeTs: number;
    closed: boolean;
    won: boolean | null;
    pnl: number | null;
  };

  const rawEntries: Entry[] = [];
  const seenPerWhale = new Set<string>();

  for (const whale of whales) {
    const trades = allTrades.get(whale.address) ?? [];
    for (const t of trades) {
      const ts =
        typeof (t.timestamp ?? t.time) === "string"
          ? parseFloat(String(t.timestamp ?? t.time))
          : Number(t.timestamp ?? t.time ?? 0);

      if (ts < window.startSec || ts > window.endSec) continue;

      const marketId = String(t.conditionId ?? t.market ?? t.marketId ?? "");
      const outcome  = String(t.outcome ?? "").toUpperCase();
      const price    = Number(t.price ?? t.avgPrice ?? 0);

      if (!marketId || !outcome || price < params.MIN_PRICE || price > params.MAX_PRICE) continue;

      const key = `${whale.address}|${marketId}|${outcome}`;
      if (seenPerWhale.has(key)) continue;
      seenPerWhale.add(key);

      const betSize = kellySize(price, whale.winRate, whale.score, params);
      if (betSize === 0) continue;

      rawEntries.push({
        whaleAddress: whale.address,
        whaleScore:   whale.score,
        whaleWinRate: whale.winRate,
        marketId,
        outcome,
        entryPrice: price,
        betSize,
        tradeTs: ts,
        closed: false,
        won: null,
        pnl: null,
      });
    }
  }

  rawEntries.sort((a, b) => a.tradeTs - b.tradeTs);

  // Apply portfolio caps
  const portfolioExposure = { total: 0 };
  const whaleExposure = new Map<string, number>();
  const maxTotal = params.BANKROLL * params.MAX_EXPOSURE_PCT;

  const cappedEntries = rawEntries.filter(e => {
    const we = whaleExposure.get(e.whaleAddress) ?? 0;
    if (we >= params.MAX_EXPOSURE_PER_WHALE) { e.betSize = 0; return false; }
    if (portfolioExposure.total >= maxTotal) { e.betSize = 0; return false; }
    const actual = Math.min(e.betSize, params.MAX_EXPOSURE_PER_WHALE - we, maxTotal - portfolioExposure.total);
    e.betSize = Math.round(actual * 100) / 100;
    portfolioExposure.total += e.betSize;
    whaleExposure.set(e.whaleAddress, we + e.betSize);
    return true;
  });

  // Resolve markets and compute P&L
  let totalBet  = 0;
  let totalPnl  = 0;
  let wins      = 0;
  let losses    = 0;
  let openCount = 0;
  let skipped   = 0;

  for (const e of cappedEntries) {
    const market = allMarkets.get(e.marketId);
    if (!market) { openCount++; continue; }

    const isSportsHandicap =
      market.tags.some(t => SPORTS_TAGS.includes(t.toLowerCase())) &&
      /\bO\/U\b|^Spread:|Spread\s[-+]/i.test(market.title);
    if (isSportsHandicap) { skipped++; continue; }

    if (!market.closed) {
      if (!market.endDateIso) { skipped++; continue; }
      const hoursToEnd = (new Date(market.endDateIso).getTime() - Date.now()) / (1000 * 3600);
      if (hoursToEnd > params.MAX_MARKET_DURATION_H) { skipped++; continue; }
      openCount++;
      continue;
    }

    const tok =
      market.tokens.find(t => t.outcome.toLowerCase() === e.outcome.toLowerCase()) ??
      market.tokens[0];

    e.closed = true;
    e.won    = tok ? (tok.winner === true || tok.price >= 0.99) : false;
    e.pnl    = Math.round(((e.won ? 1 : 0) - e.entryPrice) * e.betSize * 100) / 100;

    totalBet += e.betSize;
    totalPnl += e.pnl;
    if (e.won) wins++; else losses++;
  }

  const roi = totalBet > 0 ? Math.round((totalPnl / totalBet) * 1000) / 10 : null;

  return {
    roi,
    totalBet:    Math.round(totalBet * 100) / 100,
    totalPnl:    Math.round(totalPnl * 100) / 100,
    resolved:    wins + losses,
    wins,
    losses,
    totalTrades: cappedEntries.length,
    open:        openCount,
    skipped,
  };
}
