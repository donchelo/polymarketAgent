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
