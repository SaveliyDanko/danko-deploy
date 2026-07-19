import cron, { type ScheduledTask } from "node-cron";

import type { DeploymentService } from "./DeploymentService.js";
import type { ProjectService } from "./ProjectService.js";
import type { BackupService } from "./BackupService.js";

/**
 * Регистрирует cron-задачи авто-бэкапов по полю config.backupCron проекта.
 * Бэкап гоняется по КАЖДОМУ деплою проекта (проект×сервер) — у проекта без
 * деплоев расписание не активируется. Пересобирается через reload().
 */
export class BackupScheduler {
  private readonly tasks = new Map<string, ScheduledTask>();

  constructor(
    private readonly projects: ProjectService,
    private readonly deployments: DeploymentService,
    private readonly backups: BackupService,
  ) {}

  /** Пересобирает расписание из текущего состояния проектов и их деплоев. */
  reload(): void {
    for (const task of this.tasks.values()) void task.stop();
    this.tasks.clear();

    for (const project of this.projects.list()) {
      const expr = project.config.backupCron;
      if (!expr || !cron.validate(expr)) continue;

      const deps = this.deployments.listByProject(project.id);
      for (const dep of deps) {
        const task = cron.schedule(expr, () => {
          void this.backups.run(dep.id, true).catch((err) => {
            console.error(`[backup-cron] проект ${project.name} (деплой ${dep.id}):`, err);
          });
        });
        this.tasks.set(dep.id, task);
      }
    }
    console.log(`[backup-cron] активных расписаний: ${this.tasks.size}`);
  }

  stopAll(): void {
    for (const task of this.tasks.values()) void task.stop();
    this.tasks.clear();
  }
}
