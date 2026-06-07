import type { DeployStatus } from "@dankodeploy/shared";

import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

/** Результат успешной раскатки Outline: координаты management API. */
export interface OutlineResult {
  /** Management apiUrl (содержит секретный токен доступа). */
  apiUrl: string;
  /** SHA256-отпечаток TLS-сертификата management API. */
  certSha256: string;
  /** Порт management API (вытащен из apiUrl). */
  apiPort: number | null;
}

/** Колбэки раскатки/удаления Outline — сервер транслирует их в WS-канал deploy:<runId>. */
export interface OutlineInstallHandlers {
  onLog: (line: string, stream: "stdout" | "stderr" | "info") => void;
  /** Вызывается один раз при успешной раскатке с координатами management API. */
  onResult?: (result: OutlineResult) => void;
  onDone: (status: DeployStatus) => void;
}

/** Маркер, которым оборачиваем JSON-вывод install-скрипта, чтобы надёжно его выудить. */
const RESULT_BEGIN = "===DANKO_OUTLINE_BEGIN===";
const RESULT_END = "===DANKO_OUTLINE_END===";

/**
 * Скрипт раскатки Outline Server (Shadowsocks). Idempotent: install_server.sh
 * сам ставит Docker, поднимает контейнер shadowbox и печатает JSON {apiUrl,certSha256}.
 * Мы оборачиваем его вывод маркерами, чтобы распарсить координаты management API.
 */
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

if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
  echo "Нужен curl или wget для загрузки install-скрипта Outline."
  exit 1
fi

FETCH="curl -fsSL"
if ! command -v curl >/dev/null 2>&1; then FETCH="wget -qO-"; fi

OUTLINE_URL="https://raw.githubusercontent.com/Jigsaw-Code/outline-server/master/src/server_manager/install_scripts/install_server.sh"

# Запускаем официальный install-скрипт. Он сам ставит Docker и shadowbox.
# Вывод (включая финальный JSON) пишем в файл, чтобы потом надёжно его извлечь.
OUT_FILE="$(mktemp)"
$FETCH "$OUTLINE_URL" | $SUDO bash 2>&1 | tee "$OUT_FILE"

# install_server.sh печатает строку вида:
#   {"apiUrl":"https://host:port/secret","certSha256":"ABCD..."}
# Выуживаем её и оборачиваем маркерами для парсера на стороне панели.
RESULT_LINE="$(grep -o '{"apiUrl".*}' "$OUT_FILE" | tail -n1 || true)"
rm -f "$OUT_FILE"

if [ -n "$RESULT_LINE" ]; then
  echo "` + RESULT_BEGIN + String.raw`"
  echo "$RESULT_LINE"
  echo "` + RESULT_END + String.raw`"
else
  echo "Не удалось получить apiUrl Outline из вывода install-скрипта."
  exit 1
fi
`;

/** Скрипт удаления Outline: гасим контейнеры shadowbox/watchtower и чистим каталог. */
const REMOVE_CMD = String.raw`
set -e

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi

if command -v docker >/dev/null 2>&1; then
  $SUDO docker rm -f shadowbox watchtower 2>/dev/null || true
fi
$SUDO rm -rf /opt/outline 2>/dev/null || true
echo "Outline удалён (контейнеры остановлены, каталог /opt/outline очищен)."
`;

/** Вытаскивает порт из apiUrl вида https://host:port/secret. */
function extractApiPort(apiUrl: string): number | null {
  try {
    const port = new URL(apiUrl).port;
    const n = Number(port);
    return Number.isNaN(n) || n === 0 ? null : n;
  } catch {
    return null;
  }
}

/** Парсит обёрнутый маркерами JSON-результат из накопленного вывода. */
function parseResult(buffer: string): OutlineResult | null {
  const begin = buffer.indexOf(RESULT_BEGIN);
  const end = buffer.indexOf(RESULT_END);
  if (begin === -1 || end === -1 || end < begin) return null;
  const json = buffer.slice(begin + RESULT_BEGIN.length, end).trim();
  try {
    const parsed = JSON.parse(json) as { apiUrl?: string; certSha256?: string };
    if (!parsed.apiUrl || !parsed.certSha256) return null;
    return {
      apiUrl: parsed.apiUrl,
      certSha256: parsed.certSha256,
      apiPort: extractApiPort(parsed.apiUrl),
    };
  } catch {
    return null;
  }
}

/** Разворачивает/удаляет Outline Server (Shadowsocks) на сервере по SSH. */
export class OutlineInstaller {
  constructor(private readonly ssh: SshExecutor) {}

  async run(target: SshTarget, handlers: OutlineInstallHandlers): Promise<DeployStatus> {
    handlers.onLog("▶ Раскатка Outline (Shadowsocks) на сервер", "info");
    handlers.onLog("Скрипт Jigsaw сам поставит Docker и поднимет контейнер shadowbox.", "info");

    // Копим stdout, чтобы выудить из него обёрнутый маркерами JSON-результат.
    let buffer = "";
    try {
      const code = await this.ssh.execStream(target, INSTALL_CMD, {
        onStdout: (line) => {
          buffer += line + "\n";
          handlers.onLog(line, "stdout");
        },
        onStderr: (line) => handlers.onLog(line, "stderr"),
      });
      if (code !== 0) {
        handlers.onLog(`✖ Раскатка Outline завершилась с кодом ${code}`, "info");
        handlers.onDone("failed");
        return "failed";
      }

      const result = parseResult(buffer);
      if (!result) {
        handlers.onLog("✖ Не удалось распарсить координаты management API Outline.", "info");
        handlers.onDone("failed");
        return "failed";
      }

      handlers.onResult?.(result);
      handlers.onLog("\n✔ Outline развёрнут. Management API получен.", "info");
      handlers.onDone("success");
      return "success";
    } catch (err) {
      handlers.onLog(`✖ Ошибка: ${err instanceof Error ? err.message : String(err)}`, "info");
      handlers.onDone("failed");
      return "failed";
    }
  }

  async remove(target: SshTarget, handlers: OutlineInstallHandlers): Promise<DeployStatus> {
    handlers.onLog("▶ Удаление Outline с сервера", "info");
    try {
      const code = await this.ssh.execStream(target, REMOVE_CMD, {
        onStdout: (line) => handlers.onLog(line, "stdout"),
        onStderr: (line) => handlers.onLog(line, "stderr"),
      });
      const status: DeployStatus = code === 0 ? "success" : "failed";
      handlers.onLog(code === 0 ? "✔ Outline удалён" : `✖ Удаление завершилось с кодом ${code}`, "info");
      handlers.onDone(status);
      return status;
    } catch (err) {
      handlers.onLog(`✖ Ошибка: ${err instanceof Error ? err.message : String(err)}`, "info");
      handlers.onDone("failed");
      return "failed";
    }
  }
}
