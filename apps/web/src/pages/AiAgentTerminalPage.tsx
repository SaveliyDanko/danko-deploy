import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";

import { Terminal } from "../components/Terminal.js";
import { Spinner } from "../components/ui.js";
import { api } from "../lib/api.js";

/**
 * Полноэкранная страница веб-терминала к AI-агенту. Вне общего layout —
 * терминал на весь экран, удобно с телефона.
 */
export function AiAgentTerminalPage() {
  const { id = "" } = useParams();
  const agents = useQuery({ queryKey: ["ai-agents"], queryFn: api.listAiAgents });
  const agent = agents.data?.find((a) => a.id === id);

  const start = useMutation({ mutationFn: () => api.startAiAgent(id) });
  const stop = useMutation({ mutationFn: () => api.stopAiAgent(id) });

  return (
    <div className="flex h-[100dvh] flex-col bg-ink">
      <header className="flex items-center justify-between border-b border-edge bg-panel px-3 py-2">
        <div className="flex items-center gap-2">
          <Link to="/ai" className="btn-ghost px-2 py-1 text-xs">
            ← AI
          </Link>
          <span className="text-sm font-medium">
            {agent ? agent.name : "Терминал"}
            {agent && (
              <span className="ml-2 text-xs text-slate-500">
                {agent.agentType} · {agent.workdir}
              </span>
            )}
          </span>
        </div>
        <div className="flex gap-1">
          <button
            className="btn-ghost px-2 py-1 text-xs"
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? <Spinner /> : "Запустить"}
          </button>
          <button
            className="btn-ghost px-2 py-1 text-xs"
            disabled={stop.isPending}
            onClick={() => stop.mutate()}
          >
            {stop.isPending ? <Spinner /> : "Стоп"}
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1">
        {id && <Terminal agentId={id} />}
      </div>
    </div>
  );
}
