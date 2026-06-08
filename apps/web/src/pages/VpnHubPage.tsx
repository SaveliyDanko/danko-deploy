import { useSearchParams } from "react-router-dom";

import { VpnServerSection } from "./VpnPage.js";
import { VpnClientSection } from "./VpnClientPage.js";

type VpnTab = "server" | "client";

const tabs: { id: VpnTab; label: string }[] = [
  { id: "server", label: "VPN-сервер" },
  { id: "client", label: "VPN-клиент" },
];

/**
 * Общее окно VPN с двумя вкладками: «VPN-сервер» (раскатка Outline на серверы) и
 * «VPN-клиент» (VPS ходит в интернет через провайдера, sing-box). Активная вкладка
 * хранится в url (?tab=), чтобы работали закладки и обновление страницы.
 */
export function VpnPage() {
  const [params, setParams] = useSearchParams();
  const active: VpnTab = params.get("tab") === "client" ? "client" : "server";

  const select = (tab: VpnTab) => {
    // server — дефолт, чистим параметр, чтобы url оставался /vpn
    setParams(tab === "server" ? {} : { tab }, { replace: true });
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">VPN</h1>

      <div className="flex gap-1 border-b border-edge">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => select(t.id)}
            className={`-mb-px rounded-t-lg border-b-2 px-4 py-2 text-sm font-medium transition ${
              active === t.id
                ? "border-indigo-500 text-white"
                : "border-transparent text-slate-400 hover:text-slate-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {active === "server" ? <VpnServerSection /> : <VpnClientSection />}
    </div>
  );
}
