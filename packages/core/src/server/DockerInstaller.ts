import type { DeployStatus } from "@dankodeploy/shared";

import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

/** Колбэки установки Docker — сервер транслирует их в WS-канал deploy:<runId>. */
export interface DockerInstallHandlers {
  onLog: (line: string, stream: "stdout" | "stderr" | "info") => void;
  onDone: (status: DeployStatus) => void;
}

const INSTALL_CMD = String.raw`
set -e

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  if ! command -v sudo >/dev/null 2>&1; then
    echo "sudo не найден. Запустите установку под root или установите sudo."
    exit 1
  fi
  if ! sudo -n true 2>/dev/null; then
    echo "Нужен passwordless sudo для пользователя $(id -un)."
    exit 1
  fi
  SUDO="sudo -n"
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  echo "Docker и Compose plugin уже установлены."
else
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y ca-certificates curl
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl не найден. Установите curl или используйте Debian/Ubuntu с apt-get."
    exit 1
  fi

  curl -fsSL https://get.docker.com -o /tmp/dankodeploy-get-docker.sh
  $SUDO sh /tmp/dankodeploy-get-docker.sh
  rm -f /tmp/dankodeploy-get-docker.sh
fi

if command -v systemctl >/dev/null 2>&1; then
  $SUDO systemctl enable --now docker || true
fi

if [ "$(id -u)" -ne 0 ]; then
  $SUDO usermod -aG docker "$(id -un)"
fi

docker --version
docker compose version

if docker info >/dev/null 2>&1; then
  echo "Docker daemon доступен текущему пользователю."
else
  echo "Пользователь добавлен в группу docker. Нужно открыть новое SSH-соединение, чтобы применились группы."
fi
`;

/** Устанавливает Docker Engine и Docker Compose plugin на сервер по SSH. */
export class DockerInstaller {
  constructor(private readonly ssh: SshExecutor) {}

  async run(target: SshTarget, handlers: DockerInstallHandlers): Promise<DeployStatus> {
    handlers.onLog("▶ Установка Docker на сервер", "info");
    handlers.onLog("Потребуется root или passwordless sudo у SSH-пользователя.", "info");

    try {
      const code = await this.ssh.execStream(target, INSTALL_CMD, {
        onStdout: (line) => handlers.onLog(line, "stdout"),
        onStderr: (line) => handlers.onLog(line, "stderr"),
      });
      if (code !== 0) {
        handlers.onLog(`✖ Установка Docker завершилась с кодом ${code}`, "info");
        handlers.onDone("failed");
        return "failed";
      }

      handlers.onLog("\n✔ Установка Docker завершена", "info");
      handlers.onLog("Если пользователь был добавлен в группу docker, повторный деплой откроет новое SSH-соединение.", "info");
      handlers.onDone("success");
      return "success";
    } catch (err) {
      handlers.onLog(`✖ Ошибка: ${err instanceof Error ? err.message : String(err)}`, "info");
      handlers.onDone("failed");
      return "failed";
    }
  }
}
