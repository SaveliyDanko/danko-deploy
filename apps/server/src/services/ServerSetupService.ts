import {
  DockerInstaller,
  NodeInstaller,
  SshHardeningInstaller,
  type SshExecutor,
} from "@dankodeploy/core";
import { nanoid } from "nanoid";

import type { ServerService } from "./ServerService.js";
import type { WsHub } from "../ws/WsHub.js";

/** Фоновые операции подготовки VPS: установка Docker и похожий bootstrap. */
export class ServerSetupService {
  private readonly docker: DockerInstaller;
  private readonly node: NodeInstaller;
  private readonly hardening: SshHardeningInstaller;

  constructor(
    ssh: SshExecutor,
    private readonly servers: ServerService,
    private readonly hub: WsHub,
  ) {
    this.docker = new DockerInstaller(ssh);
    this.node = new NodeInstaller(ssh);
    this.hardening = new SshHardeningInstaller(ssh);
  }

  installDocker(serverId: string): { runId: string } | { error: string } {
    const serverRow = this.servers.get(serverId);
    if (!serverRow) return { error: "Сервер не найден" };

    const runId = nanoid();
    const target = this.servers.toTarget(serverRow);

    void this.docker
      .run(target, {
        onLog: (line, stream) => {
          this.hub.publish(`deploy:${runId}`, { type: "deploy:log", runId, line, stream });
        },
        onDone: (status) => {
          // После usermod новое членство в группе docker видно только в новом SSH-сеансе.
          this.servers.disconnect(serverId);
          this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status });
        },
      })
      .catch((err) => {
        const line = `Внутренняя ошибка: ${err instanceof Error ? err.message : String(err)}`;
        this.servers.disconnect(serverId);
        this.hub.publish(`deploy:${runId}`, { type: "deploy:log", runId, line, stream: "info" });
        this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status: "failed" });
      });

    return { runId };
  }

  /**
   * Применяет hardening SSH (лимиты подключений, keepalive, fail2ban и опционально
   * запрет парольного входа). Парольный вход отключаем ТОЛЬКО если сервер подключён
   * по ключу (key/stored-key) — иначе можно отрезать доступ панели.
   */
  hardenSsh(serverId: string): { runId: string } | { error: string } {
    const serverRow = this.servers.get(serverId);
    if (!serverRow) return { error: "Сервер не найден" };

    const disablePassword =
      serverRow.authMethod === "key" || serverRow.authMethod === "stored-key";

    const runId = nanoid();
    const target = this.servers.toTarget(serverRow);

    void this.hardening
      .run(
        target,
        { disablePassword },
        {
          onLog: (line, stream) => {
            this.hub.publish(`deploy:${runId}`, { type: "deploy:log", runId, line, stream });
          },
          onDone: (status) => {
            // Параметры sshd могли измениться — сбрасываем кэш соединения.
            this.servers.disconnect(serverId);
            this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status });
          },
        },
      )
      .catch((err) => {
        const line = `Внутренняя ошибка: ${err instanceof Error ? err.message : String(err)}`;
        this.servers.disconnect(serverId);
        this.hub.publish(`deploy:${runId}`, { type: "deploy:log", runId, line, stream: "info" });
        this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status: "failed" });
      });

    return { runId };
  }

  installNode(serverId: string): { runId: string } | { error: string } {
    const serverRow = this.servers.get(serverId);
    if (!serverRow) return { error: "Сервер не найден" };

    const runId = nanoid();
    const target = this.servers.toTarget(serverRow);

    void this.node
      .run(target, {
        onLog: (line, stream) => {
          this.hub.publish(`deploy:${runId}`, { type: "deploy:log", runId, line, stream });
        },
        onDone: (status) => {
          this.servers.disconnect(serverId);
          this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status });
        },
      })
      .catch((err) => {
        const line = `Внутренняя ошибка: ${err instanceof Error ? err.message : String(err)}`;
        this.servers.disconnect(serverId);
        this.hub.publish(`deploy:${runId}`, { type: "deploy:log", runId, line, stream: "info" });
        this.hub.publish(`deploy:${runId}`, { type: "deploy:done", runId, status: "failed" });
      });

    return { runId };
  }
}
