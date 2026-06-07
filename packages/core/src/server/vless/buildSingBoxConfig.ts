import type { VlessNode } from "./parseVlessUri.js";

/** Параметры генерации конфига sing-box. */
export interface SingBoxConfigOptions {
  /** SSH-порт сервера — исключается из туннеля (защита доступа панели). */
  sshPort: number;
}

/**
 * Генерирует конфиг sing-box (≥1.11) для режима «весь трафик через VPN».
 * TUN inbound с auto_route + выбранный vless-outbound. КРИТИЧНО: ответы локального
 * sshd (source_port = sshPort) уходят direct мимо туннеля — иначе панель потеряет SSH.
 * Это второй уровень защиты; первый (kernel ip-rule по fwmark) ставит SingBoxInstaller.
 */
export function buildSingBoxConfig(node: VlessNode, opts: SingBoxConfigOptions): object {
  const proxy: Record<string, unknown> = {
    type: "vless",
    tag: "proxy",
    server: node.server,
    server_port: node.serverPort,
    uuid: node.uuid,
  };
  if (node.flow) proxy.flow = node.flow;

  // TLS/REALITY: для security=reality поднимаем reality+utls; для tls — обычный TLS.
  if (node.security === "reality" || node.security === "tls") {
    const tls: Record<string, unknown> = {
      enabled: true,
      server_name: node.sni,
      utls: { enabled: true, fingerprint: node.fingerprint || "chrome" },
    };
    if (node.security === "reality") {
      tls.reality = { enabled: true, public_key: node.publicKey, short_id: node.shortId };
    }
    proxy.tls = tls;
  }

  // transport только для не-tcp (grpc/ws); для tcp sing-box не ждёт блок transport.
  if (node.type && node.type !== "tcp") {
    const transport: Record<string, unknown> = { type: node.type };
    if (node.type === "grpc" && node.serviceName) transport.service_name = node.serviceName;
    proxy.transport = transport;
  }

  return {
    log: { level: "info" },
    // Новый формат DNS-серверов (sing-box ≥1.12): {type, server} вместо legacy {address}.
    // Старый формат с 1.13 фатально отклоняется без ENABLE_DEPRECATED_LEGACY_DNS_SERVERS.
    dns: {
      servers: [{ tag: "dns-remote", type: "udp", server: "1.1.1.1" }],
    },
    inbounds: [
      {
        type: "tun",
        tag: "tun-in",
        address: ["172.19.0.1/30", "fdfe:dcba:9876::1/126"],
        auto_route: true,
        auto_redirect: false,
        strict_route: false,
        stack: "system",
      },
    ],
    outbounds: [
      proxy,
      { type: "direct", tag: "direct" },
    ],
    route: {
      auto_detect_interface: true,
      rules: [
        { action: "sniff" },
        { protocol: "dns", action: "hijack-dns" },
        // КРИТИЧНО: ответы локального sshd (source_port = SSH-порт) → direct, мимо VPN.
        { inbound: ["tun-in"], source_port: [opts.sshPort], outbound: "direct" },
        // Локальные/приватные сети — мимо туннеля.
        { ip_is_private: true, outbound: "direct" },
      ],
      final: "proxy",
    },
  };
}
