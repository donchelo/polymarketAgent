// Mirrors Python dataclasses from whale_scanner.py

export interface WalletProfile {
  address: string;
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
  marketTitle?: string;
  detectedAt?: string;
}

export interface Trade {
  id?: string;
  marketId?: string;
  conditionId?: string;
  outcome?: string;
  side?: string;
  size?: number;
  price?: number;
  timestamp?: number | string;
  created_at?: string;
  marketTitle?: string;
}

export interface LeaderboardResponse {
  wallets: WalletProfile[];
  computedAt: string;
  candidateCount: number;
}

export interface PositionsResponse {
  positions: Position[];
}

export interface TradesResponse {
  trades: Trade[];
}
