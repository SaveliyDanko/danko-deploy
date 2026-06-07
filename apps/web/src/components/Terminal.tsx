import type { WsClientMessage } from "@dankodeploy/shared";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Terminal as XTerm } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import { useWebSocket } from "../lib/ws.js";

import "@xterm/xterm/css/xterm.css";

/** base64 utf8-safe (btoa ломается на не-Latin1 — кодируем через TextEncoder). */
function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

type TerminalProps =
  | { kind?: "agent"; agentId: string }
  | { kind: "server"; serverId: string };

/**
 * Веб-терминал. Рисует pty-вывод через xterm.js, шлёт ввод/ресайз по WS.
 * Для AI подключается к tmux-сессии агента, для сервера — к прямому SSH shell.
 */
export function Terminal(props: TerminalProps) {
  const isServer = props.kind === "server";
  const kind = isServer ? "server" : "agent";
  const id = isServer ? props.serverId : props.agentId;
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const decoderRef = useRef(new TextDecoder());
  const [exited, setExited] = useState<string | null>(null);

  const subscribe: WsClientMessage[] =
    kind === "server"
      ? [{ type: "subscribe:server-terminal", serverId: id }]
      : [{ type: "subscribe:terminal", agentId: id }];

  const socketRef = useWebSocket(subscribe, (msg) => {
    if (kind === "agent" && msg.type === "terminal:data" && msg.agentId === id) {
      termRef.current?.write(decoderRef.current.decode(fromBase64(msg.data), { stream: true }));
    } else if (kind === "agent" && msg.type === "terminal:exit" && msg.agentId === id) {
      setExited(msg.reason ?? "Сессия закрыта");
    } else if (kind === "server" && msg.type === "server-terminal:data" && msg.serverId === id) {
      termRef.current?.write(decoderRef.current.decode(fromBase64(msg.data), { stream: true }));
    } else if (kind === "server" && msg.type === "server-terminal:exit" && msg.serverId === id) {
      setExited(msg.reason ?? "Сессия закрыта");
    }
  });

  // Инициализация xterm один раз.
  useEffect(() => {
    if (!containerRef.current) return;
    const term = new XTerm({
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      fontSize: 13,
      theme: { background: "#0b0f17", foreground: "#e2e8f0" },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    // Ввод с клавиатуры → WS pty-input (base64).
    const sub = term.onData((data) => {
      const ws = socketRef.current;
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify(
            kind === "server"
              ? { type: "server-terminal:input", serverId: id, data: toBase64(data) }
              : { type: "terminal:input", agentId: id, data: toBase64(data) },
          ),
        );
      }
    });

    return () => {
      sub.dispose();
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind]);

  // Ресайз: ResizeObserver → fit → отправить новый размер на сервер.
  useEffect(() => {
    const sendResize = () => {
      const term = termRef.current;
      const fit = fitRef.current;
      const ws = socketRef.current;
      if (!term || !fit) return;
      fit.fit();
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(
          JSON.stringify(
            kind === "server"
              ? { type: "server-terminal:resize", serverId: id, cols: term.cols, rows: term.rows }
              : { type: "terminal:resize", agentId: id, cols: term.cols, rows: term.rows },
          ),
        );
      }
    };
    const ro = new ResizeObserver(sendResize);
    if (containerRef.current) ro.observe(containerRef.current);
    // первый ресайз чуть позже, когда WS точно открыт
    const t = setTimeout(sendResize, 400);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, kind]);

  /** Отправка спец-клавиш (телефонная клавиатура их не даёт). */
  const sendKey = (seq: string) => {
    const ws = socketRef.current;
    if (ws && ws.readyState === ws.OPEN) {
      ws.send(
        JSON.stringify(
          kind === "server"
            ? { type: "server-terminal:input", serverId: id, data: toBase64(seq) }
            : { type: "terminal:input", agentId: id, data: toBase64(seq) },
        ),
      );
    }
    termRef.current?.focus();
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={containerRef} className="min-h-0 flex-1 bg-ink p-2" />

      {exited && (
        <div className="bg-rose-500/10 px-3 py-2 text-center text-xs text-rose-300">
          {exited} — переоткройте терминал для переподключения.
        </div>
      )}

      {/* Панель спец-клавиш для мобильных */}
      <div className="flex flex-wrap gap-1 border-t border-edge bg-panel p-2">
        {[
          ["Esc", "\x1b"],
          ["Tab", "\t"],
          ["Ctrl+C", "\x03"],
          ["Ctrl+D", "\x04"],
          ["↑", "\x1b[A"],
          ["↓", "\x1b[B"],
          ["←", "\x1b[D"],
          ["→", "\x1b[C"],
          ["|", "|"],
          ["/", "/"],
          ["~", "~"],
        ].map(([label, seq]) => (
          <button
            key={label}
            className="btn-ghost px-2 py-1 text-xs"
            onClick={() => sendKey(seq!)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
