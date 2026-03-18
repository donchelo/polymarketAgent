import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchTrades } from "@/lib/polymarket";
import { DEFAULT_STRATEGY, PARAM_VARIATIONS, StrategyParams } from "@/lib/strategy";
import { runBacktest, WhaleRecord, MarketInfo } from "@/lib/backtest-engine";

export const maxDuration = 60;

const CLOB_API = "https://clob.polymarket.com";

// Three non-overlapping windows to test consistency
const WINDOWS = [
  { label: "Ayer",     startH: 48,  endH: 24 },
  { label: "Anteayer", startH: 72,  endH: 48 },
  { label: "Semana",   startH: 168, endH: 0  },
];

async function fetchMarketInfo(marketId: string): Promise<MarketInfo | null> {
  try {
    const r = await fetch(`${CLOB_API}/markets/${marketId}`,
      { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!r.ok) return null;
    const m = await r.json();
    if (!m || m.condition_id !== marketId) return null;
    return {
      title:      String(m.question ?? ""),
      closed:     m.closed === true,
      tokens:     m.tokens ?? [],
      tags:       m.tags ?? [],
      endDateIso: m.end_date_iso ?? m.game_start_time ?? null,
    };
  } catch { return null; }
}

// score = avgROI × sigFactor × (1 + consistencyBonus)
// sigFactor rewards statistical significance (more resolved trades = more trustworthy)
// consistencyBonus = 0.5 if all windows are profitable
function scoreStrategy(windows: Array<{ roi: number | null; resolved: number }>): number {
  const rois = windows.map(w => w.roi ?? -50);
  const avgRoi = rois.reduce((a, b) => a + b, 0) / rois.length;
  const totalResolved = windows.reduce((s, w) => s + w.resolved, 0);
  const sigFactor = 1 + Math.log(Math.max(1, totalResolved)) / 10;
  const allPositive = rois.every(r => r > 0);
  const consistencyBonus = allPositive ? 0.5 : 0;
  return avgRoi * sigFactor * (1 + consistencyBonus);
}

export async function GET() {
  const nowSec = Date.now() / 1000;
  const db = getSupabase();

  // Load generous pool of whales — each variation will filter down from here
  const { data: dbWhales } = await db
    .from("whale_wallets")
    .select("address, user_name, score, trades_per_day, win_rate, real_win_rate, pct_short_term")
    .gte("score", 30)
    .gte("trades_per_day", 0.5)
    .order("score", { ascending: false })
    .limit(30);

  if (!dbWhales?.length) {
    return NextResponse.json({ error: "No hay whales en DB. Ejecuta refresh-leaderboard primero." }, { status: 400 });
  }

  // Fetch trades for all whales in parallel
  const tradeResults = await Promise.allSettled(
    dbWhales.map(w => fetchTrades(w.address, 200))
  );

  const allTrades = new Map<string, Record<string, unknown>[]>();
  for (let i = 0; i < dbWhales.length; i++) {
    const result = tradeResults[i];
    if (result.status === "fulfilled") {
      allTrades.set(dbWhales[i].address, result.value as Record<string, unknown>[]);
    }
  }

  // Collect all unique market IDs across all whales' trades
  const uniqueMarketIds = new Set<string>();
  Array.from(allTrades.values()).forEach(trades => {
    for (const t of trades) {
      const id = String(t.conditionId ?? t.market ?? t.marketId ?? "");
      if (id) uniqueMarketIds.add(id);
    }
  });

  // Fetch market data once for all unique markets
  const marketResults = await Promise.allSettled(
    Array.from(uniqueMarketIds).map(async id => ({ id, data: await fetchMarketInfo(id) }))
  );

  const allMarkets = new Map<string, MarketInfo | null>();
  for (const result of marketResults) {
    if (result.status === "fulfilled") {
      allMarkets.set(result.value.id, result.value.data);
    }
  }

  // Normalize whale records
  const whales: WhaleRecord[] = dbWhales.map(w => ({
    address:       w.address,
    user_name:     w.user_name,
    score:         Number(w.score ?? 0),
    trades_per_day: Number(w.trades_per_day ?? 0),
    win_rate:      Number(w.win_rate ?? 0),
    real_win_rate:  w.real_win_rate != null ? Number(w.real_win_rate) : null,
    pct_short_term: w.pct_short_term != null ? Number(w.pct_short_term) : null,
  }));

  // Run all param variations — pure compute, no I/O
  const experiments = PARAM_VARIATIONS.map((variation, idx) => {
    const params: StrategyParams = { ...DEFAULT_STRATEGY, ...variation };

    const windowResults = WINDOWS.map(w => {
      const startSec = nowSec - w.startH * 3600;
      const endSec   = nowSec - w.endH   * 3600;
      const run = runBacktest(whales, allTrades, allMarkets, params, { startSec, endSec });
      return { label: w.label, ...run };
    });

    const score = scoreStrategy(
      windowResults.map(w => ({ roi: w.roi, resolved: w.resolved }))
    );

    const changedKeys = Object.keys(variation);
    const variationLabel = changedKeys.length === 0
      ? "baseline"
      : changedKeys.map(k => `${k}=${(variation as Record<string, number>)[k]}`).join(", ");

    return {
      idx,
      variation: variationLabel,
      changedParams: variation,
      params,
      windows: windowResults,
      score:          Math.round(score * 1000) / 1000,
      totalResolved:  windowResults.reduce((s, w) => s + w.resolved, 0),
      totalTrades:    windowResults.reduce((s, w) => s + w.totalTrades, 0),
    };
  });

  experiments.sort((a, b) => b.score - a.score);

  return NextResponse.json({
    winner: experiments[0],
    ranked: experiments,
    dataInfo: {
      whalesLoaded:    dbWhales.length,
      marketsTotal:    allMarkets.size,
      marketsClosed:   Array.from(allMarkets.values()).filter(m => m?.closed).length,
      variationsTested: PARAM_VARIATIONS.length,
    },
    computedAt: new Date().toISOString(),
  });
}
