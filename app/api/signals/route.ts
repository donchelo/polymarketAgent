import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const revalidate = 0;

const BANKROLL         = 100;
const MAX_EXPOSURE_PCT = 0.80;

export async function GET() {
  const db = getSupabase();

  // All open positions (no arbitrary cap — exposure controls the limit)
  const { data: openSignals, error: openErr } = await db
    .from("signals")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false });

  // Closed/won/lost for P&L history
  const { data: closedSignals, error: closedErr } = await db
    .from("signals")
    .select("*")
    .in("status", ["won", "lost"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (openErr || closedErr) {
    return NextResponse.json({ error: openErr?.message ?? closedErr?.message }, { status: 500 });
  }

  const open   = openSignals  ?? [];
  const closed = closedSignals ?? [];
  const won    = closed.filter((s) => s.status === "won");

  const exposure   = open.reduce((sum, s) => sum + (Number(s.suggested_size_usdc) || 0), 0);
  const totalPnl   = closed.reduce((sum, s) => sum + (s.pnl_usdc ?? 0), 0);
  const winRate    = closed.length ? won.length / closed.length : 0;
  const maxExp     = BANKROLL * MAX_EXPOSURE_PCT;

  return NextResponse.json({
    signals: [...open, ...closed],
    stats: {
      // Portfolio health
      openPositions:   open.length,
      exposure:        Math.round(exposure * 100) / 100,
      maxExposure:     maxExp,
      bankroll:        BANKROLL,
      exposurePct:     Math.round((exposure / BANKROLL) * 100),
      availableCash:   Math.round((maxExp - exposure) * 100) / 100,
      // Performance
      closedPositions: closed.length,
      wins:            won.length,
      losses:          closed.length - won.length,
      winRate:         Math.round(winRate * 100),
      totalPnl:        Math.round(totalPnl * 100) / 100,
    },
  });
}
