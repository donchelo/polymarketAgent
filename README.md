# Polymarket Whale Leaderboard

![CI](https://github.com/donchelo/polymarketAgent/actions/workflows/ci.yml/badge.svg)
![Deploy](https://github.com/donchelo/polymarketAgent/actions/workflows/deploy.yml/badge.svg)

Top 30 wallets activas en Polymarket, rankeadas por frecuencia, diversidad y profit.

Resuelve el geo-bloqueo de Polymarket en Colombia — las API routes corren en servidores de Vercel (USA).

## Stack

- **Next.js 14** App Router + TypeScript
- **Tailwind CSS v3** — dark theme
- **SWR** — refresco automático cada 30s
- **ISR** — caché inteligente por ruta (30min leaderboard, 2min posiciones)

## Rutas

| Ruta | Descripción |
|------|-------------|
| `/` | Leaderboard top 30 wallets |
| `/wallet/[address]` | Posiciones abiertas + trades recientes |
| `/api/leaderboard` | Proxy + scoring (revalidate 30min) |
| `/api/positions?address=0x...` | Posiciones de wallet (revalidate 2min) |
| `/api/trades?address=0x...` | Últimos trades (revalidate 5min) |

## Dev local (geo-bloqueado en Colombia)

```bash
npm install
# .env.local ya tiene USE_MOCK=true
npm run dev
```

Usa datos mock — sin llamadas reales a Polymarket.

## Deploy en Vercel

Ver [VERCEL_DEPLOY.md](./VERCEL_DEPLOY.md).

**Secrets de GitHub requeridos:**
- `VERCEL_TOKEN` — Account Settings → Tokens en vercel.com
- `VERCEL_ORG_ID` + `VERCEL_PROJECT_ID` — se obtienen corriendo `vercel link` en local

## Scoring (port de whale_scanner.py)

| Componente | Peso |
|-----------|------|
| Frecuencia (trades/día, máx 3/día) | 35 pts |
| Diversidad (mercados únicos, máx 30) | 25 pts |
| Win Rate | 25 pts |
| Profit absoluto (log-scaled) | 15 pts |
| Penalización por inactividad | −20 pts |
