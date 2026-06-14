import type { DeployStatus, DeployStep, ProjectConfig, ServiceKind } from "@dankodeploy/shared";

import { shellQuote } from "../util/shell.js";
import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";
import type { DeployHandlers } from "./DeployRunner.js";

export interface UndeployInput {
  kind: ServiceKind;
  config: ProjectConfig;
}

/** Возвращает шаги снятия проекта с запуска. Кастомные шаги полностью заменяют дефолт. */
export function resolveUndeploySteps(input: UndeployInput): DeployStep[] {
  if (input.config.undeploySteps?.length) return input.config.undeploySteps;

  switch (input.kind) {
    case "docker-compose": {
      const f = input.config.composeFile;
      const composeBase = f ? `docker compose -f ${shellQuote(f)}` : "docker compose";
      return [{ name: "Compose down", run: `${composeBase} down --remove-orphans` }];
    }
    case "systemd": {
      const unit = input.config.systemdUnit;
      if (!unit) {
        return [{ name: "Ошибка", run: 'echo "systemdUnit не задан в конфиге проекта" && false' }];
      }
      return [
        { name: "Stop unit", run: `sudo systemctl stop ${shellQuote(unit)}` },
        { name: "Status", run: `! systemctl is-active ${shellQuote(unit)}` },
      ];
    }
    case "process":
    default:
      return [
        {
          name: "Ошибка",
          run: 'echo "Для kind=process задайте config.undeploySteps" && false',
        },
      ];
  }
}

/** Выполняет остановку/снятие проекта по SSH с live-логом. */
export class UndeployRunner {
  constructor(private readonly ssh: SshExecutor) {}

  async run(target: SshTarget, input: UndeployInput, handlers: DeployHandlers): Promise<DeployStatus> {
    const steps = resolveUndeploySteps(input);
    const { workdir } = input.config;

    handlers.onLog(`▶ Undeploy в ${workdir} (${input.kind})`, "info");

    try {
      if (!(await this.preflight(target, input, handlers))) return "failed";

      for (const step of steps) {
        handlers.onLog(`\n$ [${step.name}] ${step.run}`, "info");
        const code = await this.ssh.execStream(
          target,
          step.run,
          {
            onStdout: (line) => handlers.onLog(line, "stdout"),
            onStderr: (line) => handlers.onLog(line, "stderr"),
          },
          workdir,
        );
        if (code !== 0) {
          handlers.onLog(`✖ Шаг "${step.name}" завершился с кодом ${code}`, "info");
          handlers.onDone("failed");
          return "failed";
        }
      }

      handlers.onLog("\n✔ Undeploy успешно завершён", "info");
      handlers.onDone("success");
      return "success";
    } catch (err) {
      handlers.onLog(`✖ Ошибка: ${err instanceof Error ? err.message : String(err)}`, "info");
      handlers.onDone("failed");
      return "failed";
    }
  }

  private async preflight(
    target: SshTarget,
    input: UndeployInput,
    handlers: DeployHandlers,
  ): Promise<boolean> {
    if (input.kind !== "docker-compose") return true;

    const docker = await this.ssh.exec(target, "command -v docker >/dev/null 2>&1");
    if (docker.code !== 0) {
      handlers.onLog("✖ На сервере не найден Docker.", "info");
      handlers.onDone("failed");
      return false;
    }

    const compose = await this.ssh.exec(target, "docker compose version >/dev/null 2>&1");
    if (compose.code !== 0) {
      handlers.onLog("✖ Docker найден, но compose-плагин недоступен.", "info");
      handlers.onDone("failed");
      return false;
    }

    const daemon = await this.ssh.exec(target, "docker info >/dev/null 2>&1");
    if (daemon.code !== 0) {
      handlers.onLog("✖ SSH-пользователь не может обратиться к Docker daemon.", "info");
      handlers.onDone("failed");
      return false;
    }

    return true;
  }
}
