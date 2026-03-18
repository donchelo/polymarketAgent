import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchTrades } from "@/lib/polymarket";
import { computeLeaderScore } from "@/lib/leader";

export const maxDuration = 60;

const CLOB_API = "https://clob.polymarket.com";
const BANKROLL            = 100;
const MAX_EXPOSURE_PCT    = 0.80;
const MAX_EXPOSURE_PER_WHALE = 15;
const MIN_SIZE            = 0.50;
const MAX_SIZE            = 5.00;
const WIN_RATE_PROXY      = 0.52;
const MIN_PRICE           = 0.08;  // skip near-certain outcomes
const MAX_PRICE           = 0.92;
const TOP_WHALES          = 10;
const MIN_SCORE           = 50;
const MIN_TRADES_PER_DAY  = 1.5;

function kellySize(price: number, winRate: number, score: number): number {
  if (price <= 0 || price >= 1) return 0;
  const edge = winRate - price;
  if (edge <= 0) return 0;
  const f         = edge / (1 - price);
  const scoreMult = 0.8 + Math.min(Math.max(score - 40, 0) / 125, 0.4);
  const size      = f * 0.25 * scoreMult * BANKROLL;
  return Math.min(Math.max(size, MIN_SIZE), MAX_SIZE);
}

async function fetchMarketResult(marketId: string): Promise<{
  title: string;
  closed: boolean;
  tokens: Array<{ outcome: string; price: number; winner?: boolean }>;
  tags: string[];
  endDateIso: string | null;
} | null> {
  try {
    const r = await fetch(`${CLOB_API}/markets/${marketId}`,
      { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!r.ok) return null;
    const m = await r.json();
    if (!m || m.condition_id !== marketId) return null;
    return {
      title:      String(m.question ?? ""),
      closed:     m.closed === true,
      tokens:     m.tokens ?? [],
      tags:       m.tags ?? [],
      endDateIso: m.end_date_iso ?? m.game_start_time ?? null,
    };
  } catch { return null; }
}

export async function GET(req: Request) {
  const url      = new URL(req.url);
  // lookback window: default yesterday (24h–48h ago)
  const windowEndH   = Number(url.searchParams.get("endH")   ?? 24);  // hours ago
  const windowStartH = Number(url.searchParams.get("startH") ?? 48);  // hours ago

  const nowSec       = Date.now() / 1000;
  const windowStart  = nowSec - windowStartH * 3600;
  const windowEnd    = nowSec - windowEndH   * 3600;

  const db = getSupabase();

  // Load top qualifying whales
  const { data: dbWhales } = await db
    .from("whale_wallets")
    .select("address, user_name, score, trades_per_day, win_rate, real_win_rate, pct_short_term")
    .gte("score", MIN_SCORE)
    .gte("trades_per_day", MIN_TRADES_PER_DAY)
    .order("score", { ascending: false })
    .limit(TOP_WHALES * 3);

  if (!dbWhales?.length) {
    return NextResponse.json({ error: "No hay whales en DB. Ejecuta refresh-leaderboard primero." }, { status: 400 });
  }

  const whales = dbWhales
    .map(w => ({
      address:      w.address,
      userName:     w.user_name ?? w.address.slice(0, 8),
      score:        Number(w.score ?? 0),
      tradesPerDay: Number(w.trades_per_day ?? 0),
      winRate:      Number(w.real_win_rate ?? w.win_rate ?? WIN_RATE_PROXY),
      compositeScore: computeLeaderScore({
        score:          Number(w.score ?? 0),
        trades_per_day: Number(w.trades_per_day ?? 0),
        win_rate:       Number(w.win_rate ?? WIN_RATE_PROXY),
        real_win_rate:  w.real_win_rate != null ? Number(w.real_win_rate) : null,
        pct_short_term: w.pct_short_term != null ? Number(w.pct_short_term) : null,
      }),
    }))
    .sort((a, b) => b.compositeScore - a.compositeScore)
    .slice(0, TOP_WHALES);

  // Fetch trades for all whales in parallel
  const tradeResults = await Promise.allSettled(
    whales.map(w => fetchTrades(w.address, 200))
  );

  // Collect qualifying entries: (market+outcome) → first qualifying entry wins
  // Simulate the dedup logic: one signal per (whale × market × outcome)
  type Entry = {
    whaleAddress:  string;
    whaleName:     string;
    whaleScore:    number;
    whaleWinRate:  number;
    marketId:      string;
    outcome:       string;
    entryPrice:    number;
    whaleSize:     number;
    betSize:       number;
    tradeTs:       number;
    // filled after market resolution check:
    marketTitle:   string;
    closed:        boolean;
    won:           boolean | null;  // null = still open or unresolvable
    exitPrice:     number | null;
    pnl:           number | null;
  };

  const rawEntries: Entry[] = [];
  const seenPerWhale = new Set<string>(); // dedupe per whale+market+outcome

  for (let i = 0; i < whales.length; i++) {
    const whale  = whales[i];
    const result = tradeResults[i];
    if (result.status !== "fulfilled") continue;

    const trades = result.value as Record<string, unknown>[];

    for (const t of trades) {
      const ts = typeof (t.timestamp ?? t.time) === "string"
        ? parseFloat(String(t.timestamp ?? t.time))
        : Number(t.timestamp ?? t.time ?? 0);

      // Only trades in the simulation window
      if (ts < windowStart || ts > windowEnd) continue;

      const marketId = String(t.conditionId ?? t.market ?? t.marketId ?? "");
      const outcome  = String(t.outcome ?? "").toUpperCase();
      const price    = Number(t.price ?? t.avgPrice ?? 0);
      // Skip near-certain outcomes — market already decided, no real edge
      if (!marketId || !outcome || price < MIN_PRICE || price > MAX_PRICE) continue;

      const key = `${whale.address}|${marketId}|${outcome}`;
      if (seenPerWhale.has(key)) continue; // take first entry only
      seenPerWhale.add(key);

      const betSize = kellySize(price, whale.winRate, whale.score);

      rawEntries.push({
        whaleAddress: whale.address,
        whaleName:    whale.userName,
        whaleScore:   whale.score,
        whaleWinRate: whale.winRate,
        marketId,
        outcome,
        entryPrice:   price,
        whaleSize:    Number(t.size ?? 0),
        betSize,
        tradeTs:      ts,
        marketTitle:  "",
        closed:       false,
        won:          null,
        exitPrice:    null,
        pnl:          null,
      });
    }
  }

  // Sort by timestamp (oldest first = order we would have entered)
  rawEntries.sort((a, b) => a.tradeTs - b.tradeTs);

  // Apply portfolio caps (simulate exactly as the real scan does)
  const portfolioExposure = { total: 0 };
  const whaleExposure     = new Map<string, number>();
  const maxTotal          = BANKROLL * MAX_EXPOSURE_PCT;

  const cappedEntries = rawEntries.filter(e => {
    const we = whaleExposure.get(e.whaleAddress) ?? 0;
    if (we >= MAX_EXPOSURE_PER_WHALE) { e.betSize = 0; return false; }
    if (portfolioExposure.total >= maxTotal) { e.betSize = 0; return false; }
    const actual = Math.min(e.betSize, MAX_EXPOSURE_PER_WHALE - we, maxTotal - portfolioExposure.total);
    e.betSize = Math.round(actual * 100) / 100;
    portfolioExposure.total += e.betSize;
    whaleExposure.set(e.whaleAddress, we + e.betSize);
    return true;
  });

  // Resolve markets in parallel (fetch CLOB once per unique market)
  const uniqueMarkets = Array.from(new Set(cappedEntries.map(e => e.marketId)));
  const marketData    = new Map<string, Awaited<ReturnType<typeof fetchMarketResult>>>();

  await Promise.allSettled(
    uniqueMarkets.map(async id => {
      const data = await fetchMarketResult(id);
      marketData.set(id, data);
    })
  );

  // Apply results
  let totalBet  = 0;
  let totalPnl  = 0;
  let wins      = 0;
  let losses    = 0;
  let openCount = 0;
  let skipped   = 0; // filtered by duration (still open → likely >24h at time of trade)

  const entries = cappedEntries.map(e => {
    const market = marketData.get(e.marketId);
    e.marketTitle = market?.title ?? e.marketId.slice(0, 40);

    if (!market) {
      openCount++;
      return e;
    }

    // Check if this would have passed the ≤24h duration filter at time of trade.
    // Heuristic: if the market is still open now AND endDate is far future → was too long.
    if (!market.closed) {
      if (market.endDateIso) {
        const hoursToEnd = (new Date(market.endDateIso).getTime() - Date.now()) / (1000 * 3600);
        if (hoursToEnd > 24) {
          // Likely was also >24h at trade time → would have been skipped
          e.betSize = 0;
          skipped++;
          return e;
        }
      }
      openCount++;
      return e;
    }

    // Market is closed → determine winner
    const tok = market.tokens.find(
      t => t.outcome.toLowerCase() === e.outcome.toLowerCase()
    ) ?? market.tokens[0];

    e.closed    = true;
    e.won       = tok ? (tok.winner === true || tok.price >= 0.99) : false;
    e.exitPrice = e.won ? 1 : 0;
    e.pnl       = Math.round((e.exitPrice - e.entryPrice) * e.betSize * 100) / 100;

    totalBet += e.betSize;
    totalPnl += e.pnl;
    if (e.won) wins++; else losses++;

    return e;
  });

  // Per-whale summary
  const whaleSummary = whales.map(w => {
    const we      = entries.filter(e => e.whaleAddress === w.address && e.closed);
    const wOpen   = entries.filter(e => e.whaleAddress === w.address && !e.closed && e.betSize > 0);
    const wWins   = we.filter(e => e.won).length;
    const wPnl    = we.reduce((s, e) => s + (e.pnl ?? 0), 0);
    const wBet    = we.reduce((s, e) => s + e.betSize, 0);
    return {
      name:         w.userName,
      composite:    Math.round(w.compositeScore * 100) / 100,
      winRate:      Math.round(w.winRate * 100),
      signals:      we.length,
      openSignals:  wOpen.length,
      wins:         wWins,
      losses:       we.length - wWins,
      totalBet:     Math.round(wBet * 100) / 100,
      pnl:          Math.round(wPnl * 100) / 100,
      roi:          wBet > 0 ? Math.round((wPnl / wBet) * 100) : null,
    };
  }).filter(w => w.signals > 0 || w.openSignals > 0);

  const roi = totalBet > 0 ? Math.round((totalPnl / totalBet) * 1000) / 10 : null;

  return NextResponse.json({
    period: {
      from: new Date(windowStart * 1000).toISOString(),
      to:   new Date(windowEnd   * 1000).toISOString(),
      label: `últimas ${windowStartH}h–${windowEndH}h`,
    },
    config: {
      bankroll:   BANKROLL,
      maxExposure: maxTotal,
      whalesMonitored: whales.length,
      topWhales: whales.map(w => ({ name: w.userName, composite: w.compositeScore.toFixed(2) })),
    },
    summary: {
      totalTrades:  cappedEntries.length,
      skippedLong:  skipped,
      resolved:     wins + losses,
      open:         openCount,
      wins,
      losses,
      winRate:      wins + losses > 0 ? Math.round(wins / (wins + losses) * 100) : null,
      totalBet:     Math.round(totalBet * 100) / 100,
      totalPnl:     Math.round(totalPnl * 100) / 100,
      roi,
      maxExposureReached: portfolioExposure.total >= maxTotal * 0.95,
    },
    byWhale:  whaleSummary,
    entries:  entries.filter(e => e.betSize > 0).map(e => ({
      whale:       e.whaleName,
      market:      e.marketTitle.slice(0, 70),
      outcome:     e.outcome,
      price:       e.entryPrice,
      bet:         e.betSize,
      status:      e.won === null ? "open" : e.won ? "won" : "lost",
      pnl:         e.pnl,
      ts:          new Date(e.tradeTs * 1000).toISOString(),
    })),
    computedAt: new Date().toISOString(),
  });
}
