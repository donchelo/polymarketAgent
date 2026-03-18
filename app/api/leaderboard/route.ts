import { NextResponse } from "next/server";
import { fetchLeaderboard, fetchTrades } from "@/lib/polymarket";
import { computeActivityMetrics, computeScore, FILTERS } from "@/lib/scoring";
import type { WalletProfile } from "@/lib/types";

export const revalidate = 1800; // 30 min
export const maxDuration = 60;  // Vercel hobby max

export async function GET() {
  try {
    const raw = await fetchLeaderboard(200);

    if (!raw.length) {
      return NextResponse.json({ error: "Polymarket API returned empty data" }, { status: 502 });
    }

    // First pass: basic filters — flexible field names
    const candidates: Array<{
      address: string;
      profit: number;
      volume: number;
      tradesCount: number;
      winRate: number;
    }> = [];

    for (const w of raw) {
      // Handle all known field name variants from Polymarket API
      const profit      = Number(w.profit ?? w.pnl ?? w.totalProfit ?? 0);
      const tradesCount = Number(w.tradesCount ?? w.trades_count ?? w.numTrades ?? w.trades ?? 0);
      const winRate     = Number(w.winRate ?? w.win_rate ?? w.winRatio ?? 0);
      const address     = String(w.address ?? w.id ?? w.userId ?? "");
      const volume      = Number(w.volume ?? w.totalVolume ?? 0);

      if (!address) continue;

      // Relaxed filters — apply strict ones after activity analysis
      if (profit < FILTERS.MIN_PROFIT_USDC) continue;
      if (tradesCount < FILTERS.MIN_TRADES) continue;
      if (winRate < FILTERS.MIN_WIN_RATE) continue;

      candidates.push({ address, profit, volume, tradesCount, winRate });
    }

    // Second pass: activity analysis — limit to 20 candidates to avoid timeout
    const qualified: WalletProfile[] = [];
    const limit = Math.min(candidates.length, 20);

    for (let i = 0; i < limit; i++) {
      const c = candidates[i];
      try {
        const tradeHistory = await fetchTrades(c.address, 100);
        const activity = computeActivityMetrics(
          tradeHistory as Parameters<typeof computeActivityMetrics>[0]
        );

        if (activity.isBot) continue;
        if (activity.daysSinceActive > FILTERS.MAX_ACTIVE_DAYS_AGO) continue;
        if (activity.tradesPerDay < FILTERS.MIN_TRADES_PER_DAY) continue;
        if (activity.uniqueMarkets < FILTERS.MIN_UNIQUE_MARKETS) continue;

        const score = computeScore({
          profit: c.profit,
          winRate: c.winRate,
          tradesPerDay: activity.tradesPerDay,
          uniqueMarkets: activity.uniqueMarkets,
          daysSinceActive: activity.daysSinceActive,
        });

        qualified.push({
          address: c.address,
          profit: c.profit,
          volume: c.volume,
          tradesCount: c.tradesCount,
          winRate: c.winRate,
          tradesPerDay: activity.tradesPerDay,
          uniqueMarkets: activity.uniqueMarkets,
          daysSinceActive: Math.round(activity.daysSinceActive),
          score,
        });
      } catch {
        // Skip wallets where trade fetch fails
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
