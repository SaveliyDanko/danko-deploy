import { existsSync, mkdirSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { BackupRunner, RestoreRunner, type SshExecutor } from "@dankodeploy/core";
import { backups, type BackupRow, type Db, deployRuns } from "@dankodeploy/db";
import {
  type BackupArtifactResult,
  type BackupRecord,
  resolveBackupArtifacts,
  type RestoreArtifactResult,
  type RestoreResult,
} from "@dankodeploy/shared";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { toProjectPublic, type ProjectService } from "./ProjectService.js";
import type { DeploymentService } from "./DeploymentService.js";
import type { ServerService } from "./ServerService.js";
import type { WsHub } from "../ws/WsHub.js";

/**
 * Артефакты записи: парсит JSON-колонку, а для СТАРЫХ записей (без artifacts, но с path)
 * синтезирует один артефакт "default" — обратная совместимость.
 */
function rowArtifacts(row: BackupRow): BackupArtifactResult[] {
  if (row.artifacts) {
    try {
      return JSON.parse(row.artifacts) as BackupArtifactResult[];
    } catch {
      /* битый JSON — упадём на legacy ниже */
    }
  }
  if (row.path) {
    return [{ name: "default", path: row.path, sizeBytes: row.sizeBytes }];
  }
  return [];
}

function toBackupRecord(row: BackupRow): BackupRecord {
  return {
    id: row.id,
    projectId: row.projectId,
    deploymentId: row.deploymentId,
    status: row.status,
    path: row.path,
    sizeBytes: row.sizeBytes,
    artifacts: rowArtifacts(row),
    scheduled: row.scheduled,
    uploaded: row.uploaded,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    error: row.error,
  };
}

type OperationLog = (line: string, stream?: "stdout" | "stderr" | "info") => void;

function noopLog() {
  /* no-op для cron и старых синхронных вызовов */
}

function isServiceError(result: unknown): result is { error: string } {
  return (
    !!result &&
    typeof result === "object" &&
    "error" in result &&
    typeof (result).error === "string" &&
    !("status" in result)
  );
}

function formatBytes(size: number | null | undefined): string {
  if (!size) return "0 Б";
  const units = ["Б", "КБ", "МБ", "ГБ"];
  let value = size;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

/**
 * Делает бэкап проекта: по каждому артефакту выполняет команду по SSH, скачивает
 * файл в BACKUP_DIR и пишет запись в историю (один прогон = одна запись, N артефактов).
 * Используется и вручную, и планировщиком (флаг scheduled).
 */
export class BackupService {
  private readonly runner: BackupRunner;
  private readonly restoreRunner: RestoreRunner;

  constructor(
    private readonly db: Db,
    private readonly ssh: SshExecutor,
    private readonly projects: ProjectService,
    private readonly servers: ServerService,
    private readonly deployments: DeploymentService,
    private readonly backupDir: string,
    private readonly hub: WsHub,
  ) {
    this.runner = new BackupRunner(ssh);
    this.restoreRunner = new RestoreRunner(ssh);
    mkdirSync(resolve(process.cwd(), backupDir), { recursive: true });
  }

  history(projectId: string): BackupRecord[] {
    return this.db
      .select()
      .from(backups)
      .where(eq(backups.projectId, projectId))
      .orderBy(desc(backups.startedAt))
      .all()
      .map(toBackupRecord);
  }

  /**
   * Стартует backup в фоне и сразу возвращает runId для live-лога в DeployDrawer.
   * Помимо записи истории бэкапа (внутри run()) пишет запись в историю действий
   * деплоя (deploy_runs, kind=backup) — чтобы бэкап был виден в общей хронологии.
   */
  startRun(deploymentId: string): { runId: string } {
    const runId = nanoid();
    // Запись в историю действий (с накоплением лога). runId совпадает с WS-каналом.
    this.db
      .insert(deployRuns)
      .values({ id: runId, deploymentId, kind: "backup", status: "running", log: "" })
      .run();

    let buffer = "";
    const log: OperationLog = (line, stream = "info") => {
      buffer += line + "\n";
      this.hub.publish(`deploy:${runId}`, { type: "deploy:log", runId, line, stream });
    };
    const done = (status: "success" | "failed") => {
      this.db
        .update(deployRuns)
        .set({ status, log: buffer, finishedAt: new Date().toISOString() })
        .where(eq(deployRuns.id, runId))
        .run();
      this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status });
    };

    setTimeout(() => {
      void this.run(deploymentId, false, log)
        .then((result) => {
          if (isServiceError(result)) {
            log(`✖ ${result.error}`, "stderr");
            done("failed");
            return;
          }
          done(result.status === "success" ? "success" : "failed");
        })
        .catch((err) => {
          log(`✖ Внутренняя ошибка: ${err instanceof Error ? err.message : String(err)}`, "stderr");
          done("failed");
        });
    }, 0);

    return { runId };
  }

  /**
   * Стартует restore в фоне и транслирует его шаги в WS-канал логов. Помимо этого
   * пишет запись в историю действий деплоя (deploy_runs, kind=restore) с накоплением
   * лога — чтобы restore был виден в общей хронологии (как backup) и постфактум можно
   * было понять, на какой сервер он шёл и где что пошло не так.
   */
  startRestore(deploymentId: string, backupId: string, artifactNames?: string[]): { runId: string } {
    const runId = nanoid();
    this.db
      .insert(deployRuns)
      .values({ id: runId, deploymentId, kind: "restore", status: "running", log: "" })
      .run();

    let buffer = "";
    const log: OperationLog = (line, stream = "info") => {
      buffer += line + "\n";
      this.hub.publish(`deploy:${runId}`, { type: "deploy:log", runId, line, stream });
    };
    const done = (status: "success" | "failed") => {
      this.db
        .update(deployRuns)
        .set({ status, log: buffer, finishedAt: new Date().toISOString() })
        .where(eq(deployRuns.id, runId))
        .run();
      this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status });
    };

    setTimeout(() => {
      void this.restore(deploymentId, backupId, artifactNames, log)
        .then((result) => {
          done(result.ok ? "success" : "failed");
        })
        .catch((err) => {
          log(`✖ Внутренняя ошибка: ${err instanceof Error ? err.message : String(err)}`, "stderr");
          done("failed");
        });
    }, 0);

    return { runId };
  }

  /**
   * Резолвит локальный файл артефакта бэкапа для скачивания на ПК пользователя.
   * Проверяет принадлежность бэкапа проекту, наличие артефакта и файла на диске.
   * Возвращает абсолютный путь + предлагаемое имя файла.
   */
  resolveArtifact(
    projectId: string,
    backupId: string,
    artifactName: string,
  ): { path: string; filename: string } | { error: string } {
    const row = this.db.select().from(backups).where(eq(backups.id, backupId)).get();
    if (!row || row.projectId !== projectId) return { error: "Бэкап не найден" };
    if (row.status !== "success") return { error: "Бэкап неуспешный — нечего скачивать" };

    const artifact = rowArtifacts(row).find((a) => a.name === artifactName);
    if (!artifact) return { error: `Артефакт «${artifactName}» не найден в бэкапе` };
    if (!existsSync(artifact.path)) {
      return { error: "Файл артефакта не найден на машине панели (возможно, удалён)" };
    }

    // Имя для скачивания: <проект>-<артефакт>-<дата>.bak (безопасные символы).
    const project = this.projects.get(projectId);
    const safeProject = (project?.name ?? "backup").replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeArtifact = artifactName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const stamp = row.startedAt.slice(0, 10);
    return { path: artifact.path, filename: `${safeProject}-${safeArtifact}-${stamp}.bak` };
  }

  async delete(projectId: string, backupId: string): Promise<{ ok: true } | { error: string }> {
    const row = this.db.select().from(backups).where(eq(backups.id, backupId)).get();
    if (!row || row.projectId !== projectId) return { error: "Бэкап не найден" };
    if (row.status === "running") return { error: "Нельзя удалить бэкап, который ещё выполняется" };

    const paths = new Set(rowArtifacts(row).map((artifact) => artifact.path));
    if (row.path) paths.add(row.path);

    for (const path of paths) {
      if (!path) continue;
      await unlink(path).catch((err: unknown) => {
        const code = typeof err === "object" && err && "code" in err ? err.code : undefined;
        if (code !== "ENOENT") {
          console.warn(`[backup-delete] не удалось удалить файл ${path}:`, err);
        }
      });
    }

    this.db.delete(backups).where(eq(backups.id, backupId)).run();
    return { ok: true };
  }

  /** Помечает запись бэкапа как failed и возвращает её. */
  private fail(id: string, error: string, log: OperationLog = noopLog): BackupRecord {
    log(`✖ ${error}`, "stderr");
    this.db
      .update(backups)
      .set({ status: "failed", error, finishedAt: new Date().toISOString() })
      .where(eq(backups.id, id))
      .run();
    return toBackupRecord(this.db.select().from(backups).where(eq(backups.id, id)).get()!);
  }

  async run(
    deploymentId: string,
    scheduled = false,
    log: OperationLog = noopLog,
  ): Promise<BackupRecord | { error: string }> {
    log("Старт backup", "info");
    const resolved = this.deployments.resolve(deploymentId);
    if ("error" in resolved) {
      log(`✖ ${resolved.error}`, "stderr");
      return { error: resolved.error };
    }
    const serverRow = resolved.serverRow;
    const project = toProjectPublic(resolved.project);
    const projectId = project.id;
    log(`Проект: ${project.name}`, "info");
    log(`Сервер: ${serverRow.name} (${serverRow.host})`, "info");

    const artifactSpecs = resolveBackupArtifacts(project.config);
    if (artifactSpecs.length === 0) {
      log("✖ Бэкап не настроен (нет артефактов / backupCommand)", "stderr");
      return { error: "Бэкап не настроен (нет артефактов / backupCommand)" };
    }
    log(`Артефакты: ${artifactSpecs.map((spec) => spec.name).join(", ")}`, "info");

    const id = nanoid();
    this.db
      .insert(backups)
      .values({ id, projectId, deploymentId, status: "running", scheduled })
      .run();

    const target = this.servers.toTarget(serverRow);
    const results: BackupArtifactResult[] = [];

    for (const spec of artifactSpecs) {
      log(`▶ Артефакт «${spec.name}»: выполняю backupCommand`, "info");
      const res = await this.runner.run(target, {
        artifactName: spec.name,
        backupCommand: spec.backupCommand,
        workdir: project.config.workdir,
        projectName: project.name,
      }, {
        onStdout: (line) => log(line, "stdout"),
        onStderr: (line) => log(line, "stderr"),
      });
      if (!res.ok) {
        return this.fail(id, `Артефакт «${spec.name}»: ${res.error ?? "неизвестная ошибка"}`, log);
      }

      // Скачиваем файл артефакта на машину панели, затем чистим временный на сервере.
      const localPath = resolve(
        process.cwd(),
        this.backupDir,
        `${project.name}-${id}-${spec.name}.bak`,
      );
      try {
        log(
          `✓ Команда завершена, временный файл на сервере: ${res.remotePath} (${formatBytes(res.sizeBytes)})`,
          "info",
        );
        log(`Скачиваю «${spec.name}» на машину панели...`, "info");
        await this.ssh.download(target, res.remotePath!, localPath);
        log(`Сохранено: ${localPath}`, "info");
        log("Очищаю временный файл на сервере...", "info");
        await this.ssh.exec(target, `rm -f ${res.remotePath}`);
      } catch (err) {
        return this.fail(
          id,
          `Артефакт «${spec.name}» создан, но не скачан: ${err instanceof Error ? err.message : String(err)}`,
          log,
        );
      }
      results.push({ name: spec.name, path: localPath, sizeBytes: res.sizeBytes ?? null });
    }

    // Один-артефактный "default" дублируем в path/sizeBytes — для совместимости со старым чтением.
    const legacy =
      results.length === 1 && results[0]!.name === "default"
        ? { path: results[0]!.path, sizeBytes: results[0]!.sizeBytes }
        : { path: null, sizeBytes: null };

    this.db
      .update(backups)
      .set({
        status: "success",
        artifacts: JSON.stringify(results),
        path: legacy.path,
        sizeBytes: legacy.sizeBytes,
        finishedAt: new Date().toISOString(),
      })
      .where(eq(backups.id, id))
      .run();

    log("✔ Backup завершён", "info");
    return toBackupRecord(this.db.select().from(backups).where(eq(backups.id, id)).get()!);
  }

  /**
   * Сохраняет загруженный пользователем файл бэкапа в BACKUP_DIR как выбранный артефакт
   * и создаёт запись в истории (status=success, uploaded=true).
   */
  async saveUploaded(
    projectId: string,
    data: Buffer,
    artifactName = "default",
  ): Promise<BackupRecord | { error: string }> {
    const project = this.projects.get(projectId);
    if (!project) return { error: "Проект не найден" };

    const cleanArtifactName = artifactName.trim() || "default";
    const specs = resolveBackupArtifacts(project.config);
    if (specs.length > 0 && !specs.some((spec) => spec.name === cleanArtifactName)) {
      return {
        error: `Артефакт «${cleanArtifactName}» не настроен в проекте. Доступно: ${specs
          .map((spec) => spec.name)
          .join(", ")}`,
      };
    }

    const id = nanoid();
    const localPath = resolve(
      process.cwd(),
      this.backupDir,
      `${project.name}-${id}-${cleanArtifactName}-uploaded.bak`,
    );
    try {
      await writeFile(localPath, data);
    } catch (err) {
      return { error: `Не удалось сохранить файл: ${err instanceof Error ? err.message : String(err)}` };
    }

    const artifacts: BackupArtifactResult[] = [
      { name: cleanArtifactName, path: localPath, sizeBytes: data.length },
    ];
    const legacy =
      cleanArtifactName === "default"
        ? { path: localPath, sizeBytes: data.length }
        : { path: null, sizeBytes: null };
    const now = new Date().toISOString();
    this.db
      .insert(backups)
      .values({
        id,
        projectId,
        status: "success",
        path: legacy.path,
        sizeBytes: legacy.sizeBytes,
        artifacts: JSON.stringify(artifacts),
        scheduled: false,
        uploaded: true,
        startedAt: now,
        finishedAt: now,
      })
      .run();

    return toBackupRecord(this.db.select().from(backups).where(eq(backups.id, id)).get()!);
  }

  /**
   * Восстанавливает выбранные артефакты бэкапа: заливает их файлы обратно на сервер
   * и выполняет restoreCommand каждого. artifactNames пусто = все. restoreCommand
   * берётся из конфига проекта по имени артефакта (для legacy default — из config.restoreCommand).
   */
  async restore(
    deploymentId: string,
    backupId: string,
    artifactNames?: string[],
    log: OperationLog = noopLog,
  ): Promise<RestoreResult> {
    log("Старт restore", "info");
    const resolved = this.deployments.resolve(deploymentId);
    if ("error" in resolved) {
      log(`✖ ${resolved.error}`, "stderr");
      return { ok: false, artifacts: [], error: resolved.error };
    }
    const serverRow = resolved.serverRow;
    const project = toProjectPublic(resolved.project);
    log(`Проект: ${project.name}`, "info");
    log(`Сервер: ${serverRow.name} (${serverRow.host})`, "info");

    const backup = this.db.select().from(backups).where(eq(backups.id, backupId)).get();
    if (!backup || backup.projectId !== project.id) {
      log("✖ Бэкап не найден", "stderr");
      return { ok: false, artifacts: [], error: "Бэкап не найден" };
    }
    if (backup.status !== "success") {
      log("✖ Бэкап неуспешный — нечего восстанавливать", "stderr");
      return { ok: false, artifacts: [], error: "Бэкап неуспешный — нечего восстанавливать" };
    }

    // Артефакты записи (с синтезом legacy default), отфильтрованные по запросу.
    let stored = rowArtifacts(backup);
    if (artifactNames?.length) {
      stored = stored.filter((a) => artifactNames.includes(a.name));
    }
    if (stored.length === 0) {
      log("✖ Нет артефактов для восстановления", "stderr");
      return { ok: false, artifacts: [], error: "Нет артефактов для восстановления" };
    }
    log(`Артефакты restore: ${stored.map((artifact) => artifact.name).join(", ")}`, "info");

    // Спеки восстановления из конфига проекта (по имени → restoreCommand).
    const specs = resolveBackupArtifacts(project.config);
    const restoreCmdByName = new Map(specs.map((s) => [s.name, s.restoreCommand]));

    const target = this.servers.toTarget(serverRow);
    const out: RestoreArtifactResult[] = [];

    for (const art of stored) {
      log(`▶ Артефакт «${art.name}»: подготовка restore`, "info");
      const restoreCommand = restoreCmdByName.get(art.name);
      if (!restoreCommand) {
        log(`✖ Артефакт «${art.name}»: restoreCommand не задан`, "stderr");
        out.push({ name: art.name, ok: false, error: "restoreCommand для артефакта не задан" });
        continue;
      }
      if (!existsSync(art.path)) {
        log(`✖ Артефакт «${art.name}»: файл не найден на машине панели`, "stderr");
        out.push({ name: art.name, ok: false, error: "Файл артефакта не найден на машине панели" });
        continue;
      }
      log(`Загружаю файл на сервер и выполняю restoreCommand (${formatBytes(art.sizeBytes)})...`, "info");
      const res = await this.restoreRunner.run(target, {
        artifactName: art.name,
        restoreCommand,
        workdir: project.config.workdir,
        projectName: project.name,
        localBackupPath: art.path,
      }, {
        onStdout: (line) => log(line, "stdout"),
        onStderr: (line) => log(line, "stderr"),
      });
      if (res.ok) {
        log(`✓ Артефакт «${art.name}» восстановлен`, "info");
      } else {
        log(`✖ Артефакт «${art.name}»: ${res.error ?? "неизвестная ошибка"}`, "stderr");
      }
      out.push({ name: art.name, ok: res.ok, error: res.error });
    }

    const ok = out.every((r) => r.ok);
    log(ok ? "✔ Restore завершён" : "✖ Restore завершён с ошибками", ok ? "info" : "stderr");
    return {
      ok,
      artifacts: out,
      error: ok ? undefined : "Часть артефактов не восстановлена",
    };
  }
}
