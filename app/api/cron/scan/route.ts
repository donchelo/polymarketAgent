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

    const { data: savedWallets } = await db
      .from("whale_wallets")
      .select("address, user_name, score")
      .order("score", { ascending: false })
      .range(offset, offset + 4);

    if (savedWallets && savedWallets.length >= 1) {
      candidates = savedWallets.map((w) => ({
        address:  w.address,
        score:    Number(w.score ?? 0),
        userName: String(w.user_name ?? ""),
      }));
      log.push(`Wallets: ${candidates.length} from cache (offset ${offset})`);
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
        const rawPositions = await fetchPositions(c.address);

        // Detect first-ever scan for this wallet
        const { count: snapCount } = await db
          .from("position_snapshots")
          .select("*", { count: "exact", head: true })
          .eq("whale_address", c.address);

        const isFirstScan = (snapCount ?? 0) === 0;
        let firstScanCount = 0;

        for (const p of rawPositions) {
          const marketId = String(p.conditionId ?? p.marketId ?? "");
          const outcome  = String(p.outcome ?? "");
          const size     = Number(p.size ?? p.currentValue ?? 0);
          const price    = Number(p.avgPrice ?? p.averagePrice ?? p.price ?? 0);

          if (!marketId || !outcome || size <= 0 || price <= 0 || price >= 1) continue;

          const { data: existing } = await db
            .from("position_snapshots")
            .select("id")
            .eq("whale_address", c.address)
            .eq("market_id", marketId)
            .eq("outcome", outcome)
            .maybeSingle();

          if (existing) {
            // Known position — just update tracking
            await db.from("position_snapshots")
              .update({ size, avg_price: price })
              .eq("whale_address", c.address)
              .eq("market_id", marketId)
              .eq("outcome", outcome);
            continue;
          }

          // New position — save snapshot
          await db.from("position_snapshots").upsert({
            whale_address: c.address, market_id: marketId,
            outcome, size, avg_price: price,
          });

          // First scan = snapshot only, no signal (historical position)
          if (isFirstScan) {
            firstScanCount++;
            continue;
          }

          // Real new entry — calculate Kelly size
          const betSize = kellySize(price, WIN_RATE_PROXY, c.score);

          // Skip if not enough cash remaining
          if (remainingCash < betSize * 0.5) {
            skipped++;
            continue;
          }

          // Fetch market title from gamma-api
          let marketTitle = String(p.title ?? p.marketTitle ?? p.market_title ?? "");
          if (!marketTitle) {
            try {
              const r = await fetch(`${GAMMA_API}/markets?conditionIds=${marketId}`,
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
            market_id:            marketId,
            market_title:         marketTitle,
            outcome,
            whale_size_usdc:      size,
            entry_price:          price,
            suggested_size_usdc:  suggestedSize,
            status:               "open",
          });

          if (insertErr) {
            log.push(`ERR: ${insertErr.message}`);
          } else {
            newSignals++;
            remainingCash -= suggestedSize;
            log.push(
              `NEW: ${c.userName || c.address.slice(0, 8)} → ${outcome} @ ${price.toFixed(3)} ` +
              `$${suggestedSize} (Kelly) | ${marketTitle || marketId.slice(0, 25)}`
            );
          }
        }

        if (isFirstScan && firstScanCount > 0) {
          log.push(`SNAPSHOT: ${c.userName || c.address.slice(0, 8)} — ${firstScanCount} posiciones guardadas, señales desde próximo scan`);
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
