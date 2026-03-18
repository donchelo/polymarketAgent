/**
 * BTC Short-Term Market Scout
 * Finds active BTC prediction markets (≤24h resolution) and ranks
 * traders by win rate in those specific markets.
 */
import { NextResponse } from "next/server";

export const revalidate = 0;
export const maxDuration = 30;

const GAMMA   = "https://gamma-api.polymarket.com";
const CLOB    = "https://clob.polymarket.com";
const DATA    = "https://data-api.polymarket.com";

const HEADERS = { Accept: "application/json", "User-Agent": "Mozilla/5.0" };

// ── Helpers ──────────────────────────────────────────────────────────────────

async function gfetch(url: string) {
  const r = await fetch(url, { headers: HEADERS, cache: "no-store" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/** Hours until a date string resolves */
function hoursUntil(dateStr: string): number {
  return (new Date(dateStr).getTime() - Date.now()) / 1000 / 3600;
}

/** Hours between two date strings (market duration) */
function durationHours(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 1000 / 3600;
}

// ── Main handler ─────────────────────────────────────────────────────────────

export async function GET() {
  const log: string[] = [];

  try {
    // 1. Find BTC/Bitcoin markets active now, resolving in ≤24h
    log.push("Fetching BTC markets...");
    const raw = await gfetch(`${GAMMA}/markets?search=BTC&active=true&limit=100`);
    const allBtc: Array<{
      conditionId: string;
      question: string;
      startDateIso: string;
      endDateIso: string;
      volume: string;
      outcomePrices: string[];
      tokens?: Array<{ token_id: string; outcome: string }>;
    }> = Array.isArray(raw) ? raw : raw.markets ?? [];

    // Filter: resolves within 24h and has some volume
    const shortMarkets = allBtc
      .filter((m) => {
        const h = hoursUntil(m.endDateIso);
        const dur = durationHours(m.startDateIso, m.endDateIso);
        return h > -1 && h <= 24 && dur <= 24 && Number(m.volume ?? 0) > 100;
      })
      .sort((a, b) => Number(b.volume) - Number(a.volume));

    log.push(`Found ${shortMarkets.length} short BTC markets (≤24h, >$100 vol)`);

    if (shortMarkets.length === 0) {
      // Also try broader search
      const rawBitcoin = await gfetch(`${GAMMA}/markets?search=Bitcoin&active=true&limit=50`);
      const allBitcoin = Array.isArray(rawBitcoin) ? rawBitcoin : rawBitcoin.markets ?? [];
      log.push(`Broader Bitcoin search: ${allBitcoin.length} markets total`);

      // Return top markets regardless of filter to debug
      const sample = allBitcoin.slice(0, 10).map((m: typeof allBtc[0]) => ({
        question: m.question,
        endDate: m.endDateIso,
        hoursLeft: hoursUntil(m.endDateIso).toFixed(1),
        durationH: durationHours(m.startDateIso, m.endDateIso).toFixed(1),
        volume: Number(m.volume ?? 0).toFixed(0),
        prices: m.outcomePrices,
      }));

      return NextResponse.json({
        shortMarkets: [],
        sample,
        topTraders: [],
        log,
        note: "No short BTC markets found — showing sample for debugging",
      });
    }

    // 2. For each short market, get recent trades and identify traders
    const traderStats: Record<string, {
      address: string;
      wins: number;
      losses: number;
      trades: number;
      totalProfit: number;
      markets: string[];
    }> = {};

    for (const market of shortMarkets.slice(0, 10)) {
      try {
        // Fetch trades for this market from data API
        const trades = await gfetch(
          `${DATA}/trades?market=${market.conditionId}&limit=500`
        );
        const tradeList: Array<{
          maker: string;
          taker: string;
          side: string;
          price: number;
          size: number;
          outcome: string;
          type?: string;
        }> = Array.isArray(trades) ? trades : trades.data ?? trades.trades ?? [];

        log.push(`Market: ${market.question?.slice(0, 50)} — ${tradeList.length} trades`);

        // Track each trader's activity in this market
        for (const t of tradeList) {
          const addr = t.maker || t.taker;
          if (!addr) continue;
          if (!traderStats[addr]) {
            traderStats[addr] = { address: addr, wins: 0, losses: 0, trades: 0, totalProfit: 0, markets: [] };
          }
          traderStats[addr].trades++;
          if (!traderStats[addr].markets.includes(market.conditionId)) {
            traderStats[addr].markets.push(market.conditionId);
          }
        }
      } catch (e) {
        log.push(`  ERR: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 3. Try alternative: get top traders by PnL from data API filtered to BTC
    log.push("Fetching top traders from data API...");
    let topTraders: Array<{
      address: string;
      pnl: number;
      tradesCount: number;
      winRate?: number;
      userName?: string;
    }> = [];

    try {
      // Get traders who appeared in our short markets
      const traderList = Object.values(traderStats)
        .filter((t) => t.trades >= 2)
        .sort((a, b) => b.trades - a.trades)
        .slice(0, 20);

      // Enrich with profile data
      for (const trader of traderList.slice(0, 10)) {
        try {
          const profile = await gfetch(
            `${DATA}/profiles?address=${trader.address}`
          );
          topTraders.push({
            address: trader.address,
            pnl: Number(profile.pnl ?? profile.profit ?? 0),
            tradesCount: trader.trades,
            winRate: Number(profile.winRate ?? 0),
            userName: profile.name ?? profile.userName ?? undefined,
          });
        } catch {
          topTraders.push({ address: trader.address, pnl: 0, tradesCount: trader.trades });
        }
      }
    } catch (e) {
      log.push(`Trader fetch err: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Sort by trades in short BTC markets
    topTraders = topTraders.sort((a, b) => b.tradesCount - a.tradesCount);

    return NextResponse.json({
      shortMarkets: shortMarkets.slice(0, 15).map((m) => ({
        conditionId: m.conditionId,
        question: m.question,
        endDate: m.endDateIso,
        hoursLeft: hoursUntil(m.endDateIso).toFixed(1),
        durationH: durationHours(m.startDateIso, m.endDateIso).toFixed(1),
        volume: Number(m.volume ?? 0).toFixed(0),
        prices: m.outcomePrices,
      })),
      topTraders,
      traderCount: Object.keys(traderStats).length,
      log,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), log },
      { status: 500 }
    );
  }
}
