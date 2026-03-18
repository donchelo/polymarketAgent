import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polymarket Whale Tracker",
  description: "Top active wallets on Polymarket ranked by activity score",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="bg-[#060810] text-slate-100 min-h-screen antialiased">
        <header className="border-b border-zinc-800/60 bg-[#060810]/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-6 py-3 flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M6 1L7.5 4.5H11L8.25 6.75L9.5 10.5L6 8.25L2.5 10.5L3.75 6.75L1 4.5H4.5L6 1Z" fill="#f59e0b" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-white tracking-tight">Whale Tracker</span>
            </div>
            <nav className="ml-auto flex items-center gap-1">
              {[
                { href: "/",            label: "Leaderboard" },
                { href: "/signals",     label: "Señales"     },
                { href: "/whale-study", label: "Inteligencia"},
                { href: "/backtest",   label: "Backtest"    },
              ].map(({ href, label }) => (
                <a
                  key={href}
                  href={href}
                  className="px-3 py-1.5 text-sm text-zinc-400 hover:text-white rounded-md hover:bg-zinc-800/60 transition-colors"
                >
                  {label}
                </a>
              ))}
            </nav>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
