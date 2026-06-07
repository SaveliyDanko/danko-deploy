import type { DeployStatus, WsClientMessage } from "@dankodeploy/shared";
import { useEffect, useRef, useState } from "react";

import { useWebSocket } from "../lib/ws.js";
import { Spinner } from "./ui.js";

interface LogLine {
  text: string;
  stream: "stdout" | "stderr" | "info";
}

/**
 * Drawer с live-логом деплоя. Подписывается на WS-канал deploy:<runId>,
 * рендерит строки и финальный статус.
 */
export function DeployDrawer({
  runId,
  projectName,
  title = "Деплой",
  onClose,
  onDone,
}: {
  runId: string;
  projectName: string;
  title?: string;
  onClose: () => void;
  onDone?: (status: DeployStatus) => void;
}) {
  const [lines, setLines] = useState<LogLine[]>(() => [
    { text: `Новый запуск: ${runId}`, stream: "info" },
  ]);
  const [status, setStatus] = useState<DeployStatus>("running");
  const endRef = useRef<HTMLDivElement>(null);

  const subscribe: WsClientMessage[] = [{ type: "subscribe:deploy", runId }];

  useWebSocket(subscribe, (msg) => {
    if (msg.type === "deploy:log" && msg.runId === runId) {
      setLines((prev) => [...prev, { text: msg.line, stream: msg.stream }]);
    } else if (msg.type === "deploy:done" && msg.runId === runId) {
      setStatus(msg.status);
      onDone?.(msg.status);
    }
  });

  useEffect(() => {
    setStatus("running");
    setLines([{ text: `Новый запуск: ${runId}`, stream: "info" }]);
  }, [runId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines.length]);

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col border-l border-edge bg-panel shadow-2xl">
      <div className="flex items-center justify-between border-b border-edge px-4 py-3">
        <div className="flex items-center gap-3">
          <div>
            <div className="font-semibold">{title} · {projectName}</div>
            <div className="font-mono text-[11px] text-slate-500">run {runId}</div>
          </div>
          {status === "running" ? (
            <span className="flex items-center gap-1 text-xs text-amber-400">
              <Spinner /> идёт…
            </span>
          ) : status === "success" ? (
            <span className="text-xs text-emerald-400">✔ успех</span>
          ) : (
            <span className="text-xs text-rose-400">✖ ошибка</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            className="btn-ghost px-3 py-1 text-xs"
            disabled={lines.length === 0}
            title="Очистить видимый лог в этом окне"
            onClick={() => setLines([])}
          >
            Очистить лог
          </button>
          <button className="btn-ghost px-2 py-1" onClick={onClose}>
            ✕
          </button>
        </div>
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
            {l.text || " "}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
