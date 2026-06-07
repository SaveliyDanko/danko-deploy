import { wsClientMessageSchema } from "@dankodeploy/shared";
import type { FastifyInstance } from "fastify";

import type { AppContext } from "../context.js";
import { isRequestAuthenticated } from "../plugins/authGuard.js";

/**
 * Единый WS-эндпоинт /ws. Клиент шлёт subscribe:* сообщения, сервер рассылает
 * deploy/metrics/ai/terminal по каналам через WsHub и TerminalBridge.
 *
 * ВАЖНО: WS-терминал = прямой shell-доступ к серверу, поэтому при handshake
 * проверяем сессию (cookie передаётся браузером при upgrade автоматически).
 */
export function registerWsRoute(app: FastifyInstance, ctx: AppContext): void {
  app.get("/ws", { websocket: true }, (socket, req) => {
    if (!isRequestAuthenticated(app, ctx, req)) {
      socket.close(1008, "unauthorized");
      return;
    }

    socket.on("message", (raw: Buffer) => {
      let parsed;
      try {
        parsed = wsClientMessageSchema.safeParse(JSON.parse(raw.toString()));
      } catch {
        return;
      }
      if (!parsed.success) return;
      const msg = parsed.data;

      switch (msg.type) {
        case "subscribe:deploy":
          ctx.hub.subscribe(`deploy:${msg.runId}`, socket);
          break;
        case "subscribe:metrics":
          ctx.hub.subscribe(`metrics:${msg.serverId}`, socket);
          break;
        case "unsubscribe:metrics":
          ctx.hub.unsubscribe(`metrics:${msg.serverId}`, socket);
          break;
        case "subscribe:ai":
          ctx.hub.subscribe(`ai:${msg.agentId}`, socket);
          break;
        case "subscribe:terminal":
          void ctx.terminal.attach(socket, msg.agentId);
          break;
        case "unsubscribe:terminal":
          ctx.terminal.detach(socket, msg.agentId);
          break;
        case "terminal:input":
          ctx.terminal.input(socket, msg.agentId, msg.data);
          break;
        case "terminal:resize":
          ctx.terminal.resize(socket, msg.agentId, msg.cols, msg.rows);
          break;
        case "subscribe:server-terminal":
          void ctx.terminal.attachServer(socket, msg.serverId);
          break;
        case "unsubscribe:server-terminal":
          ctx.terminal.detachServer(socket, msg.serverId);
          break;
        case "server-terminal:input":
          ctx.terminal.inputServer(socket, msg.serverId, msg.data);
          break;
        case "server-terminal:resize":
          ctx.terminal.resizeServer(socket, msg.serverId, msg.cols, msg.rows);
          break;
      }
    });

    socket.on("close", () => {
      ctx.hub.removeSocket(socket);
      ctx.terminal.removeSocket(socket);
    });
  });
}
