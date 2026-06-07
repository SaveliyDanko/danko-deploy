import type { DeployStatus } from "@dankodeploy/shared";

import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

/** Результат успешного включения VPN-клиента. */
export interface SingBoxResult {
  /** Внешний IP сервера после поднятия туннеля (для проверки, что трафик идёт через VPN). */
  externalIp: string | null;
}

/** Колбэки раскатки sing-box — сервер транслирует их в WS-канал deploy:<runId>. */
export interface SingBoxInstallHandlers {
  onLog: (line: string, stream: "stdout" | "stderr" | "info") => void;
  onResult?: (result: SingBoxResult) => void;
  onDone: (status: DeployStatus) => void;
}

/** Параметры раскатки: готовый JSON-конфиг (генерит панель) и SSH-порт для kernel-страховки. */
export interface SingBoxRunOptions {
  /** Готовый sing-box config JSON (строка). Содержит секреты — не логируем содержимое. */
  config: string;
  /** SSH-порт сервера — исключается из туннеля на kernel-уровне (защита доступа панели). */
  sshPort: number;
}

const CONFIG_PATH = "/etc/sing-box/config.json";
/** Маркер для надёжного извлечения externalIp из вывода. */
const RESULT_BEGIN = "===DANKO_SB_BEGIN===";
const RESULT_END = "===DANKO_SB_END===";

/**
 * Скрипт включения VPN-клиента. config приходит base64 в env DD_SB_CONFIG,
 * SSH-порт — в DD_SSH_PORT (чтобы не светить значения в командной строке/логе).
 *
 * Порядок КРИТИЧЕН: kernel-страховка SSH ставится ДО старта sing-box, чтобы
 * даже при битом конфиге доступ панели не оборвался.
 */
const INSTALL_CMD = String.raw`
set -e

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else
  if ! sudo -n true 2>/dev/null; then echo "Нужен root или passwordless sudo."; exit 1; fi
  SUDO="sudo -n"
fi

# Проверка TUN.
if [ ! -c /dev/net/tun ]; then
  $SUDO modprobe tun 2>/dev/null || true
fi
if [ ! -c /dev/net/tun ]; then
  echo "Нет /dev/net/tun — сервер (OpenVZ/контейнер?) не поддерживает TUN. Установка невозможна."
  exit 1
fi

# Установка sing-box (idempotent): official-скрипт ставит свежий релиз и systemd-юнит.
if ! command -v sing-box >/dev/null 2>&1; then
  echo "Устанавливаю sing-box…"
  $SUDO bash -c "$(curl -fsSL https://sing-box.app/install.sh)"
else
  echo "sing-box уже установлен: $(sing-box version 2>/dev/null | head -n1)"
fi

# --- УРОВЕНЬ 1: kernel-страховка SSH (ДО старта туннеля) ---
# Исходящие пакеты sshd (sport=SSH) маркируем и гоним через отдельную таблицу
# на физический шлюз — мимо TUN. Идемпотентно.
GW=$(ip route show default | awk '/default/{print $3; exit}')
DEV=$(ip route show default | awk '/default/{print $5; exit}')
if [ -n "$GW" ] && [ -n "$DEV" ]; then
  $SUDO iptables -t mangle -C OUTPUT -p tcp --sport "$DD_SSH_PORT" -j MARK --set-mark 0x1 2>/dev/null \
    || $SUDO iptables -t mangle -A OUTPUT -p tcp --sport "$DD_SSH_PORT" -j MARK --set-mark 0x1
  $SUDO ip rule del fwmark 0x1 table 100 2>/dev/null || true
  $SUDO ip rule add fwmark 0x1 table 100 priority 100
  $SUDO ip route replace default via "$GW" dev "$DEV" table 100
  echo "SSH-страховка установлена (fwmark 0x1 → table 100 via $GW dev $DEV)."
else
  echo "ВНИМАНИЕ: не удалось определить шлюз — kernel-страховка SSH пропущена."
fi

# Пишем конфиг (из base64, без вывода содержимого — там секреты).
$SUDO mkdir -p /etc/sing-box
echo "$DD_SB_CONFIG" | base64 -d | $SUDO tee ` + CONFIG_PATH + String.raw` >/dev/null
$SUDO chmod 600 ` + CONFIG_PATH + String.raw`
echo "Конфиг записан в ` + CONFIG_PATH + String.raw` (600)."

# Валидация конфига до запуска.
$SUDO sing-box check -c ` + CONFIG_PATH + String.raw`

$SUDO systemctl enable --now sing-box
sleep 2
if ! $SUDO systemctl is-active --quiet sing-box; then
  echo "sing-box не поднялся:"
  $SUDO systemctl status sing-box --no-pager -l 2>&1 | tail -n 20 || true
  exit 1
fi
echo "sing-box активен."

# Внешний IP ПОСЛЕ поднятия туннеля.
EXT_IP="$(curl -fsS --max-time 12 https://ifconfig.me 2>/dev/null || curl -fsS --max-time 12 https://api.ipify.org 2>/dev/null || true)"
echo "` + RESULT_BEGIN + String.raw`"
echo "{\"externalIp\":\"$EXT_IP\"}"
echo "` + RESULT_END + String.raw`"
`;

/** Скрипт выключения VPN-клиента: гасим службу, чистим конфиг и kernel-страховку. */
const REMOVE_CMD = String.raw`
set -e
if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo -n"; fi

$SUDO systemctl disable --now sing-box 2>/dev/null || true
$SUDO rm -f ` + CONFIG_PATH + String.raw` 2>/dev/null || true

# Снять kernel-страховку SSH.
$SUDO iptables -t mangle -D OUTPUT -p tcp --sport "$DD_SSH_PORT" -j MARK --set-mark 0x1 2>/dev/null || true
$SUDO ip rule del fwmark 0x1 table 100 2>/dev/null || true
$SUDO ip route flush table 100 2>/dev/null || true
echo "VPN-клиент выключен, маршрутизация восстановлена."
`;

/** Достаёт externalIp из обёрнутого маркерами JSON. */
function parseResult(buffer: string): SingBoxResult {
  const begin = buffer.indexOf(RESULT_BEGIN);
  const end = buffer.indexOf(RESULT_END);
  if (begin === -1 || end === -1 || end < begin) return { externalIp: null };
  try {
    const json = buffer.slice(begin + RESULT_BEGIN.length, end).trim();
    const parsed = JSON.parse(json) as { externalIp?: string };
    return { externalIp: parsed.externalIp && parsed.externalIp.length > 0 ? parsed.externalIp : null };
  } catch {
    return { externalIp: null };
  }
}

/** Включает/выключает VPN-клиент (sing-box) на сервере по SSH. */
export class SingBoxInstaller {
  constructor(private readonly ssh: SshExecutor) {}

  async run(target: SshTarget, opts: SingBoxRunOptions, handlers: SingBoxInstallHandlers): Promise<DeployStatus> {
    handlers.onLog("▶ Включение VPN-клиента (sing-box)", "info");
    handlers.onLog("Весь исходящий трафик сервера пойдёт через VPN; SSH-доступ панели исключён.", "info");

    // config и SSH-порт передаём через env, чтобы не светить секреты в команде.
    const env: Record<string, string> = {
      DD_SB_CONFIG: Buffer.from(opts.config, "utf8").toString("base64"),
      DD_SSH_PORT: String(opts.sshPort),
    };
    const command = `DD_SB_CONFIG="${env.DD_SB_CONFIG}" DD_SSH_PORT="${env.DD_SSH_PORT}" bash -s`;

    let buffer = "";
    try {
      // Передаём скрипт через stdin (bash -s), env — в начале команды.
      const code = await this.ssh.execStream(target, `${command} <<'DDEOF'\n${INSTALL_CMD}\nDDEOF`, {
        onStdout: (line) => {
          buffer += line + "\n";
          handlers.onLog(line, "stdout");
        },
        onStderr: (line) => handlers.onLog(line, "stderr"),
      });
      if (code !== 0) {
        handlers.onLog(`✖ Включение завершилось с кодом ${code}`, "info");
        handlers.onDone("failed");
        return "failed";
      }
      handlers.onResult?.(parseResult(buffer));
      handlers.onLog("\n✔ VPN-клиент включён.", "info");
      handlers.onDone("success");
      return "success";
    } catch (err) {
      handlers.onLog(`✖ Ошибка: ${err instanceof Error ? err.message : String(err)}`, "info");
      handlers.onDone("failed");
      return "failed";
    }
  }

  async remove(target: SshTarget, sshPort: number, handlers: SingBoxInstallHandlers): Promise<DeployStatus> {
    handlers.onLog("▶ Выключение VPN-клиента", "info");
    try {
      const command = `DD_SSH_PORT="${sshPort}" bash -s`;
      const code = await this.ssh.execStream(target, `${command} <<'DDEOF'\n${REMOVE_CMD}\nDDEOF`, {
        onStdout: (line) => handlers.onLog(line, "stdout"),
        onStderr: (line) => handlers.onLog(line, "stderr"),
      });
      const status: DeployStatus = code === 0 ? "success" : "failed";
      handlers.onLog(code === 0 ? "✔ VPN-клиент выключен" : `✖ Выключение завершилось с кодом ${code}`, "info");
      handlers.onDone(status);
      return status;
    } catch (err) {
      handlers.onLog(`✖ Ошибка: ${err instanceof Error ? err.message : String(err)}`, "info");
      handlers.onDone("failed");
      return "failed";
    }
  }

  /** Текущий внешний IP сервера (для проверки в UI, что трафик идёт через VPN). */
  async getExternalIp(target: SshTarget): Promise<string | null> {
    const info = await this.getExitInfo(target);
    return info.ip;
  }

  /**
   * Внешний IP сервера + гео (страна/провайдер) одним SSH-вызовом через ipinfo.io.
   * Запрос идёт С СЕРВЕРА — то есть через VPN-туннель, если он поднят. По стране/IP
   * пользователь видит, что трафик реально вышел через нужную локацию.
   */
  async getExitInfo(
    target: SshTarget,
  ): Promise<{ ip: string | null; country: string | null; org: string | null }> {
    try {
      // ipinfo.io/json отдаёт {ip, country, org, ...}; fallback на ifconfig.me (только IP).
      const res = await this.ssh.exec(
        target,
        "curl -fsS --max-time 12 https://ipinfo.io/json 2>/dev/null || (echo -n '{\"ip\":\"'; curl -fsS --max-time 12 https://api.ipify.org 2>/dev/null; echo '\"}')",
      );
      const text = res.stdout.trim();
      if (!text) return { ip: null, country: null, org: null };
      const parsed = JSON.parse(text) as { ip?: string; country?: string; org?: string };
      return {
        ip: parsed.ip?.trim() || null,
        country: parsed.country?.trim() || null,
        org: parsed.org?.trim() || null,
      };
    } catch {
      return { ip: null, country: null, org: null };
    }
  }

  /**
   * Проверяет доступность популярных сервисов С СЕРВЕРА (через VPN, если поднят).
   * Один SSH-вызов: для каждого сервиса curl с коротким таймаутом → HTTP-код.
   * reachable=true, если код не пустой и не 000 (000 = соединение не установлено).
   */
  async checkServices(target: SshTarget): Promise<{ name: string; reachable: boolean; detail: string }[]> {
    const services: { name: string; url: string }[] = [
      { name: "ChatGPT", url: "https://chatgpt.com" },
      { name: "Claude", url: "https://claude.ai" },
      { name: "Telegram", url: "https://api.telegram.org" },
    ];
    // Один батч: на каждый сервис печатаем "name<TAB>http_code".
    // ВАЖНО: без -f. С -f curl падает на не-2xx, и тогда вывод %{http_code} склеивается
    // с фолбэком "000" (получалось "302000"). Без -f curl всегда exit 0 и печатает
    // чистый код; недоступность даёт код "000" сам curl (соединение не установлено).
    const cmd = services
      .map(
        (s) =>
          `printf '%s\\t' '${s.name}'; curl -s -o /dev/null -L --max-time 10 -w '%{http_code}' '${s.url}' 2>/dev/null; printf '\\n'`,
      )
      .join("; ");
    try {
      const res = await this.ssh.exec(target, cmd);
      const byName = new Map<string, string>();
      for (const line of res.stdout.split("\n")) {
        const [name, code] = line.split("\t");
        if (name) byName.set(name.trim(), (code ?? "").trim());
      }
      return services.map((s) => {
        const code = byName.get(s.name) ?? "000";
        const reachable = code !== "" && code !== "000";
        return {
          name: s.name,
          reachable,
          detail: reachable ? `HTTP ${code}` : "недоступен",
        };
      });
    } catch {
      return services.map((s) => ({ name: s.name, reachable: false, detail: "ошибка проверки" }));
    }
  }
}
