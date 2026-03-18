"use client";

import useSWR from "swr";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Signal {
  id: string;
  whale_address: string;
  whale_score: number;
  whale_trades_per_day: number;
  market_id: string;
  market_title: string;
  outcome: string;
  whale_size_usdc: number;
  entry_price: number;
  suggested_size_usdc: number;
  status: "open" | "won" | "lost" | "expired";
  exit_price?: number;
  pnl_usdc?: number;
  created_at: string;
}

interface Stats {
  totalSignals: number;
  openPositions: number;
  closedPositions: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
}

function statusBadge(status: Signal["status"]) {
  const map = {
    open:    "bg-blue-900/50 text-blue-300 border border-blue-700",
    won:     "bg-green-900/50 text-green-300 border border-green-700",
    lost:    "bg-red-900/50 text-red-300 border border-red-700",
    expired: "bg-gray-800 text-gray-400 border border-gray-700",
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

export default function SignalsPage() {
  const { data, isLoading } = useSWR<{ signals: Signal[]; stats: Stats }>(
    "/api/signals",
    fetcher,
    { refreshInterval: 30_000 }
  );

  const stats   = data?.stats;
  const signals = data?.signals ?? [];
  const open    = signals.filter((s) => s.status === "open");
  const closed  = signals.filter((s) => s.status !== "open");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Señales Paper Trading</h2>
          <p className="text-sm text-gray-500 mt-1">
            Simulación con $100 USDC — copiando entradas de top whales
          </p>
        </div>
        <Link href="/" className="text-sm text-gray-500 hover:text-gray-300">
          ← Leaderboard
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Señales totales",   value: stats?.totalSignals ?? 0,              color: "text-white" },
          { label: "Posiciones abiertas", value: stats?.openPositions ?? 0,           color: "text-blue-400" },
          { label: "Win rate",           value: `${stats?.winRate ?? 0}%`,            color: stats?.winRate && stats.winRate >= 52 ? "text-green-400" : "text-gray-400" },
          { label: "P&L simulado",       value: `$${(stats?.totalPnl ?? 0).toFixed(2)}`, color: (stats?.totalPnl ?? 0) >= 0 ? "text-green-400" : "text-red-400" },
        ].map((s) => (
          <div key={s.label} className="bg-gray-900 rounded-lg p-4">
            <p className="text-xs text-gray-500">{s.label}</p>
            <p className={`text-2xl font-mono font-bold mt-1 ${s.color}`}>{s.value}</p>
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
            {s.status.toUpperCase()}
          </span>
          <span className={`text-xs font-mono font-bold ${s.outcome?.toLowerCase() === "yes" ? "text-green-400" : "text-red-400"}`}>
            {s.outcome}
          </span>
          <span className="text-xs text-gray-600">{timeAgo(s.created_at)}</span>
        </div>
        <p className="text-sm text-gray-200 truncate">
          {s.market_title || s.market_id.slice(0, 40) + "…"}
        </p>
        <p className="text-xs text-gray-500 mt-0.5 font-mono">
          {s.whale_address.slice(0, 8)}… · score {s.whale_score?.toFixed(0)} · {s.whale_trades_per_day?.toFixed(1)} trades/día
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
