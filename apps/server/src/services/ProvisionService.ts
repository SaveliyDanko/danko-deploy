import { ProvisionRunner, type SshExecutor } from "@dankodeploy/core";
import { type Db, deployRuns } from "@dankodeploy/db";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { toProjectPublic } from "./ProjectService.js";
import type { DeploymentService } from "./DeploymentService.js";
import type { GitKeyService } from "./GitKeyService.js";
import type { ServerService } from "./ServerService.js";
import type { WsHub } from "../ws/WsHub.js";

/**
 * Первичная раскатка (git clone в workdir) для конкретного деплоя (проект×сервер).
 * Создаёт запись deploy_runs (как обычный деплой), гоняет ProvisionRunner и стримит
 * логи в WS-канал deploy:<runId> — фронт показывает их в том же DeployDrawer.
 */
export class ProvisionService {
  private readonly runner: ProvisionRunner;

  constructor(
    private readonly db: Db,
    ssh: SshExecutor,
    private readonly deployments: DeploymentService,
    private readonly servers: ServerService,
    private readonly gitKeys: GitKeyService,
    private readonly hub: WsHub,
  ) {
    this.runner = new ProvisionRunner(ssh);
  }

  /**
   * Стартует раскатку деплоя. Возвращает runId сразу; работа идёт асинхронно,
   * клиент подписывается на WS-канал deploy:<runId> для логов.
   */
  provision(deploymentId: string): { runId: string } | { error: string } {
    const resolved = this.deployments.resolve(deploymentId);
    if ("error" in resolved) return { error: resolved.error };
    const serverRow = resolved.serverRow;
    const project = toProjectPublic(resolved.project);

    const source = project.config.source;
    if (!source) return { error: "У проекта не задан источник кода для раскатки" };

    // Для приватного репо нужен deploy-ключ.
    let privateKey: string | undefined;
    if (source.type === "git-private") {
      if (!source.gitKeyId) return { error: "Для приватного репозитория выберите git-ключ" };
      const keyRow = this.gitKeys.getRow(source.gitKeyId);
      if (!keyRow) return { error: "Указанный git-ключ не найден" };
      privateKey = this.gitKeys.decrypt(keyRow).privateKey;
    }

    const runId = nanoid();
    this.db
      .insert(deployRuns)
      .values({ id: runId, deploymentId, kind: "provision", status: "running", log: "" })
      .run();

    const target = this.servers.toTarget(serverRow);
    let buffer = "";
    const append = (line: string) => {
      buffer += line + "\n";
    };

    void this.runner
      .run(
        target,
        { source, workdir: project.config.workdir, privateKey },
        {
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
}
