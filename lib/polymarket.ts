// Server-side only fetch helpers for Polymarket API
// Set USE_MOCK=true to use mock data during local dev (geo-blocked in Colombia)

const BASE_DATA_API = "https://data-api.polymarket.com";
const USE_MOCK = process.env.USE_MOCK === "true";

const MOCK_PROFILES: Record<string, unknown>[] = Array.from({ length: 20 }, (_, i) => ({
  proxyWalletAddress: `0x${String(i + 1).padStart(40, "a")}`,
  pnl: 5000 + i * 3000,
  volume: 20000 + i * 10000,
  tradesCount: 80 + i * 15,
  winRate: 0.55 + (i % 5) * 0.02,
}));

const MOCK_TRADES = Array.from({ length: 50 }, (_, i) => ({
  timestamp: Date.now() / 1000 - i * 3600 * 4,
  conditionId: `market-${(i % 12) + 1}`,
  outcome: i % 2 === 0 ? "YES" : "NO",
  size: 100 + i * 10,
  price: 0.4 + (i % 6) * 0.1,
}));

const MOCK_POSITIONS = Array.from({ length: 5 }, (_, i) => ({
  conditionId: `market-${i + 1}`,
  outcome: i % 2 === 0 ? "YES" : "NO",
  size: 200 + i * 50,
  avgPrice: 0.45 + i * 0.08,
}));

async function polyFetch(url: string, params: Record<string, string | number> = {}): Promise<unknown> {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, String(v)])
  ).toString();
  const full = qs ? `${url}?${qs}` : url;

  const res = await fetch(full, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Polymarket API ${res.status}: ${full}`);
  return res.json();
}

function normalizeList(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data as Record<string, unknown>[];
  if (data && typeof data === "object") {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.data)) return d.data as Record<string, unknown>[];
    if (Array.isArray(d.results)) return d.results as Record<string, unknown>[];
  }
  return [];
}

// New leaderboard endpoint — max 50 per request, paginate 4x to get 200
export async function fetchLeaderboard(limit = 200): Promise<Record<string, unknown>[]> {
  if (USE_MOCK) return MOCK_PROFILES;

  const pageSize = 50;
  const pages = Math.ceil(Math.min(limit, 200) / pageSize);
  const results: Record<string, unknown>[] = [];

  for (let offset = 0; offset < pages * pageSize; offset += pageSize) {
    try {
      const data = await polyFetch(`${BASE_DATA_API}/v1/leaderboard`, {
        limit: pageSize,
        offset,
        orderBy: "PNL",
        timePeriod: "ALL",
        category: "OVERALL",
      });
      const page = normalizeList(data);
      if (!page.length) break;
      results.push(...page);
    } catch {
      break;
    }
  }

  return results;
}

export async function fetchTrades(address: string, limit = 100): Promise<Record<string, unknown>[]> {
  if (USE_MOCK) return MOCK_TRADES as Record<string, unknown>[];
  const data = await polyFetch(`${BASE_DATA_API}/trades`, { user: address, limit });
  return normalizeList(data);
}

export async function fetchPositions(address: string): Promise<Record<string, unknown>[]> {
  if (USE_MOCK) return MOCK_POSITIONS as Record<string, unknown>[];
  const data = await polyFetch(`${BASE_DATA_API}/positions`, { user: address });
  return normalizeList(data);
}
