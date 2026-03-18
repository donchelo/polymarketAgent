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
}

export interface PositionsResponse {
  positions: Position[];
}

export interface TradesResponse {
  trades: Trade[];
}
