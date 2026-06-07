import { DeployRunner, UndeployRunner, type SshExecutor } from "@dankodeploy/core";
import { type Db, deployRuns, type DeployRunRow } from "@dankodeploy/db";
import { toProjectPublic } from "./ProjectService.js";
import type { DeployRun } from "@dankodeploy/shared";
import { and, desc, eq, ne, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

/**
 * Сколько минут запись может «висеть» в running, прежде чем считаться зависшей
 * (запуск оборвался: процесс упал/сервер перезапустился, onDone не выполнился).
 * Реальная раскатка/бэкап укладываются в этот лимит с запасом.
 */
const STALE_RUNNING_MINUTES = 10;

import type { DeploymentService } from "./DeploymentService.js";
import type { ServerService } from "./ServerService.js";
import type { GitKeyService } from "./GitKeyService.js";
import type { WsHub } from "../ws/WsHub.js";

function toDeployRun(row: DeployRunRow): DeployRun {
  return {
    id: row.id,
    deploymentId: row.deploymentId,
    kind: row.kind,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    log: row.log,
  };
}

/**
 * Запускает деплой проекта: создаёт запись deploy_runs, гоняет DeployRunner,
 * стримит логи в WS-канал deploy:<runId> и накапливает полный лог в БД.
 */
export class DeployService {
  private readonly runner: DeployRunner;
  private readonly undeployRunner: UndeployRunner;

  constructor(
    private readonly db: Db,
    ssh: SshExecutor,
    private readonly deployments: DeploymentService,
    private readonly servers: ServerService,
    private readonly gitKeys: GitKeyService,
    private readonly hub: WsHub,
  ) {
    this.runner = new DeployRunner(ssh);
    this.undeployRunner = new UndeployRunner(ssh);
  }

  history(deploymentId: string): DeployRun[] {
    return this.db
      .select()
      .from(deployRuns)
      .where(eq(deployRuns.deploymentId, deploymentId))
      .orderBy(desc(deployRuns.startedAt))
      .all()
      .map(toDeployRun);
  }

  /**
   * Удаляет историю действий деплоя: все завершённые записи + «зависшие» running
   * (старше STALE_RUNNING_MINUTES — запуск точно оборвался). Реально идущий
   * свежий запуск (running моложе порога) не трогаем.
   *
   * datetime() в SQLite парсит оба формата startedAt: "YYYY-MM-DD HH:MM:SS"
   * (current_timestamp) и ISO-8601.
   */
  clearHistory(deploymentId: string): { deleted: number } {
    const staleCutoff = sql`datetime('now', '-${sql.raw(String(STALE_RUNNING_MINUTES))} minutes')`;
    const res = this.db
      .delete(deployRuns)
      .where(
        and(
          eq(deployRuns.deploymentId, deploymentId),
          or(
            ne(deployRuns.status, "running"),
            sql`datetime(${deployRuns.startedAt}) < ${staleCutoff}`,
          ),
        ),
      )
      .run();
    return { deleted: res.changes };
  }

  /**
   * При старте сервера переводит все «зависшие» running в failed: новый процесс
   * означает, что прежние запуски точно мертвы (их onDone уже не выполнится).
   * Вызывается один раз при сборке контекста.
   */
  reconcileOrphans(): { updated: number } {
    const res = this.db
      .update(deployRuns)
      .set({ status: "failed", finishedAt: new Date().toISOString() })
      .where(eq(deployRuns.status, "running"))
      .run();
    if (res.changes > 0) {
      console.log(`[deploy] помечено failed зависших запусков: ${res.changes}`);
    }
    return { updated: res.changes };
  }

  /**
   * Стартует деплой на конкретном деплое (проект×сервер). Возвращает runId сразу;
   * работа идёт асинхронно, клиент подписывается на WS-канал deploy:<runId> для логов.
   */
  start(deploymentId: string): { runId: string } | { error: string } {
    const resolved = this.deployments.resolve(deploymentId);
    if ("error" in resolved) return { error: resolved.error };
    const serverRow = resolved.serverRow;
    const project = toProjectPublic(resolved.project);

    let privateKey: string | undefined;
    if (project.config.source?.type === "git-private") {
      if (!project.config.source.gitKeyId) {
        return { error: "Для приватного репозитория выберите git-ключ" };
      }
      const keyRow = this.gitKeys.getRow(project.config.source.gitKeyId);
      if (!keyRow) return { error: "Указанный git-ключ не найден" };
      privateKey = this.gitKeys.decrypt(keyRow).privateKey;
    }

    const runId = nanoid();
    this.db
      .insert(deployRuns)
      .values({ id: runId, deploymentId, kind: "deploy", status: "running", log: "" })
      .run();

    const target = this.servers.toTarget(serverRow);
    let buffer = "";
    const append = (line: string) => {
      buffer += line + "\n";
    };

    // Запуск в фоне — не блокируем HTTP-ответ.
    void this.runner
      .run(
        target,
        { kind: project.kind, config: project.config, privateKey },
        {
          onLog: (line, stream) => {
            append(line);
            this.hub.publish(`deploy:${runId}`, {
              type: "deploy:log",
              runId,
              line,
              stream,
            });
          },
          onDone: (status) => {
            const finishedAt = new Date().toISOString();
            this.db
              .update(deployRuns)
              .set({ status, log: buffer, finishedAt })
              .where(eq(deployRuns.id, runId))
              .run();
            this.deployments.setLastDeploy(deploymentId, status, finishedAt);
            this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status });
          },
        },
      )
      .catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        const finishedAt = new Date().toISOString();
        append(`Внутренняя ошибка: ${msg}`);
        this.db
          .update(deployRuns)
          .set({ status: "failed", log: buffer, finishedAt })
          .where(eq(deployRuns.id, runId))
          .run();
        this.deployments.setLastDeploy(deploymentId, "failed", finishedAt);
        this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status: "failed" });
      });

    return { runId };
  }

  /**
   * Останавливает/снимает деплой с запуска. Пишет запись в историю действий
   * (kind=undeploy) с логом — чтобы было видно, что и когда снимали.
   */
  undeploy(deploymentId: string): { runId: string } | { error: string } {
    const resolved = this.deployments.resolve(deploymentId);
    if ("error" in resolved) return { error: resolved.error };
    const serverRow = resolved.serverRow;
    const project = toProjectPublic(resolved.project);

    const runId = nanoid();
    this.db
      .insert(deployRuns)
      .values({ id: runId, deploymentId, kind: "undeploy", status: "running", log: "" })
      .run();

    const target = this.servers.toTarget(serverRow);
    let buffer = "";
    const append = (line: string) => {
      buffer += line + "\n";
    };

    void this.undeployRunner
      .run(target, { kind: project.kind, config: project.config }, {
        onLog: (line, stream) => {
          append(line);
          this.hub.publish(`deploy:${runId}`, { type: "deploy:log", runId, line, stream });
        },
        onDone: (status) => {
          const finishedAt = new Date().toISOString();
          this.db
            .update(deployRuns)
            .set({ status, log: buffer, finishedAt })
            .where(eq(deployRuns.id, runId))
            .run();
          this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status });
        },
      })
      .catch((err) => {
        const line = `Внутренняя ошибка: ${err instanceof Error ? err.message : String(err)}`;
        append(line);
        const finishedAt = new Date().toISOString();
        this.db
          .update(deployRuns)
          .set({ status: "failed", log: buffer, finishedAt })
          .where(eq(deployRuns.id, runId))
          .run();
        this.hub.publish(`deploy:${runId}`, { type: "deploy:log", runId, line, stream: "info" });
        this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status: "failed" });
      });

    return { runId };
  }
}
