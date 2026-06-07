import {
  DockerInstaller,
  NodeInstaller,
  SshHardeningInstaller,
  type SshExecutor,
} from "@dankodeploy/core";
import type { DeployStatus } from "@dankodeploy/shared";

import { BackgroundRunner, type LogPublisher } from "./BackgroundRunner.js";
import type { ServerService } from "./ServerService.js";
import type { WsHub } from "../ws/WsHub.js";

/** Фоновые операции подготовки VPS: установка Docker и похожий bootstrap. */
export class ServerSetupService {
  private readonly docker: DockerInstaller;
  private readonly node: NodeInstaller;
  private readonly hardening: SshHardeningInstaller;
  private readonly runner: BackgroundRunner;

  constructor(
    ssh: SshExecutor,
    private readonly servers: ServerService,
    hub: WsHub,
  ) {
    this.docker = new DockerInstaller(ssh);
    this.node = new NodeInstaller(ssh);
    this.hardening = new SshHardeningInstaller(ssh);
    this.runner = new BackgroundRunner(hub);
  }

  /**
   * Гоняет installer с колбэками в фоне: лог стримится в WS, по завершении —
   * disconnect (после bootstrap членство в группах/sshd видно только в новом сеансе).
   */
  private runInstaller(
    serverId: string,
    exec: (publish: LogPublisher) => Promise<DeployStatus>,
  ): { runId: string } | { error: string } {
    const serverRow = this.servers.get(serverId);
    if (!serverRow) return { error: "Сервер не найден" };
    return this.runner.run(async (publish) => {
      try {
        return await exec(publish);
      } finally {
        this.servers.disconnect(serverId);
      }
    });
  }

  installDocker(serverId: string): { runId: string } | { error: string } {
    const serverRow = this.servers.get(serverId);
    if (!serverRow) return { error: "Сервер не найден" };
    const target = this.servers.toTarget(serverRow);
    return this.runInstaller(serverId, (publish) =>
      this.docker.run(target, { onLog: publish, onDone: () => {} }),
    );
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
    const target = this.servers.toTarget(serverRow);
    return this.runInstaller(serverId, (publish) =>
      this.hardening.run(target, { disablePassword }, { onLog: publish, onDone: () => {} }),
    );
  }

  installNode(serverId: string): { runId: string } | { error: string } {
    const serverRow = this.servers.get(serverId);
    if (!serverRow) return { error: "Сервер не найден" };
    const target = this.servers.toTarget(serverRow);
    return this.runInstaller(serverId, (publish) =>
      this.node.run(target, { onLog: publish, onDone: () => {} }),
    );
  }
}
