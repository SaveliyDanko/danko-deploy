import type { DeployStatus } from "@dankodeploy/shared";
import { nanoid } from "nanoid";

import type { WsHub } from "../ws/WsHub.js";

/** Публикатор строк лога в WS-канал текущей фоновой операции. */
export type LogPublisher = (line: string, stream: "stdout" | "stderr" | "info") => void;

/**
 * Тело фоновой задачи: получает publisher для стрима лога и возвращает финальный
 * статус. Может бросить — раннер поймает, залогирует и пометит операцию failed.
 */
export type BackgroundTask = (publish: LogPublisher) => Promise<DeployStatus>;

/**
 * Запускает фоновую SSH-операцию по единому паттерну «runId + WS-лог + статус»,
 * который раньше дублировался в ServerSetupService/VpnService/VpnClientService:
 *
 * - генерит `runId` и сразу возвращает его (операция идёт в фоне);
 * - даёт задаче `publish(line, stream)` → WS-канал `deploy:<runId>` (`deploy:log`);
 * - по завершении публикует `deploy:done` со статусом задачи;
 * - приброшенном исключении — пишет info-строку с ошибкой и `deploy:done failed`.
 *
 * Доменные сайд-эффекты (обновление статуса в БД, disconnect, onResult installer'а)
 * остаются ВНУТРИ задачи — раннер владеет только WS-плумбингом и обработкой ошибок.
 */
export class BackgroundRunner {
  constructor(private readonly hub: WsHub) {}

  /** Запускает задачу в фоне. Возвращает `{ runId }` сразу, не дожидаясь завершения. */
  run(task: BackgroundTask): { runId: string } {
    const runId = nanoid();
    const publish: LogPublisher = (line, stream) =>
      this.hub.publish(`deploy:${runId}`, { type: "deploy:log", runId, line, stream });

    void (async () => {
      try {
        const status = await task(publish);
        this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status });
      } catch (err) {
        const line = `Внутренняя ошибка: ${err instanceof Error ? err.message : String(err)}`;
        publish(line, "info");
        this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status: "failed" });
      }
    })();

    return { runId };
  }
}
