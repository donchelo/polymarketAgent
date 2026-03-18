"use client";

import { useState, useEffect } from "react";

// Mirror of DEFAULT_STRATEGY for display (no server import in client component)
const DEFAULT_PARAMS: Record<string, number> = {
  BANKROLL: 100,
  MAX_EXPOSURE_PCT: 0.80,
  MAX_EXPOSURE_PER_WHALE: 15,
  MIN_SIZE: 0.50,
  MAX_SIZE: 5.00,
  WIN_RATE_PROXY: 0.52,
  TOP_WHALES: 10,
  MIN_SCORE: 50,
  MIN_TRADES_PER_DAY: 1.5,
  MAX_MARKET_DURATION_H: 24,
  MIN_PRICE: 0.08,
  MAX_PRICE: 0.92,
  MIN_EDGE: 0.05,
  MIN_REAL_WIN_RATE: 0.54,
};

const PARAM_LABELS: Record<string, string> = {
  BANKROLL: "Bankroll",
  MAX_EXPOSURE_PCT: "Max Exp %",
  MAX_EXPOSURE_PER_WHALE: "Max/Whale $",
  MIN_SIZE: "Min Bet $",
  MAX_SIZE: "Max Bet $",
  WIN_RATE_PROXY: "WR Proxy",
  TOP_WHALES: "Top Whales",
  MIN_SCORE: "Min Score",
  MIN_TRADES_PER_DAY: "Min T/Day",
  MAX_MARKET_DURATION_H: "Max Dur H",
  MIN_PRICE: "Min Price",
  MAX_PRICE: "Max Price",
  MIN_EDGE: "Min Edge",
  MIN_REAL_WIN_RATE: "Min Real WR",
};

interface WindowResult {
  label: string;
  roi: number | null;
  resolved: number;
  wins: number;
  losses: number;
  totalTrades: number;
}

interface Experiment {
  idx: number;
  variation: string;
  changedParams: Record<string, number>;
  params: Record<string, number>;
  windows: WindowResult[];
  score: number;
  totalResolved: number;
  totalTrades: number;
}

interface OptimizeResult {
  winner: Experiment;
  ranked: Experiment[];
  dataInfo: {
    whalesLoaded: number;
    marketsTotal: number;
    marketsClosed: number;
    variationsTested: number;
  };
  computedAt: string;
  error?: string;
}

interface HistoryEntry {
  timestamp: string;
  result: OptimizeResult;
}

const STORAGE_KEY = "strategy-lab-history";

function RoiCell({ roi }: { roi: number | null }) {
  if (roi === null) return <span className="text-zinc-600 font-mono">—</span>;
  const color = roi > 5 ? "text-emerald-400" : roi >= 0 ? "text-yellow-400" : "text-red-400";
  return (
    <span className={`font-mono tabular-nums text-xs ${color}`}>
      {roi > 0 ? "+" : ""}{roi}%
    </span>
  );
}

function ScoreCell({ score, isWinner }: { score: number; isWinner: boolean }) {
  const color = isWinner ? "text-amber-300 font-bold" : score > 0 ? "text-zinc-200" : "text-zinc-500";
  return <span className={`font-mono tabular-nums text-xs ${color}`}>{score.toFixed(3)}</span>;
}

function ParamChip({ label, value, highlighted }: { label: string; value: number; highlighted?: boolean }) {
  const fmt = value < 1 && value > 0 ? value.toFixed(2) : String(value);
  return (
    <div className={`px-2.5 py-1.5 rounded-lg border text-xs flex gap-1.5 items-center ${
      highlighted
        ? "bg-amber-500/10 border-amber-600/40 text-amber-300"
        : "bg-zinc-900 border-zinc-800 text-zinc-400"
    }`}>
      <span className="text-zinc-600 text-[10px] uppercase tracking-wide">{label}</span>
      <span className="font-mono text-zinc-200">{fmt}</span>
    </div>
  );
}

function buildBacktestUrl(params: Record<string, number>): string {
  const changed = Object.entries(params).filter(
    ([k, v]) => DEFAULT_PARAMS[k] !== undefined && DEFAULT_PARAMS[k] !== v
  );
  if (!changed.length) return "/backtest";
  const qs = changed.map(([k, v]) => `${k}=${v}`).join("&");
  return `/backtest?${qs}`;
}

export default function StrategyLabPage() {
  const [loading, setLoading]     = useState(false);
  const [result, setResult]       = useState<OptimizeResult | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const [history, setHistory]     = useState<HistoryEntry[]>([]);
  const [activeParams, setActiveParams] = useState<Record<string, number>>(DEFAULT_PARAMS);

  // Load history from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: HistoryEntry[] = JSON.parse(raw);
        setHistory(parsed);
        // Restore last applied params if any
        const lastApplied = localStorage.getItem("strategy-lab-active");
        if (lastApplied) setActiveParams(JSON.parse(lastApplied));
      }
    } catch { /* ignore */ }
  }, []);

  const runOptimization = async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch("/api/optimize");
      const data = await res.json() as OptimizeResult;
      if (data.error) { setError(data.error); return; }
      setResult(data);

      // Save to history (max 5)
      const entry: HistoryEntry = { timestamp: new Date().toISOString(), result: data };
      const newHistory = [entry, ...history].slice(0, 5);
      setHistory(newHistory);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setLoading(false);
    }
  };

  const applyParams = (params: Record<string, number>) => {
    setActiveParams(params);
    localStorage.setItem("strategy-lab-active", JSON.stringify(params));
  };

  const isActive = (params: Record<string, number>) =>
    JSON.stringify(params) === JSON.stringify(activeParams);

  const ranked = result?.ranked ?? [];
  const winner = result?.winner;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Strategy Lab</h2>
          <p className="text-sm text-zinc-500 mt-1">
            Autoresearch loop — prueba {Object.keys(DEFAULT_PARAMS).length > 0 ? "18" : "N"} variaciones de parámetros y encuentra la estrategia óptima
          </p>
        </div>
        <button
          onClick={runOptimization}
          disabled={loading}
          className="px-5 py-2 rounded-lg bg-amber-500/10 border border-amber-600/40 text-amber-300 text-sm font-medium hover:bg-amber-500/20 disabled:opacity-40 transition-all"
        >
          {loading ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-3.5 h-3.5 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
              Probando variaciones…
            </span>
          ) : "↻ Run Optimization"}
        </button>
      </div>

      {/* Current params */}
      <div className="rounded-xl border border-zinc-800/60 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Parámetros activos
          </p>
          {JSON.stringify(activeParams) !== JSON.stringify(DEFAULT_PARAMS) && (
            <button
              onClick={() => applyParams(DEFAULT_PARAMS)}
              className="text-[11px] text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              ↺ Resetear a defaults
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(activeParams).map(([k, v]) => (
            <ParamChip
              key={k}
              label={PARAM_LABELS[k] ?? k}
              value={v}
              highlighted={DEFAULT_PARAMS[k] !== v}
            />
          ))}
        </div>
        {JSON.stringify(activeParams) !== JSON.stringify(DEFAULT_PARAMS) && (
          <a
            href={buildBacktestUrl(activeParams)}
            className="inline-flex items-center gap-1.5 text-xs text-amber-400 hover:text-amber-300 transition-colors"
          >
            ↗ Ver backtest con estos parámetros
          </a>
        )}
      </div>

      {/* Loading hint */}
      {loading && (
        <div className="rounded-xl border border-zinc-800/40 bg-zinc-900/40 p-6 text-center space-y-2">
          <div className="flex items-center justify-center gap-2 text-zinc-400 text-sm">
            <span className="inline-block w-4 h-4 border-2 border-zinc-600 border-t-zinc-300 rounded-full animate-spin" />
            Cargando trades y mercados… puede tardar ~30s
          </div>
          <p className="text-xs text-zinc-600">
            Fetching 30 whales × 200 trades + resolución de mercados en paralelo
          </p>
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-4 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <>
          {/* Data info strip */}
          <div className="text-xs text-zinc-600 flex flex-wrap gap-x-4 gap-y-1">
            <span>Whales: <span className="text-zinc-400">{result.dataInfo.whalesLoaded}</span></span>
            <span>Mercados: <span className="text-zinc-400">{result.dataInfo.marketsClosed}/{result.dataInfo.marketsTotal} resueltos</span></span>
            <span>Variaciones: <span className="text-zinc-400">{result.dataInfo.variationsTested}</span></span>
            <span className="text-zinc-700">·</span>
            <span className="text-zinc-700">{new Date(result.computedAt).toLocaleTimeString()}</span>
          </div>

          {/* Winner highlight */}
          {winner && (
            <div className="rounded-xl border border-amber-600/30 bg-amber-500/5 p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">
                    Mejor estrategia
                  </span>
                  <span className="text-sm text-zinc-300 font-mono">{winner.variation}</span>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href={buildBacktestUrl(winner.params)}
                    className="px-3 py-1 rounded-md border border-zinc-700 text-xs text-zinc-400 hover:text-zinc-200 hover:border-zinc-500 transition-colors"
                  >
                    Ver backtest ↗
                  </a>
                  <button
                    onClick={() => applyParams(winner.params)}
                    disabled={isActive(winner.params)}
                    className="px-3 py-1 rounded-md bg-amber-500/15 border border-amber-600/40 text-xs text-amber-300 hover:bg-amber-500/25 disabled:opacity-40 transition-all"
                  >
                    {isActive(winner.params) ? "✓ Aplicado" : "↗ Aplicar"}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-4 text-xs">
                {winner.windows.map(w => (
                  <div key={w.label} className="flex items-center gap-1.5">
                    <span className="text-zinc-600">{w.label}:</span>
                    <RoiCell roi={w.roi} />
                    <span className="text-zinc-700">({w.resolved} res.)</span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5">
                  <span className="text-zinc-600">Score:</span>
                  <span className="text-amber-300 font-mono font-bold">{winner.score.toFixed(3)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Full ranking table */}
          <div className="rounded-xl border border-zinc-800/60 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 bg-zinc-900/60">
              <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
                Ranking completo ({ranked.length} variaciones)
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[700px]">
                <thead>
                  <tr className="text-[11px] text-zinc-600 uppercase tracking-widest border-b border-zinc-800/40">
                    <th className="text-left px-4 py-2">#</th>
                    <th className="text-left px-3 py-2">Variación</th>
                    {["Ayer", "Anteayer", "Semana"].map(w => (
                      <th key={w} className="text-right px-3 py-2">{w} ROI</th>
                    ))}
                    <th className="text-right px-3 py-2">Score</th>
                    <th className="text-right px-3 py-2">Resueltos</th>
                    <th className="text-right px-4 py-2">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/30">
                  {ranked.map((exp, rank) => {
                    const isWinner = rank === 0;
                    const applied  = isActive(exp.params);
                    return (
                      <tr
                        key={exp.idx}
                        className={`transition-colors ${
                          isWinner
                            ? "bg-amber-500/5 hover:bg-amber-500/8"
                            : "hover:bg-zinc-800/20"
                        }`}
                      >
                        <td className="px-4 py-2.5 text-zinc-600 font-mono text-xs w-8">
                          {rank + 1}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`text-xs font-mono ${isWinner ? "text-amber-300" : "text-zinc-400"}`}>
                            {exp.variation}
                          </span>
                          {applied && (
                            <span className="ml-2 text-[10px] text-emerald-500 bg-emerald-500/10 px-1.5 py-0.5 rounded">
                              activo
                            </span>
                          )}
                        </td>
                        {exp.windows.map(w => (
                          <td key={w.label} className="px-3 py-2.5 text-right">
                            <RoiCell roi={w.roi} />
                            {w.resolved > 0 && (
                              <span className="text-zinc-700 text-[10px] ml-1">({w.resolved})</span>
                            )}
                          </td>
                        ))}
                        <td className="px-3 py-2.5 text-right">
                          <ScoreCell score={exp.score} isWinner={isWinner} />
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-zinc-500">
                          {exp.totalResolved}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <a
                              href={buildBacktestUrl(exp.params)}
                              className="px-2 py-0.5 rounded text-[11px] text-zinc-500 hover:text-zinc-300 border border-zinc-800 hover:border-zinc-600 transition-colors"
                            >
                              bt ↗
                            </a>
                            <button
                              onClick={() => applyParams(exp.params)}
                              disabled={applied}
                              className="px-2 py-0.5 rounded text-[11px] border transition-colors disabled:opacity-30 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500"
                            >
                              {applied ? "✓" : "Apply"}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[11px] text-zinc-700 text-center font-mono">
            Score = avgROI × sigFactor × (1 + consistencyBonus) · sigFactor recompensa más trades resueltos · consistencyBonus +50% si todas las ventanas son positivas
          </p>
        </>
      )}

      {/* History */}
      {history.length > 0 && !result && (
        <div className="rounded-xl border border-zinc-800/60 p-4 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">
            Historial ({history.length})
          </p>
          <div className="space-y-2">
            {history.map((h, i) => (
              <div
                key={i}
                className="flex items-center justify-between text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer transition-colors"
                onClick={() => setResult(h.result)}
              >
                <span>{new Date(h.timestamp).toLocaleString()}</span>
                <span className="font-mono">
                  winner: <span className="text-amber-400">{h.result.winner?.variation}</span>
                  {" · "}score <span className="text-zinc-300">{h.result.winner?.score.toFixed(3)}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!result && !loading && history.length === 0 && (
        <div className="text-center py-16 text-zinc-600 text-sm">
          Presiona <span className="text-zinc-400">"↻ Run Optimization"</span> para encontrar la mejor estrategia.
          <p className="text-zinc-700 text-xs mt-2">
            Tarda ~30s · prueba 18 variaciones × 3 ventanas temporales
          </p>
        </div>
      )}
    </div>
  );
}
