import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { computeLeaderScore } from "@/lib/leader";

export const revalidate = 0;

const BANKROLL         = 100;
const MAX_EXPOSURE_PCT = 0.80;
const WIN_RATE_PROXY   = 0.52;
const NUM_LEADERS      = 3;

export async function GET() {
  const db = getSupabase();

  const [
    { data: openSignals,   error: openErr   },
    { data: closedSignals, error: closedErr },
    { data: topWhales },
  ] = await Promise.all([
    db.from("signals").select("*").eq("status", "open").order("created_at", { ascending: false }),
    db.from("signals").select("*").in("status", ["won", "lost", "whale_exited"])
      .order("created_at", { ascending: false }).limit(200),
    db.from("whale_wallets")
      .select("address, user_name, score, trades_per_day, win_rate, real_win_rate, pct_short_term")
      .gte("score", 40).order("score", { ascending: false }).limit(40),
  ]);

  if (openErr || closedErr) {
    return NextResponse.json({ error: openErr?.message ?? closedErr?.message }, { status: 500 });
  }

  const open   = openSignals   ?? [];
  const closed = closedSignals ?? [];
  const won    = closed.filter((s) => s.status === "won");

  // ── Top-N leaders by composite score ────────────────────────────────────────
  const leaders = (topWhales ?? [])
    .map(w => ({
      address:       w.address,
      user_name:     w.user_name,
      score:         Number(w.score ?? 0),
      trades_per_day: Number(w.trades_per_day ?? 0),
      win_rate:      Number(w.win_rate ?? WIN_RATE_PROXY),
      real_win_rate:  w.real_win_rate != null ? Number(w.real_win_rate) : null,
      pct_short_term: w.pct_short_term != null ? Number(w.pct_short_term) : null,
      leader_score:  computeLeaderScore({
        score:          Number(w.score ?? 0),
        trades_per_day: Number(w.trades_per_day ?? 0),
        win_rate:       Number(w.win_rate ?? WIN_RATE_PROXY),
        real_win_rate:  w.real_win_rate != null ? Number(w.real_win_rate) : null,
        pct_short_term: w.pct_short_term != null ? Number(w.pct_short_term) : null,
      }),
    }))
    .sort((a, b) => b.leader_score - a.leader_score)
    .slice(0, NUM_LEADERS)
    .map((w, i) => ({ ...w, rank: i + 1 }));

  // ── Equity curve (cumulative P&L ascending by date) ─────────────────────────
  const sortedClosed = [...closed]
    .filter(s => s.pnl_usdc != null)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  let running = 0;
  const equityCurve = sortedClosed.map(s => {
    running += s.pnl_usdc ?? 0;
    return { ts: s.created_at, cumPnl: Math.round(running * 100) / 100 };
  });

  // ── Stats ────────────────────────────────────────────────────────────────────
  const exposure = open.reduce((sum, s) => sum + (Number(s.suggested_size_usdc) || 0), 0);
  const totalPnl = closed.reduce((sum, s) => sum + (s.pnl_usdc ?? 0), 0);
  const maxExp   = BANKROLL * MAX_EXPOSURE_PCT;
  const totalBet = closed.reduce((sum, s) => sum + (Number(s.suggested_size_usdc) || 0), 0);

  return NextResponse.json({
    signals: [...open, ...closed],
    stats: {
      openPositions:   open.length,
      exposure:        Math.round(exposure * 100) / 100,
      maxExposure:     maxExp,
      bankroll:        BANKROLL,
      exposurePct:     Math.round((exposure / BANKROLL) * 100),
      availableCash:   Math.round((maxExp - exposure) * 100) / 100,
      closedPositions: closed.length,
      wins:            won.length,
      losses:          closed.length - won.length,
      winRate:         closed.length ? Math.round(won.length / closed.length * 100) : 0,
      totalPnl:        Math.round(totalPnl * 100) / 100,
      roi:             totalBet > 0 ? Math.round((totalPnl / totalBet) * 1000) / 10 : null,
    },
    leaders,
    equityCurve,
  });
}
