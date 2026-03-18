import { WalletDetailPanel } from "@/components/WalletDetailPanel";
import Link from "next/link";

interface Props {
  params: { address: string };
}

export default function WalletPage({ params }: Props) {
  const { address } = params;

  return (
    <div className="space-y-6">
      {/* Back nav */}
      <div>
        <Link
          href="/"
          className="text-sm text-gray-500 hover:text-gray-300 transition-colors inline-flex items-center gap-1"
        >
          ← Volver al Leaderboard
        </Link>
      </div>

      <div>
        <h2 className="text-xl font-bold text-white">Detalle de Wallet</h2>
        <p className="text-sm text-gray-500 mt-1">
          Posiciones abiertas y trades recientes
        </p>
      </div>

      <WalletDetailPanel address={address} />
    </div>
  );
}
