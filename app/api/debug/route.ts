import { NextResponse } from "next/server";

// Debug endpoint — shows raw Polymarket API response (first 3 profiles)
// Visit: /api/debug
export const revalidate = 0;
export const maxDuration = 30;

export async function GET() {
  try {
    const res = await fetch(
      "https://data-api.polymarket.com/profiles?limit=3&sortBy=profit&ascending=false",
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "PolymarketWhaleLeaderboard/1.0",
        },
        cache: "no-store",
      }
    );

    const status = res.status;
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { parsed = text; }

    return NextResponse.json({ status, sample: parsed });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
