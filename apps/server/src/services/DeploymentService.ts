import { collectProjectRuntime, type SshExecutor } from "@dankodeploy/core";
import {
  type Db,
  deployments,
  type DeploymentRow,
  type ProjectRow,
  type ServerRow,
} from "@dankodeploy/db";
import {
  type CreateDeploymentInput,
  type DeploymentDetail,
  type DeploymentPublic,
} from "@dankodeploy/shared";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { toProjectPublic, type ProjectService } from "./ProjectService.js";
import type { ServerService } from "./ServerService.js";

export function toDeploymentPublic(row: DeploymentRow): DeploymentPublic {
  return {
    id: row.id,
    projectId: row.projectId,
    serverId: row.serverId,
    lastDeployStatus: row.lastDeployStatus,
    lastDeployAt: row.lastDeployAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Резолв деплоя: проект (карточка/конфиг) + сервер (куда ходить по SSH). */
export interface DeploymentTarget {
  deployment: DeploymentRow;
  project: ProjectRow;
  serverRow: ServerRow;
}

/**
 * CRUD деплоев (проект × сервер) + резолв проекта/сервера для Deploy/Backup/Env
 * и сборка детальной сводки (рантайм-статус по SSH).
 */
export class DeploymentService {
  constructor(
    private readonly db: Db,
    private readonly ssh: SshExecutor,
    private readonly projects: ProjectService,
    private readonly servers: ServerService,
  ) {}

  list(): DeploymentPublic[] {
    return this.db.select().from(deployments).all().map(toDeploymentPublic);
  }

  listByProject(projectId: string): DeploymentPublic[] {
    return this.db
      .select()
      .from(deployments)
      .where(eq(deployments.projectId, projectId))
      .all()
      .map(toDeploymentPublic);
  }

  getRow(id: string): DeploymentRow | undefined {
    return this.db.select().from(deployments).where(eq(deployments.id, id)).get();
  }

  get(id: string): DeploymentPublic | undefined {
    const row = this.getRow(id);
    return row ? toDeploymentPublic(row) : undefined;
  }

  create(input: CreateDeploymentInput): DeploymentPublic | { error: string } {
    if (!this.projects.getRow(input.projectId)) return { error: "Проект не найден" };
    if (!this.servers.get(input.serverId)) return { error: "Сервер не найден" };

    // Один деплой на пару проект↔сервер.
    const existing = this.db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.projectId, input.projectId),
          eq(deployments.serverId, input.serverId),
        ),
      )
      .get();
    if (existing) return { error: "Этот проект уже развёрнут на выбранном сервере" };

    const id = nanoid();
    this.db
      .insert(deployments)
      .values({ id, projectId: input.projectId, serverId: input.serverId })
      .run();
    return toDeploymentPublic(this.getRow(id)!);
  }

  delete(id: string): boolean {
    const res = this.db.delete(deployments).where(eq(deployments.id, id)).run();
    return res.changes > 0;
  }

  /** Резолвит деплой в {deployment, project, server} либо отдаёт текст ошибки. */
  resolve(id: string): DeploymentTarget | { error: string } {
    const deployment = this.getRow(id);
    if (!deployment) return { error: "Деплой не найден" };
    const project = this.projects.getRow(deployment.projectId);
    if (!project) return { error: "Проект деплоя не найден" };
    const serverRow = this.servers.get(deployment.serverId);
    if (!serverRow) return { error: "Сервер деплоя не найден" };
    return { deployment, project, serverRow };
  }

  /** Детальная сводка: деплой + карточка проекта + имя сервера + рантайм-статус по SSH. */
  async detail(id: string): Promise<DeploymentDetail | undefined> {
    const resolved = this.resolve(id);
    if ("error" in resolved) return undefined;
    const { deployment, project, serverRow } = resolved;
    const projectPublic = toProjectPublic(project);

    let status: DeploymentDetail["status"] = "unknown";
    let gitRevision: string | null = null;
    let version: string | null = null;

    try {
      const runtime = await collectProjectRuntime(
        this.ssh,
        this.servers.toTarget(serverRow),
        projectPublic.kind,
        projectPublic.config,
      );
      status = runtime.status;
      gitRevision = runtime.gitRevision;
      version = runtime.version;
    } catch {
      // Сервер недоступен — оставляем unknown, не роняем сводку.
      status = "unknown";
    }

    return {
      deployment: toDeploymentPublic(deployment),
      project: projectPublic,
      serverName: serverRow.name,
      status,
      gitRevision,
      version,
    };
  }

  /** Обновляет статус/время последней раскатки деплоя (вызывается из Deploy/Provision). */
  setLastDeploy(id: string, status: "success" | "failed" | "running", at: string): void {
    this.db
      .update(deployments)
      .set({ lastDeployStatus: status, lastDeployAt: at, updatedAt: at })
      .where(eq(deployments.id, id))
      .run();
  }
}
