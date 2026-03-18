import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchLeaderboard, fetchTrades, fetchPositions } from "@/lib/polymarket";
import { computeActivityMetrics, computeScore, FILTERS } from "@/lib/scoring";

export const maxDuration = 20;

// ─── Money management ────────────────────────────────────────────────────────
const BANKROLL          = 100;   // USD paper trading bankroll
const MAX_EXPOSURE_PCT  = 0.80;  // never deploy more than 80% of bankroll
const MIN_SIZE          = 0.50;  // minimum bet size
const MAX_SIZE          = 5.00;  // maximum bet size (5% of bankroll)
const WIN_RATE_PROXY    = 0.52;  // conservative proxy until real history exists

/**
 * Quarter-Kelly sizing for a binary prediction market position.
 * Bet at price `p`, estimated win probability `w`, bankroll `b`.
 * Returns dollar amount to bet.
 */
function kellySize(price: number, winRate: number, whaleScore: number): number {
  if (price <= 0 || price >= 1) return MIN_SIZE;

  // Kelly fraction = (w - p) / (1 - p)  [for binary prediction markets]
  const edge = winRate - price;
  const f    = edge / (1 - price);

  // Quarter Kelly, scaled by whale quality (score 40-90 → multiplier 0.8-1.2)
  const scoreMult = 0.8 + Math.min(Math.max(whaleScore - 40, 0) / 125, 0.4);
  const fraction  = Math.max(f * 0.25 * scoreMult, 0);
  const size      = fraction * BANKROLL;

  return Math.min(Math.max(size, MIN_SIZE), MAX_SIZE);
}
// ─────────────────────────────────────────────────────────────────────────────

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
      const outcomeIsYes    = sig.outcome?.toUpperCase() === "YES";
      const won             = outcomeIsYes ? outcomePriceYes >= 0.99 : outcomePriceYes <= 0.01;
      const exitPrice       = won ? 1 : 0;
      const pnl             = (exitPrice - sig.entry_price) * sig.suggested_size_usdc;

      await db.from("signals").update({
        status:     won ? "won" : "lost",
        exit_price: exitPrice,
        pnl_usdc:   Math.round(pnl * 100) / 100,
      }).eq("id", sig.id);

      log.push(`RESOLVED: ${sig.market_id.slice(0, 12)}… ${won ? "✓ WON" : "✗ LOST"} P&L $${pnl.toFixed(2)}`);
      resolved++;
    } catch (err) {
      log.push(`RESOLVE_ERR: ${err instanceof Error ? err.message : String(err)}`);
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
  let resolved   = 0;
  let skipped    = 0;

  try {
    // Step 0: resolve old signals
    resolved = await resolveOpenSignals(log);

    const db = getSupabase();

    // Step 1: check current portfolio exposure
    const { data: openSigs } = await db
      .from("signals")
      .select("suggested_size_usdc")
      .eq("status", "open");

    const currentExposure = (openSigs ?? []).reduce(
      (sum, s) => sum + (Number(s.suggested_size_usdc) || 0), 0
    );
    const maxExposure    = BANKROLL * MAX_EXPOSURE_PCT;
    const availableCash  = maxExposure - currentExposure;
    const openCount      = openSigs?.length ?? 0;

    log.push(`Portfolio: ${openCount} open | $${currentExposure.toFixed(2)}/$${maxExposure} exposed | $${availableCash.toFixed(2)} disponible`);

    // Step 2: load wallets (rotate 5 per run through the 45-wallet cache)
    const minute = new Date().getMinutes();
    const offset = (Math.floor(minute / 5) * 5) % 50;

    let candidates: Array<{ address: string; score: number; userName: string }> = [];

    // Priority 1: wallets that have NEVER been position-scanned (no snapshot yet)
    const { data: snappedAddrs } = await db
      .from("position_snapshots")
      .select("whale_address");
    const alreadySnapped = new Set((snappedAddrs ?? []).map((s) => s.whale_address));

    const { data: allWallets } = await db
      .from("whale_wallets")
      .select("address, user_name, score")
      .order("score", { ascending: false })
      .limit(100);

    const unsnapped = (allWallets ?? []).filter((w) => !alreadySnapped.has(w.address));
    const rotationPool = (allWallets ?? []).filter((w) => alreadySnapped.has(w.address));

    // Pick up to 5 unsnapped (first-scan priority) + up to 5 from rotation
    const unsnappedBatch = unsnapped.slice(0, 5);
    const rotationBatch  = rotationPool.slice(offset % Math.max(rotationPool.length, 1),
                            (offset % Math.max(rotationPool.length, 1)) + Math.max(0, 10 - unsnappedBatch.length));

    const savedWallets = [...unsnappedBatch, ...rotationBatch];

    if (savedWallets && savedWallets.length >= 1) {
      candidates = savedWallets.map((w) => ({
        address:  w.address,
        score:    Number(w.score ?? 0),
        userName: String(w.user_name ?? ""),
      }));
      log.push(`Wallets: ${unsnappedBatch.length} new-snapshot + ${rotationBatch.length} rotation = ${candidates.length} total (${unsnapped.length} unsnapped remaining)`);
    } else {
      // Fallback: live leaderboard fetch
      const raw = await fetchLeaderboard(50);
      for (const w of raw.slice(0, 5)) {
        try {
          const addr = String(w.proxyWallet ?? w.proxyWalletAddress ?? w.address ?? "");
          if (!addr) continue;
          const trades   = await fetchTrades(addr, 50);
          const activity = computeActivityMetrics(trades as Parameters<typeof computeActivityMetrics>[0]);
          if (activity.isBot || activity.daysSinceActive > FILTERS.MAX_ACTIVE_DAYS_AGO) continue;
          const score = computeScore({
            profit: Number(w.pnl ?? 0), winRate: 0.55,
            tradesPerDay: activity.tradesPerDay, uniqueMarkets: activity.uniqueMarkets,
            daysSinceActive: activity.daysSinceActive,
          });
          if (score >= 40) candidates.push({ address: addr, score, userName: String(w.userName ?? "") });
        } catch { /* skip */ }
      }
      log.push(`Wallets: ${candidates.length} from live leaderboard (fallback)`);
    }

    // Step 3: scan positions
    let remainingCash = availableCash;

    for (const c of candidates) {
      try {
        // Fetch positions and existing snapshots IN PARALLEL (2 calls, not N+1)
        const [rawPositions, { data: existingSnaps }] = await Promise.all([
          fetchPositions(c.address),
          db.from("position_snapshots")
            .select("market_id, outcome, size, avg_price")
            .eq("whale_address", c.address),
        ]);

        // Build lookup set in memory
        const snapSet = new Set(
          (existingSnaps ?? []).map((s) => `${s.market_id}|${s.outcome}`)
        );
        const isFirstScan = snapSet.size === 0;

        // Parse all valid positions
        const positions = rawPositions
          .map((p) => ({
            marketId: String(p.conditionId ?? p.marketId ?? ""),
            outcome:  String(p.outcome ?? ""),
            size:     Number(p.size ?? p.currentValue ?? 0),
            price:    Number(p.avgPrice ?? p.averagePrice ?? p.price ?? 0),
            title:    String(p.title ?? p.marketTitle ?? p.market_title ?? ""),
          }))
          .filter((p) => p.marketId && p.outcome && p.size > 0 && p.price > 0 && p.price < 1);

        // Batch upsert ALL positions (handles both new and existing in one call)
        if (positions.length > 0) {
          await db.from("position_snapshots").upsert(
            positions.map((p) => ({
              whale_address: c.address,
              market_id:     p.marketId,
              outcome:       p.outcome,
              size:          p.size,
              avg_price:     p.price,
            })),
            { onConflict: "whale_address,market_id,outcome" }
          );
        }

        if (isFirstScan) {
          log.push(`SNAPSHOT: ${c.userName || c.address.slice(0, 8)} — ${positions.length} posiciones guardadas, señales desde próximo scan`);
          continue;
        }

        // Identify truly new positions (not in previous snapshot)
        const newPositions = positions.filter(
          (p) => !snapSet.has(`${p.marketId}|${p.outcome}`)
        );

        // Create signals for new positions
        for (const p of newPositions) {
          const betSize = kellySize(p.price, WIN_RATE_PROXY, c.score);
          if (remainingCash < betSize * 0.5) { skipped++; continue; }

          // Fetch title from gamma-api if not available
          let marketTitle = p.title;
          if (!marketTitle) {
            try {
              const r = await fetch(`${GAMMA_API}/markets?conditionIds=${p.marketId}`,
                { headers: { Accept: "application/json" }, cache: "no-store" });
              if (r.ok) {
                const m = await r.json();
                marketTitle = (Array.isArray(m) ? m[0] : m)?.question ?? "";
              }
            } catch { /* title stays empty */ }
          }

          const suggestedSize = Math.round(betSize * 100) / 100;
          const { error: insertErr } = await db.from("signals").insert({
            whale_address:        c.address,
            whale_score:          c.score,
            whale_trades_per_day: 0,
            market_id:            p.marketId,
            market_title:         marketTitle,
            outcome:              p.outcome,
            whale_size_usdc:      p.size,
            entry_price:          p.price,
            suggested_size_usdc:  suggestedSize,
            status:               "open",
          });

          if (!insertErr) {
            newSignals++;
            remainingCash -= suggestedSize;
            log.push(`NEW: ${c.userName || c.address.slice(0, 8)} → ${p.outcome} @ ${p.price.toFixed(3)} $${suggestedSize} | ${marketTitle || p.marketId.slice(0, 25)}`);
          }
        }

        if (newPositions.length === 0) {
          log.push(`OK: ${c.userName || c.address.slice(0, 8)} — ${positions.length} posiciones sin cambios`);
        }
      } catch (walletErr) {
        log.push(`WALLET_ERR: ${c.address.slice(0, 8)} — ${walletErr instanceof Error ? walletErr.message : String(walletErr)}`);
      }
    }

    const newExposure = availableCash - remainingCash; // how much cash we deployed this run
    const totalExposure = currentExposure + newExposure;

    return NextResponse.json({
      ok:      true,
      scanned: candidates.length,
      newSignals,
      resolved,
      skipped,
      portfolio: {
        open:     openCount + newSignals,
        exposure: `$${totalExposure.toFixed(2)}/$${maxExposure.toFixed(0)}`,
        pct:      `${Math.round((totalExposure / BANKROLL) * 100)}%`,
      },
      log,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, log }, { status: 500 });
  }
}
