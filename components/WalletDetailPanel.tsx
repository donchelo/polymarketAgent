"use client";

import { useState } from "react";
import useSWR from "swr";
import { PositionsTable } from "./PositionsTable";
import { RefreshBadge } from "./RefreshBadge";
import type { PositionsResponse, TradesResponse, Trade } from "@/lib/types";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Props {
  address: string;
}

function TradesTable({ trades, loading }: { trades: Trade[]; loading?: boolean }) {
  if (loading) {
    return (
      <div className="animate-pulse space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-10 bg-gray-800 rounded" />
        ))}
      </div>
    );
  }
  if (!trades.length) return <p className="text-gray-500 text-sm">Sin trades recientes.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-gray-500 text-xs uppercase tracking-wider border-b border-gray-800">
            <th className="py-3 pr-4">Market</th>
            <th className="py-3 pr-4">Outcome</th>
            <th className="py-3 pr-4 text-right">Size</th>
            <th className="py-3 text-right">Price</th>
          </tr>
        </thead>
        <tbody>
          {trades.map((t, i) => (
            <tr key={i} className="border-b border-gray-800/50">
              <td className="py-3 pr-4 font-mono text-xs text-gray-400">
                {(t.marketId ?? "").slice(0, 16)}…
              </td>
              <td className={`py-3 pr-4 font-mono font-semibold ${
                (t.outcome ?? "").toUpperCase() === "YES" ? "text-green-400" : "text-red-400"
              }`}>
                {t.outcome}
              </td>
              <td className="py-3 pr-4 text-right font-mono text-white">
                ${(t.size ?? 0).toFixed(2)}
              </td>
              <td className="py-3 text-right font-mono text-gray-300">
                {(t.price ?? 0).toFixed(3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function WalletDetailPanel({ address }: Props) {
  const [copied, setCopied] = useState(false);

  const { data: posData, isLoading: posLoading } = useSWR<PositionsResponse>(
    `/api/positions?address=${address}`,
    fetcher,
    { refreshInterval: 120_000 }
  );

  const { data: tradeData, isLoading: tradeLoading } = useSWR<TradesResponse>(
    `/api/trades?address=${address}`,
    fetcher,
    { refreshInterval: 300_000 }
  );

  function copyAddress() {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="space-y-8">
      {/* Address header */}
      <div className="bg-gray-900 rounded-lg p-4 flex items-center gap-4">
        <div>
          <p className="text-xs text-gray-500 mb-1">Wallet Address</p>
          <p className="font-mono text-sm text-white break-all">{address}</p>
        </div>
        <button
          onClick={copyAddress}
          className="ml-auto shrink-0 text-xs px-3 py-1.5 rounded bg-gray-800 hover:bg-gray-700 text-gray-300 transition-colors"
        >
          {copied ? "✓ Copiado" : "Copiar"}
        </button>
      </div>

      {/* Positions */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Posiciones Abiertas</h2>
          <RefreshBadge isLoading={posLoading} />
        </div>
        <div className="bg-gray-900 rounded-lg p-4">
          <PositionsTable
            positions={posData?.positions ?? []}
            loading={posLoading}
          />
        </div>
      </section>

      {/* Trades */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-white">Últimos 20 Trades</h2>
          <RefreshBadge isLoading={tradeLoading} />
        </div>
        <div className="bg-gray-900 rounded-lg p-4">
          <TradesTable
            trades={tradeData?.trades ?? []}
            loading={tradeLoading}
          />
        </div>
      </section>
    </div>
  );
}
