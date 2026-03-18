import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchTrades } from "@/lib/polymarket";
import { computeActivityMetrics } from "@/lib/scoring";
import { computeLeaderScore } from "@/lib/leader";

export const maxDuration = 60;

const GAMMA_API = "https://gamma-api.polymarket.com";

interface MarketInfo {
  question: string;
  startDate?: string;
  endDate?: string;
  resolved?: boolean;
  closed?: boolean;
  outcomePrices?: string[];
}

// Each entry: [category, regex patterns with word boundaries]
const CATEGORY_PATTERNS: Array<[string, RegExp]> = [
  ["btc",      /\b(btc|bitcoin)\b/i],
  ["eth",      /\b(ethereum)\b|\beth price|\beth [<>$]/i],
  ["crypto",   /\b(crypto|dogecoin|doge|solana|\bsol\b|xrp|ripple|defi|nft|altcoin|memecoin|coinbase|binance)\b/i],
  ["politics", /\b(trump|harris|biden|election|congress|senate|democrat|republican|presidency|white house|supreme court|inauguration|tariff|nato|zelensky|putin|modi|macron|merz)\b/i],
  // Explicit league names
  ["sports",   /\b(nba|nfl|nhl|mlb|fifa|ufc|f1|formula 1|super bowl|world cup|championship|playoffs|league|season|tournament|premier league|la liga|serie a|bundesliga|champions league)\b/i],
  // NHL teams
  ["sports",   /\b(bruins|canadiens|maple leafs|leafs|lightning|kraken|islanders|rangers|sabres|golden knights|predators|jets|sharks|oilers|flames|canucks|senators|flyers|penguins|capitals|hurricanes|panthers|red wings|avalanche|blues|stars|wild|blackhawks|kings|ducks|coyotes|blue jackets)\b/i],
  // NBA teams
  ["sports",   /\b(celtics|spurs|mavericks|mavs|cavaliers|cavs|hawks|pelicans|nuggets|thunder|raptors|rockets|bucks|lakers|warriors|nets|knicks|bulls|heat|suns|jazz|grizzlies|clippers|blazers|pacers|magic|hornets|kings|pistons|wizards)\b/i],
  // NFL teams
  ["sports",   /\b(chiefs|eagles|patriots|cowboys|49ers|packers|bills|ravens|bengals|steelers|dolphins|jets|giants|commanders|bears|vikings|lions|seahawks|rams|cardinals|broncos|raiders|chargers|texans|colts|jaguars|titans|saints|falcons|panthers|buccaneers)\b/i],
  // MLB teams
  ["sports",   /\b(yankees|red sox|dodgers|cubs|mets|astros|giants|braves|cardinals|phillies|brewers|mariners|athletics|angels|rangers|tigers|indians|guardians|twins|white sox|royals|pirates|padres|rockies|diamondbacks|marlins|rays|nationals|orioles|blue jays)\b/i],
  // Soccer clubs
  ["sports",   /\b(chelsea|arsenal|liverpool|manchester|city fc|united fc|real madrid|barcelona|atletico|juventus|inter milan|ac milan|psg|paris saint-germain|bayern|dortmund|ajax|porto|benfica|celtic)\b/i],
  // Generic "X vs Y" pattern — likely sports matchup (not caught by other patterns)
  ["sports",   /^[A-Z][a-zA-Z\s]+ vs\.? [A-Z][a-zA-Z\s]+$/],
  ["macro",    /\b(gdp|inflation|fed|federal reserve|interest rate|recession|unemployment|cpi|fomc|rate cut|rate hike)\b/i],
];

function detectCategory(question: string): string {
  for (const [cat, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(question)) return cat;
  }
  return "other";
}

async function fetchMarketInfo(conditionId: string): Promise<MarketInfo | null> {
  try {
    const res = await fetch(
      `${GAMMA_API}/markets?conditionIds=${conditionId}`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const market = Array.isArray(data) ? data[0] : data;
    if (!market) return null;
    return {
      question:      market.question ?? "",
      startDate:     market.startDate ?? market.createdAt ?? null,
      endDate:       market.endDate ?? market.closedTime ?? null,
      resolved:      market.resolved === true,
      closed:        market.closed === true,
      outcomePrices: market.outcomePrices ?? [],
    };
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const db = getSupabase();

    // Load top 20 whales with score >= 50
    const { data: whales, error } = await db
      .from("whale_wallets")
      .select("address, user_name, score, trades_per_day, win_rate, real_win_rate, pct_short_term, avg_market_duration_h, top_category")
      .gte("score", 50)
      .order("score", { ascending: false })
      .limit(20);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!whales?.length) return NextResponse.json({ whales: [], computedAt: new Date().toISOString() });

    // Fetch current leader to mark badge
    const { data: leaderRow } = await db
      .from("leader_config")
      .select("address")
      .eq("id", 1)
      .single();
    const leaderAddress = leaderRow?.address ?? null;

    // Process each whale
    const results = await Promise.all(
      whales.map(async (whale) => {
        try {
          const trades = await fetchTrades(whale.address, 200);
          const activity = computeActivityMetrics(trades as Parameters<typeof computeActivityMetrics>[0]);

          // Extract unique conditionIds from trades (most recent first, cap at 30)
          const conditionIds: string[] = [];
          const seen = new Set<string>();
          for (const t of trades as Record<string, unknown>[]) {
            const cid = String(t.conditionId ?? t.market ?? t.marketId ?? "");
            if (cid && !seen.has(cid)) {
              seen.add(cid);
              conditionIds.push(cid);
              if (conditionIds.length >= 30) break;
            }
          }

          // Fetch market info in parallel (up to 30 markets)
          const marketInfos = await Promise.allSettled(
            conditionIds.map((cid) => fetchMarketInfo(cid))
          );

          // Compute market intelligence
          let totalDurationH = 0;
          let shortTermCount = 0;
          let resolvedCount  = 0;
          let wonCount       = 0;
          const categoryMap: Record<string, number> = {};
          const recentMarkets: Array<{
            question: string;
            conditionId: string;
            durationH: number | null;
            resolved: boolean;
            won: boolean | null;
          }> = [];

          // Build a map from conditionId to the trade direction (YES/NO)
          const tradeSides: Record<string, string> = {};
          for (const t of trades as Record<string, unknown>[]) {
            const cid = String(t.conditionId ?? t.market ?? t.marketId ?? "");
            const outcome = String(t.outcome ?? "").toUpperCase();
            if (cid && outcome && !tradeSides[cid]) {
              tradeSides[cid] = outcome;
            }
          }

          for (let i = 0; i < marketInfos.length; i++) {
            const r = marketInfos[i];
            if (r.status !== "fulfilled" || !r.value) continue;
            const m = r.value;
            const cid = conditionIds[i];

            // Duration
            let durationH: number | null = null;
            if (m.startDate && m.endDate) {
              const start = new Date(m.startDate).getTime();
              const end   = new Date(m.endDate).getTime();
              if (!isNaN(start) && !isNaN(end) && end > start) {
                durationH = (end - start) / (1000 * 3600);
                totalDurationH += durationH;
                if (durationH < 24) shortTermCount++;
              }
            }

            // Category
            const cat = detectCategory(m.question);
            categoryMap[cat] = (categoryMap[cat] ?? 0) + 1;

            // Win rate estimation
            if (m.resolved || m.closed) {
              const yesPrice = Number(m.outcomePrices?.[0] ?? -1);
              if (yesPrice >= 0 && m.question) {
                resolvedCount++;
                const side = tradeSides[cid] ?? "YES";
                const won  = side === "YES" ? yesPrice >= 0.99 : yesPrice <= 0.01;
                if (won) wonCount++;

                if (recentMarkets.length < 5) {
                  recentMarkets.push({
                    question:   m.question.slice(0, 80),
                    conditionId: cid,
                    durationH:   durationH ? Math.round(durationH) : null,
                    resolved:    true,
                    won,
                  });
                }
              }
            } else if (recentMarkets.length < 5 && m.question) {
              recentMarkets.push({
                question:   m.question.slice(0, 80),
                conditionId: cid,
                durationH:   durationH ? Math.round(durationH) : null,
                resolved:    false,
                won:         null,
              });
            }
          }

          const validMarkets  = marketInfos.filter((r) => r.status === "fulfilled" && r.value).length;
          const avgMarketDurationH = validMarkets > 0 ? totalDurationH / validMarkets : null;
          const pctShortTerm  = validMarkets > 0 ? shortTermCount / validMarkets : 0;
          const realWinRate   = resolvedCount >= 5 ? wonCount / resolvedCount : null;

          // Top categories
          const topCategories = Object.entries(categoryMap)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([k]) => k);

          const wForScore = {
            score:         Number(whale.score ?? 0),
            trades_per_day: activity.tradesPerDay,
            win_rate:      Number(whale.win_rate ?? 0.52),
            real_win_rate:  realWinRate,
            pct_short_term: pctShortTerm,
          };
          const compositeScore = Math.round(computeLeaderScore(wForScore) * 100) / 100;

          return {
            address:           whale.address,
            userName:          whale.user_name ?? whale.address.slice(0, 8),
            score:             Number(whale.score ?? 0),
            tradesPerDay:      activity.tradesPerDay,
            avgMarketDurationH: avgMarketDurationH ? Math.round(avgMarketDurationH * 10) / 10 : null,
            pctShortTerm:      Math.round(pctShortTerm * 100),
            topCategories,
            realWinRate:       realWinRate ? Math.round(realWinRate * 100) : null,
            resolvedSample:    resolvedCount,
            compositeScore,
            isCurrentLeader:   whale.address === leaderAddress,
            recentMarkets,
          };
        } catch (err) {
          return {
            address:      whale.address,
            userName:     whale.user_name ?? whale.address.slice(0, 8),
            score:        Number(whale.score ?? 0),
            tradesPerDay: 0,
            avgMarketDurationH: null,
            pctShortTerm:  0,
            topCategories: [],
            realWinRate:   null,
            resolvedSample: 0,
            compositeScore: 0,
            isCurrentLeader: whale.address === leaderAddress,
            recentMarkets:  [],
            error:          err instanceof Error ? err.message : String(err),
          };
        }
      })
    );

    // Sort by compositeScore desc
    results.sort((a, b) => b.compositeScore - a.compositeScore);

    return NextResponse.json({
      whales:      results,
      computedAt:  new Date().toISOString(),
      totalWhales: whales.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
