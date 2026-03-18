"use client";

import React, { useState } from "react";
import useSWR from "swr";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface RecentMarket {
  question: string;
  conditionId: string;
  durationH: number | null;
  resolved: boolean;
  won: boolean | null;
}

interface WhaleStudy {
  address: string;
  userName: string;
  score: number;
  tradesPerDay: number;
  avgMarketDurationH: number | null;
  pctShortTerm: number;
  topCategories: string[];
  realWinRate: number | null;
  resolvedSample: number;
  compositeScore: number;
  isCurrentLeader: boolean;
  recentMarkets: RecentMarket[];
  error?: string;
}

interface StudyResponse {
  whales: WhaleStudy[];
  computedAt: string;
  totalWhales: number;
}

function CategoryBadge({ cat }: { cat: string }) {
  const colors: Record<string, string> = {
    btc:      "bg-orange-900/50 text-orange-300 border-orange-700/50",
    eth:      "bg-blue-900/50 text-blue-300 border-blue-700/50",
    crypto:   "bg-purple-900/50 text-purple-300 border-purple-700/50",
    politics: "bg-red-900/50 text-red-300 border-red-700/50",
    sports:   "bg-green-900/50 text-green-300 border-green-700/50",
    macro:    "bg-yellow-900/50 text-yellow-300 border-yellow-700/50",
    other:    "bg-gray-800 text-gray-400 border-gray-700",
  };
  return (
    <span className={`inline-block px-1.5 py-0.5 text-xs rounded border ${colors[cat] ?? colors.other}`}>
      {cat}
    </span>
  );
}

function WinRateBar({ rate }: { rate: number | null }) {
  if (rate === null) return <span className="text-gray-600 text-xs">—</span>;
  const color = rate >= 60 ? "bg-green-500" : rate >= 50 ? "bg-yellow-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(rate, 100)}%` }} />
      </div>
      <span className={`text-xs font-mono ${rate >= 60 ? "text-green-400" : rate >= 50 ? "text-yellow-400" : "text-red-400"}`}>
        {rate}%
      </span>
    </div>
  );
}

function ExpandedRow({ whale }: { whale: WhaleStudy }) {
  return (
    <div className="px-4 py-3 bg-gray-900/60 border-t border-gray-800">
      <p className="text-xs text-gray-500 mb-2 font-mono">{whale.address}</p>
      {whale.error && (
        <p className="text-xs text-red-400 mb-2">Error: {whale.error}</p>
      )}
      {whale.recentMarkets.length > 0 ? (
        <div className="space-y-1">
          {whale.recentMarkets.map((m, i) => (
            <div key={i} className="flex items-center gap-3 text-xs">
              <span className={`w-12 text-center rounded px-1 py-0.5 font-mono ${
                m.won === null ? "bg-gray-700 text-gray-400" :
                m.won ? "bg-green-900/60 text-green-400" : "bg-red-900/60 text-red-400"
              }`}>
                {m.won === null ? (m.resolved ? "n/a" : "open") : m.won ? "✓ WON" : "✗ LOST"}
              </span>
              {m.durationH !== null && (
                <span className="text-gray-500 w-14">
                  {m.durationH < 24 ? `${m.durationH}h` : `${Math.round(m.durationH / 24)}d`}
                </span>
              )}
              <span className="text-gray-300 truncate">{m.question}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-600">No hay mercados recientes</p>
      )}
    </div>
  );
}

export default function WhaleStudyPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [settingLeader, setSettingLeader] = useState<string | null>(null);

  const { data, isLoading, error, mutate } = useSWR<StudyResponse>(
    "/api/whale-study",
    fetcher,
    { revalidateOnFocus: false }
  );

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await mutate();
    setIsRefreshing(false);
  };

  const handleSetLeader = async (address: string) => {
    setSettingLeader(address);
    try {
      const res = await fetch("/api/leader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (res.ok) await mutate();
    } finally {
      setSettingLeader(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Market Intelligence</h2>
          <p className="text-sm text-gray-500 mt-1">
            Win rate real + preferencia de mercados por trader
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data?.computedAt && (
            <span className="text-xs text-gray-600">
              {new Date(data.computedAt).toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing || isLoading}
            className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded border border-gray-700 disabled:opacity-50 transition"
          >
            {isRefreshing ? "Calculando…" : "Recalcular"}
          </button>
          <Link href="/" className="text-xs text-gray-600 hover:text-gray-400">
            ← Volver
          </Link>
        </div>
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-gray-500">
        <div className="bg-gray-900 border border-gray-800 rounded p-2">
          <div className="text-gray-400 font-medium mb-0.5">Win Rate Real</div>
          % mercados resueltos ganados (min 5 muestras)
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded p-2">
          <div className="text-gray-400 font-medium mb-0.5">Mercados Cortos</div>
          % de trades en mercados de menos de 24h
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded p-2">
          <div className="text-gray-400 font-medium mb-0.5">Composite Score</div>
          win_rate × trades_día × (score/100) × (1 + short%)
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded p-2">
          <div className="text-gray-400 font-medium mb-0.5">Categorías</div>
          Tipos de mercado preferidos (top 3)
        </div>
      </div>

      {/* Loading */}
      {(isLoading || isRefreshing) && (
        <div className="text-center py-16 text-gray-500 text-sm">
          <div className="animate-pulse">Analizando {data?.totalWhales ?? "…"} whales — esto puede tomar ~30s…</div>
        </div>
      )}

      {/* Error */}
      {error && !isLoading && (
        <div className="bg-red-900/20 border border-red-800 rounded p-4 text-red-400 text-sm">
          Error al cargar: {error.message ?? String(error)}
        </div>
      )}

      {/* Table */}
      {data?.whales && !isLoading && (
        <div className="overflow-x-auto rounded-lg border border-gray-800">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide">
                <th className="text-left px-4 py-3">Trader</th>
                <th className="text-right px-3 py-3">Score</th>
                <th className="text-right px-3 py-3">Trades/día</th>
                <th className="text-left px-3 py-3 min-w-[120px]">Win Rate Real</th>
                <th className="text-right px-3 py-3">Dur. Media</th>
                <th className="text-right px-3 py-3">Cortos</th>
                <th className="text-left px-3 py-3">Categorías</th>
                <th className="text-right px-3 py-3 text-blue-400">Composite</th>
                <th className="px-3 py-3">Acción</th>
              </tr>
            </thead>
            <tbody>
              {data.whales.map((whale) => (
                <React.Fragment key={whale.address}>
                  <tr
                    className={`border-b border-gray-800/50 transition cursor-pointer hover:bg-gray-800/30 ${
                      whale.isCurrentLeader ? "bg-yellow-950/20" : ""
                    }`}
                    onClick={() => setExpanded(expanded === whale.address ? null : whale.address)}
                  >
                    {/* Trader name */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-200 font-medium">{whale.userName}</span>
                        {whale.isCurrentLeader && (
                          <span className="text-xs bg-yellow-700/40 text-yellow-300 border border-yellow-700/50 px-1.5 py-0.5 rounded font-medium">
                            LÍDER
                          </span>
                        )}
                        {whale.error && (
                          <span className="text-xs text-red-500">⚠</span>
                        )}
                      </div>
                    </td>

                    {/* Score */}
                    <td className="px-3 py-3 text-right font-mono text-gray-300">
                      {whale.score}
                    </td>

                    {/* Trades/día */}
                    <td className="px-3 py-3 text-right font-mono text-gray-300">
                      {whale.tradesPerDay.toFixed(1)}
                    </td>

                    {/* Win Rate Real */}
                    <td className="px-3 py-3">
                      <WinRateBar rate={whale.realWinRate} />
                      {whale.resolvedSample > 0 && (
                        <div className="text-gray-600 text-xs mt-0.5">
                          n={whale.resolvedSample}
                        </div>
                      )}
                    </td>

                    {/* Duración media */}
                    <td className="px-3 py-3 text-right font-mono text-gray-400 text-xs">
                      {whale.avgMarketDurationH !== null
                        ? whale.avgMarketDurationH < 24
                          ? `${whale.avgMarketDurationH}h`
                          : `${Math.round(whale.avgMarketDurationH / 24)}d`
                        : "—"}
                    </td>

                    {/* Mercados cortos */}
                    <td className="px-3 py-3 text-right font-mono">
                      <span className={whale.pctShortTerm >= 50 ? "text-green-400" : "text-gray-400"}>
                        {whale.pctShortTerm}%
                      </span>
                    </td>

                    {/* Categorías */}
                    <td className="px-3 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {whale.topCategories.length > 0
                          ? whale.topCategories.map((cat) => <CategoryBadge key={cat} cat={cat} />)
                          : <span className="text-gray-600 text-xs">—</span>
                        }
                      </div>
                    </td>

                    {/* Composite Score */}
                    <td className="px-3 py-3 text-right">
                      <span className={`font-mono font-bold ${
                        whale.compositeScore >= 2 ? "text-blue-400" :
                        whale.compositeScore >= 1 ? "text-blue-300" :
                        "text-gray-500"
                      }`}>
                        {whale.compositeScore.toFixed(2)}
                      </span>
                    </td>

                    {/* Actions: set leader + expand toggle */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2">
                        {!whale.isCurrentLeader && (
                          <button
                            onClick={(e) => { e.stopPropagation(); handleSetLeader(whale.address); }}
                            disabled={settingLeader === whale.address}
                            className="text-xs px-2 py-0.5 rounded bg-yellow-900/30 hover:bg-yellow-800/50 text-yellow-400 border border-yellow-800/50 disabled:opacity-50 transition whitespace-nowrap"
                          >
                            {settingLeader === whale.address ? "…" : "→ Líder"}
                          </button>
                        )}
                        <span className="text-gray-600 text-xs">
                          {expanded === whale.address ? "▲" : "▼"}
                        </span>
                      </div>
                    </td>
                  </tr>

                  {/* Expanded detail */}
                  {expanded === whale.address && (
                    <tr key={`${whale.address}-exp`} className="border-b border-gray-800/50">
                      <td colSpan={9} className="p-0">
                        <ExpandedRow whale={whale} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.whales?.length === 0 && !isLoading && (
        <div className="text-center py-16 text-gray-600">
          No hay whales con score ≥ 50. Ejecuta el cron de refresh-leaderboard primero.
        </div>
      )}

      <p className="text-xs text-gray-700 text-center">
        Nota: Este endpoint no escribe en DB — solo lee y calcula. Para persistir datos, ejecuta el cron de refresh-leaderboard.
      </p>
    </div>
  );
}
