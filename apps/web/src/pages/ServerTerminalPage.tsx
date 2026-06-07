import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { Terminal } from "../components/Terminal.js";
import { Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";

/**
 * Полноэкранный SSH-терминал конкретного сервера. Вне общего layout —
 * терминал занимает весь экран и удобен с телефона.
 */
export function ServerTerminalPage() {
  const { id = "" } = useParams();
  const server = useQuery({
    queryKey: ["server", id],
    queryFn: () => api.getServer(id),
    enabled: Boolean(id),
  });

  return (
    <div className="flex h-[100dvh] flex-col bg-ink">
      <header className="flex items-center justify-between border-b border-edge bg-panel px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={id ? `/servers/${id}` : "/servers"} className="btn-ghost px-2 py-1 text-xs">
            ← Сервер
          </Link>
          <span className="truncate text-sm font-medium">
            {server.data?.name ?? "Терминал сервера"}
            {server.data && (
              <span className="ml-2 text-xs text-slate-500">
                {server.data.username}@{server.data.host}
              </span>
            )}
          </span>
        </div>
        {server.isLoading && <Spinner />}
      </header>
      <div className="min-h-0 flex-1">
        {id && <Terminal kind="server" serverId={id} />}
      </div>
    </div>
  );
}
