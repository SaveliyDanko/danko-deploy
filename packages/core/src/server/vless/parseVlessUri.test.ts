import { describe, expect, it } from "vitest";

import {
  decodeSubscription,
  parseSubscriptionNodes,
  parseSubscriptionServers,
  parseVlessUri,
} from "./parseVlessUri.js";

/**
 * Реалистичный VLESS+REALITY+gRPC URI (как у провайдеров под Happ/Hiddify).
 * Значения вымышлены, структура соответствует реальной подписке.
 */
const REALITY_GRPC =
  "vless://11111111-2222-3333-4444-555555555555@host.example.com:23356" +
  "?encryption=none&type=grpc&serviceName=api&mode=gun&security=reality" +
  "&sni=www.microsoft.com&fp=chrome&pbk=PUBKEY123&sid=ab12#%F0%9F%87%B1%F0%9F%87%BB%20%D0%9B%D0%B0%D1%82%D0%B2%D0%B8%D1%8F";

/** TCP-узел без transport (другой кейс ветвления в конфиге). */
const TCP_PLAIN =
  "vless://aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee@tcp.example.com:443" +
  "?encryption=none&type=tcp&security=reality&sni=example.org&pbk=PK2&sid=cd34#%F0%9F%87%B8%F0%9F%87%AA%20Sweden";

/** Собирает base64-тело подписки из массива URI (как отдаёт провайдер). */
function makeSubscription(uris: string[]): string {
  return Buffer.from(uris.join("\n"), "utf8").toString("base64");
}

describe("decodeSubscription", () => {
  it("декодирует base64 и отдаёт только vless:// строки", () => {
    const body = makeSubscription([REALITY_GRPC, TCP_PLAIN]);
    expect(decodeSubscription(body)).toHaveLength(2);
  });

  it("отфильтровывает пустые строки и мусор", () => {
    const body = Buffer.from(
      `\n${REALITY_GRPC}\n\n# comment\nhttps://not-vless\n${TCP_PLAIN}\n`,
      "utf8",
    ).toString("base64");
    const lines = decodeSubscription(body);
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.startsWith("vless://"))).toBe(true);
  });

  it("пустое тело → пустой список (не падает)", () => {
    expect(decodeSubscription("")).toEqual([]);
  });
});

describe("parseVlessUri", () => {
  it("разбирает REALITY+gRPC узел полностью", () => {
    const n = parseVlessUri(REALITY_GRPC);
    expect(n.uuid).toBe("11111111-2222-3333-4444-555555555555");
    expect(n.server).toBe("host.example.com");
    expect(n.serverPort).toBe(23356);
    expect(n.type).toBe("grpc");
    expect(n.security).toBe("reality");
    expect(n.sni).toBe("www.microsoft.com");
    expect(n.fingerprint).toBe("chrome");
    expect(n.publicKey).toBe("PUBKEY123");
    expect(n.shortId).toBe("ab12");
    expect(n.serviceName).toBe("api");
  });

  it("декодирует человекочитаемую метку локации из #fragment", () => {
    expect(parseVlessUri(REALITY_GRPC).label).toBe("🇱🇻 Латвия");
  });

  it("дефолты для отсутствующих параметров (fp=chrome, security=none, type=tcp)", () => {
    const minimal = "vless://uuid@h.example:443#Plain";
    const n = parseVlessUri(minimal);
    expect(n.type).toBe("tcp");
    expect(n.security).toBe("none");
    expect(n.fingerprint).toBe("chrome");
    expect(n.flow).toBe("");
  });

  it("без #fragment label берётся из host:port", () => {
    const n = parseVlessUri("vless://uuid@h.example:8443?security=reality");
    expect(n.label).toBe("h.example:8443");
  });
});

describe("parseSubscriptionServers (публичный список без секретов)", () => {
  it("отдаёт label/host/port/index, НЕ светит uuid/ключи", () => {
    const body = makeSubscription([REALITY_GRPC, TCP_PLAIN]);
    const servers = parseSubscriptionServers(body);
    expect(servers).toHaveLength(2);
    expect(servers[0]).toEqual({
      label: "🇱🇻 Латвия",
      host: "host.example.com",
      port: 23356,
      protocol: "vless",
      index: 0,
    });
    // Защита приватности: в публичном объекте не должно быть секретных полей.
    expect(JSON.stringify(servers)).not.toContain("11111111");
    expect(JSON.stringify(servers)).not.toContain("PUBKEY123");
  });

  it("index уникален даже при одинаковых label", () => {
    const dup = makeSubscription([REALITY_GRPC, REALITY_GRPC]);
    const servers = parseSubscriptionServers(dup);
    expect(servers.map((s) => s.index)).toEqual([0, 1]);
  });
});

describe("parseSubscriptionNodes (полные узлы для конфига)", () => {
  it("сохраняет секреты для генерации sing-box конфига", () => {
    const nodes = parseSubscriptionNodes(makeSubscription([REALITY_GRPC]));
    expect(nodes[0]!.uuid).toBe("11111111-2222-3333-4444-555555555555");
    expect(nodes[0]!.publicKey).toBe("PUBKEY123");
  });
});
