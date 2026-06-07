import { AgentInstaller, type SshExecutor } from "@dankodeploy/core";
import { aiAgents, type AiAgentRow, type Db } from "@dankodeploy/db";
import type { AiAgentPublic, AiAgentStatus, CreateAiAgentInput } from "@dankodeploy/shared";
import { desc, eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { ServerService } from "./ServerService.js";
import type { WsHub } from "../ws/WsHub.js";

export function toAiAgentPublic(row: AiAgentRow): AiAgentPublic {
  return {
    id: row.id,
    name: row.name,
    serverId: row.serverId,
    agentType: row.agentType,
    workdir: row.workdir,
    tmuxSession: row.tmuxSession,
    status: row.status,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Управляет AI-агентами: CRUD, установка (AgentInstaller), запуск/остановка tmux-сессии.
 * Установка идёт в фоне со стримом логов в WS-канал ai:<agentId> (паттерн DeployService).
 */
export class AiAgentService {
  private readonly installer: AgentInstaller;

  constructor(
    private readonly db: Db,
    ssh: SshExecutor,
    private readonly servers: ServerService,
    private readonly hub: WsHub,
  ) {
    this.installer = new AgentInstaller(ssh);
  }

  list(): AiAgentPublic[] {
    return this.db
      .select()
      .from(aiAgents)
      .orderBy(desc(aiAgents.createdAt))
      .all()
      .map(toAiAgentPublic);
  }

  get(id: string): AiAgentRow | undefined {
    return this.db.select().from(aiAgents).where(eq(aiAgents.id, id)).get();
  }

  create(input: CreateAiAgentInput): AiAgentPublic {
    const id = nanoid();
    this.db
      .insert(aiAgents)
      .values({
        id,
        name: input.name,
        serverId: input.serverId,
        agentType: input.agentType,
        workdir: input.workdir,
        tmuxSession: `dd-agent-${id}`,
        status: "stopped",
      })
      .run();
    return toAiAgentPublic(this.get(id)!);
  }

  delete(id: string): boolean {
    const res = this.db.delete(aiAgents).where(eq(aiAgents.id, id)).run();
    return res.changes > 0;
  }

  private setStatus(id: string, status: AiAgentStatus, lastError?: string | null): void {
    this.db
      .update(aiAgents)
      .set({ status, lastError: lastError ?? null, updatedAt: new Date().toISOString() })
      .where(eq(aiAgents.id, id))
      .run();
    this.hub.publish(`ai:${id}`, { type: "ai:status", agentId: id, status });
  }

  /**
   * Разворачивает агента: ensureTmux → ensureInstalled → ensureSession.
   * Возвращает сразу; работа в фоне, лог в WS-канал ai:<agentId>.
   */
  deploy(agentId: string): { ok: true } | { error: string } {
    const agent = this.get(agentId);
    if (!agent) return { error: "Агент не найден" };
    const serverRow = this.servers.get(agent.serverId);
    if (!serverRow) return { error: "Сервер агента не найден" };

    const target = this.servers.toTarget(serverRow);
    const log = (line: string, stream: "stdout" | "stderr" | "info") =>
      this.hub.publish(`ai:${agentId}`, { type: "ai:log", agentId, line, stream });

    this.setStatus(agentId, "installing");

    void (async () => {
      try {
        await this.installer.ensureTmux(target, log);
        await this.installer.ensureInstalled(target, agent.agentType, log);
        await this.installer.ensureSession(target, agent.tmuxSession, agent.workdir, agent.agentType, log);
        log("✔ Агент готов к работе", "info");
        this.setStatus(agentId, "running");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`✖ Ошибка: ${msg}`, "info");
        this.setStatus(agentId, "error", msg);
      }
    })();

    return { ok: true };
  }

  /**
   * Удаляет CLI агента с сервера: сначала гасит tmux-сессию, затем делает npm uninstall -g.
   * Запись агента в панели остаётся, чтобы его можно было поставить повторно.
   */
  uninstall(agentId: string): { ok: true } | { error: string } {
    const agent = this.get(agentId);
    if (!agent) return { error: "Агент не найден" };
    const serverRow = this.servers.get(agent.serverId);
    if (!serverRow) return { error: "Сервер агента не найден" };

    const target = this.servers.toTarget(serverRow);
    const log = (line: string, stream: "stdout" | "stderr" | "info") =>
      this.hub.publish(`ai:${agentId}`, { type: "ai:log", agentId, line, stream });

    this.setStatus(agentId, "uninstalling");

    void (async () => {
      try {
        log(`Останавливаю tmux-сессию ${agent.tmuxSession}...`, "info");
        await this.installer.killSession(target, agent.tmuxSession);
        await this.installer.uninstall(target, agent.agentType, log);
        log("✔ CLI агента удалён с сервера", "info");
        this.setStatus(agentId, "stopped");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log(`✖ Ошибка: ${msg}`, "info");
        this.setStatus(agentId, "error", msg);
      }
    })();

    return { ok: true };
  }

  /** Поднимает tmux-сессию агента, если её нет (без переустановки CLI). */
  async start(agentId: string): Promise<{ ok: true } | { error: string }> {
    const agent = this.get(agentId);
    if (!agent) return { error: "Агент не найден" };
    const serverRow = this.servers.get(agent.serverId);
    if (!serverRow) return { error: "Сервер агента не найден" };
    const target = this.servers.toTarget(serverRow);
    try {
      await this.installer.ensureSession(
        target,
        agent.tmuxSession,
        agent.workdir,
        agent.agentType,
        () => {},
      );
      const alive = await this.installer.hasSession(target, agent.tmuxSession);
      if (!alive) {
        throw new Error(
          "tmux-сессия не запустилась или сразу завершилась. Проверьте, что CLI агента установлен и запускается на сервере.",
        );
      }
      this.setStatus(agentId, "running");
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.setStatus(agentId, "error", msg);
      return { error: msg };
    }
  }

  /** Останавливает (убивает) tmux-сессию агента. */
  async stop(agentId: string): Promise<{ ok: true } | { error: string }> {
    const agent = this.get(agentId);
    if (!agent) return { error: "Агент не найден" };
    const serverRow = this.servers.get(agent.serverId);
    if (!serverRow) return { error: "Сервер агента не найден" };
    const target = this.servers.toTarget(serverRow);
    try {
      await this.installer.killSession(target, agent.tmuxSession);
      this.setStatus(agentId, "stopped");
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Синхронизирует статус с реальностью (tmux has-session) и возвращает его. */
  async sessionStatus(agentId: string): Promise<AiAgentStatus> {
    const agent = this.get(agentId);
    if (!agent) return "error";
    const serverRow = this.servers.get(agent.serverId);
    if (!serverRow) return "error";
    try {
      const alive = await this.installer.hasSession(
        this.servers.toTarget(serverRow),
        agent.tmuxSession,
      );
      const status: AiAgentStatus = alive ? "running" : "stopped";
      // Не перетираем installing/uninstalling/error — обновляем только стабильные статусы.
      if (agent.status === "running" || agent.status === "stopped" || agent.status === "ready") {
        this.db.update(aiAgents).set({ status }).where(eq(aiAgents.id, agentId)).run();
      }
      return status;
    } catch {
      return "error";
    }
  }
}
