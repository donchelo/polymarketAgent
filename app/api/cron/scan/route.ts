import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchTrades } from "@/lib/polymarket";
import { computeLeaderScore } from "@/lib/leader";

export const maxDuration = 60;

// ─── Money management ────────────────────────────────────────────────────────
const BANKROLL             = 100;
const MAX_EXPOSURE_PCT     = 0.80;  // max 80% of bankroll deployed at once
const MAX_EXPOSURE_PER_WHALE = 15;  // max $15 per whale (concentration risk)
const MIN_SIZE             = 0.50;
const MAX_SIZE             = 5.00;
const WIN_RATE_PROXY       = 0.52;

// ─── Whale selection ─────────────────────────────────────────────────────────
const TOP_WHALES           = 10;    // monitor this many whales in parallel
const MIN_SCORE            = 50;
const MIN_TRADES_PER_DAY   = 1.5;

// ─── Market filter ───────────────────────────────────────────────────────────
const MAX_MARKET_DURATION_H = 24;
const MIN_PRICE  = 0.08;  // skip near-certain outcomes (market already decided)
const MAX_PRICE  = 0.92;  // symmetric: don't buy >92¢ — no real edge
const MIN_EDGE   = 0.05;  // require ≥5% edge over price — filters coin-flip markets (~0.49)
const MIN_REAL_WIN_RATE = 0.54;  // skip whales with proven win rate below this
const CLOB_API = "https://clob.polymarket.com";

// Sports tags that indicate efficient handicap markets
const SPORTS_TAGS = ["nhl","nba","nfl","mlb","soccer","basketball","hockey","baseball","football","sports","tennis","golf","ufc","mma"];

// ─── Trade detection window ──────────────────────────────────────────────────
const TRADE_WINDOW_SECS = 10 * 60; // look back 10 minutes

/**
 * Quarter-Kelly sizing for a binary prediction market.
 * Kelly fraction = (w - p) / (1 - p), divided by 4, scaled by whale quality.
 */
/**
 * Returns 0 if there is no positive edge — caller must skip the trade.
 * MIN_SIZE only applied when edge > 0 (we have a real reason to bet).
 */
function kellySize(price: number, winRate: number, score: number): number {
  if (price <= 0 || price >= 1) return 0;
  const edge = winRate - price;
  if (edge < MIN_EDGE) return 0;  // require meaningful edge — filters coin-flips
  const f         = edge / (1 - price);
  const scoreMult = 0.8 + Math.min(Math.max(score - 40, 0) / 125, 0.4);
  const size      = f * 0.25 * scoreMult * BANKROLL;
  return Math.min(Math.max(size, MIN_SIZE), MAX_SIZE);
}

async function fetchMarketMeta(marketId: string): Promise<{
  title: string;
  durationH: number | null;
  tags: string[];
}> {
  try {
    const r = await fetch(`${CLOB_API}/markets/${marketId}`,
      { headers: { Accept: "application/json" }, cache: "no-store" });
    if (!r.ok) return { title: "", durationH: null, tags: [] };
    const m = await r.json();
    if (!m || m.condition_id !== marketId) return { title: "", durationH: null, tags: [] };

    const tags: string[] = m.tags ?? [];
    const isSports = tags.some((t: string) =>
      ["sports","nhl","nba","nfl","mlb","soccer","basketball","hockey","baseball","football","tennis","ufc"].includes(t.toLowerCase())
    );
    let durationH: number | null = null;
    if (isSports) {
      durationH = 12;
    } else if (m.end_date_iso) {
      const ms = new Date(m.end_date_iso).getTime() - Date.now();
      if (!isNaN(ms)) durationH = ms / (1000 * 3600);
    }
    return { title: String(m.question ?? ""), durationH, tags };
  } catch {
    return { title: "", durationH: null, tags: [] };
  }
}

async function resolveOpenSignals(log: string[]): Promise<number> {
  const db = getSupabase();

  // Check ALL open signals (no age cutoff) — limit per run to avoid timeout.
  // Short-term markets (<24h) can close within the same cron window they were entered.
  const { data: openSignals } = await db
    .from("signals")
    .select("id, market_id, outcome, entry_price, suggested_size_usdc")
    .eq("status", "open")
    .order("created_at", { ascending: true }) // oldest first
    .limit(20);

  if (!openSignals?.length) return 0;

  let resolved = 0;
  await Promise.allSettled(openSignals.map(async (sig) => {
    try {
      const r = await fetch(`${CLOB_API}/markets/${sig.market_id}`,
        { headers: { Accept: "application/json" }, cache: "no-store" });
      if (!r.ok) return;
      const market = await r.json();
      if (!market?.closed || market.condition_id !== sig.market_id) return;

      const tokens: Array<{ outcome: string; price: number; winner?: boolean }> = market.tokens ?? [];
      const tok = tokens.find(t => t.outcome.toLowerCase() === String(sig.outcome ?? "").toLowerCase())
               ?? tokens.find(t => t.outcome.toUpperCase() === "YES");
      const won       = tok ? (tok.winner === true || tok.price >= 0.99) : false;
      const exitPrice = won ? 1 : 0;
      const pnl       = (exitPrice - sig.entry_price) * sig.suggested_size_usdc;

      await db.from("signals").update({
        status: won ? "won" : "lost", exit_price: exitPrice,
        pnl_usdc: Math.round(pnl * 100) / 100,
      }).eq("id", sig.id);

      log.push(`RESOLVED: ${sig.market_id.slice(0, 12)}… ${won ? "✓ WON" : "✗ LOST"} $${pnl.toFixed(2)}`);
      resolved++;
    } catch { /* skip */ }
  }));
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
    // ── Step 0: resolve expired signals ──────────────────────────────────────
    resolved = await resolveOpenSignals(log);

    const db = getSupabase();

    // ── Step 1: portfolio exposure ───────────────────────────────────────────
    const { data: openSigs } = await db
      .from("signals")
      .select("suggested_size_usdc, whale_address")
      .eq("status", "open");

    const totalExposure = (openSigs ?? []).reduce(
      (sum, s) => sum + (Number(s.suggested_size_usdc) || 0), 0
    );
    const maxExposure    = BANKROLL * MAX_EXPOSURE_PCT;
    let remainingCash    = maxExposure - totalExposure;

    // Exposure per whale (to avoid concentration)
    const whaleExposureMap = new Map<string, number>();
    for (const s of openSigs ?? []) {
      const prev = whaleExposureMap.get(s.whale_address) ?? 0;
      whaleExposureMap.set(s.whale_address, prev + (Number(s.suggested_size_usdc) || 0));
    }

    log.push(`Portfolio: $${totalExposure.toFixed(2)}/$${maxExposure} (${Math.round(totalExposure/BANKROLL*100)}%) | $${remainingCash.toFixed(2)} libre`);

    // ── Step 2: load top qualifying whales ───────────────────────────────────
    const { data: dbWhales } = await db
      .from("whale_wallets")
      .select("address, user_name, score, trades_per_day, win_rate, real_win_rate, pct_short_term")
      .gte("score", MIN_SCORE)
      .gte("trades_per_day", MIN_TRADES_PER_DAY)
      .order("score", { ascending: false })
      .limit(TOP_WHALES * 3); // fetch extra to sort by composite

    if (!dbWhales?.length) {
      return NextResponse.json({ ok: false, error: "No qualifying whales in DB. Run refresh-leaderboard first.", log, ts: new Date().toISOString() });
    }

    // Sort by composite score and take top N
    const whales = dbWhales
      .filter(w => {
        // Exclude whales with verified poor win rate (null = no data yet = allowed)
        if (w.real_win_rate != null && Number(w.real_win_rate) < MIN_REAL_WIN_RATE) return false;
        return true;
      })
      .map(w => ({
        address:       w.address,
        userName:      w.user_name ?? w.address.slice(0, 8),
        score:         Number(w.score ?? 0),
        tradesPerDay:  Number(w.trades_per_day ?? 0),
        winRate:       Number(w.real_win_rate ?? w.win_rate ?? WIN_RATE_PROXY),
        pctShortTerm:  w.pct_short_term != null ? Number(w.pct_short_term) : null,
        compositeScore: computeLeaderScore({
          score:          Number(w.score ?? 0),
          trades_per_day: Number(w.trades_per_day ?? 0),
          win_rate:       Number(w.win_rate ?? WIN_RATE_PROXY),
          real_win_rate:  w.real_win_rate != null ? Number(w.real_win_rate) : null,
          pct_short_term: w.pct_short_term != null ? Number(w.pct_short_term) : null,
        }),
      }))
      .sort((a, b) => b.compositeScore - a.compositeScore)
      .slice(0, TOP_WHALES);

    // Multi-leader weighting: top whale = 1.0, others scale proportionally.
    // Kelly bet is multiplied by (0.5 + 0.5 * weight) → range 50%–100% of full kelly.
    const maxComposite = whales[0]?.compositeScore ?? 1;

    log.push(`Whales: ${whales.length} monitoreadas — ${whales.map(w => w.userName).join(", ")}`);

    // Update leader_config to top composite whale (for UI display)
    const topWhale = whales[0];
    if (topWhale) {
      await db.from("leader_config").upsert({
        id: 1,
        address:        topWhale.address,
        user_name:      topWhale.userName,
        score:          topWhale.score,
        trades_per_day: topWhale.tradesPerDay,
        win_rate:       topWhale.winRate,
        leader_score:   topWhale.compositeScore,
        selected_at:    new Date().toISOString(),
      });
    }

    // ── Step 3: fetch recent trades for ALL whales in parallel ────────────────
    const tenMinAgo = Date.now() / 1000 - TRADE_WINDOW_SECS;

    const tradeResults = await Promise.allSettled(
      whales.map(w => fetchTrades(w.address, 30))
    );

    // ── Step 4: process each whale's recent BUYs ─────────────────────────────
    for (let i = 0; i < whales.length; i++) {
      const whale       = whales[i];
      const leaderRank  = i + 1;  // 1 = top composite whale
      const leaderWeight = whale.compositeScore / maxComposite;  // 0–1
      const result = tradeResults[i];
      if (result.status !== "fulfilled") {
        log.push(`FETCH_ERR: ${whale.userName}`);
        continue;
      }

      const recentBuys = (result.value as Record<string, unknown>[]).filter(t => {
        const ts    = t.timestamp ?? t.created_at ?? t.time;
        const tsNum = typeof ts === "string" ? parseFloat(ts) : Number(ts);
        const isBuy = String(t.side ?? t.type ?? "").toUpperCase() === "BUY"
                   || Number(t.size ?? 0) > 0;
        return !isNaN(tsNum) && tsNum > tenMinAgo && isBuy;
      });

      if (!recentBuys.length) continue;

      log.push(`${whale.userName}: ${recentBuys.length} trades recientes`);

      for (const t of recentBuys) {
        const marketId = String(t.conditionId ?? t.market ?? t.marketId ?? "");
        const outcome  = String(t.outcome ?? "").toUpperCase();
        const price    = Number(t.price ?? t.avgPrice ?? 0);
        // Skip invalid prices and near-certain outcomes (market already decided)
        if (!marketId || !outcome || price < MIN_PRICE || price > MAX_PRICE) continue;

        // Already have a signal for this whale+market+outcome?
        const { data: existing } = await db
          .from("signals")
          .select("id")
          .eq("whale_address", whale.address)
          .eq("market_id", marketId)
          .eq("outcome", outcome)
          .in("status", ["open", "won", "lost", "whale_exited"])
          .limit(1);
        if (existing?.length) continue;

        // Check market duration + category
        const { title, durationH, tags } = await fetchMarketMeta(marketId);
        if (durationH === null || durationH > MAX_MARKET_DURATION_H) {
          log.push(`SKIP_LONG: ${whale.userName} ${marketId.slice(0, 10)} ${durationH === null ? "duración desconocida" : `${Math.round(durationH)}h`}`);
          skipped++;
          continue;
        }

        // Skip sports O/U and spread markets — efficient pricing, proxy edge is fictitious
        const isSportsHandicap = tags.some(t => SPORTS_TAGS.includes(t.toLowerCase()))
          && /\bO\/U\b|^Spread:|Spread\s[-+]/i.test(title);
        if (isSportsHandicap) {
          log.push(`SKIP_SPORTS_OU: ${whale.userName} → ${title.slice(0, 40)}`);
          skipped++;
          continue;
        }

        // Exposure checks
        const whaleExposure = whaleExposureMap.get(whale.address) ?? 0;
        if (whaleExposure >= MAX_EXPOSURE_PER_WHALE) {
          log.push(`SKIP_WHALE_CAP: ${whale.userName} ya $${whaleExposure.toFixed(2)} expuesto`);
          skipped++;
          continue;
        }
        const rawBetSize = kellySize(price, whale.winRate, whale.score);
        if (rawBetSize === 0) {
          log.push(`SKIP_NO_EDGE: ${whale.userName} → ${outcome} @ ${price.toFixed(3)}`);
          skipped++;
          continue;
        }
        // Scale by leader weight: top whale gets full kelly, others proportionally less
        const betSize = rawBetSize * (0.5 + 0.5 * leaderWeight);
        if (remainingCash < betSize * 0.5) {
          log.push(`SKIP_CASH: portfolio lleno ($${remainingCash.toFixed(2)} libre)`);
          skipped++;
          continue;
        }

        const suggestedSize = Math.min(
          Math.round(betSize * 100) / 100,
          MAX_EXPOSURE_PER_WHALE - whaleExposure,
          remainingCash
        );

        const { error: insertErr } = await db.from("signals").insert({
          whale_address:        whale.address,
          whale_score:          whale.score,
          whale_trades_per_day: whale.tradesPerDay,
          whale_win_rate:       whale.winRate,
          market_id:            marketId,
          market_title:         title,
          outcome,
          whale_size_usdc:      Number(t.size ?? 0),
          entry_price:          price,
          suggested_size_usdc:  suggestedSize,
          status:               "open",
          leader_rank:          leaderRank,
          leader_weight:        Math.round(leaderWeight * 1000) / 1000,
        });

        if (!insertErr) {
          newSignals++;
          remainingCash -= suggestedSize;
          whaleExposureMap.set(whale.address, (whaleExposureMap.get(whale.address) ?? 0) + suggestedSize);
          log.push(`✓ COPY [L${leaderRank}×${leaderWeight.toFixed(2)}]: ${whale.userName} → ${outcome} @ ${price.toFixed(3)} $${suggestedSize} | ${title || marketId.slice(0, 30)}`);
        }
      }
    }

    return NextResponse.json({
      ok:        true,
      whales:    whales.length,
      newSignals,
      resolved,
      skipped,
      topWhale:  topWhale ? { name: topWhale.userName, composite: topWhale.compositeScore.toFixed(2) } : null,
      portfolio: {
        exposure: `$${(totalExposure + (maxExposure - remainingCash - totalExposure)).toFixed(2)}/$${maxExposure}`,
        open:     (openSigs?.length ?? 0) + newSignals,
      },
      log,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message, log }, { status: 500 });
  }
}
