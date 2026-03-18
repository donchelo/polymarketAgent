"use client";

import type { Position } from "@/lib/types";

interface Props {
  positions: Position[];
  loading?: boolean;
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-10 bg-gray-800 rounded" />
      ))}
    </div>
  );
}

export function PositionsTable({ positions, loading }: Props) {
  if (loading) return <Skeleton />;
  if (!positions.length) {
    return <p className="text-gray-500 text-sm">Sin posiciones abiertas.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
            <th className="py-3 pr-4">Market</th>
            <th className="py-3 pr-4">Outcome</th>
            <th className="py-3 pr-4 text-right">Size (USDC)</th>
            <th className="py-3 text-right">Avg Price</th>
          </tr>
        </thead>
        <tbody>
          {positions.map((p, i) => (
            <tr key={i} className="border-b border-gray-800/50">
              <td className="py-3 pr-4 font-mono text-xs text-gray-400">
                {p.marketId.slice(0, 16)}…
              </td>
              <td className={`py-3 pr-4 font-mono font-semibold ${
                p.outcome?.toUpperCase() === "YES" ? "text-green-400" : "text-red-400"
              }`}>
                {p.outcome}
              </td>
              <td className="py-3 pr-4 text-right font-mono text-white">
                ${p.size.toFixed(2)}
              </td>
              <td className="py-3 text-right font-mono text-gray-300">
                {p.avgPrice.toFixed(3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
