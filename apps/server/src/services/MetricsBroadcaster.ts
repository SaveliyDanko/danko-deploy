import { classifySshError, MetricsCollector, type SshExecutor } from "@dankodeploy/core";

import type { MetricsStore } from "./MetricsStore.js";
import type { ServerService } from "./ServerService.js";
import type { WsHub } from "../ws/WsHub.js";

/** Backoff: после ошибки сервер опрашивается реже. Сбрасывается при успехе. */
const MAX_BACKOFF_MS = 120_000; // не реже раза в 2 минуты даже при долгой недоступности

/**
 * Периодически собирает метрики для серверов, у которых есть активные WS-подписчики,
 * и публикует снимки в канал metrics:<serverId>. Если подписчиков нет — ничего не делает.
 * Каждый успешный снимок также сохраняется в MetricsStore для мгновенного показа на дашборде.
 *
 * Базовый тик — раз в intervalMs (5с). Но для недоступного/упавшего сервера применяется
 * экспоненциальный backoff (5с→10→20→…→2мин): панель не долбит мёртвый/атакованный sshd
 * каждые 5 секунд, добавляя шум. При первом успешном снимке интервал сервера сбрасывается.
 */
export class MetricsBroadcaster {
  private readonly collector: MetricsCollector;
  private timer: NodeJS.Timeout | undefined;
  /** Состояние backoff по серверу: текущий интервал и время следующей попытки. */
  private readonly backoff = new Map<string, { intervalMs: number; nextAt: number }>();

  constructor(
    ssh: SshExecutor,
    private readonly servers: ServerService,
    private readonly hub: WsHub,
    private readonly store: MetricsStore,
    private readonly intervalMs = 5000,
  ) {
    this.collector = new MetricsCollector(ssh);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.backoff.clear();
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    const serverIds = this.hub.activeMetricServerIds();
    // Убираем backoff-состояние для серверов, которые больше никто не смотрит.
    for (const id of this.backoff.keys()) {
      if (!serverIds.includes(id)) this.backoff.delete(id);
    }

    await Promise.all(
      serverIds.map(async (serverId) => {
        // Сервер в backoff и время ещё не пришло — пропускаем тик.
        const bo = this.backoff.get(serverId);
        if (bo && now < bo.nextAt) return;

        const row = this.servers.get(serverId);
        if (!row) return;
        try {
          const snapshot = await this.collector.collect(this.servers.toTarget(row));
          this.backoff.delete(serverId); // успех — снимаем backoff, возвращаемся к 5с
          this.store.save(snapshot); // персистим для мгновенного показа при следующей загрузке
          this.hub.publish(`metrics:${serverId}`, {
            type: "metrics:update",
            serverId,
            snapshot,
          });
        } catch (err) {
          this.applyBackoff(serverId, now);
          const info = classifySshError(err);
          this.hub.publish(`metrics:${serverId}`, {
            type: "error",
            message: `Метрики ${row.name}: ${info.message}`,
          });
        }
      }),
    );
  }

  /** Увеличивает интервал опроса сервера после ошибки (×2, но не дольше MAX_BACKOFF_MS). */
  private applyBackoff(serverId: string, now: number): void {
    const prev = this.backoff.get(serverId)?.intervalMs ?? this.intervalMs;
    const next = Math.min(prev * 2, MAX_BACKOFF_MS);
    this.backoff.set(serverId, { intervalMs: next, nextAt: now + next });
  }
}
