import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchLeaderboard } from "@/lib/polymarket";
import { FILTERS } from "@/lib/scoring";

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

    const wallets = raw
      .map((w) => ({
        address:   String(w.proxyWallet ?? w.proxyWalletAddress ?? w.address ?? ""),
        user_name: String(w.userName ?? w.name ?? ""),
        profit:    Number(w.pnl ?? w.profit ?? 0),
        volume:    Number(w.vol ?? w.volume ?? 0),
      }))
      .filter((c) => c.address && c.profit >= FILTERS.MIN_PROFIT_USDC);

    if (!wallets.length) {
      return NextResponse.json({ ok: false, error: "No wallets returned from leaderboard", ts: new Date().toISOString() });
    }

    const db = getSupabase();

    // Upsert all wallets — whale_wallets table: address (pk), user_name, profit, volume, updated_at
    const { error } = await db.from("whale_wallets").upsert(
      wallets.map((w) => ({ ...w, updated_at: new Date().toISOString() })),
      { onConflict: "address" }
    );

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      saved: wallets.length,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
