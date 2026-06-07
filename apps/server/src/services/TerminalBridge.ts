import { classifySshError, type SshExecutor } from "@dankodeploy/core";
import type { WebSocket } from "@fastify/websocket";
import type { ClientChannel } from "ssh2";

import type { AiAgentService } from "./AiAgentService.js";
import type { ServerService } from "./ServerService.js";

interface BridgeSession {
  channel: ClientChannel;
  key: string;
}

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * PTY-мост: проксирует интерактивный SSH shell ↔ WebSocket для веб-терминала.
 *
 * Один shell-канал на сокет (на вкладку). Для AI канал делает `tmux attach` к общей
 * tmux-сессии агента, поэтому несколько устройств видят один живой экран. Для сервера
 * открывается прямой shell, который закрывается вместе с вкладкой.
 *
 * БЕЗОПАСНОСТЬ: это прямой shell-доступ к серверу. Подписка приходит только из
 * аутентифицированного WS (проверка сессии — в registerWsRoute на handshake).
 */
export class TerminalBridge {
  /** socket → (terminalKey → сессия). На сокете может быть несколько терминалов. */
  private readonly sessions = new Map<WebSocket, Map<string, BridgeSession>>();

  constructor(
    private readonly ssh: SshExecutor,
    private readonly servers: ServerService,
    private readonly agents: AiAgentService,
  ) {}

  /** Открывает терминал к агенту и привязывает его к сокету. */
  async attach(socket: WebSocket, agentId: string): Promise<void> {
    const key = this.agentKey(agentId);
    // Уже открыт на этом сокете — не дублируем.
    if (this.sessions.get(socket)?.has(key)) return;

    const agent = this.agents.get(agentId);
    if (!agent) return this.sendAgentExit(socket, agentId, "Агент не найден");
    const serverRow = this.servers.get(agent.serverId);
    if (!serverRow) return this.sendAgentExit(socket, agentId, "Сервер агента не найден");

    const started = await this.agents.start(agentId);
    if ("error" in started) return this.sendAgentExit(socket, agentId, started.error);

    const status = await this.agents.sessionStatus(agentId);
    if (status !== "running") {
      return this.sendAgentExit(
        socket,
        agentId,
        "tmux-сессия агента не запущена. Нажмите «Развернуть» для переустановки CLI и создания сессии.",
      );
    }

    let channel: ClientChannel;
    try {
      channel = await this.ssh.openShell(this.servers.toTarget(serverRow), {
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      });
    } catch (err) {
      return this.sendAgentExit(socket, agentId, classifySshError(err).message);
    }

    // Приаттачиваемся только к сессии агента. Пустую tmux-сессию здесь не создаём:
    // если агент остановлен, выше запускаем его через AiAgentService.start().
    channel.write(`exec tmux attach-session -t ${shellQuote(agent.tmuxSession)}\n`);

    channel.on("data", (buf: Buffer) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({ type: "terminal:data", agentId, data: buf.toString("base64") }),
        );
      }
    });
    channel.on("close", () => {
      this.sessions.get(socket)?.delete(key);
      this.sendAgentExit(socket, agentId, "Сессия закрыта");
    });

    this.storeSession(socket, key, channel);
  }

  /** Открывает прямой SSH shell к серверу и привязывает его к сокету. */
  async attachServer(socket: WebSocket, serverId: string): Promise<void> {
    const key = this.serverKey(serverId);
    if (this.sessions.get(socket)?.has(key)) return;

    const serverRow = this.servers.get(serverId);
    if (!serverRow) return this.sendServerExit(socket, serverId, "Сервер не найден");

    let channel: ClientChannel;
    try {
      channel = await this.ssh.openShell(this.servers.toTarget(serverRow), {
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
      });
    } catch (err) {
      return this.sendServerExit(socket, serverId, classifySshError(err).message);
    }

    channel.on("data", (buf: Buffer) => {
      if (socket.readyState === socket.OPEN) {
        socket.send(
          JSON.stringify({ type: "server-terminal:data", serverId, data: buf.toString("base64") }),
        );
      }
    });
    channel.on("close", () => {
      this.sessions.get(socket)?.delete(key);
      this.sendServerExit(socket, serverId, "Сессия закрыта");
    });

    this.storeSession(socket, key, channel);
  }

  /** Передаёт ввод (base64) в pty. */
  input(socket: WebSocket, agentId: string, dataB64: string): void {
    const session = this.sessions.get(socket)?.get(this.agentKey(agentId));
    session?.channel.write(Buffer.from(dataB64, "base64"));
  }

  /** Передаёт ввод в серверный pty. */
  inputServer(socket: WebSocket, serverId: string, dataB64: string): void {
    const session = this.sessions.get(socket)?.get(this.serverKey(serverId));
    session?.channel.write(Buffer.from(dataB64, "base64"));
  }

  /** Меняет размер pty. */
  resize(socket: WebSocket, agentId: string, cols: number, rows: number): void {
    const session = this.sessions.get(socket)?.get(this.agentKey(agentId));
    session?.channel.setWindow(rows, cols, 0, 0);
  }

  /** Меняет размер серверного pty. */
  resizeServer(socket: WebSocket, serverId: string, cols: number, rows: number): void {
    const session = this.sessions.get(socket)?.get(this.serverKey(serverId));
    session?.channel.setWindow(rows, cols, 0, 0);
  }

  /** Закрывает терминал агента на сокете. tmux-сессию НЕ трогаем. */
  detach(socket: WebSocket, agentId: string): void {
    const key = this.agentKey(agentId);
    const session = this.sessions.get(socket)?.get(key);
    if (session) {
      session.channel.end();
      this.sessions.get(socket)?.delete(key);
    }
  }

  /** Закрывает прямой серверный терминал на сокете. */
  detachServer(socket: WebSocket, serverId: string): void {
    const key = this.serverKey(serverId);
    const session = this.sessions.get(socket)?.get(key);
    if (session) {
      session.channel.end();
      this.sessions.get(socket)?.delete(key);
    }
  }

  /** Закрывает все терминалы сокета (на закрытие WS). */
  removeSocket(socket: WebSocket): void {
    const bySocket = this.sessions.get(socket);
    if (!bySocket) return;
    for (const session of bySocket.values()) session.channel.end();
    this.sessions.delete(socket);
  }

  /** Закрывает все каналы (graceful shutdown панели). tmux на серверах остаётся. */
  disposeAll(): void {
    for (const bySocket of this.sessions.values()) {
      for (const session of bySocket.values()) session.channel.end();
    }
    this.sessions.clear();
  }

  private storeSession(socket: WebSocket, key: string, channel: ClientChannel): void {
    let bySocket = this.sessions.get(socket);
    if (!bySocket) {
      bySocket = new Map();
      this.sessions.set(socket, bySocket);
    }
    bySocket.set(key, { channel, key });
  }

  private agentKey(agentId: string): string {
    return `agent:${agentId}`;
  }

  private serverKey(serverId: string): string {
    return `server:${serverId}`;
  }

  private sendAgentExit(socket: WebSocket, agentId: string, reason: string): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "terminal:exit", agentId, reason }));
    }
  }

  private sendServerExit(socket: WebSocket, serverId: string, reason: string): void {
    if (socket.readyState === socket.OPEN) {
      socket.send(JSON.stringify({ type: "server-terminal:exit", serverId, reason }));
    }
  }
}
