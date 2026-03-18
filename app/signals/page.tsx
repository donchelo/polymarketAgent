"use client";

import useSWR from "swr";
import Link from "next/link";

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
}

interface Leader {
  address: string;
  user_name?: string;
  score?: number;
  trades_per_day?: number;
  win_rate?: number;
  leader_score?: number;
  selected_at: string;
}

function statusBadge(status: Signal["status"]) {
  const map: Record<Signal["status"], string> = {
    open:         "bg-blue-900/50 text-blue-300 border border-blue-700",
    won:          "bg-green-900/50 text-green-300 border border-green-700",
    lost:         "bg-red-900/50 text-red-300 border border-red-700",
    expired:      "bg-gray-800 text-gray-400 border border-gray-700",
    whale_exited: "bg-yellow-900/50 text-yellow-300 border border-yellow-700",
  };
  return map[status] ?? map.expired;
}

function timeAgo(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function StatItem({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div className="text-right">
      <p className="text-xs text-indigo-400">{label}</p>
      <p className="font-mono font-bold text-white">{value ?? "—"}</p>
    </div>
  );
}

export default function SignalsPage() {
  const { data, isLoading } = useSWR<{ signals: Signal[]; stats: Stats; leader: Leader | null }>(
    "/api/signals",
    fetcher,
    { refreshInterval: 30_000 }
  );

  const stats   = data?.stats;
  const signals = data?.signals ?? [];
  const leader  = data?.leader ?? null;
  const open    = signals.filter((s) => s.status === "open");
  const closed  = signals.filter((s) => s.status !== "open" && s.status !== "expired");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Señales Paper Trading</h2>
          <p className="text-sm text-gray-500 mt-1">
            Simulación con $100 USDC — copiando al líder único
          </p>
        </div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-300">
          ← Leaderboard
        </Link>
      </div>

      {/* Leader card */}
      {leader && (
        <div className="bg-indigo-950/50 border border-indigo-800 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="min-w-0">
            <p className="text-xs text-indigo-400 uppercase tracking-wider">Siguiendo al líder</p>
            <p className="text-lg font-mono font-bold text-white truncate">
              {leader.user_name || leader.address.slice(0, 10) + "…"}
            </p>
          </div>
          <div className="flex gap-6 sm:ml-auto flex-wrap">
            <StatItem label="Win Rate" value={leader.win_rate != null ? `${(leader.win_rate * 100).toFixed(0)}%` : undefined} />
            <StatItem label="Trades/día" value={leader.trades_per_day?.toFixed(1)} />
            <StatItem label="Score" value={leader.score?.toFixed(0)} />
            <StatItem label="Desde" value={timeAgo(leader.selected_at)} />
          </div>
        </div>
      )}

      {!isLoading && !leader && (
        <div className="bg-indigo-950/30 border border-indigo-900 rounded-lg p-4 text-center">
          <p className="text-indigo-400 text-sm">Sin líder seleccionado aún. El próximo scan evaluará candidatos.</p>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          {
            label: "Posiciones abiertas",
            value: stats?.openPositions ?? 0,
            sub: `$${(stats?.availableCash ?? 80).toFixed(2)} disponible`,
            color: "text-blue-400",
          },
          {
            label: "Expuesto / Bankroll",
            value: `$${(stats?.exposure ?? 0).toFixed(2)}`,
            sub: `${stats?.exposurePct ?? 0}% de $${stats?.bankroll ?? 100}`,
            color: (stats?.exposurePct ?? 0) > 75 ? "text-yellow-400" : "text-green-400",
          },
          {
            label: "Win rate",
            value: `${stats?.winRate ?? 0}%`,
            sub: `${stats?.wins ?? 0}W / ${stats?.losses ?? 0}L`,
            color: (stats?.winRate ?? 0) >= 52 ? "text-green-400" : "text-gray-400",
          },
          {
            label: "P&L simulado",
            value: `$${(stats?.totalPnl ?? 0).toFixed(2)}`,
            sub: `${stats?.closedPositions ?? 0} cerradas`,
            color: (stats?.totalPnl ?? 0) >= 0 ? "text-green-400" : "text-red-400",
          },
        ].map((s) => (
          <div key={s.label} className="bg-gray-900 rounded-lg p-4">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-2xl font-mono font-bold mt-1 ${s.color}`}>{s.value}</p>
            <p className="text-xs text-gray-600 mt-1">{s.sub}</p>
          </div>
        ))}
      </div>

      {isLoading && (
        <div className="space-y-2 animate-pulse">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 bg-gray-900 rounded-lg" />
          ))}
        </div>
      )}

      {/* Open positions */}
      {open.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Posiciones Abiertas ({open.length})
          </h3>
          <div className="space-y-2">
            {open.map((s) => (
              <SignalRow key={s.id} signal={s} />
            ))}
          </div>
        </section>
      )}

      {!isLoading && open.length === 0 && (
        <div className="bg-gray-900 rounded-lg p-8 text-center">
          <p className="text-gray-500 text-sm">Sin señales abiertas aún.</p>
          <p className="text-gray-600 text-xs mt-2">El cron escanea cada 5 min. Si acabas de activarlo, espera el primer ciclo.</p>
        </div>
      )}

      {/* Closed positions */}
      {closed.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Historial ({closed.length})
          </h3>
          <div className="space-y-2">
            {closed.map((s) => (
              <SignalRow key={s.id} signal={s} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function SignalRow({ signal: s }: { signal: Signal }) {
  return (
    <div className="bg-gray-900 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-3">
      {/* Left: market info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(s.status)}`}>
            {s.status === "whale_exited" ? "SALIÓ" : s.status.toUpperCase()}
          </span>
          <span className={`text-xs font-mono font-bold ${s.outcome?.toLowerCase() === "yes" ? "text-green-400" : "text-red-400"}`}>
            {s.outcome}
          </span>
          <span className="text-xs text-gray-600">{timeAgo(s.created_at)}</span>
        </div>
        <a
          href={`https://polymarket.com/event/${s.market_id}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-gray-200 hover:text-white hover:underline truncate block"
        >
          {s.market_title || s.market_id.slice(0, 40) + "…"}
        </a>
        <p className="text-xs text-gray-500 mt-0.5 font-mono">
          {s.whale_address.slice(0, 8)}… · score {s.whale_score?.toFixed(0)} · {s.whale_trades_per_day?.toFixed(1)} trades/día
          {s.whale_win_rate != null && ` · WR ${(s.whale_win_rate * 100).toFixed(0)}%`}
        </p>
      </div>

      {/* Right: numbers */}
      <div className="flex gap-6 text-right shrink-0">
        <div>
          <p className="text-xs text-gray-500">Entrada</p>
          <p className="font-mono text-white">{s.entry_price?.toFixed(3)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Tamaño</p>
          <p className="font-mono text-white">${s.suggested_size_usdc?.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500">Whale $</p>
          <p className="font-mono text-gray-400">${s.whale_size_usdc?.toFixed(0)}</p>
        </div>
        {s.pnl_usdc != null && (
          <div>
            <p className="text-xs text-gray-500">P&L</p>
            <p className={`font-mono font-bold ${s.pnl_usdc >= 0 ? "text-green-400" : "text-red-400"}`}>
              {s.pnl_usdc >= 0 ? "+" : ""}${s.pnl_usdc.toFixed(2)}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
