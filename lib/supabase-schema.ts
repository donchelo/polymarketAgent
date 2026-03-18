/**
 * TypeScript types for Supabase tables.
 *
 * SQL to create tables (run in Supabase SQL editor):
 *
 * -- Whale wallets cache (refreshed every 30min)
 * CREATE TABLE IF NOT EXISTS whale_wallets (
 *   address    TEXT PRIMARY KEY,
 *   user_name  TEXT,
 *   profit     NUMERIC,
 *   volume     NUMERIC,
 *   updated_at TIMESTAMPTZ DEFAULT now()
 * );
 *
 * -- Position snapshots (detect new entries)
 * CREATE TABLE IF NOT EXISTS position_snapshots (
 *   id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   whale_address TEXT NOT NULL,
 *   market_id     TEXT NOT NULL,
 *   outcome       TEXT NOT NULL,
 *   size          NUMERIC,
 *   avg_price     NUMERIC,
 *   updated_at    TIMESTAMPTZ DEFAULT now(),
 *   UNIQUE(whale_address, market_id, outcome)
 * );
 *
 * -- Signals (paper trading)
 * CREATE TABLE IF NOT EXISTS signals (
 *   id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 *   whale_address        TEXT NOT NULL,
 *   whale_score          NUMERIC,
 *   whale_trades_per_day NUMERIC,
 *   market_id            TEXT NOT NULL,
 *   market_title         TEXT,
 *   outcome              TEXT,
 *   whale_size_usdc      NUMERIC,
 *   entry_price          NUMERIC,
 *   suggested_size_usdc  NUMERIC,
 *   status               TEXT DEFAULT 'open',  -- open | won | lost | expired
 *   exit_price           NUMERIC,
 *   pnl_usdc             NUMERIC,
 *   created_at           TIMESTAMPTZ DEFAULT now()
 * );
 */

export interface WhaleWallet {
  address: string;
  user_name: string | null;
  profit: number;
  volume: number;
  updated_at: string;
}

export interface PositionSnapshot {
  id: string;
  whale_address: string;
  market_id: string;
  outcome: string;
  size: number;
  avg_price: number;
  updated_at: string;
}

export type SignalStatus = "open" | "won" | "lost" | "expired";

export interface Signal {
  id: string;
  whale_address: string;
  whale_score: number;
  whale_trades_per_day: number;
  market_id: string;
  market_title: string | null;
  outcome: string;
  whale_size_usdc: number;
  entry_price: number;
  suggested_size_usdc: number;
  status: SignalStatus;
  exit_price: number | null;
  pnl_usdc: number | null;
  created_at: string;
}
