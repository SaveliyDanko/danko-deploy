import type { ProjectConfig, ServiceKind, ServiceStatus } from "@dankodeploy/shared";

import { shellQuote } from "../util/shell.js";
import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

export interface ProjectRuntimeInfo {
  status: ServiceStatus;
  gitRevision: string | null;
  version: string | null;
}

/**
 * Определяет текущий статус сервиса и его версию по SSH.
 * Логика зависит от типа упаковки (docker-compose / systemd / process).
 */
export async function collectProjectRuntime(
  ssh: SshExecutor,
  target: SshTarget,
  kind: ServiceKind,
  config: ProjectConfig,
): Promise<ProjectRuntimeInfo> {
  const gitRevision = await readGitRevision(ssh, target, config.workdir);

  switch (kind) {
    case "docker-compose":
      return { ...(await dockerStatus(ssh, target, config)), gitRevision };
    case "systemd":
      return { ...(await systemdStatus(ssh, target, config)), gitRevision };
    case "process":
    default:
      return { status: "unknown", version: null, gitRevision };
  }
}

async function readGitRevision(
  ssh: SshExecutor,
  target: SshTarget,
  workdir: string,
): Promise<string | null> {
  const res = await ssh.exec(target, "git rev-parse --short HEAD 2>/dev/null || true", workdir);
  const rev = res.stdout.trim();
  return rev || null;
}

async function dockerStatus(
  ssh: SshExecutor,
  target: SshTarget,
  config: ProjectConfig,
): Promise<{ status: ServiceStatus; version: string | null }> {
  const base = config.composeFile
    ? `docker compose -f ${shellQuote(config.composeFile)}`
    : "docker compose";
  const res = await ssh.exec(target, `${base} ps --format "{{.Name}} {{.State}}"`, config.workdir);
  const lines = res.stdout.trim().split("\n").filter(Boolean);
  if (lines.length === 0) return { status: "stopped", version: null };
  const anyRunning = lines.some((l) => /running|up/i.test(l));
  return { status: anyRunning ? "running" : "stopped", version: null };
}

async function systemdStatus(
  ssh: SshExecutor,
  target: SshTarget,
  config: ProjectConfig,
): Promise<{ status: ServiceStatus; version: string | null }> {
  if (!config.systemdUnit) return { status: "unknown", version: null };
  const res = await ssh.exec(target, `systemctl is-active ${shellQuote(config.systemdUnit)} || true`);
  const active = res.stdout.trim();
  return { status: active === "active" ? "running" : "stopped", version: null };
}
