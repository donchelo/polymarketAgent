export interface WalletProfile {
  address: string;
  userName?: string;
  profit: number;
  volume: number;
  tradesCount: number;
  winRate: number;
  tradesPerDay: number;
  uniqueMarkets: number;
  daysSinceActive: number;
  score: number;
  // enriched from whale_wallets DB
  realWinRate?: number | null;
  pctShortTerm?: number | null;   // 0–1
  topCategory?: string | null;
  isLeader?: boolean;
}

export interface LeaderInfo {
  address: string;
  userName: string | null;
  score: number | null;
  tradesPerDay: number | null;
  winRate: number | null;
  leaderScore: number | null;
  selectedAt: string;
  // enriched
  topCategory?: string | null;
  pctShortTerm?: number | null;
}

export interface Position {
  marketId: string;
  outcome: string;
  size: number;
  avgPrice: number;
  currentValue?: number;
  marketTitle?: string;
}

export interface Trade {
  id?: string;
  marketId?: string;
  outcome?: string;
  side?: string;
  size?: number;
  price?: number;
  timestamp?: number | string;
  marketTitle?: string;
}

export interface LeaderboardResponse {
  wallets: WalletProfile[];
  computedAt: string;
  candidateCount: number;
  rawCount?: number;
  leader?: LeaderInfo | null;
}

export interface PositionsResponse {
  positions: Position[];
}

export interface TradesResponse {
  trades: Trade[];
}
