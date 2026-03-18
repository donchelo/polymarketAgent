import { NextResponse } from "next/server";
import { fetchLeaderboard, fetchTrades } from "@/lib/polymarket";
import { computeActivityMetrics, computeScore, FILTERS } from "@/lib/scoring";
import { getSupabase } from "@/lib/supabase";
import type { WalletProfile, LeaderInfo } from "@/lib/types";

export const revalidate = 1800;
export const maxDuration = 60;

export async function GET() {
  try {
    const raw = await fetchLeaderboard(200);

    if (!raw.length) {
      return NextResponse.json({ error: "Polymarket API returned empty data" }, { status: 502 });
    }

    const candidates = raw
      .map((w) => ({
        address:  String(w.proxyWallet ?? w.address ?? w.id ?? ""),
        profit:   Number(w.pnl ?? w.profit ?? 0),
        volume:   Number(w.vol ?? w.volume ?? 0),
        userName: String(w.userName ?? ""),
      }))
      .filter((c) => c.address && c.profit >= FILTERS.MIN_PROFIT_USDC);

    // Score each wallet (max 25 to avoid timeout)
    const qualified: WalletProfile[] = [];
    const limit = Math.min(candidates.length, 25);

    for (let i = 0; i < limit; i++) {
      const c = candidates[i];
      try {
        const tradeHistory = await fetchTrades(c.address, 100);
        const activity = computeActivityMetrics(
          tradeHistory as Parameters<typeof computeActivityMetrics>[0]
        );

        if (activity.isBot) continue;
        if (activity.daysSinceActive > FILTERS.MAX_ACTIVE_DAYS_AGO) continue;
        if (activity.tradesPerDay < FILTERS.MIN_TRADES_PER_DAY) continue;
        if (activity.uniqueMarkets < FILTERS.MIN_UNIQUE_MARKETS) continue;
        if (tradeHistory.length < FILTERS.MIN_TRADES) continue;

        const score = computeScore({
          profit: c.profit,
          winRate: 0.55,
          tradesPerDay: activity.tradesPerDay,
          uniqueMarkets: activity.uniqueMarkets,
          daysSinceActive: activity.daysSinceActive,
        });

        qualified.push({
          address:         c.address,
          profit:          c.profit,
          volume:          c.volume,
          tradesCount:     tradeHistory.length,
          winRate:         0.55,
          tradesPerDay:    activity.tradesPerDay,
          uniqueMarkets:   activity.uniqueMarkets,
          daysSinceActive: Math.round(activity.daysSinceActive),
          score,
          userName:        c.userName,
        });
      } catch {
        continue;
      }
    }

    const wallets = qualified.sort((a, b) => b.score - a.score).slice(0, 30);

    // Enrich with DB data from whale_wallets + leader_config
    let leader: LeaderInfo | null = null;
    try {
      const db = getSupabase();
      const addresses = wallets.map((w) => w.address);

      const [whaleRes, leaderRes] = await Promise.all([
        db
          .from("whale_wallets")
          .select("address, real_win_rate, pct_short_term, top_category")
          .in("address", addresses),
        db
          .from("leader_config")
          .select("address, user_name, score, trades_per_day, win_rate, leader_score, selected_at")
          .eq("id", 1)
          .single(),
      ]);

      // Build enrichment map
      const enrichMap = new Map<string, {
        real_win_rate: number | null;
        pct_short_term: number | null;
        top_category: string | null;
      }>();
      for (const row of whaleRes.data ?? []) {
        enrichMap.set(row.address, {
          real_win_rate:  row.real_win_rate  != null ? Number(row.real_win_rate)  : null,
          pct_short_term: row.pct_short_term != null ? Number(row.pct_short_term) : null,
          top_category:   row.top_category   ?? null,
        });
      }

      // Apply enrichment to wallets
      const leaderAddress = leaderRes.data?.address ?? null;
      for (const w of wallets) {
        const e = enrichMap.get(w.address);
        if (e) {
          w.realWinRate  = e.real_win_rate;
          w.pctShortTerm = e.pct_short_term;
          w.topCategory  = e.top_category;
        }
        w.isLeader = w.address === leaderAddress;
      }

      // Build leader info
      if (leaderRes.data) {
        const l = leaderRes.data;
        // Get enriched data for leader (might not be in top 30)
        let leaderEnrich = enrichMap.get(l.address);
        if (!leaderEnrich) {
          const { data: lr } = await db
            .from("whale_wallets")
            .select("real_win_rate, pct_short_term, top_category")
            .eq("address", l.address)
            .single();
          if (lr) {
            leaderEnrich = {
              real_win_rate:  lr.real_win_rate  != null ? Number(lr.real_win_rate)  : null,
              pct_short_term: lr.pct_short_term != null ? Number(lr.pct_short_term) : null,
              top_category:   lr.top_category   ?? null,
            };
          }
        }
        leader = {
          address:      l.address,
          userName:     l.user_name ?? null,
          score:        l.score     != null ? Number(l.score)           : null,
          tradesPerDay: l.trades_per_day != null ? Number(l.trades_per_day) : null,
          winRate:      l.win_rate  != null ? Number(l.win_rate)        : null,
          leaderScore:  l.leader_score != null ? Number(l.leader_score) : null,
          selectedAt:   l.selected_at,
          topCategory:  leaderEnrich?.top_category  ?? null,
          pctShortTerm: leaderEnrich?.pct_short_term ?? null,
        };
      }
    } catch {
      // DB enrichment is optional — don't fail the whole response
    }

    return NextResponse.json({
      wallets,
      computedAt:     new Date().toISOString(),
      candidateCount: candidates.length,
      rawCount:       raw.length,
      leader,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
