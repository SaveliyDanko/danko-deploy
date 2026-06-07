import type { VpnReadinessCheck } from "@dankodeploy/shared";

import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

const SEP = "===DANKO_VPNC_SEP===";

/**
 * Батч-команда readiness для VPN-клиента (sing-box): каждый блок печатает
 * машинно-читаемый результат, разделитель SEP.
 */
const READINESS_CMD = [
  `if [ "$(id -u)" -eq 0 ]; then echo "root"; elif sudo -n true 2>/dev/null; then echo "sudo"; else echo "no"; fi`,
  `echo "${SEP}"`,
  `(command -v curl >/dev/null 2>&1 || command -v wget >/dev/null 2>&1) && echo "yes" || echo "no"`,
  `echo "${SEP}"`,
  // /dev/net/tun — критично для TUN-режима.
  `([ -c /dev/net/tun ] || modprobe tun 2>/dev/null) && [ -c /dev/net/tun ] && echo "yes" || echo "no"`,
  `echo "${SEP}"`,
  `command -v systemctl >/dev/null 2>&1 && echo "yes" || echo "no"`,
  `echo "${SEP}"`,
  // iptables + ip — нужны для kernel-страховки SSH.
  `(command -v iptables >/dev/null 2>&1 && command -v ip >/dev/null 2>&1) && echo "yes" || echo "no"`,
  `echo "${SEP}"`,
  "systemd-detect-virt 2>/dev/null || echo unknown",
].join(" && ");

function block(out: string, index: number): string {
  return (out.split(SEP)[index] ?? "").trim();
}

/**
 * Проверяет готовность сервера к VPN-клиенту (sing-box + TUN) по SSH.
 * Главные блокеры: нет /dev/net/tun (OpenVZ/контейнер) или нет root/sudo.
 */
export class VpnClientReadinessChecker {
  constructor(private readonly ssh: SshExecutor) {}

  async check(target: SshTarget): Promise<VpnReadinessCheck[]> {
    const res = await this.ssh.exec(target, READINESS_CMD);
    const out = res.stdout;

    const priv = block(out, 0);
    const fetcher = block(out, 1);
    const tun = block(out, 2);
    const systemd = block(out, 3);
    const netTools = block(out, 4);
    const virt = block(out, 5);

    const virtBad = ["openvz", "lxc"].includes(virt.toLowerCase());

    return [
      {
        name: "privilege",
        label: "Root или passwordless sudo",
        ok: priv === "root" || priv === "sudo",
        detail: priv === "no" ? "нет root/sudo — установка невозможна" : priv,
      },
      {
        name: "tun",
        label: "Доступен /dev/net/tun (нужен для туннеля)",
        ok: tun === "yes",
        detail: tun === "yes" ? "доступен" : "нет TUN — сервер не поддерживает VPN-клиент (OpenVZ?)",
      },
      {
        name: "fetcher",
        label: "curl/wget для установки sing-box",
        ok: fetcher === "yes",
        detail: fetcher === "yes" ? "найден" : "не найден ни curl, ни wget",
      },
      {
        name: "systemd",
        label: "systemd (для службы sing-box)",
        ok: systemd === "yes",
        detail: systemd === "yes" ? "есть" : "нет systemctl",
      },
      {
        name: "nettools",
        label: "iptables/ip (для защиты SSH от туннеля)",
        ok: netTools === "yes",
        detail: netTools === "yes" ? "есть" : "нет iptables/ip — нельзя защитить SSH",
      },
      {
        name: "virt",
        label: "Виртуализация совместима с TUN",
        ok: !virtBad,
        detail: virtBad ? `${virt}: TUN часто запрещён` : virt === "unknown" ? "не определено" : virt,
      },
    ];
  }
}
