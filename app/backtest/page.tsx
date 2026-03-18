"use client";

import { useState } from "react";
import useSWR from "swr";
import Link from "next/link";

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface BacktestEntry {
  whale:   string;
  market:  string;
  outcome: string;
  price:   number;
  bet:     number;
  status:  "open" | "won" | "lost";
  pnl:     number | null;
  ts:      string;
}

interface WhaleSummary {
  name:        string;
  composite:   number;
  winRate:     number;
  signals:     number;
  openSignals: number;
  wins:        number;
  losses:      number;
  totalBet:    number;
  pnl:         number;
  roi:         number | null;
}

interface BacktestResult {
  period:  { from: string; to: string; label: string };
  config:  { bankroll: number; maxExposure: number; whalesMonitored: number; topWhales: { name: string; composite: string }[] };
  summary: {
    totalTrades: number; skippedLong: number; resolved: number; open: number;
    wins: number; losses: number; winRate: number | null;
    totalBet: number; totalPnl: number; roi: number | null;
    maxExposureReached: boolean;
  };
  byWhale:    WhaleSummary[];
  entries:    BacktestEntry[];
  computedAt: string;
  error?:     string;
}

function PnlChip({ pnl, size = "sm" }: { pnl: number | null; size?: "sm" | "lg" }) {
  if (pnl === null) return <span className="text-zinc-600 font-mono">—</span>;
  const pos   = pnl >= 0;
  const cls   = pos ? "text-emerald-400" : "text-red-400";
  const large = size === "lg" ? "text-2xl font-bold" : "text-xs font-mono";
  return <span className={`${cls} ${large} tabular-nums`}>{pos ? "+" : ""}${pnl.toFixed(2)}</span>;
}

function StatusDot({ status }: { status: BacktestEntry["status"] }) {
  if (status === "won")  return <span className="inline-block w-2 h-2 rounded-full bg-emerald-400" />;
  if (status === "lost") return <span className="inline-block w-2 h-2 rounded-full bg-red-400" />;
  return <span className="inline-block w-2 h-2 rounded-full bg-zinc-600 animate-pulse" />;
}

function Stat({ label, value, accent, sub }: { label: string; value: string | number; accent?: string; sub?: string }) {
  return (
    <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-4">
      <p className="text-[11px] text-zinc-500 uppercase tracking-widest font-medium mb-1">{label}</p>
      <p className={`text-2xl font-bold font-mono tabular-nums ${accent ?? "text-white"}`}>{value}</p>
      {sub && <p className="text-[11px] text-zinc-600 mt-1">{sub}</p>}
    </div>
  );
}

const WINDOWS = [
  { label: "Ayer",           startH: 48, endH: 24 },
  { label: "Últimas 24h",    startH: 24, endH: 0  },
  { label: "Últimas 48h",    startH: 48, endH: 0  },
  { label: "Últimas 72h",    startH: 72, endH: 0  },
];

export default function BacktestPage() {
  const [window, setWindow] = useState(WINDOWS[0]);
  const [running, setRunning] = useState(false);

  const url = `/api/backtest?startH=${window.startH}&endH=${window.endH}`;
  const { data, isLoading, error, mutate } = useSWR<BacktestResult>(
    url, fetcher, { revalidateOnFocus: false }
  );

  const handleRun = async () => {
    setRunning(true);
    await mutate();
    setRunning(false);
  };

  const s       = data?.summary;
  const loading = isLoading || running;

  const pnlColor = (s?.totalPnl ?? 0) >= 0 ? "text-emerald-400" : "text-red-400";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Backtest</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Simulación retroactiva — ¿qué habría pasado si el sistema estuviera corriendo?
          </p>
        </div>
        <Link href="/" className="text-xs text-zinc-600 hover:text-zinc-400 mt-1">← Leaderboard</Link>
      </div>

      {/* Window selector + run */}
      <div className="flex items-center gap-2 flex-wrap">
        {WINDOWS.map(w => (
          <button
            key={w.label}
            onClick={() => setWindow(w)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-all ${
              window.label === w.label
                ? "bg-amber-500/10 border-amber-600/50 text-amber-300"
                : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {w.label}
          </button>
        ))}
        <button
          onClick={handleRun}
          disabled={loading}
          className="ml-auto px-4 py-1.5 text-xs rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 disabled:opacity-50 transition-all"
        >
          {loading ? "Calculando…" : "↻ Recalcular"}
        </button>
      </div>

      {/* Config strip */}
      {data?.config && (
        <div className="text-xs text-zinc-600 flex flex-wrap gap-x-4 gap-y-1">
          <span>Whales: <span className="text-zinc-400">{data.config.topWhales.map(w => w.name).join(", ")}</span></span>
          <span>Bankroll: <span className="text-zinc-400">${data.config.bankroll}</span></span>
          <span>Max exposición: <span className="text-zinc-400">${data.config.maxExposure}</span></span>
          <span className="text-zinc-700">·</span>
          <span className="text-zinc-700">{data.period?.label}</span>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 bg-zinc-900 rounded-xl border border-zinc-800" />
          ))}
        </div>
      )}

      {/* Error */}
      {(error || data?.error) && !loading && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-red-400 text-sm">
          {data?.error ?? "Error al cargar backtest"}
        </div>
      )}

      {/* Summary cards */}
      {s && !loading && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Stat
              label="P&L simulado"
              value={`${(s.totalPnl ?? 0) >= 0 ? "+" : ""}$${(s.totalPnl ?? 0).toFixed(2)}`}
              accent={pnlColor}
              sub={`sobre $${s.totalBet.toFixed(2)} apostados`}
            />
            <Stat
              label="ROI"
              value={s.roi != null ? `${s.roi > 0 ? "+" : ""}${s.roi}%` : "—"}
              accent={s.roi != null ? (s.roi >= 0 ? "text-emerald-400" : "text-red-400") : "text-zinc-500"}
              sub={`${s.wins}W / ${s.losses}L`}
            />
            <Stat
              label="Win rate"
              value={s.winRate != null ? `${s.winRate}%` : "—"}
              accent={s.winRate != null ? (s.winRate >= 55 ? "text-emerald-400" : s.winRate >= 50 ? "text-yellow-400" : "text-red-400") : "text-zinc-500"}
              sub={`${s.resolved} resueltos · ${s.open} abiertos`}
            />
            <Stat
              label="Señales"
              value={s.totalTrades}
              accent="text-white"
              sub={`${s.skippedLong} omitidas (mercados largos)${s.maxExposureReached ? " · cap alcanzado" : ""}`}
            />
          </div>

          {/* Per-whale table */}
          {data.byWhale.length > 0 && (
            <div className="rounded-xl border border-zinc-800/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/60">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">Por whale</p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] text-zinc-600 uppercase tracking-widest border-b border-zinc-800/40">
                    <th className="text-left px-4 py-2">Whale</th>
                    <th className="text-right px-3 py-2">Composite</th>
                    <th className="text-right px-3 py-2">WR est.</th>
                    <th className="text-right px-3 py-2">Señales</th>
                    <th className="text-right px-3 py-2">W/L</th>
                    <th className="text-right px-3 py-2">Apostado</th>
                    <th className="text-right px-4 py-2">P&L</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {data.byWhale.sort((a, b) => b.pnl - a.pnl).map(w => (
                    <tr key={w.name} className="hover:bg-zinc-800/20 transition-colors">
                      <td className="px-4 py-2.5 text-zinc-200 font-medium">{w.name}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-400 text-xs">{w.composite}</td>
                      <td className="px-3 py-2.5 text-right font-mono text-xs">
                        <span className={w.winRate >= 55 ? "text-emerald-400" : w.winRate >= 50 ? "text-yellow-400" : "text-zinc-500"}>
                          {w.winRate}%
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-300">
                        {w.signals}{w.openSignals > 0 && <span className="text-zinc-600 text-xs"> +{w.openSignals}▸</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right text-xs font-mono">
                        <span className="text-emerald-400">{w.wins}W</span>
                        <span className="text-zinc-700 mx-1">/</span>
                        <span className="text-red-400">{w.losses}L</span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-mono text-zinc-400 text-xs">${w.totalBet.toFixed(2)}</td>
                      <td className="px-4 py-2.5 text-right">
                        <PnlChip pnl={w.pnl} />
                        {w.roi !== null && (
                          <span className={`text-[10px] ml-1 ${w.roi >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            ({w.roi > 0 ? "+" : ""}{w.roi}%)
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Trade log */}
          {data.entries.length > 0 && (
            <div className="rounded-xl border border-zinc-800/60 overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/60 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                  Trades ({data.entries.length})
                </p>
                <div className="flex items-center gap-3 text-[11px]">
                  <span className="flex items-center gap-1.5 text-zinc-600"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Won</span>
                  <span className="flex items-center gap-1.5 text-zinc-600"><span className="w-2 h-2 rounded-full bg-red-400 inline-block" /> Lost</span>
                  <span className="flex items-center gap-1.5 text-zinc-600"><span className="w-2 h-2 rounded-full bg-zinc-600 inline-block" /> Open</span>
                </div>
              </div>
              <div className="divide-y divide-zinc-800/30 max-h-[480px] overflow-y-auto">
                {data.entries.map((e, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5 hover:bg-zinc-800/20 transition-colors text-xs">
                    <StatusDot status={e.status} />
                    <span className={`w-8 font-mono font-semibold shrink-0 ${e.outcome === "YES" ? "text-emerald-400" : "text-red-400"}`}>
                      {e.outcome === "YES" ? "YES" : "NO"}
                    </span>
                    <span className="font-mono text-zinc-500 w-14 shrink-0">@ {e.price.toFixed(3)}</span>
                    <span className="font-mono text-zinc-500 w-12 shrink-0">${e.bet.toFixed(2)}</span>
                    <span className="text-zinc-400 flex-1 truncate">{e.market}</span>
                    <span className="text-zinc-600 w-14 text-right shrink-0">{e.whale}</span>
                    <PnlChip pnl={e.pnl} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.entries.length === 0 && !loading && (
            <div className="text-center py-12 text-zinc-600 text-sm">
              Sin trades en la ventana seleccionada para las whales actuales.
              <p className="text-zinc-700 text-xs mt-1">
                Ejecuta el refresh-leaderboard si whale_wallets está vacío.
              </p>
            </div>
          )}

          <p className="text-[11px] text-zinc-700 text-center font-mono">
            Calculado: {new Date(data.computedAt).toLocaleString()}
            {" · "} Kelly ¼ · cap $15/whale · max $80 total
          </p>
        </>
      )}
    </div>
  );
}
