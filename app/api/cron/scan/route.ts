import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchLeaderboard, fetchTrades, fetchPositions } from "@/lib/polymarket";
import { computeActivityMetrics, computeScore, FILTERS } from "@/lib/scoring";

export const maxDuration = 60;

const BANKROLL = 100; // USD paper trading bankroll
const MAX_PCT  = 0.02; // max 2% per trade

function kellySize(price: number, winRate: number): number {
  if (price <= 0 || price >= 1) return 0;
  const odds = (1 - price) / price;
  const edge = winRate - price;
  const f = Math.max((edge * odds - (1 - winRate)) / odds, 0) * 0.25; // quarter-Kelly
  return Math.min(f * BANKROLL, BANKROLL * MAX_PCT);
}

export async function GET(req: NextRequest) {
  // Protect cron endpoint
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // 1. Get top wallets from leaderboard
    const raw = await fetchLeaderboard(100);
    const candidates = raw
      .map((w) => ({
        address:  String(w.proxyWallet ?? w.address ?? ""),
        profit:   Number(w.pnl ?? w.profit ?? 0),
        volume:   Number(w.vol ?? w.volume ?? 0),
        userName: String(w.userName ?? ""),
      }))
      .filter((c) => c.address && c.profit >= FILTERS.MIN_PROFIT_USDC)
      .slice(0, 20); // top 20 to stay within timeout

    let newSignals = 0;
    const log: string[] = [];

    for (const c of candidates) {
      // 2. Fetch trades to compute activity score
      const tradeHistory = await fetchTrades(c.address, 100);
      const activity = computeActivityMetrics(
        tradeHistory as Parameters<typeof computeActivityMetrics>[0]
      );

      if (
        activity.isBot ||
        activity.daysSinceActive > FILTERS.MAX_ACTIVE_DAYS_AGO ||
        activity.tradesPerDay < FILTERS.MIN_TRADES_PER_DAY ||
        activity.uniqueMarkets < FILTERS.MIN_UNIQUE_MARKETS ||
        tradeHistory.length < FILTERS.MIN_TRADES
      ) continue;

      const score = computeScore({
        profit: c.profit,
        winRate: 0.55,
        tradesPerDay: activity.tradesPerDay,
        uniqueMarkets: activity.uniqueMarkets,
        daysSinceActive: activity.daysSinceActive,
      });

      if (score < 40) continue; // only track quality wallets

      // 3. Fetch current positions
      const rawPositions = await fetchPositions(c.address);

      for (const p of rawPositions) {
        const marketId = String(p.conditionId ?? p.marketId ?? "");
        const outcome  = String(p.outcome ?? "");
        const size     = Number(p.size ?? p.currentValue ?? 0);
        const price    = Number(p.avgPrice ?? p.averagePrice ?? p.price ?? 0);

        if (!marketId || !outcome || size <= 0) continue;

        // 4. Check if this position already exists in our snapshot
        const db = getSupabase();
        const { data: existing } = await db
          .from("position_snapshots")
          .select("id")
          .eq("whale_address", c.address)
          .eq("market_id", marketId)
          .eq("outcome", outcome)
          .single();

        if (existing) {
          await db
            .from("position_snapshots")
            .update({ size, avg_price: price })
            .eq("whale_address", c.address)
            .eq("market_id", marketId)
            .eq("outcome", outcome);
          continue;
        }

        // 5. NEW position detected → create signal
        const suggestedSize = Math.max(kellySize(price, 0.55), 1);

        await getSupabase().from("position_snapshots").upsert({
          whale_address: c.address,
          market_id: marketId,
          outcome,
          size,
          avg_price: price,
        });

        await getSupabase().from("signals").insert({
          whale_address:       c.address,
          whale_score:         score,
          whale_trades_per_day: activity.tradesPerDay,
          market_id:           marketId,
          market_title:        String(p.title ?? p.marketTitle ?? ""),
          outcome,
          whale_size_usdc:     size,
          entry_price:         price,
          suggested_size_usdc: Math.round(suggestedSize * 100) / 100,
          status:              "open",
        });

        newSignals++;
        log.push(`NEW: ${c.userName || c.address.slice(0, 8)} → ${outcome} @ ${price.toFixed(3)} ($${suggestedSize.toFixed(2)} paper)`);
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: candidates.length,
      newSignals,
      log,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
