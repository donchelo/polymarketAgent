"use client";

import { useState } from "react";
import useSWR from "swr";
import { LeaderboardTable } from "@/components/LeaderboardTable";
import type { LeaderboardResponse, LeaderInfo, Trade } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function timeAgo(ts: string) {
  const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 60)    return `${s}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

const CAT_STYLE: Record<string, string> = {
  btc:      "text-orange-400 bg-orange-950/40 border-orange-800/40",
  eth:      "text-sky-400 bg-sky-950/40 border-sky-800/40",
  crypto:   "text-violet-400 bg-violet-950/40 border-violet-800/40",
  politics: "text-rose-400 bg-rose-950/40 border-rose-800/40",
  sports:   "text-emerald-400 bg-emerald-950/40 border-emerald-800/40",
  macro:    "text-amber-400 bg-amber-950/40 border-amber-800/40",
  other:    "text-zinc-400 bg-zinc-900 border-zinc-700",
};

function CategoryBadge({ cat }: { cat: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-[11px] font-medium rounded border tracking-wide ${CAT_STYLE[cat] ?? CAT_STYLE.other}`}>
      {cat}
    </span>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div>
      <p className="text-[10px] text-zinc-500 uppercase tracking-widest font-medium mb-0.5">{label}</p>
      <p className={`text-xl font-bold font-mono ${accent ?? "text-white"}`}>{value}</p>
    </div>
  );
}

function LeaderCard({
  leader,
  onSetLeader,
  settingLeader,
}: {
  leader: LeaderInfo;
  onSetLeader: (address: string) => void;
  settingLeader: string | null;
}) {
  const { data: tradesData } = useSWR<{ trades: Trade[] }>(
    `/api/trades?address=${leader.address}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  const recent = (tradesData?.trades ?? []).slice(0, 5);
  const winRatePct = leader.winRate != null ? Math.round(leader.winRate * 100) : null;
  const shortPct = leader.pctShortTerm != null ? Math.round(leader.pctShortTerm * 100) : null;

  return (
    <div className="relative rounded-2xl border border-amber-800/30 bg-gradient-to-br from-amber-950/15 via-zinc-900/40 to-zinc-950 overflow-hidden">
      {/* Left accent bar */}
      <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-amber-400 via-amber-500/60 to-transparent" />

      <div className="pl-6 pr-5 pt-5 pb-5">
        {/* Top row: identity + metrics */}
        <div className="flex flex-col sm:flex-row sm:items-start gap-5 justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-amber-500/70 mb-1.5">
              Líder activo
            </p>
            <h2 className="text-3xl font-bold text-white tracking-tight leading-none">
              {leader.userName || leader.address.slice(0, 10) + "…"}
            </h2>
            <p className="text-xs text-zinc-600 font-mono mt-1.5">
              {leader.address.slice(0, 14)}…
            </p>
          </div>

          <div className="flex gap-6 sm:gap-8 shrink-0">
            <Metric
              label="Trades/día"
              value={leader.tradesPerDay?.toFixed(1) ?? "—"}
              accent="text-amber-400"
            />
            <Metric
              label="Win Rate"
              value={winRatePct != null ? `${winRatePct}%` : "—"}
              accent={winRatePct != null && winRatePct >= 54 ? "text-emerald-400" : "text-zinc-300"}
            />
            <Metric
              label="Composite"
              value={leader.leaderScore != null ? leader.leaderScore.toFixed(2) : "—"}
              accent="text-sky-400"
            />
            {shortPct !== null && (
              <Metric
                label="Cortos"
                value={`${shortPct}%`}
                accent={shortPct >= 50 ? "text-emerald-400" : "text-zinc-400"}
              />
            )}
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          {leader.topCategory && <CategoryBadge cat={leader.topCategory} />}
          <span className="text-xs text-zinc-600">
            seleccionado hace {timeAgo(leader.selectedAt)}
          </span>
          <button
            onClick={() => onSetLeader(leader.address)}
            disabled={settingLeader === leader.address}
            className="ml-auto text-xs px-3 py-1 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 active:scale-95 transition-all disabled:opacity-50"
          >
            {settingLeader === leader.address ? "…" : "cambiar líder"}
          </button>
        </div>

        {/* Recent trades strip */}
        {recent.length > 0 && (
          <div className="mt-4 pt-4 border-t border-zinc-800/50">
            <p className="text-[10px] uppercase tracking-[0.15em] text-zinc-600 font-medium mb-2.5">
              Trades recientes
            </p>
            <div className="space-y-1.5">
              {recent.map((t, i) => {
                const isYes = String(t.outcome ?? "").toUpperCase() === "YES";
                return (
                  <div key={i} className="flex items-center gap-3 text-xs">
                    <span className={`w-8 text-center font-mono font-semibold ${isYes ? "text-emerald-400" : "text-red-400"}`}>
                      {isYes ? "YES" : "NO"}
                    </span>
                    {t.price != null && (
                      <span className="text-zinc-600 font-mono w-14 shrink-0">
                        @ {t.price.toFixed(2)}
                      </span>
                    )}
                    <span className="text-zinc-300 truncate">{t.marketTitle ?? "—"}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function NoLeader() {
  return (
    <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 p-8 text-center">
      <p className="text-zinc-500 text-sm">Sin líder seleccionado.</p>
      <p className="text-zinc-700 text-xs mt-1">Selecciona uno desde la tabla usando el botón → líder</p>
    </div>
  );
}

export default function HomePage() {
  const [settingLeader, setSettingLeader] = useState<string | null>(null);

  const { data, isLoading, error, mutate } = useSWR<LeaderboardResponse>(
    "/api/leaderboard",
    fetcher,
    { refreshInterval: 30_000 }
  );

  const handleSetLeader = async (address: string) => {
    setSettingLeader(address);
    try {
      await fetch("/api/leader", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      await mutate();
    } finally {
      setSettingLeader(null);
    }
  };

  return (
    <div className="space-y-6">

      {/* Leader command card */}
      {isLoading && (
        <div className="rounded-2xl border border-zinc-800 bg-zinc-900/30 h-40 animate-pulse" />
      )}
      {!isLoading && data?.leader && (
        <LeaderCard
          leader={data.leader}
          onSetLeader={handleSetLeader}
          settingLeader={settingLeader}
        />
      )}
      {!isLoading && !data?.leader && !error && <NoLeader />}

      {/* Section header */}
      <div className="flex items-center justify-between pt-2">
        <div>
          <h2 className="text-base font-semibold text-white">Candidatos</h2>
          <p className="text-xs text-zinc-600 mt-0.5">
            {data?.candidateCount ?? "—"} analizadas · top {data?.wallets.length ?? "—"} por score
          </p>
        </div>
        {data?.computedAt && (
          <span className="text-xs text-zinc-700 font-mono">
            {new Date(data.computedAt).toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {[
          ["Min Profit", "$2,000"],
          ["Trades",     "≥30"],
          ["Win%",       "≥52%"],
          ["Activa",     "≤7d"],
          ["/día",       "≥0.5"],
          ["Mercados",   "≥5"],
        ].map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-900/80 border border-zinc-800 text-xs">
            <span className="text-zinc-600">{k}</span>
            <span className="font-mono text-zinc-300">{v}</span>
          </span>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-red-400 text-sm">
          Error: {error.message ?? String(error)}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-zinc-800/60 overflow-hidden bg-zinc-900/20">
        <LeaderboardTable
          wallets={data?.wallets ?? []}
          loading={isLoading}
          leaderAddress={data?.leader?.address}
          onSetLeader={handleSetLeader}
          settingLeader={settingLeader}
        />
        {!isLoading && !error && !data?.wallets?.length && (
          <div className="p-16 text-center text-zinc-600 text-sm">
            Sin wallets que cumplan los filtros.
          </div>
        )}
      </div>

      {/* Score legend */}
      <p className="text-[11px] text-zinc-700 text-center font-mono">
        Score: 30pts frecuencia · 20pts diversidad · 30pts profit · 20pts recencia
      </p>
    </div>
  );
}
