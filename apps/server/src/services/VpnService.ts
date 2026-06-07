import {
  encryptSecret,
  MetricsCollector,
  OutlineInstaller,
  VpnReadinessChecker,
  type SshExecutor,
} from "@dankodeploy/core";
import { type Db, vpnInstallations, type VpnInstallationRow } from "@dankodeploy/db";
import {
  type CreateVpnInstallationInput,
  type VpnInstallationPublic,
  type VpnReadiness,
} from "@dankodeploy/shared";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { BackgroundRunner } from "./BackgroundRunner.js";
import type { ServerService } from "./ServerService.js";
import type { WsHub } from "../ws/WsHub.js";

/** Преобразует строку БД в публичный вид (без management-токена и cert). */
export function toVpnInstallationPublic(row: VpnInstallationRow): VpnInstallationPublic {
  return {
    id: row.id,
    serverId: row.serverId,
    kind: row.kind,
    status: row.status,
    host: row.host,
    apiPort: row.apiPort,
    managed: !!row.apiUrlEnc,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Управление VPN-инсталляциями на серверах (Outline/Shadowsocks).
 * Раскатка/удаление идут в фоне со стримом лога в WS-канал deploy:<runId>
 * (переиспользуем существующий канал, как install-docker/harden-ssh).
 * Management-токен Outline шифруется мастер-ключом; наружу не отдаётся.
 */
export class VpnService {
  private readonly outline: OutlineInstaller;
  private readonly readiness: VpnReadinessChecker;
  private readonly metrics: MetricsCollector;
  private readonly runner: BackgroundRunner;

  constructor(
    private readonly db: Db,
    ssh: SshExecutor,
    private readonly masterKey: Buffer,
    private readonly servers: ServerService,
    hub: WsHub,
  ) {
    this.outline = new OutlineInstaller(ssh);
    this.readiness = new VpnReadinessChecker(ssh);
    this.metrics = new MetricsCollector(ssh);
    this.runner = new BackgroundRunner(hub);
  }

  list(): VpnInstallationPublic[] {
    return this.db.select().from(vpnInstallations).all().map(toVpnInstallationPublic);
  }

  get(id: string): VpnInstallationRow | undefined {
    return this.db.select().from(vpnInstallations).where(eq(vpnInstallations.id, id)).get();
  }

  getPublic(id: string): VpnInstallationPublic | undefined {
    const row = this.get(id);
    return row ? toVpnInstallationPublic(row) : undefined;
  }

  private setStatus(
    id: string,
    status: VpnInstallationRow["status"],
    lastError?: string | null,
  ): void {
    this.db
      .update(vpnInstallations)
      .set({ status, lastError: lastError ?? null, updatedAt: new Date().toISOString() })
      .where(eq(vpnInstallations.id, id))
      .run();
  }

  /**
   * Проверка готовности сервера к раскатке VPN: булевы чеки (root/curl/arch/virt)
   * + текущие метрики (CPU/RAM/диск). Синхронно, без WS.
   */
  async checkReadiness(serverId: string): Promise<VpnReadiness | { error: string }> {
    const serverRow = this.servers.get(serverId);
    if (!serverRow) return { error: "Сервер не найден" };

    const target = this.servers.toTarget(serverRow);
    const checks = await this.readiness.check(target);
    // Метрики best-effort — если сервер их не отдал, читаемость чеков важнее.
    let metrics = null;
    try {
      metrics = await this.metrics.collect(target);
    } catch {
      metrics = null;
    }

    // ok=true, если прошли все обязательные проверки (docker — информационная, всегда ok).
    const ok = checks.every((c) => c.ok);
    return { ok, checks, metrics };
  }

  /**
   * Раскатывает VPN на сервер (фон). Создаёт строку (status installing),
   * гоняет OutlineInstaller, стримит лог в deploy:<runId>, в onResult шифрует
   * management-токен, по завершении ставит active/error.
   */
  install(serverId: string, input: CreateVpnInstallationInput): { runId: string } | { error: string } {
    const serverRow = this.servers.get(serverId);
    if (!serverRow) return { error: "Сервер не найден" };

    // Одна инсталляция данного типа на сервер (уникальный индекс в БД).
    const existing = this.db
      .select()
      .from(vpnInstallations)
      .where(eq(vpnInstallations.serverId, serverId))
      .all()
      .find((r) => r.kind === input.kind && r.status !== "removed");
    if (existing) return { error: "На этом сервере уже развёрнут VPN этого типа" };

    const id = nanoid();
    this.db
      .insert(vpnInstallations)
      .values({
        id,
        serverId,
        kind: input.kind,
        status: "installing",
        host: serverRow.host,
        apiPort: input.apiPort ?? null,
      })
      .run();

    const target = this.servers.toTarget(serverRow);

    return this.runner.run(async (publish) => {
      try {
        return await this.outline.run(target, {
          onLog: publish,
          onResult: (result) => {
            // apiUrl содержит management-токен — шифруем перед записью в БД.
            this.db
              .update(vpnInstallations)
              .set({
                apiUrlEnc: encryptSecret(result.apiUrl, this.masterKey),
                certSha256: result.certSha256,
                apiPort: result.apiPort ?? input.apiPort ?? null,
                updatedAt: new Date().toISOString(),
              })
              .where(eq(vpnInstallations.id, id))
              .run();
          },
          onDone: (status) => {
            this.setStatus(id, status === "success" ? "active" : "error", status === "success" ? null : "Раскатка завершилась с ошибкой");
          },
        });
      } catch (err) {
        this.setStatus(id, "error", err instanceof Error ? err.message : String(err));
        throw err;
      }
    });
  }

  /** Удаляет VPN с сервера (фон). По завершении удаляет строку из БД. */
  remove(id: string): { runId: string } | { error: string } {
    const row = this.get(id);
    if (!row) return { error: "VPN-инсталляция не найдена" };

    const serverRow = this.servers.get(row.serverId);
    if (!serverRow) return { error: "Сервер инсталляции не найден" };

    const target = this.servers.toTarget(serverRow);

    return this.runner.run(async (publish) => {
      try {
        return await this.outline.remove(target, {
          onLog: publish,
          onDone: (status) => {
            if (status === "success") {
              this.db.delete(vpnInstallations).where(eq(vpnInstallations.id, id)).run();
            } else {
              this.setStatus(id, "error", "Удаление завершилось с ошибкой");
            }
          },
        });
      } catch (err) {
        this.setStatus(id, "error", err instanceof Error ? err.message : String(err));
        throw err;
      }
    });
  }
}
