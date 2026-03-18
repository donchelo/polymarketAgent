import { NextResponse } from "next/server";

// Debug endpoint — probes multiple Polymarket API paths to find what works
export const revalidate = 0;
export const maxDuration = 30;

const ENDPOINTS = [
  "https://data-api.polymarket.com/profiles?limit=3&sortBy=profit&ascending=false",
  "https://data-api.polymarket.com/leaderboard?limit=3",
  "https://data-api.polymarket.com/users?limit=3&sortBy=profit",
  "https://gamma-api.polymarket.com/profiles?limit=3",
  "https://data-api.polymarket.com/profile?limit=3&sortBy=profit&ascending=false",
];

export async function GET() {
  const results: Record<string, unknown> = {};

  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0",
        },
        cache: "no-store",
      });
      const text = await res.text();
      let parsed: unknown = text;
      try { parsed = JSON.parse(text); } catch { /* keep as text */ }

      // Only show first 2 items if array
      if (Array.isArray(parsed)) parsed = parsed.slice(0, 2);
      results[url] = { status: res.status, data: parsed };
    } catch (err) {
      results[url] = { error: String(err) };
    }
  }

  return NextResponse.json(results);
}
