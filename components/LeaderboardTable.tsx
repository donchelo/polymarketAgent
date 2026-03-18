"use client";

import { useRouter } from "next/navigation";
import type { WalletProfile } from "@/lib/types";

interface Props {
  wallets: WalletProfile[];
  loading?: boolean;
  leaderAddress?: string;
  onSetLeader?: (address: string) => void;
  settingLeader?: string | null;
}

const CAT_STYLE: Record<string, string> = {
  btc:      "text-orange-400 bg-orange-950/50 border-orange-800/50",
  eth:      "text-sky-400 bg-sky-950/50 border-sky-800/50",
  crypto:   "text-violet-400 bg-violet-950/50 border-violet-800/50",
  politics: "text-rose-400 bg-rose-950/50 border-rose-800/50",
  sports:   "text-emerald-400 bg-emerald-950/50 border-emerald-800/50",
  macro:    "text-amber-400 bg-amber-950/50 border-amber-800/50",
  other:    "text-zinc-400 bg-zinc-900 border-zinc-700",
};

function ScoreBar({ score }: { score: number }) {
  const pct = Math.min(Math.max(score, 0), 100);
  const barColor =
    pct >= 70 ? "bg-emerald-500" :
    pct >= 50 ? "bg-amber-500"   :
    "bg-zinc-600";
  const textColor =
    pct >= 70 ? "text-emerald-400" :
    pct >= 50 ? "text-amber-400"   :
    "text-zinc-500";
  return (
    <div className="flex items-center gap-2.5">
      <div className="w-16 h-[3px] bg-zinc-800 rounded-full overflow-hidden flex-shrink-0">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className={`font-mono text-xs font-semibold tabular-nums ${textColor}`}>
        {score.toFixed(0)}
      </span>
    </div>
  );
}

function WinRateCell({ real, proxy }: { real?: number | null; proxy: number }) {
  if (real != null) {
    const pct = Math.round(real * 100);
    const color =
      pct >= 57 ? "text-emerald-400" :
      pct >= 52 ? "text-yellow-400"  :
      "text-red-400";
    return (
      <div className="flex items-center gap-1.5">
        <span className={`font-mono text-sm font-semibold tabular-nums ${color}`}>{pct}%</span>
        <span className="text-[10px] text-zinc-600 bg-zinc-800/60 px-1 rounded">real</span>
      </div>
    );
  }
  return (
    <span className="font-mono text-sm text-zinc-600 italic tabular-nums">
      {Math.round(proxy * 100)}%
    </span>
  );
}

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

export function LeaderboardTable({
  wallets,
  loading,
  leaderAddress,
  onSetLeader,
  settingLeader,
}: Props) {
  const router = useRouter();

  if (loading) return <Skeleton />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800/60 bg-zinc-900/60">
            <th className="text-left pl-4 pr-2 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest w-8">#</th>
            <th className="text-left px-3 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest">Trader</th>
            <th className="text-left px-3 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest min-w-[110px]">Score</th>
            <th className="text-right px-3 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest">/día</th>
            <th className="text-left px-3 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest min-w-[90px]">Win Rate</th>
            <th className="text-right px-3 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest">Cortos</th>
            <th className="text-left px-3 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest">Tipo</th>
            <th className="text-right px-3 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest">Profit</th>
            <th className="text-right px-3 py-3 text-[11px] text-zinc-500 font-medium uppercase tracking-widest">Inac.</th>
            <th className="px-3 py-3 w-20"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/30">
          {wallets.map((w, i) => {
            const isLeader = w.address === leaderAddress;
            const shortPct = w.pctShortTerm != null ? Math.round(w.pctShortTerm * 100) : null;

            return (
              <tr
                key={w.address}
                className={`group transition-colors cursor-pointer ${
                  isLeader
                    ? "bg-amber-950/10 hover:bg-amber-950/20"
                    : "hover:bg-zinc-800/20"
                }`}
                onClick={() => router.push(`/wallet/${w.address}`)}
              >
                {/* Rank */}
                <td className="pl-4 pr-2 py-3 text-zinc-600 font-mono text-xs tabular-nums">
                  {i + 1}
                </td>

                {/* Trader */}
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    {isLeader && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0 shadow-[0_0_6px_#f59e0b]" />
                    )}
                    <span className={`font-medium ${isLeader ? "text-amber-100" : "text-zinc-100"}`}>
                      {w.userName || `${w.address.slice(0, 6)}…${w.address.slice(-4)}`}
                    </span>
                    {isLeader && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-900/50 text-amber-400 border border-amber-800/50 font-medium">
                        LÍDER
                      </span>
                    )}
                  </div>
                </td>

                {/* Score bar */}
                <td className="px-3 py-3">
                  <ScoreBar score={w.score} />
                </td>

                {/* Trades/day */}
                <td className="px-3 py-3 text-right">
                  <span className={`font-mono text-sm tabular-nums ${w.tradesPerDay >= 5 ? "text-white font-medium" : "text-zinc-400"}`}>
                    {w.tradesPerDay.toFixed(1)}
                  </span>
                </td>

                {/* Win rate */}
                <td className="px-3 py-3">
                  <WinRateCell real={w.realWinRate} proxy={w.winRate} />
                </td>

                {/* Short-term % */}
                <td className="px-3 py-3 text-right font-mono text-sm tabular-nums">
                  {shortPct !== null ? (
                    <span className={shortPct >= 50 ? "text-emerald-400 font-medium" : "text-zinc-500"}>
                      {shortPct}%
                    </span>
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
                  $
                  {w.profit >= 1_000_000
                    ? `${(w.profit / 1_000_000).toFixed(1)}M`
                    : w.profit >= 1_000
                    ? `${(w.profit / 1_000).toFixed(0)}K`
                    : w.profit.toFixed(0)}
                </td>

                {/* Days inactive */}
                <td className="px-3 py-3 text-right font-mono text-xs tabular-nums">
                  <span className={
                    w.daysSinceActive === 0 ? "text-emerald-400 font-medium" :
                    w.daysSinceActive <= 2  ? "text-yellow-400"             :
                    "text-zinc-600"
                  }>
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
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
