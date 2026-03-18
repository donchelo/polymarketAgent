import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const revalidate = 0;

const BANKROLL = 100;
const MAX_OPEN = 20;

export async function GET() {
  const db = getSupabase();

  // Open positions (limited to MAX_OPEN, most recent first)
  const { data: openSignals, error: openErr } = await db
    .from("signals")
    .select("*")
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(MAX_OPEN);

  // Closed/resolved signals for stats (last 200)
  const { data: closedSignals, error: closedErr } = await db
    .from("signals")
    .select("*")
    .neq("status", "open")
    .neq("status", "expired")
    .order("created_at", { ascending: false })
    .limit(200);

  if (openErr || closedErr) {
    const msg = openErr?.message ?? closedErr?.message ?? "unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const open   = openSignals ?? [];
  const closed = closedSignals ?? [];
  const won    = closed.filter((s) => s.status === "won");
  const totalPnl  = closed.reduce((acc, s) => acc + (s.pnl_usdc ?? 0), 0);
  const winRate   = closed.length ? won.length / closed.length : 0;
  const exposure  = open.reduce((acc, s) => acc + (s.suggested_size_usdc ?? 0), 0);

  return NextResponse.json({
    signals: [...open, ...closed],
    stats: {
      totalOpen:       open.length,
      maxOpen:         MAX_OPEN,
      slotsAvailable:  MAX_OPEN - open.length,
      exposure:        Math.round(exposure * 100) / 100,
      bankroll:        BANKROLL,
      exposurePct:     Math.round((exposure / BANKROLL) * 100),
      closedPositions: closed.length,
      wins:            won.length,
      losses:          closed.length - won.length,
      winRate:         Math.round(winRate * 100),
      totalPnl:        Math.round(totalPnl * 100) / 100,
    },
  });
}
