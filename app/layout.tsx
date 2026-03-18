import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Polymarket Whale Leaderboard",
  description: "Top active wallets on Polymarket ranked by activity score",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-gray-950 text-gray-100 min-h-screen antialiased">
        <header className="border-b border-gray-800 px-6 py-4">
          <div className="max-w-7xl mx-auto flex items-center gap-3">
            <span className="text-xl font-bold text-white">🐋</span>
            <h1 className="text-lg font-semibold text-white">Polymarket Whale Tracker</h1>
            <span className="text-xs text-gray-500 ml-auto">S01 — Active Wallet Scanner</span>
          </div>
        </header>
        <main className="max-w-7xl mx-auto px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
