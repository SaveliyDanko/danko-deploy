import { decryptSecret, encryptSecret, type SshExecutor } from "@dankodeploy/core";
import { type Db, projectEnv, type ProjectEnvRow } from "@dankodeploy/db";
import type { DeployEnvResult, ProjectEnv } from "@dankodeploy/shared";
import { eq } from "drizzle-orm";

import { toProjectPublic } from "./ProjectService.js";
import type { DeploymentService } from "./DeploymentService.js";
import type { ServerService } from "./ServerService.js";

/**
 * Хранит .env проектов зашифрованными (AES-256-GCM) в БД панели и по запросу
 * записывает их на сервер в <workdir>/.env. Расшифрованный контент отдаётся
 * только аутентифицированному пользователю панели (роуты за authGuard).
 */
export class EnvService {
  constructor(
    private readonly db: Db,
    private readonly ssh: SshExecutor,
    private readonly masterKey: Buffer,
    private readonly deployments: DeploymentService,
    private readonly servers: ServerService,
  ) {}

  private row(projectId: string): ProjectEnvRow | undefined {
    return this.db.select().from(projectEnv).where(eq(projectEnv.projectId, projectId)).get();
  }

  /** Расшифрованный .env проекта (или пустой, если ещё не задан). */
  get(projectId: string): ProjectEnv {
    const row = this.row(projectId);
    if (!row) return { content: "", updatedAt: null };
    return {
      content: decryptSecret(row.contentEnc, this.masterKey),
      updatedAt: row.updatedAt,
    };
  }

  /** Сохраняет (upsert) зашифрованный .env в БД. */
  save(projectId: string, content: string): ProjectEnv {
    const now = new Date().toISOString();
    const contentEnc = encryptSecret(content, this.masterKey);
    this.db
      .insert(projectEnv)
      .values({ projectId, contentEnc, updatedAt: now })
      .onConflictDoUpdate({
        target: projectEnv.projectId,
        set: { contentEnc, updatedAt: now },
      })
      .run();
    return { content, updatedAt: now };
  }

  /**
   * Записывает сохранённый .env на сервер в <workdir>/.env с правами 600.
   * Если содержимое ещё не сохранено в панели — пишет пустой файл? Нет: возвращает ошибку.
   */
  async deployToServer(deploymentId: string): Promise<DeployEnvResult> {
    const resolved = this.deployments.resolve(deploymentId);
    if ("error" in resolved) return { ok: false, error: resolved.error };
    const project = toProjectPublic(resolved.project);

    const row = this.row(project.id);
    if (!row) return { ok: false, error: "Для проекта не задан .env" };

    const content = decryptSecret(row.contentEnc, this.masterKey);
    const target = this.servers.toTarget(resolved.serverRow);
    const remotePath = `${project.config.workdir.replace(/\/+$/, "")}/.env`;

    try {
      await this.ssh.writeFile(target, remotePath, content);
      // Ограничиваем права — секреты не должны быть доступны другим пользователям.
      await this.ssh.exec(target, `chmod 600 ${remotePath}`);
      return { ok: true, path: remotePath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
