import type { DeployStatus, DeployStep, ProjectConfig, ServiceKind } from "@dankodeploy/shared";

import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

/** Колбэки прогресса деплоя — сервер транслирует их в WS-канал deploy:<runId>. */
export interface DeployHandlers {
  onLog: (line: string, stream: "stdout" | "stderr" | "info") => void;
  onDone: (status: DeployStatus) => void;
}

export interface DeployInput {
  kind: ServiceKind;
  config: ProjectConfig;
  /** Расшифрованный Git deploy-ключ для приватного репозитория. */
  privateKey?: string;
}

/** Безопасное экранирование строки для вставки в одинарные кавычки shell. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function withGitSshCommand(command: string, keyPath: string): string {
  const gitSsh = `ssh -i ${shellQuote(keyPath)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
  return `export GIT_SSH_COMMAND=${shellQuote(gitSsh)}; ${command}`;
}

/**
 * Возвращает шаги деплоя для проекта. Если в конфиге заданы кастомные deploySteps —
 * используются они; иначе берутся разумные дефолты по типу сервиса.
 */
export function resolveDeploySteps(input: DeployInput): DeployStep[] {
  if (input.config.deploySteps?.length) return input.config.deploySteps;

  switch (input.kind) {
    case "docker-compose": {
      const f = input.config.composeFile;
      const composeBase = f ? `docker compose -f ${f}` : "docker compose";
      return [
        { name: "Git pull", run: "git pull --ff-only" },
        { name: "Pull images", run: `${composeBase} pull --ignore-buildable` },
        { name: "Up (build)", run: `${composeBase} up -d --build` },
        // Чистим то, что копится от частых `--build`: dangling-образы И build cache
        // (главный источник роста диска). Теговые образы и volumes НЕ трогаем —
        // чтобы оставался откат и не терялись данные.
        { name: "Prune dangling", run: "docker image prune -f" },
        { name: "Prune build cache", run: "docker builder prune -f" },
      ];
    }
    case "systemd": {
      const unit = input.config.systemdUnit;
      if (!unit) {
        return [{ name: "Ошибка", run: 'echo "systemdUnit не задан в конфиге проекта" && false' }];
      }
      return [
        { name: "Git pull", run: "git pull --ff-only" },
        { name: "Restart unit", run: `sudo systemctl restart ${unit}` },
        { name: "Status", run: `systemctl is-active ${unit}` },
      ];
    }
    case "process":
    default:
      return [{ name: "Git pull", run: "git pull --ff-only" }];
  }
}

/**
 * Выполняет деплой проекта по SSH, стримя логи. Каждый шаг выполняется в workdir;
 * при ненулевом коде выхода деплой прерывается и помечается failed.
 */
export class DeployRunner {
  constructor(private readonly ssh: SshExecutor) {}

  async run(target: SshTarget, input: DeployInput, handlers: DeployHandlers): Promise<DeployStatus> {
    const steps = resolveDeploySteps(input);
    const { workdir } = input.config;
    let keyPath: string | undefined;

    handlers.onLog(`▶ Деплой в ${workdir} (${input.kind})`, "info");

    try {
      if (!(await this.preflight(target, input, handlers))) return "failed";

      if (input.privateKey) {
        // Ключ нужен для git pull приватных репозиториев; храним только временно.
        keyPath = (await this.ssh.exec(target, "mktemp /tmp/dd-gitkey.XXXXXX")).stdout.trim();
        if (!keyPath) throw new Error("Не удалось создать временный файл для Git deploy-ключа");
        const pk = input.privateKey.endsWith("\n") ? input.privateKey : input.privateKey + "\n";
        await this.ssh.writeFile(target, keyPath, pk);
        await this.ssh.exec(target, `chmod 600 ${shellQuote(keyPath)}`);
        handlers.onLog("Использую Git deploy-ключ для приватного репозитория", "info");
      }

      for (const step of steps) {
        handlers.onLog(`\n$ [${step.name}] ${step.run}`, "info");
        const command = keyPath ? withGitSshCommand(step.run, keyPath) : step.run;
        const code = await this.ssh.execStream(
          target,
          command,
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

      handlers.onLog("\n✔ Деплой успешно завершён", "info");
      handlers.onDone("success");
      return "success";
    } catch (err) {
      handlers.onLog(`✖ Ошибка: ${err instanceof Error ? err.message : String(err)}`, "info");
      handlers.onDone("failed");
      return "failed";
    } finally {
      if (keyPath) await this.ssh.exec(target, `rm -f ${shellQuote(keyPath)}`).catch(() => {});
    }
  }

  /** Проверяет серверные зависимости до изменения рабочей директории. */
  private async preflight(
    target: SshTarget,
    input: DeployInput,
    handlers: DeployHandlers,
  ): Promise<boolean> {
    if (input.kind !== "docker-compose") return true;

    const docker = await this.ssh.exec(target, "command -v docker >/dev/null 2>&1");
    if (docker.code !== 0) {
      handlers.onLog(
        "✖ На сервере не найден Docker. Установите Docker Engine или выберите другой тип проекта.",
        "info",
      );
      handlers.onLog("Проверка на сервере: docker --version", "info");
      handlers.onDone("failed");
      return false;
    }

    const compose = await this.ssh.exec(target, "docker compose version >/dev/null 2>&1");
    if (compose.code !== 0) {
      handlers.onLog(
        "✖ Docker найден, но compose-плагин недоступен. Установите Docker Compose plugin.",
        "info",
      );
      handlers.onLog("Проверка на сервере: docker compose version", "info");
      handlers.onDone("failed");
      return false;
    }

    const daemon = await this.ssh.exec(target, "docker info >/dev/null 2>&1");
    if (daemon.code !== 0) {
      handlers.onLog(
        "✖ SSH-пользователь не может обратиться к Docker daemon. Проверьте, что Docker запущен и пользователь состоит в группе docker.",
        "info",
      );
      handlers.onLog("Проверка на сервере: docker info", "info");
      handlers.onDone("failed");
      return false;
    }

    return true;
  }
}
