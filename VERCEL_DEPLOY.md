# Vercel Deployment

## Settings in Vercel Dashboard

| Setting          | Value                        |
|------------------|------------------------------|
| Repository       | donchelo/polymarketAgent     |
| Root Directory   | `web`                        |
| Framework Preset | Next.js                      |
| Build Command    | `npm run build`              |
| Output Directory | `.next`                      |

## Environment Variables

| Variable   | Value  | Notes                                           |
|------------|--------|-------------------------------------------------|
| `USE_MOCK` | `false`| Must be `false` in Vercel (USA servers, no geo-block) |

## Local Dev (Colombia / geo-blocked)

```bash
# .env.local already sets USE_MOCK=true
npm run dev
```

Uses in-memory mock data — no real Polymarket API calls.

## Test Real Data

Push to GitHub → Vercel preview URL → access from any non-blocked region.

## Supabase Migration — Fase 3

Run this in Supabase SQL editor before deploying Fase 3:

```sql
ALTER TABLE whale_wallets
  ADD COLUMN IF NOT EXISTS real_win_rate NUMERIC,
  ADD COLUMN IF NOT EXISTS avg_market_duration_h NUMERIC,
  ADD COLUMN IF NOT EXISTS pct_short_term NUMERIC,
  ADD COLUMN IF NOT EXISTS top_category TEXT;
```

After migration:
1. Trigger `/api/cron/refresh-leaderboard` once to populate the new columns
2. Visit `/whale-study` to see the market intelligence report
3. The scan cron will now use `real_win_rate` + `pct_short_term` for leader selection
