import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchLeaderboard, fetchTrades, fetchPositions } from "@/lib/polymarket";
import { computeActivityMetrics, computeScore, FILTERS } from "@/lib/scoring";

export const maxDuration = 20;

const BANKROLL      = 100;  // USD paper trading bankroll
const MAX_OPEN      = 20;   // max concurrent open positions
const SIZE_PER_SLOT = BANKROLL / MAX_OPEN; // $5 per position

const GAMMA_API = "https://gamma-api.polymarket.com";

async function resolveOpenSignals(log: string[]): Promise<number> {
  const db = getSupabase();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: openSignals, error } = await db
    .from("signals")
    .select("id, market_id, outcome, entry_price, suggested_size_usdc")
    .eq("status", "open")
    .lt("created_at", cutoff)
    .limit(10);

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
      if (!market || !(market.resolved === true || market.closed === true)) continue;

      const outcomePriceYes = Number(market.outcomePrices?.[0] ?? -1);
      const outcomeIsYes = sig.outcome?.toUpperCase() === "YES";
      const won = outcomeIsYes ? outcomePriceYes >= 0.99 : outcomePriceYes <= 0.01;

      const exitPrice = won ? 1 : 0;
      const pnl = (exitPrice - sig.entry_price) * sig.suggested_size_usdc;

      await db.from("signals").update({
        status:     won ? "won" : "lost",
        exit_price: exitPrice,
        pnl_usdc:   Math.round(pnl * 100) / 100,
      }).eq("id", sig.id);

      log.push(`RESOLVED: ${sig.market_id.slice(0, 12)}… ${won ? "WON" : "LOST"} P&L $${pnl.toFixed(2)}`);
      resolved++;
    } catch (err) {
      log.push(`RESOLVE_ERR: ${sig.market_id.slice(0, 12)} — ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return resolved;
}

export async function GET(req: NextRequest) {
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
  let skippedFirstScan = 0;

  try {
    resolved = await resolveOpenSignals(log);

    const db = getSupabase();

    // Check how many open positions we already have
    const { count: openCount } = await db
      .from("signals")
      .select("*", { count: "exact", head: true })
      .eq("status", "open");

    const slotsAvailable = MAX_OPEN - (openCount ?? 0);
    log.push(`Open: ${openCount ?? 0}/${MAX_OPEN} — slots available: ${slotsAvailable}`);

    // Rotate through cached wallets: 5 wallets per run
    const minute = new Date().getMinutes();
    const offset = (Math.floor(minute / 5) * 5) % 50;

    let candidates: Array<{ address: string; score: number; userName: string }> = [];

    const { data: savedWallets } = await db
      .from("whale_wallets")
      .select("address, user_name, profit, score")
      .order("score", { ascending: false })
      .range(offset, offset + 4);

    if (savedWallets && savedWallets.length >= 1) {
      candidates = savedWallets.map((w) => ({
        address:  w.address,
        score:    Number(w.score ?? 0),
        userName: String(w.user_name ?? ""),
      }));
      log.push(`Cache: ${candidates.length} wallets (offset ${offset})`);
    } else {
      const raw = await fetchLeaderboard(50);
      const top = raw
        .map((w) => ({
          address:  String(w.proxyWallet ?? w.proxyWalletAddress ?? w.address ?? ""),
          profit:   Number(w.pnl ?? w.profit ?? 0),
          volume:   Number(w.vol ?? w.volume ?? 0),
          userName: String(w.userName ?? ""),
        }))
        .filter((c) => c.address && c.profit >= FILTERS.MIN_PROFIT_USDC)
        .slice(0, 5);

      for (const c of top) {
        try {
          const trades = await fetchTrades(c.address, 50);
          const activity = computeActivityMetrics(trades as Parameters<typeof computeActivityMetrics>[0]);
          if (activity.isBot || activity.daysSinceActive > FILTERS.MAX_ACTIVE_DAYS_AGO) continue;
          const score = computeScore({ profit: c.profit, winRate: 0.55, tradesPerDay: activity.tradesPerDay, uniqueMarkets: activity.uniqueMarkets, daysSinceActive: activity.daysSinceActive });
          if (score < 40) continue;
          candidates.push({ address: c.address, score, userName: c.userName });
        } catch { /* skip */ }
      }
      log.push(`Fallback: ${candidates.length} wallets`);
    }

    for (const c of candidates) {
      try {
        const rawPositions = await fetchPositions(c.address);

        // Check if this is the FIRST time we see this wallet (no existing snapshots)
        const { count: existingSnapshots } = await db
          .from("position_snapshots")
          .select("*", { count: "exact", head: true })
          .eq("whale_address", c.address);

        const isFirstScan = (existingSnapshots ?? 0) === 0;

        for (const p of rawPositions) {
          const marketId = String(p.conditionId ?? p.marketId ?? "");
          const outcome  = String(p.outcome ?? "");
          const size     = Number(p.size ?? p.currentValue ?? 0);
          const price    = Number(p.avgPrice ?? p.averagePrice ?? p.price ?? 0);

          if (!marketId || !outcome || size <= 0) continue;

          const { data: existing } = await db
            .from("position_snapshots")
            .select("id")
            .eq("whale_address", c.address)
            .eq("market_id", marketId)
            .eq("outcome", outcome)
            .maybeSingle();

          if (existing) {
            // Known position — update size/price only
            await db.from("position_snapshots")
              .update({ size, avg_price: price })
              .eq("whale_address", c.address)
              .eq("market_id", marketId)
              .eq("outcome", outcome);
            continue;
          }

          // New position in DB → save snapshot first
          await db.from("position_snapshots").upsert({
            whale_address: c.address, market_id: marketId, outcome, size, avg_price: price,
          });

          // FIRST SCAN: just snapshot, don't create signal (historical position)
          if (isFirstScan) {
            skippedFirstScan++;
            continue;
          }

          // SUBSEQUENT SCAN: truly new position the whale just opened → check slots
          if (slotsAvailable <= 0) {
            log.push(`SKIP (full): ${c.userName || c.address.slice(0, 8)} → ${outcome} @ ${price.toFixed(3)}`);
            continue;
          }

          // Fetch title from gamma-api
          let marketTitle = String(p.title ?? p.marketTitle ?? p.market_title ?? "");
          if (!marketTitle) {
            try {
              const r = await fetch(`${GAMMA_API}/markets?conditionIds=${marketId}`, { headers: { Accept: "application/json" }, cache: "no-store" });
              if (r.ok) {
                const m = await r.json();
                marketTitle = (Array.isArray(m) ? m[0] : m)?.question ?? "";
              }
            } catch { /* title stays empty */ }
          }

          const suggestedSize = Math.round(SIZE_PER_SLOT * 100) / 100;

          const { error: insertErr } = await db.from("signals").insert({
            whale_address:        c.address,
            whale_score:          c.score,
            whale_trades_per_day: 0,
            market_id:            marketId,
            market_title:         marketTitle,
            outcome,
            whale_size_usdc:      size,
            entry_price:          price,
            suggested_size_usdc:  suggestedSize,
            status:               "open",
          });

          if (insertErr) {
            log.push(`INSERT_ERR: ${marketId.slice(0, 12)} — ${insertErr.message}`);
          } else {
            newSignals++;
            log.push(`NEW: ${c.userName || c.address.slice(0, 8)} → ${outcome} @ ${price.toFixed(3)} $${suggestedSize} | ${marketTitle || marketId.slice(0, 20)}`);
          }
        }

        if (isFirstScan && skippedFirstScan > 0) {
          log.push(`FIRST_SCAN: ${c.userName || c.address.slice(0, 8)} — ${skippedFirstScan} posiciones snapshotted, 0 señales (serán señales desde el próximo scan)`);
          skippedFirstScan = 0;
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
      openPositions: (openCount ?? 0) + newSignals,
      exposure: `$${((openCount ?? 0) + newSignals) * SIZE_PER_SLOT}/$${BANKROLL}`,
      log,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, log }, { status: 500 });
  }
}
