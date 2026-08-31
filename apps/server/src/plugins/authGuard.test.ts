import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { AppContext } from "../context.js";
import { generateAutomationToken, hashAutomationToken } from "../services/AutomationToken.js";
import { isAutomationPathAllowed, registerAuthGuard } from "./authGuard.js";

describe("isAutomationPathAllowed", () => {
  it("разрешает чтение контекста и операции деплоя", () => {
    expect(isAutomationPathAllowed("GET", "/api/projects/p1")).toBe(true);
    expect(isAutomationPathAllowed("GET", "/api/projects/p1/backups")).toBe(true);
    expect(isAutomationPathAllowed("GET", "/api/deployments/d1/deploys?limit=5")).toBe(true);
    expect(isAutomationPathAllowed("POST", "/api/deployments/d1/deploy")).toBe(true);
    expect(isAutomationPathAllowed("POST", "/api/deployments/d1/restore")).toBe(true);
    expect(isAutomationPathAllowed("POST", "/api/deployments/d1/env/deploy")).toBe(true);
  });

  it("запрещает секреты, администрирование и удаления", () => {
    expect(isAutomationPathAllowed("GET", "/api/projects/p1/env")).toBe(false);
    expect(isAutomationPathAllowed("GET", "/api/projects")).toBe(false);
    expect(isAutomationPathAllowed("GET", "/api/deployments")).toBe(false);
    expect(isAutomationPathAllowed("GET", "/api/servers")).toBe(false);
    expect(isAutomationPathAllowed("POST", "/api/keys/generate")).toBe(false);
    expect(isAutomationPathAllowed("DELETE", "/api/deployments/d1")).toBe(false);
  });

  it("принимает валидный Bearer только для allowlist", async () => {
    const token = generateAutomationToken();
    const app = Fastify();
    await app.register(cookie, { secret: "test-session-secret" });
    const ctx = {
      config: { authEnabled: true, automationTokenHash: hashAutomationToken(token) },
      auth: { validateSessionToken: () => false },
    } as unknown as AppContext;
    registerAuthGuard(app, ctx);
    app.get("/api/projects/:id", () => ({ ok: true }));
    app.get("/api/servers", () => ({ ok: true }));

    const allowed = await app.inject({
      method: "GET",
      url: "/api/projects/p1",
      headers: { authorization: `Bearer ${token}` },
    });
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/servers",
      headers: { authorization: `Bearer ${token}` },
    });
    const invalid = await app.inject({
      method: "GET",
      url: "/api/projects/p1",
      headers: { authorization: "Bearer ddp_invalid" },
    });

    expect(allowed.statusCode).toBe(200);
    expect(forbidden.statusCode).toBe(403);
    expect(invalid.statusCode).toBe(401);
    await app.close();
  });
});
