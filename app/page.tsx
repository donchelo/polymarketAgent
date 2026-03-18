"use client";

import useSWR from "swr";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import { RefreshBadge } from "@/components/RefreshBadge";
import type { LeaderboardResponse } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function HomePage() {
  const { data, isLoading, error } = useSWR<LeaderboardResponse>(
    "/api/leaderboard",
    fetcher,
    { refreshInterval: 30_000 }
  );

  return (
    <div className="space-y-6">
      {/* Title row */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Whale Leaderboard</h2>
          <p className="text-sm text-gray-500 mt-1">
            Top 30 wallets por frecuencia, diversidad y profit en Polymarket
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <RefreshBadge computedAt={data?.computedAt} isLoading={isLoading} />
          {data && (
            <span className="text-xs text-gray-600">
              {data.candidateCount} candidatas analizadas
            </span>
          )}
        </div>
      </div>

      {/* Filters info */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {[
          { label: "Min Profit", value: "$2,000" },
          { label: "Min Trades", value: "30" },
          { label: "Min Win%", value: "52%" },
          { label: "Activa ≤", value: "7 días" },
          { label: "Min Trades/Día", value: "0.5" },
          { label: "Min Mercados", value: "5" },
        ].map((f) => (
          <div key={f.label} className="bg-gray-900 rounded-lg px-3 py-2">
            <p className="text-xs text-gray-500">{f.label}</p>
            <p className="text-sm font-mono text-gray-200 mt-0.5">{f.value}</p>
          </div>
        ))}
      </div>

      {/* Error state */}
      {error && (
        <div className="bg-red-950/50 border border-red-800 rounded-lg p-4 text-red-400 text-sm">
          Error cargando datos: {error.message ?? String(error)}
        </div>
      )}

      {/* Table */}
      <div className="bg-gray-900 rounded-lg p-4">
        <LeaderboardTable wallets={data?.wallets ?? []} loading={isLoading} />
        {!isLoading && !error && (!data?.wallets?.length) && (
          <p className="text-gray-500 text-sm py-8 text-center">
            No hay wallets que cumplan los filtros en este momento.
          </p>
        )}
      </div>

      {/* Score legend */}
      <div className="text-xs text-gray-600 space-y-1">
        <p className="font-semibold text-gray-500">Scoring (100 pts max):</p>
        <p>35 — Frecuencia (trades/día, máx a 3/día) &nbsp;|&nbsp; 25 — Diversidad (mercados únicos, máx a 30) &nbsp;|&nbsp; 25 — Win Rate &nbsp;|&nbsp; 15 — Profit (log-scaled) &nbsp;|&nbsp; −20 — Penalización por inactividad reciente</p>
      </div>
    </div>
  );
}
