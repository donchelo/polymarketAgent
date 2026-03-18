import { NextRequest, NextResponse } from "next/server";
import { fetchPositions } from "@/lib/polymarket";
import type { Position } from "@/lib/types";

export const revalidate = 120; // 2 minutes

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address param required" }, { status: 400 });
  }

  try {
    const raw = await fetchPositions(address);

    const positions: Position[] = raw
      .map((p) => {
        const marketId = String(p.conditionId ?? p.market ?? p.marketId ?? "");
        const outcome  = String(p.outcome ?? p.side ?? "");
        const size     = Number(p.size ?? p.currentValue ?? 0);
        const avgPrice = Number(p.avgPrice ?? p.averagePrice ?? p.price ?? 0);
        return { marketId, outcome, size, avgPrice };
      })
      .filter((p) => p.marketId && p.outcome && p.size > 0);

    return NextResponse.json({ positions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
