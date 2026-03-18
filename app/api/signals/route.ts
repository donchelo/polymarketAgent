import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export const revalidate = 0;

export async function GET() {
  const { data: signals, error } = await getSupabase()
    .from("signals")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const open     = signals?.filter((s) => s.status === "open") ?? [];
  const closed   = signals?.filter((s) => s.status !== "open") ?? [];
  const won      = closed.filter((s) => s.status === "won");
  const totalPnl = closed.reduce((acc, s) => acc + (s.pnl_usdc ?? 0), 0);
  const winRate  = closed.length ? won.length / closed.length : 0;

  return NextResponse.json({
    signals: signals ?? [],
    stats: {
      totalSignals:    signals?.length ?? 0,
      openPositions:   open.length,
      closedPositions: closed.length,
      wins:            won.length,
      losses:          closed.length - won.length,
      winRate:         Math.round(winRate * 100),
      totalPnl:        Math.round(totalPnl * 100) / 100,
    },
  });
}
