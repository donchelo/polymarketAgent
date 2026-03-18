import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchLeaderboard, fetchTrades } from "@/lib/polymarket";
import { computeActivityMetrics, computeScore, FILTERS } from "@/lib/scoring";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  // Auth: same pattern as scan cron
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // Fetch up to 200 wallets from leaderboard
    const raw = await fetchLeaderboard(200);

    const candidates = raw
      .map((w) => ({
        address:   String(w.proxyWallet ?? w.proxyWalletAddress ?? w.address ?? ""),
        user_name: String(w.userName ?? w.name ?? ""),
        profit:    Number(w.pnl ?? w.profit ?? 0),
        volume:    Number(w.vol ?? w.volume ?? 0),
      }))
      .filter((c) => c.address && c.profit >= FILTERS.MIN_PROFIT_USDC)
      .slice(0, 100); // top 100 wallets

    if (!candidates.length) {
      return NextResponse.json({ ok: false, error: "No wallets returned from leaderboard", ts: new Date().toISOString() });
    }

    // Score each wallet (fetch trades) — this runs every 30min so timeout is fine
    const wallets = [];
    for (const c of candidates) {
      try {
        const trades = await fetchTrades(c.address, 100);
        const activity = computeActivityMetrics(trades as Parameters<typeof computeActivityMetrics>[0]);
        const score = computeScore({ profit: c.profit, winRate: 0.55, tradesPerDay: activity.tradesPerDay, uniqueMarkets: activity.uniqueMarkets, daysSinceActive: activity.daysSinceActive });
        if (score < 30 || activity.isBot) continue;
        wallets.push({ ...c, score, updated_at: new Date().toISOString() });
      } catch { wallets.push({ ...c, score: 0, updated_at: new Date().toISOString() }); }
    }

    const db = getSupabase();

    const { error } = await db.from("whale_wallets").upsert(wallets, { onConflict: "address" });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      saved: wallets.length,
      scored: wallets.filter((w) => w.score > 0).length,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
