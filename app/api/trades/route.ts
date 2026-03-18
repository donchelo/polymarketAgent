import { NextRequest, NextResponse } from "next/server";
import { fetchTrades } from "@/lib/polymarket";

export const revalidate = 300; // 5 minutes

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) {
    return NextResponse.json({ error: "address param required" }, { status: 400 });
  }

  try {
    const raw = await fetchTrades(address, 20);
    const trades = raw.map((t) => ({
      id:          String(t.id ?? ""),
      marketId:    String(t.conditionId ?? t.market ?? t.marketId ?? ""),
      outcome:     String(t.outcome ?? t.side ?? ""),
      size:        Number(t.size ?? 0),
      price:       Number(t.price ?? 0),
      timestamp:   t.timestamp ?? t.created_at ?? t.time ?? null,
      marketTitle: String(t.title ?? t.marketTitle ?? ""),
    }));

    return NextResponse.json({ trades });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
