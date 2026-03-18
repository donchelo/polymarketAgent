"use client";

import React, { useState } from "react";
import useSWR from "swr";
import Link from "next/link";
import type { WalletProfile, Position } from "@/lib/types";

interface Props {
  wallets: WalletProfile[];
  loading?: boolean;
  leaderAddress?: string;
  onSetLeader?: (address: string) => void;
  settingLeader?: string | null;
}

type SortKey = "score" | "tradesPerDay" | "realWinRate" | "pctShortTerm" | "profit" | "daysSinceActive";
type SortDir = "asc" | "desc";

const CAT_STYLE: Record<string, string> = {
  btc:      "text-orange-400 bg-orange-950/50 border-orange-800/50",
  eth:      "text-sky-400 bg-sky-950/50 border-sky-800/50",
  crypto:   "text-violet-400 bg-violet-950/50 border-violet-800/50",
  politics: "text-rose-400 bg-rose-950/50 border-rose-800/50",
  sports:   "text-emerald-400 bg-emerald-950/50 border-emerald-800/50",
  macro:    "text-amber-400 bg-amber-950/50 border-amber-800/50",
  other:    "text-zinc-400 bg-zinc-900 border-zinc-700",
};

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function sortWallets(wallets: WalletProfile[], key: SortKey, dir: SortDir) {
  return [...wallets].sort((a, b) => {
    let av: number, bv: number;
    switch (key) {
      case "score":          av = a.score;           bv = b.score;           break;
      case "tradesPerDay":   av = a.tradesPerDay;    bv = b.tradesPerDay;    break;
      case "realWinRate":    av = a.realWinRate ?? a.winRate ?? 0; bv = b.realWinRate ?? b.winRate ?? 0; break;
      case "pctShortTerm":   av = a.pctShortTerm ?? 0; bv = b.pctShortTerm ?? 0; break;
      case "profit":         av = a.profit;          bv = b.profit;          break;
      case "daysSinceActive": av = a.daysSinceActive; bv = b.daysSinceActive; break;
      default:               av = 0; bv = 0;
    }
    return dir === "desc" ? bv - av : av - bv;
  });
}

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(Math.max(score, 0), 100);
  const barColor = pct >= 70 ? "bg-emerald-500" : pct >= 50 ? "bg-amber-500" : "bg-zinc-600";
  const textColor = pct >= 70 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-zinc-500";
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-16 h-[3px] bg-zinc-800 rounded-full overflow-hidden flex-shrink-0">
        <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`font-mono text-xs font-semibold tabular-nums ${textColor}`}>{score.toFixed(0)}</span>
    </div>
  );
}

function WinRateCell({ real, proxy }: { real?: number | null; proxy: number }) {
  if (real != null) {
    const pct = Math.round(real * 100);
    const color = pct >= 57 ? "text-emerald-400" : pct >= 52 ? "text-yellow-400" : "text-red-400";
    return (
      <div className="flex items-center gap-1.5">
        <span className={`font-mono text-sm font-semibold tabular-nums ${color}`}>{pct}%</span>
        <span className="text-[10px] text-zinc-600 bg-zinc-800/60 px-1 rounded">real</span>
      </div>
    );
  }
  return <span className="font-mono text-sm text-zinc-600 italic tabular-nums">{Math.round(proxy * 100)}%</span>;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <span className="text-zinc-700 text-[10px] ml-1">⇅</span>;
  return <span className="text-amber-400 text-[10px] ml-1">{dir === "desc" ? "↓" : "↑"}</span>;
}

function ScoreHeader({ sortKey, activeSortKey, sortDir, onClick }: {
  sortKey: SortKey;
  activeSortKey: SortKey;
  sortDir: SortDir;
  onClick: () => void;
}) {
  return (
    <th className="text-left px-3 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest min-w-[110px] group/th">
      <button onClick={onClick} className="flex items-center gap-1 hover:text-zinc-300 transition-colors">
        Score
        <SortIcon active={activeSortKey === sortKey} dir={sortDir} />
      </button>
      {/* Score explanation tooltip */}
      <div className="hidden group-hover/th:block absolute z-50 mt-1 w-64 rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-xl text-left normal-case tracking-normal">
        <p className="text-xs font-semibold text-white mb-2">Cómo se calcula el Score</p>
        <div className="space-y-1.5">
          {[
            ["30 pts", "Frecuencia", "trades/día, max 3/día"],
            ["20 pts", "Diversidad", "mercados únicos, max 30"],
            ["30 pts", "Profit", "log-escalado desde $2k"],
            ["20 pts", "Recencia", "días desde último trade"],
          ].map(([pts, label, desc]) => (
            <div key={label} className="flex items-start gap-2">
              <span className="text-[10px] font-mono text-amber-400 shrink-0 mt-0.5">{pts}</span>
              <div>
                <span className="text-[11px] text-zinc-200 font-medium">{label}</span>
                <span className="text-[10px] text-zinc-600 ml-1">({desc})</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </th>
  );
}

// ── Positions panel (renders inside expanded row) ─────────────────────────────

function PositionsPanel({ address }: { address: string }) {
  const { data, isLoading, error } = useSWR<{ positions: Position[] }>(
    `/api/positions?address=${address}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60_000 }
  );

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 py-2 px-1 text-xs text-zinc-600">
        <span className="inline-block w-3 h-3 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
        Cargando posiciones…
      </div>
    );
  }

  if (error) {
    return <p className="text-xs text-red-500/60 py-2 px-1">Error al cargar posiciones</p>;
  }

  const positions = data?.positions ?? [];

  if (!positions.length) {
    return <p className="text-xs text-zinc-600 py-2 px-1 italic">Sin posiciones abiertas</p>;
  }

  return (
    <div className="flex flex-wrap gap-2 py-1">
      {positions.map((p, i) => {
        const isYes = p.outcome.toUpperCase() === "YES";
        const outcomeCls = isYes ? "text-emerald-400" : "text-red-400";
        return (
          <div
            key={i}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-zinc-800/60 border border-zinc-700/50 text-xs"
          >
            <span className={`font-mono font-semibold ${outcomeCls}`}>{p.outcome}</span>
            <span className="text-zinc-600">@</span>
            <span className="font-mono text-zinc-300">{p.avgPrice.toFixed(2)}</span>
            <span className="text-zinc-600 text-[10px]">·</span>
            <span className="font-mono text-zinc-400">${p.size >= 1000 ? `${(p.size / 1000).toFixed(1)}k` : p.size.toFixed(0)}</span>
            {p.marketTitle ? (
              <span className="text-zinc-500 max-w-[160px] truncate ml-0.5">{p.marketTitle}</span>
            ) : (
              <span className="text-zinc-700 font-mono text-[10px] ml-0.5">{p.marketId.slice(0, 8)}…</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div className="divide-y divide-zinc-800/40">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="h-11 px-4 flex items-center gap-4 animate-pulse">
          <div className="w-5 h-2.5 bg-zinc-800 rounded" />
          <div className="w-28 h-2.5 bg-zinc-800 rounded" />
          <div className="flex-1" />
          <div className="w-20 h-2.5 bg-zinc-800 rounded" />
          <div className="w-10 h-2.5 bg-zinc-800 rounded" />
          <div className="w-14 h-2.5 bg-zinc-800 rounded" />
        </div>
      ))}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function LeaderboardTable({ wallets, loading, leaderAddress, onSetLeader, settingLeader }: Props) {
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [expanded, setExpanded] = useState<string | null>(null);

  if (loading) return <Skeleton />;

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function SortTh({ label, k, className = "" }: { label: string; k: SortKey; className?: string }) {
    return (
      <th className={`px-3 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest ${className}`}>
        <button
          onClick={() => handleSort(k)}
          className="flex items-center gap-0.5 hover:text-zinc-300 transition-colors w-full"
        >
          {label}
          <SortIcon active={sortKey === k} dir={sortDir} />
        </button>
      </th>
    );
  }

  const sorted = sortWallets(wallets, sortKey, sortDir);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800/60 bg-zinc-900/60">
            <th className="text-left pl-4 pr-2 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest w-8">#</th>
            <th className="text-left px-3 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest">Trader</th>

            {/* Score — with tooltip, uses relative positioning via th */}
            <ScoreHeader
              sortKey="score"
              activeSortKey={sortKey}
              sortDir={sortDir}
              onClick={() => handleSort("score")}
            />

            <SortTh label="/día"     k="tradesPerDay"   className="text-right" />
            <SortTh label="Win Rate" k="realWinRate"    className="text-left min-w-[90px]" />
            <SortTh label="Cortos"   k="pctShortTerm"   className="text-right" />

            <th className="text-left px-3 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest">Tipo</th>

            <SortTh label="Profit"   k="profit"         className="text-right" />
            <SortTh label="Inac."    k="daysSinceActive" className="text-right" />

            <th className="px-3 py-3 w-20" />
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/30">
          {sorted.map((w, i) => {
            const isLeader  = w.address === leaderAddress;
            const isOpen    = expanded === w.address;
            const shortPct  = w.pctShortTerm != null ? Math.round(w.pctShortTerm * 100) : null;

            return (
              <React.Fragment key={w.address}>
                <tr
                  className={`group transition-colors cursor-pointer select-none ${
                    isLeader ? "bg-amber-950/10 hover:bg-amber-950/20" : "hover:bg-zinc-800/20"
                  }`}
                  onClick={() => setExpanded(isOpen ? null : w.address)}
                >
                  {/* Rank */}
                  <td className="pl-4 pr-2 py-3 text-zinc-600 font-mono text-xs tabular-nums">
                    {isOpen ? (
                      <span className="text-zinc-500">▾</span>
                    ) : (
                      i + 1
                    )}
                  </td>

                  {/* Trader — name is a link, rest of row is expand */}
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      {isLeader && (
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 shadow-[0_0_6px_#f59e0b]" />
                      )}
                      <Link
                        href={`/wallet/${w.address}`}
                        className={`font-medium hover:underline ${isLeader ? "text-amber-100" : "text-zinc-100"}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {w.userName || `${w.address.slice(0, 6)}…${w.address.slice(-4)}`}
                      </Link>
                      {isLeader && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-400 border border-amber-800/50 font-medium">
                          LÍDER
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Score bar */}
                  <td className="px-3 py-3"><ScoreBar score={w.score} /></td>

                  {/* Trades/day */}
                  <td className="px-3 py-3 text-right">
                    <span className={`font-mono text-sm tabular-nums ${w.tradesPerDay >= 5 ? "text-white font-medium" : "text-zinc-400"}`}>
                      {w.tradesPerDay.toFixed(1)}
                    </span>
                  </td>

                  {/* Win rate */}
                  <td className="px-3 py-3"><WinRateCell real={w.realWinRate} proxy={w.winRate} /></td>

                  {/* Short-term % */}
                  <td className="px-3 py-3 text-right font-mono text-sm tabular-nums">
                    {shortPct !== null ? (
                      <span className={shortPct >= 50 ? "text-emerald-400 font-medium" : "text-zinc-500"}>{shortPct}%</span>
                    ) : (
                      <span className="text-zinc-700">—</span>
                    )}
                  </td>

                  {/* Category */}
                  <td className="px-3 py-3">
                    {w.topCategory ? (
                      <span className={`inline-block px-1.5 py-0.5 text-[11px] font-medium rounded border ${CAT_STYLE[w.topCategory] ?? CAT_STYLE.other}`}>
                        {w.topCategory}
                      </span>
                    ) : (
                      <span className="text-zinc-700 text-xs">—</span>
                    )}
                  </td>

                  {/* Profit */}
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums text-emerald-400">
                    ${w.profit >= 1_000_000 ? `${(w.profit / 1_000_000).toFixed(1)}M` : w.profit >= 1_000 ? `${(w.profit / 1_000).toFixed(0)}K` : w.profit.toFixed(0)}
                  </td>

                  {/* Days inactive */}
                  <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                    <span className={w.daysSinceActive === 0 ? "text-emerald-400 font-medium" : w.daysSinceActive <= 2 ? "text-yellow-400" : "text-zinc-600"}>
                      {w.daysSinceActive}d
                    </span>
                  </td>

                  {/* Action */}
                  <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                    {isLeader ? (
                      <span className="text-[10px] text-amber-700/60 font-medium">activo</span>
                    ) : (
                      <button
                        onClick={() => onSetLeader?.(w.address)}
                        disabled={settingLeader === w.address}
                        className="opacity-0 group-hover:opacity-100 text-[11px] px-2 py-1 rounded border border-zinc-700 text-zinc-400 hover:text-amber-300 hover:border-amber-700/60 active:scale-95 disabled:opacity-50 transition-all"
                      >
                        {settingLeader === w.address ? "…" : "→ líder"}
                      </button>
                    )}
                  </td>
                </tr>

                {/* Expanded positions row */}
                {isOpen && (
                  <tr key={`${w.address}-positions`} className={isLeader ? "bg-amber-950/5" : "bg-zinc-900/30"}>
                    <td />
                    <td colSpan={9} className="px-3 pb-3 pt-0">
                      <div className="border-t border-zinc-800/40 pt-2.5">
                        <p className="text-[10px] uppercase tracking-[0.15em] text-zinc-600 font-medium mb-2">
                          Posiciones abiertas
                        </p>
                        <PositionsPanel address={w.address} />
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
