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
 *   score      NUMERIC,
 *   trades_per_day NUMERIC,
 *   win_rate   NUMERIC,
 *   real_win_rate  NUMERIC,
 *   avg_market_duration_h NUMERIC,
 *   pct_short_term NUMERIC,
 *   top_category   TEXT,
 *   updated_at TIMESTAMPTZ DEFAULT now()
 * );
 *
 * -- Migration: add market intelligence columns to existing table
 * ALTER TABLE whale_wallets
 *   ADD COLUMN IF NOT EXISTS real_win_rate NUMERIC,
 *   ADD COLUMN IF NOT EXISTS avg_market_duration_h NUMERIC,
 *   ADD COLUMN IF NOT EXISTS pct_short_term NUMERIC,
 *   ADD COLUMN IF NOT EXISTS top_category TEXT;
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
 *   whale_win_rate       NUMERIC,
 *   market_id            TEXT NOT NULL,
 *   market_title         TEXT,
 *   outcome              TEXT,
 *   whale_size_usdc      NUMERIC,
 *   entry_price          NUMERIC,
 *   suggested_size_usdc  NUMERIC,
 *   status               TEXT DEFAULT 'open',  -- open | won | lost | whale_exited
 *   exit_price           NUMERIC,
 *   pnl_usdc             NUMERIC,
 *   created_at           TIMESTAMPTZ DEFAULT now()
 * );
 *
 * -- Migration: add whale_win_rate column to existing signals table
 * ALTER TABLE signals ADD COLUMN IF NOT EXISTS whale_win_rate NUMERIC;
 *
 * -- Leader config (singleton row, id=1)
 * CREATE TABLE IF NOT EXISTS leader_config (
 *   id             INT PRIMARY KEY DEFAULT 1,
 *   address        TEXT NOT NULL,
 *   user_name      TEXT,
 *   score          NUMERIC,
 *   trades_per_day NUMERIC,
 *   win_rate       NUMERIC,
 *   leader_score   NUMERIC,
 *   selected_at    TIMESTAMPTZ DEFAULT now()
 * );
 */

export interface WhaleWallet {
  address: string;
  user_name: string | null;
  profit: number;
  volume: number;
  score?: number;
  trades_per_day?: number;
  win_rate?: number;
  real_win_rate?: number | null;
  avg_market_duration_h?: number | null;
  pct_short_term?: number | null;
  top_category?: string | null;
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

export type SignalStatus = "open" | "won" | "lost" | "whale_exited";

export interface Signal {
  id: string;
  whale_address: string;
  whale_score: number;
  whale_trades_per_day: number;
  whale_win_rate?: number | null;
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

export interface LeaderConfig {
  id: number;
  address: string;
  user_name: string | null;
  score: number | null;
  trades_per_day: number | null;
  win_rate: number | null;
  leader_score: number | null;
  selected_at: string;
}
