export interface StrategyParams {
  BANKROLL: number;
  MAX_EXPOSURE_PCT: number;
  MAX_EXPOSURE_PER_WHALE: number;
  MIN_SIZE: number;
  MAX_SIZE: number;
  WIN_RATE_PROXY: number;
  TOP_WHALES: number;
  MIN_SCORE: number;
  MIN_TRADES_PER_DAY: number;
  MAX_MARKET_DURATION_H: number;
  MIN_PRICE: number;
  MAX_PRICE: number;
  MIN_EDGE: number;
  MIN_REAL_WIN_RATE: number;
}

export const DEFAULT_STRATEGY: StrategyParams = {
  BANKROLL: 100,
  MAX_EXPOSURE_PCT: 0.80,
  MAX_EXPOSURE_PER_WHALE: 15,
  MIN_SIZE: 0.50,
  MAX_SIZE: 5.00,
  WIN_RATE_PROXY: 0.52,
  TOP_WHALES: 10,
  MIN_SCORE: 50,
  MIN_TRADES_PER_DAY: 1.5,
  MAX_MARKET_DURATION_H: 24,
  MIN_PRICE: 0.08,
  MAX_PRICE: 0.92,
  MIN_EDGE: 0.05,
  MIN_REAL_WIN_RATE: 0.54,
};

// Variations to test — vary one param at a time + key combos
export const PARAM_VARIATIONS: Partial<StrategyParams>[] = [
  {},  // baseline
  { MIN_SCORE: 40 }, { MIN_SCORE: 60 }, { MIN_SCORE: 70 },
  { MIN_TRADES_PER_DAY: 1.0 }, { MIN_TRADES_PER_DAY: 2.5 },
  { MIN_REAL_WIN_RATE: 0.52 }, { MIN_REAL_WIN_RATE: 0.58 }, { MIN_REAL_WIN_RATE: 0.62 },
  { MIN_EDGE: 0.03 }, { MIN_EDGE: 0.07 }, { MIN_EDGE: 0.10 },
  { TOP_WHALES: 5 }, { TOP_WHALES: 15 }, { TOP_WHALES: 20 },
  { MIN_REAL_WIN_RATE: 0.58, MIN_EDGE: 0.07 },
  { MIN_SCORE: 60, MIN_REAL_WIN_RATE: 0.58, TOP_WHALES: 8 },
  { MIN_REAL_WIN_RATE: 0.60, MIN_TRADES_PER_DAY: 2.0, TOP_WHALES: 7 },
];
