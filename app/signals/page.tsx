"use client";

import useSWR from "swr";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Signal {
  id: string;
  whale_address: string;
  whale_score: number;
  whale_trades_per_day: number;
  whale_win_rate?: number;
  market_id: string;
  market_title: string;
  outcome: string;
  whale_size_usdc: number;
  entry_price: number;
  suggested_size_usdc: number;
  status: "open" | "won" | "lost" | "expired" | "whale_exited";
  exit_price?: number;
  pnl_usdc?: number;
  leader_rank?: number | null;
  leader_weight?: number | null;
  created_at: string;
}

interface Stats {
  openPositions: number;
  exposure: number;
  maxExposure: number;
  bankroll: number;
  exposurePct: number;
  availableCash: number;
  closedPositions: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  roi: number | null;
}

interface Leader {
  address: string;
  user_name?: string | null;
  score: number;
  trades_per_day: number;
  win_rate: number;
  real_win_rate?: number | null;
  leader_score: number;
  rank: number;
}

interface EquityPoint { ts: string; cumPnl: number }

// ── Equity curve (pure SVG, no library) ──────────────────────────────────────
function EquityCurve({ points }: { points: EquityPoint[] }) {
  if (points.length < 2) return null;

  const W = 600, H = 80, PAD = 4;
  const values = points.map(p => p.cumPnl);
  const min    = Math.min(0, ...values);
  const max    = Math.max(0, ...values);
  const range  = max - min || 1;

  const toX = (i: number) => PAD + (i / (points.length - 1)) * (W - PAD * 2);
  const toY = (v: number) => PAD + (1 - (v - min) / range) * (H - PAD * 2);

  const pathD = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${toX(i).toFixed(1)},${toY(p.cumPnl).toFixed(1)}`)
    .join(" ");

  const zeroY = toY(0).toFixed(1);
  const lastVal = values[values.length - 1];
  const isPositive = lastVal >= 0;
  const color = isPositive ? "#34d399" : "#f87171";

  // Fill area under/over zero
  const fillD = `${pathD} L${toX(points.length - 1).toFixed(1)},${zeroY} L${toX(0).toFixed(1)},${zeroY} Z`;

  return (
    <div className="rounded-xl border border-zinc-800/60 p-4 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Equity Curve</p>
        <div className="flex items-center gap-3 text-xs font-mono">
          <span className={isPositive ? "text-emerald-400" : "text-red-400"}>
            {isPositive ? "+" : ""}${lastVal.toFixed(2)}
          </span>
          <span className="text-zinc-600">{points.length} trades</span>
        </div>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ height: 80 }}
        preserveAspectRatio="none"
      >
        {/* Zero baseline */}
        <line x1={PAD} y1={zeroY} x2={W - PAD} y2={zeroY}
          stroke="#3f3f46" strokeWidth="1" strokeDasharray="3,3" />
        {/* Fill */}
        <path d={fillD} fill={color} fillOpacity="0.08" />
        {/* Line */}
        <path d={pathD} fill="none" stroke={color} strokeWidth="1.5"
          strokeLinejoin="round" strokeLinecap="round" />
        {/* Last point dot */}
        <circle
          cx={toX(points.length - 1).toFixed(1)}
          cy={toY(lastVal).toFixed(1)}
          r="3" fill={color}
        />
      </svg>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusBadge(status: Signal["status"]) {
  const map: Record<Signal["status"], string> = {
    open:         "bg-blue-900/40 text-blue-300 border border-blue-800",
    won:          "bg-emerald-900/40 text-emerald-300 border border-emerald-800",
    lost:         "bg-red-900/40 text-red-300 border border-red-800",
    expired:      "bg-zinc-800 text-zinc-500 border border-zinc-700",
    whale_exited: "bg-amber-900/40 text-amber-300 border border-amber-800",
  };
  return map[status] ?? map.expired;
}

function rankBadge(rank: number | null | undefined) {
  if (!rank || rank > 3) return null;
  const styles = [
    "bg-amber-500/20 text-amber-300 border border-amber-600/50",   // L1
    "bg-zinc-700/60 text-zinc-300 border border-zinc-600",          // L2
    "bg-zinc-800/60 text-zinc-400 border border-zinc-700",          // L3
  ];
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${styles[rank - 1]}`}>
      L{rank}
    </span>
  );
}

function timeAgo(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

// ── Components ────────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, accent }: {
  label: string; value: string | number; sub?: string; accent?: string;
}) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <p className="text-[11px] text-zinc-500 uppercase tracking-widest font-medium mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono tabular-nums ${accent ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-600 mt-1">{sub}</p>}
    </div>
  );
}

function LeaderCard({ leader }: { leader: Leader }) {
  const wr = leader.real_win_rate ?? leader.win_rate;
  const rankLabels = ["", "Líder principal", "Líder #2", "Líder #3"];
  const rankColors = [
    "",
    "border-amber-600/40 bg-amber-500/5",
    "border-zinc-700 bg-zinc-900/60",
    "border-zinc-800 bg-zinc-900/40",
  ];
  return (
    <div className={`rounded-xl border p-3 space-y-1.5 ${rankColors[leader.rank]}`}>
      <div className="flex items-center gap-2">
        {rankBadge(leader.rank)}
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{rankLabels[leader.rank]}</span>
      </div>
      <p className="text-sm font-mono font-bold text-white truncate">
        {leader.user_name || leader.address.slice(0, 10) + "…"}
      </p>
      <div className="flex gap-3 text-xs font-mono text-zinc-500">
        <span>WR <span className="text-zinc-300">{Math.round(wr * 100)}%</span></span>
        <span>{leader.trades_per_day.toFixed(1)}<span className="text-zinc-600"> t/d</span></span>
        <span>∑ <span className="text-zinc-300">{leader.leader_score.toFixed(2)}</span></span>
      </div>
    </div>
  );
}

function SignalRow({ signal: s }: { signal: Signal }) {
  return (
    <div className="bg-zinc-900/60 rounded-xl border border-zinc-800/60 p-3.5 flex flex-col sm:flex-row sm:items-center gap-3 hover:border-zinc-700/60 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1 flex-wrap">
          <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${statusBadge(s.status)}`}>
            {s.status === "whale_exited" ? "SALIÓ" : s.status.toUpperCase()}
          </span>
          {rankBadge(s.leader_rank)}
          <span className={`text-xs font-mono font-bold ${s.outcome?.toLowerCase() === "yes" ? "text-emerald-400" : "text-red-400"}`}>
            {s.outcome}
          </span>
          <span className="text-[11px] text-zinc-600">{timeAgo(s.created_at)}</span>
        </div>
        <a
          href={`https://polymarket.com/event/${s.market_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-zinc-200 hover:text-white hover:underline truncate block"
        >
          {s.market_title || s.market_id.slice(0, 40) + "…"}
        </a>
        <p className="text-[11px] text-zinc-600 mt-0.5 font-mono">
          {s.whale_address.slice(0, 8)}… · score {s.whale_score?.toFixed(0)}
          {s.whale_win_rate != null && ` · WR ${(s.whale_win_rate * 100).toFixed(0)}%`}
          {s.leader_weight != null && ` · peso ${(s.leader_weight * 100).toFixed(0)}%`}
        </p>
      </div>
      <div className="flex gap-5 text-right shrink-0">
        <div>
          <p className="text-[10px] text-zinc-600">Entrada</p>
          <p className="font-mono text-sm text-zinc-200">{s.entry_price?.toFixed(3)}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-600">Tamaño</p>
          <p className="font-mono text-sm text-zinc-200">${s.suggested_size_usdc?.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-[10px] text-zinc-600">Whale $</p>
          <p className="font-mono text-sm text-zinc-500">${s.whale_size_usdc?.toFixed(0)}</p>
        </div>
        {s.pnl_usdc != null && (
          <div>
            <p className="text-[10px] text-zinc-600">P&L</p>
            <p className={`font-mono text-sm font-bold ${s.pnl_usdc >= 0 ? "text-emerald-400" : "text-red-400"}`}>
              {s.pnl_usdc >= 0 ? "+" : ""}${s.pnl_usdc.toFixed(2)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function SignalsPage() {
  const { data, isLoading } = useSWR<{
    signals: Signal[];
    stats: Stats;
    leaders: Leader[];
    equityCurve: EquityPoint[];
  }>("/api/signals", fetcher, { refreshInterval: 30_000 });

  const stats        = data?.stats;
  const signals      = data?.signals ?? [];
  const leaders      = data?.leaders ?? [];
  const equityCurve  = data?.equityCurve ?? [];
  const open         = signals.filter((s) => s.status === "open");
  const closed       = signals.filter((s) => s.status !== "open" && s.status !== "expired");

  const pnlColor = (stats?.totalPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-2xl font-bold text-white">Señales Paper Trading</h2>
        <p className="text-sm text-zinc-500 mt-1">
          $100 USDC simulado · Kelly ¼ ponderado por rank · copiando top {leaders.length || 3} líderes
        </p>
      </div>

      {/* Multi-leader panel */}
      {leaders.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {leaders.map(l => <LeaderCard key={l.address} leader={l} />)}
        </div>
      )}
      {!isLoading && leaders.length === 0 && (
        <div className="rounded-xl border border-zinc-800 p-4 text-center text-zinc-600 text-sm">
          Sin líderes aún. Ejecuta refresh-leaderboard para poblar whale_wallets.
        </div>
      )}

      {/* Stats */}
      {isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 bg-zinc-900 rounded-xl border border-zinc-800" />
          ))}
        </div>
      )}
      {stats && !isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard
            label="Abiertas"
            value={stats.openPositions}
            sub={`$${stats.availableCash.toFixed(2)} libre`}
            accent="text-blue-400"
          />
          <StatCard
            label="Exposición"
            value={`$${stats.exposure.toFixed(2)}`}
            sub={`${stats.exposurePct}% de $${stats.bankroll}`}
            accent={stats.exposurePct > 75 ? "text-amber-400" : "text-zinc-200"}
          />
          <StatCard
            label="Win rate"
            value={`${stats.winRate}%`}
            sub={`${stats.wins}W / ${stats.losses}L`}
            accent={stats.winRate >= 55 ? "text-emerald-400" : stats.winRate >= 50 ? "text-yellow-400" : "text-red-400"}
          />
          <StatCard
            label="P&L simulado"
            value={`${(stats.totalPnl ?? 0) >= 0 ? "+" : ""}$${(stats.totalPnl ?? 0).toFixed(2)}`}
            sub={`${stats.closedPositions} cerradas`}
            accent={pnlColor}
          />
          <StatCard
            label="ROI"
            value={stats.roi != null ? `${stats.roi > 0 ? "+" : ""}${stats.roi}%` : "—"}
            sub="sobre capital apostado"
            accent={stats.roi != null ? (stats.roi >= 0 ? "text-emerald-400" : "text-red-400") : "text-zinc-500"}
          />
        </div>
      )}

      {/* Equity curve */}
      {equityCurve.length >= 2 && <EquityCurve points={equityCurve} />}

      {/* Open positions */}
      {open.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Posiciones abiertas ({open.length})
          </p>
          {open.map((s) => <SignalRow key={s.id} signal={s} />)}
        </section>
      )}

      {!isLoading && open.length === 0 && (
        <div className="rounded-xl border border-zinc-800/40 p-8 text-center text-zinc-600 text-sm">
          Sin señales abiertas. El cron escanea cada 30min.
        </div>
      )}

      {/* History */}
      {closed.length > 0 && (
        <section className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Historial ({closed.length})
          </p>
          {closed.map((s) => <SignalRow key={s.id} signal={s} />)}
        </section>
      )}
    </div>
  );
}
