import { NextResponse } from "next/server";
import { fetchLeaderboard, fetchTrades } from "@/lib/polymarket";
import { computeActivityMetrics, computeScore, FILTERS } from "@/lib/scoring";
import type { WalletProfile } from "@/lib/types";

export const revalidate = 1800; // 30 minutes — heavy N+1 fetches

export async function GET() {
  try {
    const raw = await fetchLeaderboard(200);

    // First pass: basic filters
    const candidates: Array<{
      address: string;
      profit: number;
      volume: number;
      tradesCount: number;
      winRate: number;
    }> = [];

    for (const w of raw) {
      const profit     = Number(w.profit ?? 0);
      const tradesCount = Number(w.tradesCount ?? w.trades_count ?? 0);
      const winRate    = Number(w.winRate ?? w.win_rate ?? 0);
      const address    = String(w.address ?? w.id ?? "");

      if (
        profit < FILTERS.MIN_PROFIT_USDC ||
        tradesCount < FILTERS.MIN_TRADES ||
        winRate < FILTERS.MIN_WIN_RATE ||
        !address
      ) continue;

      candidates.push({
        address,
        profit,
        volume: Number(w.volume ?? 0),
        tradesCount,
        winRate,
      });
    }

    // Second pass: activity analysis (N+1 fetches)
    const qualified: WalletProfile[] = [];

    for (const c of candidates) {
      if (qualified.length >= 40) break;

      const tradeHistory = await fetchTrades(c.address, 100);
      const activity = computeActivityMetrics(tradeHistory as Parameters<typeof computeActivityMetrics>[0]);

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
    }

    const wallets = qualified
      .sort((a, b) => b.score - a.score)
      .slice(0, 30);

    return NextResponse.json({
      wallets,
      computedAt: new Date().toISOString(),
      candidateCount: candidates.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
