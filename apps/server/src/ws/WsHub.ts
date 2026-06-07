import type { WebSocket } from "@fastify/websocket";
import type { WsServerMessage } from "@dankodeploy/shared";

/**
 * Хаб WS-соединений с подпиской по каналам.
 * Каналы: `deploy:<runId>` и `metrics:<serverId>`.
 * Сервисы (деплой/метрики) публикуют сообщения в канал, хаб рассылает подписчикам.
 */
export class WsHub {
  /** channel -> set of sockets */
  private readonly channels = new Map<string, Set<WebSocket>>();

  subscribe(channel: string, socket: WebSocket): void {
    let set = this.channels.get(channel);
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(socket);
  }

  unsubscribe(channel: string, socket: WebSocket): void {
    this.channels.get(channel)?.delete(socket);
  }

  /** Удаляет сокет из всех каналов (на закрытие соединения). */
  removeSocket(socket: WebSocket): void {
    for (const set of this.channels.values()) set.delete(socket);
  }

  /** Есть ли активные подписчики канала (можно не собирать метрики зря). */
  hasSubscribers(channel: string): boolean {
    const set = this.channels.get(channel);
    return !!set && set.size > 0;
  }

  /** Рассылает сообщение всем подписчикам канала. */
  publish(channel: string, message: WsServerMessage): void {
    const set = this.channels.get(channel);
    if (!set || set.size === 0) return;
    const data = JSON.stringify(message);
    for (const socket of set) {
      if (socket.readyState === socket.OPEN) socket.send(data);
    }
  }

  /** Список serverId, у которых есть активные подписчики метрик. */
  activeMetricServerIds(): string[] {
    const ids: string[] = [];
    for (const [channel, set] of this.channels) {
      if (channel.startsWith("metrics:") && set.size > 0) {
        ids.push(channel.slice("metrics:".length));
      }
    }
    return ids;
  }
}
