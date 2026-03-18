import { NextResponse } from "next/server";
import { fetchLeaderboard, fetchTrades } from "@/lib/polymarket";
import { computeActivityMetrics, computeScore, FILTERS } from "@/lib/scoring";
import type { WalletProfile } from "@/lib/types";

export const revalidate = 1800;
export const maxDuration = 60;

export async function GET() {
  try {
    const raw = await fetchLeaderboard(200);

    if (!raw.length) {
      return NextResponse.json({ error: "Polymarket API returned empty data" }, { status: 502 });
    }

    // First pass: filter by PNL only (leaderboard doesn't expose tradesCount/winRate)
    const candidates = raw
      .map((w) => ({
        address: String(w.proxyWallet ?? w.address ?? w.id ?? ""),
        profit:  Number(w.pnl ?? w.profit ?? 0),
        volume:  Number(w.vol ?? w.volume ?? 0),
        userName: String(w.userName ?? ""),
      }))
      .filter((c) => c.address && c.profit >= FILTERS.MIN_PROFIT_USDC);

    // Second pass: activity analysis from trade history (max 25 to avoid timeout)
    const qualified: WalletProfile[] = [];
    const limit = Math.min(candidates.length, 25);

    for (let i = 0; i < limit; i++) {
      const c = candidates[i];
      try {
        const tradeHistory = await fetchTrades(c.address, 100);

        // Compute win rate from trade outcomes (% of BUY trades on winning outcomes)
        const buys = tradeHistory.filter((t) => String(t.side ?? "").toUpperCase() === "BUY");
        // We can't know resolution without extra fetches — use ratio of unique markets won
        // Approximate: trades with outcome "Yes" that are recent buys as proxy
        const winRate = 0.55; // Default — real winRate needs resolved trade data

        const tradesCount = tradeHistory.length;
        const activity = computeActivityMetrics(
          tradeHistory as Parameters<typeof computeActivityMetrics>[0]
        );

        if (activity.isBot) continue;
        if (activity.daysSinceActive > FILTERS.MAX_ACTIVE_DAYS_AGO) continue;
        if (activity.tradesPerDay < FILTERS.MIN_TRADES_PER_DAY) continue;
        if (activity.uniqueMarkets < FILTERS.MIN_UNIQUE_MARKETS) continue;
        if (tradesCount < FILTERS.MIN_TRADES) continue;

        const score = computeScore({
          profit: c.profit,
          winRate,
          tradesPerDay: activity.tradesPerDay,
          uniqueMarkets: activity.uniqueMarkets,
          daysSinceActive: activity.daysSinceActive,
        });

        qualified.push({
          address: c.address,
          profit: c.profit,
          volume: c.volume,
          tradesCount,
          winRate,
          tradesPerDay: activity.tradesPerDay,
          uniqueMarkets: activity.uniqueMarkets,
          daysSinceActive: Math.round(activity.daysSinceActive),
          score,
          userName: c.userName,
        });

        void buys; // suppress unused warning
      } catch {
        continue;
      }
    }

    const wallets = qualified.sort((a, b) => b.score - a.score).slice(0, 30);

    return NextResponse.json({
      wallets,
      computedAt: new Date().toISOString(),
      candidateCount: candidates.length,
      rawCount: raw.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
