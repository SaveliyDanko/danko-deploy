import type { VpnClientServer } from "@dankodeploy/shared";

/**
 * Распарсенный VLESS-узел из subscription-ссылки. Содержит СЕКРЕТЫ (uuid, reality-ключи),
 * поэтому наружу (во фронт) не отдаётся — только в core/server для генерации конфига.
 */
export interface VlessNode {
  label: string;
  server: string;
  serverPort: number;
  uuid: string;
  /** Транспорт: tcp | grpc | ws (из ?type=) */
  type: string;
  /** security: reality | tls | none */
  security: string;
  sni: string;
  /** uTLS fingerprint (?fp=), напр. chrome */
  fingerprint: string;
  /** REALITY public key (?pbk=) */
  publicKey: string;
  /** REALITY short id (?sid=) */
  shortId: string;
  /** flow (?flow=), напр. xtls-rprx-vision */
  flow: string;
  /** serviceName для grpc (?serviceName=) */
  serviceName: string;
}

/**
 * Декодирует тело subscription (base64) в список строк-URI.
 * Провайдер отдаёт base64 от текста, где каждая строка — один vless://-URI.
 */
export function decodeSubscription(body: string): string[] {
  const decoded = Buffer.from(body.trim(), "base64").toString("utf8");
  return decoded
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("vless://"));
}

/**
 * Парсит один vless://-URI в VlessNode через стандартный URL-парсер.
 * Формат: vless://<uuid>@<host>:<port>?<params>#<label>
 */
export function parseVlessUri(uri: string): VlessNode {
  const url = new URL(uri);
  const p = url.searchParams;
  return {
    label: url.hash ? decodeURIComponent(url.hash.slice(1)) : `${url.hostname}:${url.port}`,
    server: url.hostname,
    serverPort: Number(url.port),
    uuid: decodeURIComponent(url.username),
    type: p.get("type") ?? "tcp",
    security: p.get("security") ?? "none",
    sni: p.get("sni") ?? "",
    fingerprint: p.get("fp") ?? "chrome",
    publicKey: p.get("pbk") ?? "",
    shortId: p.get("sid") ?? "",
    flow: p.get("flow") ?? "",
    serviceName: p.get("serviceName") ?? "",
  };
}

/**
 * Парсит всю подписку в публичный список серверов (БЕЗ секретов) для выбора в UI.
 * index — порядковый номер (label'ы могут совпадать).
 */
export function parseSubscriptionServers(body: string): VpnClientServer[] {
  return decodeSubscription(body).map((uri, index) => {
    const node = parseVlessUri(uri);
    return {
      label: node.label,
      host: node.server,
      port: node.serverPort,
      protocol: "vless" as const,
      index,
    };
  });
}

/** Парсит подписку в полные узлы (с секретами) — для генерации конфига на бэке. */
export function parseSubscriptionNodes(body: string): VlessNode[] {
  return decodeSubscription(body).map(parseVlessUri);
}
