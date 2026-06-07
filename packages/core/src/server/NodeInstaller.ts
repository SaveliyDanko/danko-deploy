import type { DeployStatus } from "@dankodeploy/shared";

import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

/** Колбэки установки Node/npm — сервер транслирует их в WS-канал deploy:<runId>. */
export interface NodeInstallHandlers {
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

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  echo "Node и npm уже установлены."
else
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update
    $SUDO apt-get install -y ca-certificates curl
    curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/dankodeploy-nodesource.sh
    $SUDO bash /tmp/dankodeploy-nodesource.sh
    rm -f /tmp/dankodeploy-nodesource.sh
    $SUDO apt-get install -y nodejs
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y nodejs npm
  elif command -v yum >/dev/null 2>&1; then
    $SUDO yum install -y nodejs npm
  elif command -v apk >/dev/null 2>&1; then
    $SUDO apk add nodejs npm
  elif command -v brew >/dev/null 2>&1; then
    brew install node
  else
    echo "Не найден поддерживаемый пакетный менеджер (apt-get/dnf/yum/apk/brew)."
    exit 1
  fi
fi

if ! command -v node >/dev/null 2>&1; then
  echo "node не найден после установки."
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm не найден после установки."
  exit 1
fi

node --version
npm --version
`;

/** Устанавливает Node.js и npm на сервер по SSH. */
export class NodeInstaller {
  constructor(private readonly ssh: SshExecutor) {}

  async run(target: SshTarget, handlers: NodeInstallHandlers): Promise<DeployStatus> {
    handlers.onLog("▶ Установка Node.js/npm на сервер", "info");
    handlers.onLog("Потребуется root или passwordless sudo у SSH-пользователя.", "info");

    try {
      const code = await this.ssh.execStream(target, INSTALL_CMD, {
        onStdout: (line) => handlers.onLog(line, "stdout"),
        onStderr: (line) => handlers.onLog(line, "stderr"),
      });
      if (code !== 0) {
        handlers.onLog(`✖ Установка Node/npm завершилась с кодом ${code}`, "info");
        handlers.onDone("failed");
        return "failed";
      }

      handlers.onLog("\n✔ Установка Node/npm завершена", "info");
      handlers.onDone("success");
      return "success";
    } catch (err) {
      handlers.onLog(`✖ Ошибка: ${err instanceof Error ? err.message : String(err)}`, "info");
      handlers.onDone("failed");
      return "failed";
    }
  }
}
