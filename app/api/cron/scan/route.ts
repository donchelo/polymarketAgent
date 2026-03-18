import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchLeaderboard, fetchTrades, fetchPositions } from "@/lib/polymarket";
import { computeActivityMetrics, computeScore, FILTERS } from "@/lib/scoring";

export const maxDuration = 60;

const BANKROLL = 100; // USD paper trading bankroll
const FLAT_SIZE = 2;  // flat $2 per signal (no real win rate yet)
const MAX_PCT  = 0.02;

const GAMMA_API = "https://gamma-api.polymarket.com";

function kellySize(price: number, winRate: number): number {
  if (price <= 0 || price >= 1) return FLAT_SIZE;
  const odds = (1 - price) / price;
  const edge = winRate - price;
  const f = Math.max((edge * odds - (1 - winRate)) / odds, 0) * 0.25;
  return Math.min(Math.max(f * BANKROLL, FLAT_SIZE), BANKROLL * MAX_PCT);
}

async function resolveOpenSignals(log: string[]): Promise<number> {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: openSignals, error } = await db
    .from("signals")
    .select("id, market_id, outcome, entry_price, suggested_size_usdc")
    .eq("status", "open")
    .lt("created_at", cutoff);

  if (error || !openSignals?.length) return 0;

  let resolved = 0;

  for (const sig of openSignals) {
    try {
      const res = await fetch(
        `${GAMMA_API}/markets?conditionIds=${sig.market_id}`,
        { headers: { Accept: "application/json" }, cache: "no-store" }
      );
      if (!res.ok) continue;

      const markets = await res.json();
      const market = Array.isArray(markets) ? markets[0] : markets;
      if (!market) continue;

      const isResolved = market.resolved === true || market.closed === true;
      if (!isResolved) continue;

      // outcomePrices[0] is YES price at resolution; 1.0 = YES won, 0.0 = YES lost
      const outcomePriceYes = Number(market.outcomePrices?.[0] ?? -1);
      const outcomeIsYes = sig.outcome?.toUpperCase() === "YES";
      const won = outcomeIsYes ? outcomePriceYes >= 0.99 : outcomePriceYes <= 0.01;

      const exitPrice = won ? 1 : 0;
      const pnl = (exitPrice - sig.entry_price) * sig.suggested_size_usdc;

      await db
        .from("signals")
        .update({
          status:     won ? "won" : "lost",
          exit_price: exitPrice,
          pnl_usdc:   Math.round(pnl * 100) / 100,
        })
        .eq("id", sig.id);

      log.push(`RESOLVED: ${sig.market_id.slice(0, 12)}… ${won ? "WON" : "LOST"} P&L $${pnl.toFixed(2)}`);
      resolved++;
    } catch (err) {
      log.push(`RESOLVE_ERR: ${sig.market_id.slice(0, 12)} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return resolved;
}

export async function GET(req: NextRequest) {
  // Auth: if CRON_SECRET is set, verify it; if not set, allow (Vercel cron path is obscure)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const log: string[] = [];
  let newSignals = 0;
  let resolved = 0;

  try {
    // Step 0: resolve open signals >24h old
    resolved = await resolveOpenSignals(log);

    // Step 1: try to load wallets from Supabase cache (populated by refresh-leaderboard cron)
    const db = getSupabase();
    let candidates: Array<{ address: string; profit: number; volume: number; userName: string }> = [];

    const { data: savedWallets } = await db
      .from("whale_wallets")
      .select("address, user_name, profit, volume")
      .order("profit", { ascending: false })
      .limit(50);

    if (savedWallets && savedWallets.length >= 10) {
      candidates = savedWallets.map((w) => ({
        address:  w.address,
        profit:   Number(w.profit),
        volume:   Number(w.volume),
        userName: String(w.user_name ?? ""),
      }));
      log.push(`Loaded ${candidates.length} wallets from Supabase cache`);
    } else {
      // Fallback: fetch leaderboard directly
      const raw = await fetchLeaderboard(100);
      candidates = raw
        .map((w) => ({
          address:  String(w.proxyWallet ?? w.proxyWalletAddress ?? w.address ?? ""),
          profit:   Number(w.pnl ?? w.profit ?? 0),
          volume:   Number(w.vol ?? w.volume ?? 0),
          userName: String(w.userName ?? ""),
        }))
        .filter((c) => c.address && c.profit >= FILTERS.MIN_PROFIT_USDC)
        .slice(0, 20);
      log.push(`Fetched ${candidates.length} wallets from leaderboard (fallback)`);
    }

    for (const c of candidates) {
      try {
        // Step 2: Fetch trades for activity metrics + title lookup
        const tradeHistory = await fetchTrades(c.address, 100);
        const activity = computeActivityMetrics(
          tradeHistory as Parameters<typeof computeActivityMetrics>[0]
        );

        if (
          activity.isBot ||
          activity.daysSinceActive > FILTERS.MAX_ACTIVE_DAYS_AGO ||
          activity.tradesPerDay < FILTERS.MIN_TRADES_PER_DAY ||
          activity.uniqueMarkets < FILTERS.MIN_UNIQUE_MARKETS ||
          tradeHistory.length < FILTERS.MIN_TRADES
        ) continue;

        const score = computeScore({
          profit: c.profit,
          winRate: 0.55,
          tradesPerDay: activity.tradesPerDay,
          uniqueMarkets: activity.uniqueMarkets,
          daysSinceActive: activity.daysSinceActive,
        });

        if (score < 40) continue;

        // Build title map from trade history: conditionId → market title
        const titleByMarket: Record<string, string> = {};
        for (const t of tradeHistory) {
          const mid   = String(t.conditionId ?? t.market ?? t.marketId ?? "");
          const title = String(t.title ?? t.marketTitle ?? t.market_title ?? "");
          if (mid && title) titleByMarket[mid] = title;
        }

        // Step 3: Fetch current positions
        const rawPositions = await fetchPositions(c.address);

        for (const p of rawPositions) {
          const marketId = String(p.conditionId ?? p.marketId ?? "");
          const outcome  = String(p.outcome ?? "");
          const size     = Number(p.size ?? p.currentValue ?? 0);
          const price    = Number(p.avgPrice ?? p.averagePrice ?? p.price ?? 0);

          if (!marketId || !outcome || size <= 0) continue;

          // Step 4: Check if this position already exists in our snapshot
          const { data: existing } = await db
            .from("position_snapshots")
            .select("id")
            .eq("whale_address", c.address)
            .eq("market_id", marketId)
            .eq("outcome", outcome)
            .maybeSingle();

          if (existing) {
            await db
              .from("position_snapshots")
              .update({ size, avg_price: price })
              .eq("whale_address", c.address)
              .eq("market_id", marketId)
              .eq("outcome", outcome);
            continue;
          }

          // Step 5: NEW position detected → create signal
          const marketTitle =
            titleByMarket[marketId] ||
            String(p.title ?? p.marketTitle ?? p.market_title ?? "");

          const suggestedSize = kellySize(price, 0.55);

          await db.from("position_snapshots").upsert({
            whale_address: c.address,
            market_id:     marketId,
            outcome,
            size,
            avg_price:     price,
          });

          const { error: insertErr } = await db.from("signals").insert({
            whale_address:        c.address,
            whale_score:          score,
            whale_trades_per_day: activity.tradesPerDay,
            market_id:            marketId,
            market_title:         marketTitle,
            outcome,
            whale_size_usdc:      size,
            entry_price:          price,
            suggested_size_usdc:  Math.round(suggestedSize * 100) / 100,
            status:               "open",
          });

          if (insertErr) {
            log.push(`INSERT_ERR: ${marketId.slice(0, 12)} — ${insertErr.message}`);
          } else {
            newSignals++;
            log.push(
              `NEW: ${c.userName || c.address.slice(0, 8)} → ${outcome} @ ${price.toFixed(3)} ` +
              `$${suggestedSize.toFixed(2)} | ${marketTitle || marketId.slice(0, 20)}`
            );
          }
        }
      } catch (walletErr) {
        log.push(`WALLET_ERR: ${c.address.slice(0, 8)} — ${walletErr instanceof Error ? walletErr.message : String(walletErr)}`);
      }
    }

    return NextResponse.json({
      ok: true,
      scanned: candidates.length,
      newSignals,
      resolved,
      log,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.push(`FATAL: ${message}`);
    return NextResponse.json({ error: message, log }, { status: 500 });
  }
}
