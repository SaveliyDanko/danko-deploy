import { useEffect, useRef } from "react";

import type { WsClientMessage, WsServerMessage } from "@dankodeploy/shared";

/** Открывает WS к /ws на том же origin (vite проксирует на backend). */
function wsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

/**
 * Подписка на WS-сообщения. Колбэк `onMessage` получает разобранные сообщения сервера.
 * `subscribe` (массив сообщений) отправляется при открытии соединения.
 * Возвращает ref на send для управления подписками во время жизни компонента.
 */
export function useWebSocket(
  subscribe: WsClientMessage[],
  onMessage: (msg: WsServerMessage) => void,
  enabled = true,
) {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const socketRef = useRef<WebSocket | null>(null);

  // Сериализуем subscribe для зависимости эффекта
  const subKey = JSON.stringify(subscribe);

  useEffect(() => {
    if (!enabled) return;
    const ws = new WebSocket(wsUrl());
    socketRef.current = ws;

    ws.onopen = () => {
      for (const msg of JSON.parse(subKey) as WsClientMessage[]) {
        ws.send(JSON.stringify(msg));
      }
    };
    ws.onmessage = (ev) => {
      try {
        onMessageRef.current(JSON.parse(ev.data) as WsServerMessage);
      } catch {
        /* ignore malformed */
      }
    };

    return () => {
      ws.close();
      socketRef.current = null;
    };
  }, [subKey, enabled]);

  return socketRef;
}
