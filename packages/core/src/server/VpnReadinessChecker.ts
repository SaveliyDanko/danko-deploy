import type { VpnReadinessCheck } from "@dankodeploy/shared";

import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

/**
 * Разделитель блоков вывода — собираем все проверки готовности ОДНОЙ ssh-командой
 * (как MetricsCollector), чтобы не открывать несколько сессий.
 */
const SEP = "===DANKO_VPN_SEP===";

/**
 * Батч-команда readiness: каждый блок печатает машинно-читаемый результат.
 * `|| true` — чтобы отсутствие чего-либо не роняло всю команду.
 */
const READINESS_CMD = [
  // root или passwordless sudo (нужно для install-скрипта Outline).
  `if [ "$(id -u)" -eq 0 ]; then echo "root"; elif sudo -n true 2>/dev/null; then echo "sudo"; else echo "no"; fi`,
  `echo "${SEP}"`,
  // Доступен ли Docker (Outline ставит сам, но если уже есть — хорошо).
  `command -v docker >/dev/null 2>&1 && echo "yes" || echo "no"`,
  `echo "${SEP}"`,
  // curl или wget — нужен для загрузки install-скрипта.
  `(command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1) && echo "yes" || echo "no"`,
  `echo "${SEP}"`,
  // Архитектура (Outline официально поддерживает x86_64/arm64).
  "uname -m",
  `echo "${SEP}"`,
  // Виртуализация: внутри OpenVZ/LXC Docker часто не поднимается. systemd-detect-virt best-effort.
  "systemd-detect-virt 2>/dev/null || echo unknown",
].join(" && ");

/** Достаёт блок по индексу из вывода, разбитого маркером SEP. */
function block(out: string, index: number): string {
  return (out.split(SEP)[index] ?? "").trim();
}

/**
 * Проверяет техническую готовность сервера к раскатке Outline по SSH.
 * Возвращает список булевых проверок (root/docker/curl/arch/virt) с пояснениями.
 */
export class VpnReadinessChecker {
  constructor(private readonly ssh: SshExecutor) {}

  async check(target: SshTarget): Promise<VpnReadinessCheck[]> {
    const res = await this.ssh.exec(target, READINESS_CMD);
    const out = res.stdout;

    const priv = block(out, 0); // root | sudo | no
    const docker = block(out, 1); // yes | no
    const fetcher = block(out, 2); // yes | no
    const arch = block(out, 3); // x86_64 | aarch64 | ...
    const virt = block(out, 4); // kvm | openvz | lxc | none | unknown

    const archOk = ["x86_64", "amd64", "aarch64", "arm64"].includes(arch);
    const virtBad = ["openvz", "lxc"].includes(virt.toLowerCase());

    return [
      {
        name: "privilege",
        label: "Root или passwordless sudo",
        ok: priv === "root" || priv === "sudo",
        detail:
          priv === "root"
            ? "пользователь root"
            : priv === "sudo"
              ? "доступен passwordless sudo"
              : "нет root/sudo — install-скрипт не сможет работать",
      },
      {
        name: "fetcher",
        label: "curl/wget для загрузки install-скрипта",
        ok: fetcher === "yes",
        detail: fetcher === "yes" ? "найден" : "не найден ни curl, ни wget",
      },
      {
        name: "arch",
        label: "Поддерживаемая архитектура",
        ok: archOk,
        detail: arch || "неизвестно",
      },
      {
        name: "virt",
        label: "Тип виртуализации совместим с Docker",
        ok: !virtBad,
        detail: virtBad
          ? `${virt}: контейнеры могут не подняться`
          : virt === "unknown"
            ? "не определено (обычно ок)"
            : virt || "bare metal/kvm",
      },
      {
        name: "docker",
        label: "Docker уже установлен",
        // Не обязателен (Outline ставит сам) — это информационная проверка.
        ok: true,
        detail: docker === "yes" ? "установлен" : "будет установлен install-скриптом",
      },
    ];
  }
}
