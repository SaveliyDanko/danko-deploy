import type { DeployStatus } from "@dankodeploy/shared";

import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

/** Колбэки настройки SSH — сервер транслирует их в WS-канал deploy:<runId>. */
export interface SshHardeningHandlers {
  onLog: (line: string, stream: "stdout" | "stderr" | "info") => void;
  onDone: (status: DeployStatus) => void;
}

export interface SshHardeningOptions {
  /**
   * Отключать ли парольный вход (PasswordAuthentication no). Безопасно только когда
   * панель подключается по КЛЮЧУ — иначе можно отрезать себе доступ. Сервис
   * выставляет это лишь для серверов с authMethod key/stored-key.
   */
  disablePassword: boolean;
}

/**
 * Скрипт hardening. Ключевые принципы безопасности (чтобы не оборвать доступ панели):
 *  1. Все настройки кладём в ОТДЕЛЬНЫЙ drop-in `/etc/ssh/sshd_config.d/99-dankodeploy.conf`,
 *     не трогая основной sshd_config (его параметры имеют приоритет «первое значение»,
 *     поэтому drop-in подключается через `Include` в начале — на свежих Debian/Ubuntu так и есть).
 *  2. Перед применением — `sshd -t` (проверка синтаксиса). Если конфиг битый — удаляем
 *     drop-in и выходим с ошибкой, sshd не перезагружаем.
 *  3. Применяем `reload` (НЕ restart) — существующие соединения (включая текущее) не рвутся.
 *  4. PasswordAuthentication no добавляется ТОЛЬКО если PASSWORD_OFF=1 (см. опции).
 *
 * Плейсхолдер __PASSWORD_OFF__ подставляется сервисом ("1"/"0").
 */
const HARDEN_CMD = String.raw`
set -e

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else
  if ! command -v sudo >/dev/null 2>&1 || ! sudo -n true 2>/dev/null; then
    echo "Нужен root или passwordless sudo."; exit 1
  fi
  SUDO="sudo -n"
fi

PASSWORD_OFF=__PASSWORD_OFF__
DROPDIR=/etc/ssh/sshd_config.d
CONF=$DROPDIR/99-dankodeploy.conf

if ! command -v sshd >/dev/null 2>&1; then
  SSHD=$(command -v sshd || echo /usr/sbin/sshd)
else
  SSHD=sshd
fi

# Проверяем, что основной конфиг подключает drop-in каталог (иначе наш файл не применится).
if ! grep -rqs "sshd_config.d/\*.conf" /etc/ssh/sshd_config; then
  echo "⚠ /etc/ssh/sshd_config не содержит Include для sshd_config.d — добавляю в начало."
  $SUDO cp -a /etc/ssh/sshd_config /etc/ssh/sshd_config.preinclude.bak || true
  { echo "Include /etc/ssh/sshd_config.d/*.conf"; cat /etc/ssh/sshd_config; } | $SUDO tee /etc/ssh/sshd_config.tmp >/dev/null
  $SUDO mv /etc/ssh/sshd_config.tmp /etc/ssh/sshd_config
fi

echo "▶ Резервная копия sshd_config…"
$SUDO cp -a /etc/ssh/sshd_config "/etc/ssh/sshd_config.dankodeploy.bak.$(date +%s)" || true
$SUDO mkdir -p "$DROPDIR"

# Бэкап предыдущего нашего drop-in (для отката при битом конфиге).
if [ -f "$CONF" ]; then $SUDO cp -a "$CONF" "$CONF.bak" || true; fi

echo "▶ Пишу настройки в $CONF…"
# heredoc собирается локально, пишем атомарно через временный файл от root.
{
  echo "# Управляется DankoDeploy. Не редактируйте вручную — будет перезаписан."
  echo "# Меньше обрывов под нагрузкой/атакой:"
  echo "MaxStartups 30:50:100"
  echo "MaxSessions 20"
  echo "LoginGraceTime 20"
  echo "# sshd сам рвёт зависшие сессии раньше (меньше мёртвых каналов):"
  echo "ClientAliveInterval 30"
  echo "ClientAliveCountMax 3"
  if [ "$PASSWORD_OFF" = "1" ]; then
    echo "# Вход только по ключу (панель подключается по ключу):"
    echo "PasswordAuthentication no"
    echo "KbdInteractiveAuthentication no"
    echo "ChallengeResponseAuthentication no"
  fi
} | $SUDO tee "$CONF" >/dev/null

echo "▶ Проверка конфигурации sshd -t…"
if ! $SUDO "$SSHD" -t 2>/tmp/dankodeploy-sshd-test.err; then
  echo "✖ sshd -t не прошёл — откатываю изменения, sshd НЕ перезагружаю:"
  cat /tmp/dankodeploy-sshd-test.err || true
  if [ -f "$CONF.bak" ]; then $SUDO mv "$CONF.bak" "$CONF"; else $SUDO rm -f "$CONF"; fi
  rm -f /tmp/dankodeploy-sshd-test.err
  exit 1
fi
rm -f "$CONF.bak" /tmp/dankodeploy-sshd-test.err 2>/dev/null || true

echo "▶ Применяю (reload — текущее соединение не рвётся)…"
if command -v systemctl >/dev/null 2>&1; then
  $SUDO systemctl reload ssh 2>/dev/null || $SUDO systemctl reload sshd 2>/dev/null || $SUDO systemctl restart ssh 2>/dev/null || true
else
  $SUDO service ssh reload 2>/dev/null || $SUDO service sshd reload 2>/dev/null || true
fi
echo "✔ Настройки SSH применены."

# fail2ban — автобан брутфорс-IP.
if command -v fail2ban-client >/dev/null 2>&1; then
  echo "fail2ban уже установлен."
else
  echo "▶ Устанавливаю fail2ban…"
  if command -v apt-get >/dev/null 2>&1; then
    $SUDO apt-get update && $SUDO apt-get install -y fail2ban
  elif command -v dnf >/dev/null 2>&1; then
    $SUDO dnf install -y fail2ban
  elif command -v yum >/dev/null 2>&1; then
    $SUDO yum install -y fail2ban
  else
    echo "⚠ Не нашёл apt/dnf/yum — пропускаю установку fail2ban."
  fi
fi

# Базовый jail для sshd (минимальный, если ещё не настроен).
if command -v fail2ban-client >/dev/null 2>&1; then
  if [ ! -f /etc/fail2ban/jail.d/dankodeploy-sshd.conf ]; then
    printf '[sshd]\nenabled = true\nmaxretry = 5\nbantime = 1h\nfindtime = 10m\n' | $SUDO tee /etc/fail2ban/jail.d/dankodeploy-sshd.conf >/dev/null
  fi
  $SUDO systemctl enable --now fail2ban 2>/dev/null || $SUDO service fail2ban restart 2>/dev/null || true
  $SUDO fail2ban-client reload 2>/dev/null || true
  echo "✔ fail2ban активен (jail sshd)."
fi

echo ""
echo "Итоговая конфигурация $CONF:"
$SUDO cat "$CONF"
`;

/**
 * Применяет рекомендуемые настройки SSH-сервера (hardening) по SSH:
 * лимиты подключений, keepalive, fail2ban и (опционально) запрет парольного входа.
 * Делает бэкап, валидирует `sshd -t`, применяет через reload — текущее соединение не рвётся.
 */
export class SshHardeningInstaller {
  constructor(private readonly ssh: SshExecutor) {}

  async run(
    target: SshTarget,
    opts: SshHardeningOptions,
    handlers: SshHardeningHandlers,
  ): Promise<DeployStatus> {
    handlers.onLog("▶ Настройка SSH-сервера (лимиты, keepalive, fail2ban)", "info");
    handlers.onLog("Требуется root или passwordless sudo у SSH-пользователя.", "info");
    if (opts.disablePassword) {
      handlers.onLog("Парольный вход будет отключён (панель подключается по ключу).", "info");
    } else {
      handlers.onLog(
        "Парольный вход НЕ трогаем (сервер подключён не по ключу — чтобы не отрезать доступ).",
        "info",
      );
    }

    const cmd = HARDEN_CMD.replace("__PASSWORD_OFF__", opts.disablePassword ? "1" : "0");

    try {
      const code = await this.ssh.execStream(target, cmd, {
        onStdout: (line) => handlers.onLog(line, "stdout"),
        onStderr: (line) => handlers.onLog(line, "stderr"),
      });
      if (code !== 0) {
        handlers.onLog(`✖ Настройка SSH завершилась с кодом ${code}`, "info");
        handlers.onDone("failed");
        return "failed";
      }
      handlers.onLog("\n✔ Настройка SSH завершена", "info");
      handlers.onDone("success");
      return "success";
    } catch (err) {
      handlers.onLog(`✖ Ошибка: ${err instanceof Error ? err.message : String(err)}`, "info");
      handlers.onDone("failed");
      return "failed";
    }
  }
}
