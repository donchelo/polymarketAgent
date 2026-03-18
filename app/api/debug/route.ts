import { NextResponse } from "next/server";

// Debug: verify new Polymarket API endpoints
export const revalidate = 0;
export const maxDuration = 30;

export async function GET() {
  const headers = {
    Accept: "application/json",
    "User-Agent": "Mozilla/5.0",
  };

  async function probe(url: string) {
    try {
      const res = await fetch(url, { headers, cache: "no-store" });
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep as text */ }
      if (Array.isArray(parsed)) parsed = (parsed as unknown[]).slice(0, 2);
      return { status: res.status, data: parsed };
    } catch (err) {
      return { error: String(err) };
    }
  }

  const [leaderboard, positions, trades] = await Promise.all([
    probe("https://data-api.polymarket.com/v1/leaderboard?limit=3&orderBy=PNL&timePeriod=MONTH&category=OVERALL"),
    probe("https://data-api.polymarket.com/positions?user=0x56687bf447db6ffa42ffe2204a05edaa20f55839"),
    probe("https://data-api.polymarket.com/trades?user=0x56687bf447db6ffa42ffe2204a05edaa20f55839&limit=2"),
  ]);

  return NextResponse.json({ leaderboard, positions, trades });
}
