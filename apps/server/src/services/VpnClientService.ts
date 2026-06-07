import {
  buildSingBoxConfig,
  decryptSecret,
  encryptSecret,
  MetricsCollector,
  parseSubscriptionNodes,
  parseSubscriptionServers,
  SingBoxInstaller,
  VpnClientReadinessChecker,
  type SshExecutor,
  type VlessNode,
} from "@dankodeploy/core";
import { type Db, vpnClients, type VpnClientRow } from "@dankodeploy/db";
import {
  type CreateVpnClientInput,
  type VpnClientExitInfo,
  type VpnClientPublic,
  type VpnClientReadiness,
  type VpnClientServer,
  type VpnServiceCheck,
} from "@dankodeploy/shared";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import { BackgroundRunner } from "./BackgroundRunner.js";
import type { ServerService } from "./ServerService.js";
import type { WsHub } from "../ws/WsHub.js";

/** Преобразует строку БД в публичный вид (без зашифрованной ссылки подписки). */
export function toVpnClientPublic(row: VpnClientRow): VpnClientPublic {
  return {
    id: row.id,
    serverId: row.serverId,
    status: row.status,
    selectedLabel: row.selectedLabel,
    host: row.host,
    externalIp: row.externalIp,
    lastError: row.lastError,
    syncCron: row.syncCron,
    lastSyncedAt: row.lastSyncedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Управление VPN-клиентами (sing-box): VPS гонит весь трафик через VPN-провайдера
 * по subscription-ссылке. Ссылка хранится зашифрованной; парсинг/конфиг — server-side.
 * Раскатка/удаление в фоне со стримом лога в WS-канал deploy:<runId> (как Outline).
 */
export class VpnClientService {
  private readonly singbox: SingBoxInstaller;
  private readonly readiness: VpnClientReadinessChecker;
  private readonly metrics: MetricsCollector;
  private readonly runner: BackgroundRunner;

  constructor(
    private readonly db: Db,
    ssh: SshExecutor,
    private readonly masterKey: Buffer,
    private readonly servers: ServerService,
    hub: WsHub,
  ) {
    this.singbox = new SingBoxInstaller(ssh);
    this.readiness = new VpnClientReadinessChecker(ssh);
    this.metrics = new MetricsCollector(ssh);
    this.runner = new BackgroundRunner(hub);
  }

  list(): VpnClientPublic[] {
    return this.db.select().from(vpnClients).all().map(toVpnClientPublic);
  }

  get(id: string): VpnClientRow | undefined {
    return this.db.select().from(vpnClients).where(eq(vpnClients.id, id)).get();
  }

  getPublic(id: string): VpnClientPublic | undefined {
    const row = this.get(id);
    return row ? toVpnClientPublic(row) : undefined;
  }

  private setStatus(id: string, status: VpnClientRow["status"], lastError?: string | null): void {
    this.db
      .update(vpnClients)
      .set({ status, lastError: lastError ?? null, updatedAt: new Date().toISOString() })
      .where(eq(vpnClients.id, id))
      .run();
  }

  /**
   * Тянет подписку по ссылке (server-side) и возвращает сырое тело.
   * User-Agent КРИТИЧЕН: провайдеры отдают РАЗНЫЙ формат в зависимости от клиента
   * (напр. UltimaVPN на UA "Hiddify" отдаёт base64-список vless://, а на неизвестный
   * UA — Xray JSON). Притворяемся Hiddify, чтобы получить парсимый base64-список.
   */
  private async fetchSubscription(url: string): Promise<string> {
    const res = await fetch(url, {
      headers: { "User-Agent": "Hiddify/2.0.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`Подписка вернула HTTP ${res.status}`);
    return res.text();
  }

  /** Парсит подписку в список локаций (без секретов) — для выбора в UI. */
  async parseSubscription(url: string): Promise<VpnClientServer[] | { error: string }> {
    try {
      const body = await this.fetchSubscription(url);
      const servers = parseSubscriptionServers(body);
      if (servers.length === 0) return { error: "В подписке не найдено серверов VLESS" };
      return servers;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Готовность сервера к VPN-клиенту: чеки sing-box/TUN + текущие метрики. */
  async checkReadiness(serverId: string): Promise<VpnClientReadiness | { error: string }> {
    const serverRow = this.servers.get(serverId);
    if (!serverRow) return { error: "Сервер не найден" };

    const target = this.servers.toTarget(serverRow);
    const checks = await this.readiness.check(target);
    let metrics = null;
    try {
      metrics = await this.metrics.collect(target);
    } catch {
      metrics = null;
    }
    const ok = checks.every((c) => c.ok);
    return { ok, checks, metrics };
  }

  /** Находит узел подписки по выбранной метке (матч по label, индекс может съехать). */
  private pickNode(nodes: VlessNode[], label: string): VlessNode | undefined {
    return nodes.find((n) => n.label === label);
  }

  /**
   * Общий фоновый запуск sing-box по строке клиента: тянет сохранённую подписку,
   * выбирает узел по label, генерит конфиг и поднимает туннель со стримом лога в
   * deploy:<runId>. Переиспользуется включением, повторным включением и сменой локации.
   */
  private runWithConfig(id: string, label: string): { runId: string } {
    this.setStatus(id, "installing");

    return this.runner.run(async (publish) => {
      try {
        const row = this.get(id);
        if (!row) throw new Error("VPN-клиент не найден");
        const serverRow = this.servers.get(row.serverId);
        if (!serverRow) throw new Error("Сервер не найден");

        const sshPort = serverRow.port;
        const url = decryptSecret(row.subscriptionUrlEnc, this.masterKey);
        const body = await this.fetchSubscription(url);
        const nodes = parseSubscriptionNodes(body);
        const node = this.pickNode(nodes, label);
        if (!node) throw new Error(`Локация «${label}» не найдена в подписке`);

        const config = JSON.stringify(buildSingBoxConfig(node, { sshPort }), null, 2);
        // Фиксируем выбранную локацию (важно при смене).
        this.db
          .update(vpnClients)
          .set({ selectedLabel: label, updatedAt: new Date().toISOString() })
          .where(eq(vpnClients.id, id))
          .run();

        return await this.singbox.run(
          this.servers.toTarget(serverRow),
          { config, sshPort },
          {
            onLog: publish,
            onResult: (result) => {
              this.db
                .update(vpnClients)
                .set({ externalIp: result.externalIp, lastSyncedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
                .where(eq(vpnClients.id, id))
                .run();
            },
            onDone: (status) => {
              this.setStatus(id, status === "success" ? "active" : "error", status === "success" ? null : "Операция завершилась с ошибкой");
            },
          },
        );
      } catch (err) {
        this.setStatus(id, "error", err instanceof Error ? err.message : String(err));
        throw err;
      }
    });
  }

  /** Включает VPN-клиент на сервере (фон). Лог в WS-канал deploy:<runId>. */
  install(serverId: string, input: CreateVpnClientInput): { runId: string } | { error: string } {
    const serverRow = this.servers.get(serverId);
    if (!serverRow) return { error: "Сервер не найден" };

    const existing = this.db.select().from(vpnClients).where(eq(vpnClients.serverId, serverId)).get();
    if (existing && existing.status !== "removed") {
      return { error: "На этом сервере уже включён VPN-клиент" };
    }

    const id = existing?.id ?? nanoid();
    const enc = encryptSecret(input.subscriptionUrl, this.masterKey);
    const now = new Date().toISOString();
    // upsert строки с новой ссылкой/локацией (статус выставит runWithConfig).
    if (existing) {
      this.db
        .update(vpnClients)
        .set({ subscriptionUrlEnc: enc, selectedLabel: input.selectedLabel, host: serverRow.host, syncCron: input.syncCron ?? null, lastError: null, updatedAt: now })
        .where(eq(vpnClients.id, id))
        .run();
    } else {
      this.db
        .insert(vpnClients)
        .values({ id, serverId, subscriptionUrlEnc: enc, selectedLabel: input.selectedLabel, status: "installing", host: serverRow.host, syncCron: input.syncCron ?? null })
        .run();
    }

    return this.runWithConfig(id, input.selectedLabel);
  }

  /** Повторно включает выключенный (removed) клиент с сохранённой ссылкой/локацией. */
  enable(id: string): { runId: string } | { error: string } {
    const row = this.get(id);
    if (!row) return { error: "VPN-клиент не найден" };
    if (row.status === "active" || row.status === "installing") {
      return { error: "VPN-клиент уже включён" };
    }
    return this.runWithConfig(id, row.selectedLabel);
  }

  /** Меняет локацию (фон): перегенерация конфига под новый узел + рестарт sing-box. */
  changeLocation(id: string, label: string): { runId: string } | { error: string } {
    const row = this.get(id);
    if (!row) return { error: "VPN-клиент не найден" };
    return this.runWithConfig(id, label);
  }

  /** Список локаций клиента из его сохранённой подписки (для выпадашки на карточке). */
  async locations(id: string): Promise<VpnClientServer[] | { error: string }> {
    const row = this.get(id);
    if (!row) return { error: "VPN-клиент не найден" };
    try {
      const url = decryptSecret(row.subscriptionUrlEnc, this.masterKey);
      const body = await this.fetchSubscription(url);
      const servers = parseSubscriptionServers(body);
      if (servers.length === 0) return { error: "В подписке не найдено серверов VLESS" };
      return servers;
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Выключает VPN-клиент (фон): гасит туннель, но СТРОКУ НЕ удаляет (status removed). */
  remove(id: string): { runId: string } | { error: string } {
    const row = this.get(id);
    if (!row) return { error: "VPN-клиент не найден" };
    const serverRow = this.servers.get(row.serverId);
    if (!serverRow) return { error: "Сервер не найден" };

    const target = this.servers.toTarget(serverRow);

    return this.runner.run(async (publish) => {
      try {
        return await this.singbox.remove(target, serverRow.port, {
          onLog: publish,
          onDone: (status) => {
            // По успеху → removed (карточка остаётся в списке, можно включить снова).
            this.setStatus(id, status === "success" ? "removed" : "error", status === "success" ? null : "Выключение завершилось с ошибкой");
            if (status === "success") {
              this.db
                .update(vpnClients)
                .set({ externalIp: null, updatedAt: new Date().toISOString() })
                .where(eq(vpnClients.id, id))
                .run();
            }
          },
        });
      } catch (err) {
        this.setStatus(id, "error", err instanceof Error ? err.message : String(err));
        throw err;
      }
    });
  }

  /** Полностью удаляет клиента: гасит туннель на сервере И удаляет строку из БД. */
  deleteRow(id: string): { runId: string } | { error: string } {
    const row = this.get(id);
    if (!row) return { error: "VPN-клиент не найден" };
    const serverRow = this.servers.get(row.serverId);
    // Сервера уже нет — чистить на нём нечего, просто убираем строку.
    if (!serverRow) {
      this.db.delete(vpnClients).where(eq(vpnClients.id, id)).run();
      return { runId: nanoid() };
    }

    const target = this.servers.toTarget(serverRow);
    const del = () => this.db.delete(vpnClients).where(eq(vpnClients.id, id)).run();

    return this.runner.run(async (publish) => {
      try {
        // Строку удаляем в любом случае — пользователь явно просил удалить совсем.
        return await this.singbox.remove(target, serverRow.port, { onLog: publish, onDone: del });
      } catch (err) {
        del();
        throw err;
      }
    });
  }

  /**
   * Авто-обновление подписки (cron/ручной триггер): re-fetch, матч по selectedLabel,
   * пересборка конфига, рестарт sing-box. Ошибка → status error, но kernel-страховку SSH НЕ снимаем.
   */
  async sync(id: string): Promise<void> {
    const row = this.get(id);
    if (!row || row.status === "removed") return;
    const serverRow = this.servers.get(row.serverId);
    if (!serverRow) return;

    this.setStatus(id, "syncing");
    const target = this.servers.toTarget(serverRow);
    try {
      const url = decryptSecret(row.subscriptionUrlEnc, this.masterKey);
      const body = await this.fetchSubscription(url);
      const nodes = parseSubscriptionNodes(body);
      const node = this.pickNode(nodes, row.selectedLabel) ?? nodes[0];
      if (!node) throw new Error("Подписка пуста — нечего обновлять");

      const config = JSON.stringify(buildSingBoxConfig(node, { sshPort: serverRow.port }), null, 2);
      // Перезапись конфига + рестарт через тот же installer (idempotent run).
      await this.singbox.run(
        target,
        { config, sshPort: serverRow.port },
        {
          onLog: () => {}, // sync тихий (без WS-канала)
          onResult: (result) => {
            this.db
              .update(vpnClients)
              .set({ externalIp: result.externalIp, lastSyncedAt: new Date().toISOString(), updatedAt: new Date().toISOString() })
              .where(eq(vpnClients.id, id))
              .run();
          },
          onDone: (status) => {
            this.setStatus(id, status === "success" ? "active" : "error", status === "success" ? null : "Обновление подписки завершилось с ошибкой");
          },
        },
      );
    } catch (err) {
      this.setStatus(id, "error", err instanceof Error ? err.message : String(err));
    }
  }

  /**
   * Ручное обновление подписки (кнопка «Обновить»): фон + live-лог в deploy:<runId>.
   * В отличие от cron-`sync` (тихого и блокирующего), не вешает HTTP-запрос — сразу
   * отдаёт runId, прогресс виден в DeployDrawer. Перетягивает ту же локацию.
   */
  manualSync(id: string): { runId: string } | { error: string } {
    const row = this.get(id);
    if (!row) return { error: "VPN-клиент не найден" };
    if (row.status !== "active") return { error: "Обновлять можно только активный VPN-клиент" };
    return this.runWithConfig(id, row.selectedLabel);
  }

  /**
   * Внешний IP сервера + гео (через VPN, если поднят). serverHost — точка отсчёта;
   * throughVpn=true, если externalIp отличается от host сервера. Обновляет externalIp в БД.
   */
  async exitInfo(id: string): Promise<VpnClientExitInfo | { error: string }> {
    const row = this.get(id);
    if (!row) return { error: "VPN-клиент не найден" };
    const serverRow = this.servers.get(row.serverId);
    if (!serverRow) return { error: "Сервер не найден" };

    const info = await this.singbox.getExitInfo(this.servers.toTarget(serverRow));
    this.db
      .update(vpnClients)
      .set({ externalIp: info.ip, updatedAt: new Date().toISOString() })
      .where(eq(vpnClients.id, id))
      .run();
    return {
      serverHost: serverRow.host,
      externalIp: info.ip,
      country: info.country,
      org: info.org,
      throughVpn: !!info.ip && info.ip !== serverRow.host,
    };
  }

  /** Проверяет доступность ChatGPT/Claude/Telegram С СЕРВЕРА (через VPN, если поднят). */
  async checkServices(id: string): Promise<VpnServiceCheck[] | { error: string }> {
    const row = this.get(id);
    if (!row) return { error: "VPN-клиент не найден" };
    const serverRow = this.servers.get(row.serverId);
    if (!serverRow) return { error: "Сервер не найден" };
    return this.singbox.checkServices(this.servers.toTarget(serverRow));
  }
}
