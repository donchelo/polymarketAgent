import { NextRequest, NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { fetchLeaderboard, fetchTrades } from "@/lib/polymarket";
import { computeActivityMetrics, computeScore, FILTERS } from "@/lib/scoring";

export const maxDuration = 60;

// CLOB API has current markets; Gamma API only has 2020-era markets
const CLOB_API = "https://clob.polymarket.com";

interface ClobToken { token_id: string; outcome: string; price: number; winner?: boolean; }

const TAG_CATEGORY: Record<string, string> = {
  bitcoin: "btc", btc: "btc",
  ethereum: "eth", eth: "eth",
  crypto: "crypto", cryptocurrency: "crypto", defi: "crypto", nft: "crypto",
  politics: "politics", election: "politics", "us-politics": "politics",
  sports: "sports", nhl: "sports", nba: "sports", nfl: "sports",
  mlb: "sports", soccer: "sports", football: "sports", basketball: "sports",
  hockey: "sports", baseball: "sports", tennis: "sports", golf: "sports",
  ufc: "sports", mma: "sports", esports: "sports",
  economics: "macro", macro: "macro", finance: "macro", fed: "macro",
  inflation: "macro", "interest-rates": "macro",
};

const CATEGORY_PATTERNS: Array<[string, RegExp]> = [
  ["btc",      /\b(btc|bitcoin)\b/i],
  ["eth",      /\b(ethereum)\b|\beth price|\beth [<>$]/i],
  ["crypto",   /\b(crypto|dogecoin|doge|solana|\bsol\b|xrp|ripple|defi|nft|altcoin|memecoin|coinbase|binance)\b/i],
  ["politics", /\b(trump|harris|biden|election|congress|senate|democrat|republican|presidency|white house|supreme court|inauguration|tariff|nato|zelensky|putin|modi|macron|merz)\b/i],
  ["sports",   /\b(nba|nfl|nhl|mlb|fifa|ufc|f1|formula 1|super bowl|world cup|championship|playoffs|league|season|tournament|premier league|la liga|serie a|bundesliga|champions league)\b/i],
  ["sports",   /\b(bruins|canadiens|maple leafs|leafs|lightning|kraken|islanders|rangers|sabres|golden knights|predators|jets|sharks|oilers|flames|canucks|senators|flyers|penguins|capitals|hurricanes|panthers|red wings|avalanche|blues|stars|wild|blackhawks|kings|ducks|coyotes|blue jackets)\b/i],
  ["sports",   /\b(celtics|spurs|mavericks|mavs|cavaliers|cavs|hawks|pelicans|nuggets|thunder|raptors|rockets|bucks|lakers|warriors|nets|knicks|bulls|heat|suns|jazz|grizzlies|clippers|blazers|pacers|magic|hornets|kings|pistons|wizards)\b/i],
  ["sports",   /\b(chiefs|eagles|patriots|cowboys|49ers|packers|bills|ravens|bengals|steelers|dolphins|jets|giants|commanders|bears|vikings|lions|seahawks|rams|cardinals|broncos|raiders|chargers|texans|colts|jaguars|titans|saints|falcons|panthers|buccaneers)\b/i],
  ["sports",   /\b(yankees|red sox|dodgers|cubs|mets|astros|giants|braves|cardinals|phillies|brewers|mariners|athletics|angels|rangers|tigers|guardians|twins|white sox|royals|pirates|padres|rockies|diamondbacks|marlins|rays|nationals|orioles|blue jays)\b/i],
  ["sports",   /\b(chelsea|arsenal|liverpool|manchester|city fc|united fc|real madrid|barcelona|atletico|juventus|inter milan|ac milan|psg|paris saint-germain|bayern|dortmund|ajax|porto|benfica|celtic)\b/i],
  ["sports",   /^[A-Z][a-zA-Z\s]+ vs\.? [A-Z][a-zA-Z\s]+$/],
  ["macro",    /\b(gdp|inflation|fed|federal reserve|interest rate|recession|unemployment|cpi|fomc|rate cut|rate hike)\b/i],
];

function detectCategory(question: string, tags: string[] = []): string {
  for (const tag of tags) {
    const cat = TAG_CATEGORY[tag.toLowerCase()];
    if (cat) return cat;
  }
  for (const [cat, pattern] of CATEGORY_PATTERNS) {
    if (pattern.test(question)) return cat;
  }
  return "other";
}

async function fetchMarketInfo(conditionId: string) {
  try {
    const res = await fetch(
      `${CLOB_API}/markets/${conditionId}`,
      { headers: { Accept: "application/json" }, cache: "no-store" }
    );
    if (!res.ok) return null;
    const m = await res.json();
    if (!m || m.condition_id !== conditionId) return null;
    return {
      question: String(m.question ?? ""),
      endDate:  m.end_date_iso ?? m.game_start_time ?? null as string | null,
      resolved: m.closed === true,
      closed:   m.closed === true,
      tokens:   (m.tokens ?? []) as ClobToken[],
      tags:     (m.tags   ?? []) as string[],
    };
  } catch {
    return null;
  }
}

/**
 * Compute market intelligence metrics for a whale from their trade history.
 * Returns: realWinRate, avgMarketDurationH, pctShortTerm, topCategory
 */
async function computeMarketIntelligence(
  address: string,
  trades: Record<string, unknown>[]
) {
  // Extract unique conditionIds (cap at 20 to stay within timeout)
  const conditionIds: string[] = [];
  const seen = new Set<string>();
  for (const t of trades) {
    const cid = String(t.conditionId ?? t.market ?? t.marketId ?? "");
    if (cid && !seen.has(cid)) {
      seen.add(cid);
      conditionIds.push(cid);
      if (conditionIds.length >= 20) break;
    }
  }

  if (!conditionIds.length) {
    return { realWinRate: null, avgMarketDurationH: null, pctShortTerm: 0, topCategory: null };
  }

  // Build trade outcome map
  const tradeSides: Record<string, string> = {};
  for (const t of trades) {
    const cid = String(t.conditionId ?? t.market ?? t.marketId ?? "");
    const outcome = String(t.outcome ?? "");
    if (cid && outcome && !tradeSides[cid]) tradeSides[cid] = outcome;
  }

  // Fetch market info in parallel via CLOB API
  const marketInfos = await Promise.allSettled(
    conditionIds.map((cid) => fetchMarketInfo(cid))
  );

  let totalDurationH = 0;
  let shortTermCount = 0;
  let resolvedCount  = 0;
  let wonCount       = 0;
  let validDurations = 0;
  const categoryMap: Record<string, number> = {};

  for (let i = 0; i < marketInfos.length; i++) {
    const r = marketInfos[i];
    if (r.status !== "fulfilled" || !r.value) continue;
    const m = r.value;
    const cid = conditionIds[i];

    // Duration: sports markets are always same-day (<24h)
    const isSports = (m.tags ?? []).some((t) =>
      ["sports","nhl","nba","nfl","mlb","soccer","basketball","hockey","baseball","football","tennis","golf","ufc"].includes(t.toLowerCase())
    );
    if (isSports) {
      totalDurationH += 12;
      validDurations++;
      shortTermCount++;
    } else if (m.endDate) {
      const end = new Date(m.endDate).getTime();
      if (!isNaN(end)) {
        const dh = Math.abs(end - Date.now()) / (1000 * 3600);
        totalDurationH += dh;
        validDurations++;
        if (dh < 24) shortTermCount++;
      }
    }

    if (m.question) {
      const cat = detectCategory(m.question, m.tags);
      categoryMap[cat] = (categoryMap[cat] ?? 0) + 1;
    }

    if ((m.resolved || m.closed) && m.tokens?.length) {
      const tradeOutcome = tradeSides[cid] ?? "";
      const matchedToken = m.tokens.find(
        (tk) => tk.outcome.toLowerCase() === tradeOutcome.toLowerCase()
      ) ?? m.tokens[0];
      if (matchedToken && m.question) {
        resolvedCount++;
        if (matchedToken.winner === true || matchedToken.price >= 0.99) wonCount++;
      }
    }
  }

  // Only report win rate if we have at least 5 resolved samples
  const realWinRate      = resolvedCount >= 5 ? wonCount / resolvedCount : null;
  const avgMarketDurationH = validDurations > 0
    ? Math.round((totalDurationH / validDurations) * 10) / 10
    : null;
  const pctShortTerm     = validDurations > 0
    ? Math.round((shortTermCount / validDurations) * 100) / 100
    : 0;

  const topCategory = Object.entries(categoryMap)
    .sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return { realWinRate, avgMarketDurationH, pctShortTerm, topCategory };
}

export async function GET(req: NextRequest) {
  // Auth: same pattern as scan cron
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  try {
    // Fetch up to 200 wallets from leaderboard
    const raw = await fetchLeaderboard(200);

    const candidates = raw
      .map((w) => ({
        address:   String(w.proxyWallet ?? w.proxyWalletAddress ?? w.address ?? ""),
        user_name: String(w.userName ?? w.name ?? ""),
        profit:    Number(w.pnl ?? w.profit ?? 0),
        volume:    Number(w.vol ?? w.volume ?? 0),
      }))
      .filter((c) => c.address && c.profit >= FILTERS.MIN_PROFIT_USDC)
      .slice(0, 100); // top 100 wallets

    if (!candidates.length) {
      return NextResponse.json({ ok: false, error: "No wallets returned from leaderboard", ts: new Date().toISOString() });
    }

    // Score each wallet + compute market intelligence
    const wallets = [];
    for (const c of candidates) {
      try {
        const trades = await fetchTrades(c.address, 100);
        const activity = computeActivityMetrics(trades as Parameters<typeof computeActivityMetrics>[0]);
        const score = computeScore({
          profit: c.profit,
          winRate: 0.55,
          tradesPerDay: activity.tradesPerDay,
          uniqueMarkets: activity.uniqueMarkets,
          daysSinceActive: activity.daysSinceActive,
        });
        if (score < 30 || activity.isBot) continue;

        // Compute market intelligence for wallets scoring >= 50
        let marketIntel = { realWinRate: null as number | null, avgMarketDurationH: null as number | null, pctShortTerm: 0, topCategory: null as string | null };
        if (score >= 50) {
          marketIntel = await computeMarketIntelligence(c.address, trades as Record<string, unknown>[]);
        }

        wallets.push({
          ...c,
          score,
          trades_per_day: activity.tradesPerDay,
          win_rate: 0.52, // proxy; real_win_rate is the true estimate
          real_win_rate:         marketIntel.realWinRate,
          avg_market_duration_h: marketIntel.avgMarketDurationH,
          pct_short_term:        marketIntel.pctShortTerm,
          top_category:          marketIntel.topCategory,
          updated_at: new Date().toISOString(),
        });
      } catch {
        wallets.push({ ...c, score: 0, trades_per_day: 0, win_rate: 0.52, updated_at: new Date().toISOString() });
      }
    }

    const db = getSupabase();

    const { error } = await db.from("whale_wallets").upsert(wallets, { onConflict: "address" });

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    const withRealWinRate = wallets.filter((w) => (w as Record<string, unknown>).real_win_rate != null).length;

    return NextResponse.json({
      ok:             true,
      saved:          wallets.length,
      scored:         wallets.filter((w) => w.score > 0).length,
      withRealWinRate,
      ts:             new Date().toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
