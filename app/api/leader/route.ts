import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { computeLeaderScore } from "@/lib/leader";

export const revalidate = 0;

export async function GET() {
  const db = getSupabase();
  const { data } = await db
    .from("leader_config")
    .select("*")
    .eq("id", 1)
    .single();
  return NextResponse.json({ leader: data ?? null });
}

/**
 * POST /api/leader — manually set a wallet as the current leader.
 * Body: { address: string }
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const address = String(body?.address ?? "").trim().toLowerCase();
    if (!address) {
      return NextResponse.json({ error: "Missing address" }, { status: 400 });
    }

    const db = getSupabase();

    // Look up the wallet in whale_wallets
    const { data: whale, error: whaleErr } = await db
      .from("whale_wallets")
      .select("address, user_name, score, trades_per_day, win_rate, real_win_rate, pct_short_term")
      .eq("address", address)
      .single();

    if (whaleErr || !whale) {
      return NextResponse.json({ error: "Wallet not found in whale_wallets" }, { status: 404 });
    }

    const leaderScore = computeLeaderScore({
      score:          Number(whale.score ?? 0),
      trades_per_day: Number(whale.trades_per_day ?? 0),
      win_rate:       Number(whale.win_rate ?? 0.52),
      real_win_rate:  whale.real_win_rate != null ? Number(whale.real_win_rate) : null,
      pct_short_term: whale.pct_short_term != null ? Number(whale.pct_short_term) : null,
    });

    const now = new Date().toISOString();
    const { error: upsertErr } = await db.from("leader_config").upsert({
      id:             1,
      address:        whale.address,
      user_name:      whale.user_name,
      score:          whale.score,
      trades_per_day: whale.trades_per_day,
      win_rate:       whale.real_win_rate ?? whale.win_rate,
      leader_score:   leaderScore,
      selected_at:    now,
    });

    if (upsertErr) {
      return NextResponse.json({ error: upsertErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok:           true,
      leader:       whale.user_name ?? address.slice(0, 8),
      address:      whale.address,
      leader_score: Math.round(leaderScore * 100) / 100,
      selected_at:  now,
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
