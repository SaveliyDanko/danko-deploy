import { describe, expect, it } from "vitest";

import { buildSingBoxConfig } from "./buildSingBoxConfig.js";
import type { VlessNode } from "./parseVlessUri.js";

/** Базовый REALITY+gRPC узел для тестов. */
const grpcNode: VlessNode = {
  label: "🇱🇻 Латвия",
  server: "host.example.com",
  serverPort: 23356,
  uuid: "11111111-2222-3333-4444-555555555555",
  type: "grpc",
  security: "reality",
  sni: "www.microsoft.com",
  fingerprint: "chrome",
  publicKey: "PUBKEY123",
  shortId: "ab12",
  flow: "",
  serviceName: "api",
};

 
function build(node: VlessNode, sshPort = 22): any {
  return buildSingBoxConfig(node, { sshPort });
}

describe("buildSingBoxConfig — общая структура", () => {
  it("есть TUN inbound с auto_route", () => {
    const cfg = build(grpcNode);
    expect(cfg.inbounds[0].type).toBe("tun");
    expect(cfg.inbounds[0].auto_route).toBe(true);
    expect(cfg.route.final).toBe("proxy");
  });

  it("новый формат DNS (sing-box ≥1.12): type+server, НЕ legacy address", () => {
    // Этот баг реально ронял раскатку на sing-box 1.13 (FATAL legacy DNS servers).
    const dns = build(grpcNode).dns.servers[0];
    expect(dns.type).toBe("udp");
    expect(dns.server).toBeTruthy();
    expect(dns).not.toHaveProperty("address");
  });
});

describe("buildSingBoxConfig — защита SSH (критический инвариант)", () => {
  it("есть route-правило source_port:[SSH]→direct (не port!)", () => {
    const cfg = build(grpcNode, 2222);
    const rule = cfg.route.rules.find(
      (r: { source_port?: number[] }) => Array.isArray(r.source_port) && r.source_port.includes(2222),
    );
    expect(rule).toBeDefined();
    expect(rule.outbound).toBe("direct");
    // Ключевая деталь: именно source_port (ответ sshd), а не port (назначение).
    expect(rule).not.toHaveProperty("port");
  });

  it("SSH-порт берётся из параметра, не хардкод 22", () => {
    const cfg = build(grpcNode, 49222);
    const rule = cfg.route.rules.find(
      (r: { source_port?: number[] }) => Array.isArray(r.source_port),
    );
    expect(rule.source_port).toEqual([49222]);
  });
});

describe("buildSingBoxConfig — VLESS/REALITY outbound", () => {
  it("REALITY: public_key/short_id/utls проброшены верно", () => {
    const proxy = build(grpcNode).outbounds.find((o: { tag: string }) => o.tag === "proxy");
    expect(proxy.type).toBe("vless");
    expect(proxy.uuid).toBe(grpcNode.uuid);
    expect(proxy.tls.enabled).toBe(true);
    expect(proxy.tls.server_name).toBe("www.microsoft.com");
    expect(proxy.tls.reality.enabled).toBe(true);
    expect(proxy.tls.reality.public_key).toBe("PUBKEY123");
    expect(proxy.tls.reality.short_id).toBe("ab12");
    expect(proxy.tls.utls.fingerprint).toBe("chrome");
  });

  it("gRPC: transport с service_name", () => {
    const proxy = build(grpcNode).outbounds.find((o: { tag: string }) => o.tag === "proxy");
    expect(proxy.transport).toEqual({ type: "grpc", service_name: "api" });
  });

  it("TCP-узел: блок transport ОТСУТСТВУЕТ (sing-box иначе ругается)", () => {
    const tcpNode: VlessNode = { ...grpcNode, type: "tcp", serviceName: "" };
    const proxy = build(tcpNode).outbounds.find((o: { tag: string }) => o.tag === "proxy");
    expect(proxy.transport).toBeUndefined();
  });

  it("flow добавляется только если задан", () => {
    const withoutFlow = build(grpcNode).outbounds.find((o: { tag: string }) => o.tag === "proxy");
    expect(withoutFlow).not.toHaveProperty("flow");

    const withFlow = build({ ...grpcNode, flow: "xtls-rprx-vision" }).outbounds.find(
      (o: { tag: string }) => o.tag === "proxy",
    );
    expect(withFlow.flow).toBe("xtls-rprx-vision");
  });

  it("security=tls (без reality): tls включён, reality отсутствует", () => {
    const tlsNode: VlessNode = { ...grpcNode, security: "tls" };
    const proxy = build(tlsNode).outbounds.find((o: { tag: string }) => o.tag === "proxy");
    expect(proxy.tls.enabled).toBe(true);
    expect(proxy.tls.reality).toBeUndefined();
  });

  it("есть direct outbound (для SSH-исключения и приватных сетей)", () => {
    const cfg = build(grpcNode);
    expect(cfg.outbounds.some((o: { type: string }) => o.type === "direct")).toBe(true);
  });
});

describe("buildSingBoxConfig — валидность JSON", () => {
  it("результат сериализуется в JSON без потерь", () => {
    const cfg = build(grpcNode);
    expect(() => JSON.parse(JSON.stringify(cfg))).not.toThrow();
  });
});
