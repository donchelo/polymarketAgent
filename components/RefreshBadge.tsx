"use client";

import { useEffect, useState } from "react";

interface RefreshBadgeProps {
  computedAt?: string;
  isLoading?: boolean;
}

export function RefreshBadge({ computedAt, isLoading }: RefreshBadgeProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!computedAt) return;
    const interval = setInterval(() => {
      const secs = Math.floor((Date.now() - new Date(computedAt).getTime()) / 1000);
      setElapsed(secs);
    }, 1000);
    return () => clearInterval(interval);
  }, [computedAt]);

  function formatElapsed(s: number): string {
    if (s < 60) return `hace ${s}s`;
    if (s < 3600) return `hace ${Math.floor(s / 60)}m`;
    return `hace ${Math.floor(s / 3600)}h`;
  }

  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      {isLoading ? (
        <>
          <span className="inline-block w-2 h-2 rounded-full bg-yellow-400 animate-pulse" />
          <span>Calculando...</span>
        </>
      ) : computedAt ? (
        <>
          <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
          <span>Actualizado {formatElapsed(elapsed)}</span>
        </>
      ) : null}
    </div>
  );
}
