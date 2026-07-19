import { vpnClients } from "@dankodeploy/db";
import type { Db } from "@dankodeploy/db";
import cron, { type ScheduledTask } from "node-cron";
import { eq } from "drizzle-orm";

import type { VpnClientService } from "./VpnClientService.js";

/** Дефолтное расписание авто-обновления подписки, если у клиента не задан syncCron. */
const DEFAULT_SYNC_CRON = "0 */6 * * *"; // каждые 6 часов

/**
 * Регистрирует cron-задачи авто-обновления подписки VPN-клиентов (sing-box).
 * Для каждого активного клиента гоняет VpnClientService.sync по syncCron (или дефолту).
 * Пересобирается через reload() при изменении клиентов (как BackupScheduler).
 */
export class VpnClientScheduler {
  private readonly tasks = new Map<string, ScheduledTask>();

  constructor(
    private readonly db: Db,
    private readonly vpnClient: VpnClientService,
  ) {}

  /** Пересобирает расписание из текущих VPN-клиентов. */
  reload(): void {
    for (const task of this.tasks.values()) void task.stop();
    this.tasks.clear();

    const rows = this.db.select().from(vpnClients).where(eq(vpnClients.status, "active")).all();
    for (const row of rows) {
      const expr = row.syncCron && cron.validate(row.syncCron) ? row.syncCron : DEFAULT_SYNC_CRON;
      const task = cron.schedule(expr, () => {
        void this.vpnClient.sync(row.id).catch((err) => {
          console.error(`[vpn-client-cron] клиент ${row.id}:`, err);
        });
      });
      this.tasks.set(row.id, task);
    }
    console.log(`[vpn-client-cron] активных расписаний: ${this.tasks.size}`);
  }

  stopAll(): void {
    for (const task of this.tasks.values()) void task.stop();
    this.tasks.clear();
  }
}
