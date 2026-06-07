import { checkVpnReadinessSchema, createVpnInstallationSchema } from "@dankodeploy/shared";
import type { FastifyInstance } from "fastify";

import type { AppContext } from "../context.js";

export function registerVpnRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/vpn", () => ctx.vpn.list());

  app.get("/api/vpn/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const installation = ctx.vpn.getPublic(id);
    if (!installation) return reply.status(404).send({ error: "VPN-инсталляция не найдена" });
    return installation;
  });

  // Проверка готовности сервера к раскатке VPN (readiness-чек + текущие метрики).
  app.post("/api/vpn/readiness", async (req, reply) => {
    const parsed = checkVpnReadinessSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = await ctx.vpn.checkReadiness(parsed.data.serverId);
    if ("error" in result) return reply.status(404).send(result);
    return result;
  });

  // Раскатка VPN на сервер (фон; лог в WS-канал deploy:<runId>).
  app.post("/api/vpn", (req, reply) => {
    const parsed = createVpnInstallationSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = ctx.vpn.install(parsed.data.serverId, parsed.data);
    if ("error" in result) return reply.status(400).send(result);
    return result;
  });

  // Удаление VPN с сервера (фон; лог в WS-канал deploy:<runId>).
  app.delete("/api/vpn/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.vpn.remove(id);
    if ("error" in result) return reply.status(404).send(result);
    return result;
  });
}
