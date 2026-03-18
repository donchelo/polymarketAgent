"use client";

import { useRouter } from "next/navigation";
import type { WalletProfile } from "@/lib/types";

interface Props {
  wallets: WalletProfile[];
  loading?: boolean;
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-2">
      {Array.from({ length: 10 }).map((_, i) => (
        <div key={i} className="h-10 bg-gray-800 rounded" />
      ))}
    </div>
  );
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-green-400";
  if (score >= 50) return "text-yellow-400";
  return "text-gray-400";
}

export function LeaderboardTable({ wallets, loading }: Props) {
  const router = useRouter();

  if (loading) return <Skeleton />;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
            <th className="py-3 pr-4 w-8">#</th>
            <th className="py-3 pr-6">Address</th>
            <th className="py-3 pr-6 text-right">Trades/Día</th>
            <th className="py-3 pr-6 text-right">Mercados</th>
            <th className="py-3 pr-6 text-right">Win%</th>
            <th className="py-3 pr-6 text-right">Profit</th>
            <th className="py-3 pr-6 text-right">Días Inac.</th>
            <th className="py-3 text-right">Score</th>
          </tr>
        </thead>
        <tbody>
          {wallets.map((w, i) => (
            <tr
              key={w.address}
              className="border-b border-gray-800/50 hover:bg-gray-900 cursor-pointer transition-colors"
              onClick={() => router.push(`/wallet/${w.address}`)}
            >
              <td className="py-3 pr-4 text-gray-500 font-mono">{i + 1}</td>
              <td className="py-3 pr-6 font-mono text-gray-300">
                {w.address.slice(0, 6)}…{w.address.slice(-4)}
              </td>
              <td className="py-3 pr-6 text-right font-mono text-white">
                {w.tradesPerDay.toFixed(1)}
              </td>
              <td className="py-3 pr-6 text-right font-mono text-white">
                {w.uniqueMarkets}
              </td>
              <td className={`py-3 pr-6 text-right font-mono ${w.winRate >= 0.6 ? "text-green-400" : "text-gray-300"}`}>
                {(w.winRate * 100).toFixed(0)}%
              </td>
              <td className="py-3 pr-6 text-right font-mono text-green-400">
                ${w.profit.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </td>
              <td className={`py-3 pr-6 text-right font-mono ${w.daysSinceActive <= 1 ? "text-green-400" : w.daysSinceActive <= 3 ? "text-yellow-400" : "text-gray-400"}`}>
                {w.daysSinceActive}d
              </td>
              <td className={`py-3 text-right font-mono font-bold ${scoreColor(w.score)}`}>
                {w.score.toFixed(1)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
