import type { AiAgentStatus, WsClientMessage } from "@dankodeploy/shared";
import { useEffect, useRef, useState } from "react";

import { useWebSocket } from "../lib/ws.js";
import { Spinner } from "./ui.js";

interface LogLine {
  text: string;
  stream: "stdout" | "stderr" | "info";
}

/**
 * Drawer с live-логом установки AI-агента. Подписывается на WS-канал ai:<agentId>,
 * рендерит строки и финальный статус (running/error).
 */
export function AiDeployDrawer({
  agentId,
  agentName,
  title = "Установка",
  onClose,
  onDone,
}: {
  agentId: string;
  agentName: string;
  title?: string;
  onClose: () => void;
  onDone?: (status: AiAgentStatus) => void;
}) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [status, setStatus] = useState<AiAgentStatus>("installing");
  const endRef = useRef<HTMLDivElement>(null);

  const subscribe: WsClientMessage[] = [{ type: "subscribe:ai", agentId }];

  useWebSocket(subscribe, (msg) => {
    if (msg.type === "ai:log" && msg.agentId === agentId) {
      setLines((prev) => [...prev, { text: msg.line, stream: msg.stream }]);
    } else if (msg.type === "ai:status" && msg.agentId === agentId) {
      const s = msg.status as AiAgentStatus;
      setStatus(s);
      if (s === "running" || s === "stopped" || s === "error") onDone?.(s);
    }
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-edge bg-panel shadow-2xl">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-semibold">{title} · {agentName}</span>
          {status === "installing" || status === "uninstalling" ? (
            <span className="flex items-center gap-1 text-xs text-amber-400">
              <Spinner /> идёт…
            </span>
          ) : status === "running" || status === "ready" || status === "stopped" ? (
            <span className="text-xs text-emerald-400">✔ готово</span>
          ) : (
            <span className="text-xs text-rose-400">✖ ошибка</span>
          )}
        </div>
        <button className="btn-ghost px-2 py-1" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="flex-1 overflow-y-auto bg-ink p-4 font-mono text-xs leading-relaxed">
        {lines.length === 0 && <div className="text-slate-500">Ожидание вывода…</div>}
        {lines.map((l, i) => (
          <div
            key={i}
            className={
              l.stream === "stderr"
                ? "text-rose-300"
                : l.stream === "info"
                  ? "text-indigo-300"
                  : "text-slate-300"
            }
          >
            {l.text || " "}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
