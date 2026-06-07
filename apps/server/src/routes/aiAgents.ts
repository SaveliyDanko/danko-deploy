import { createAiAgentSchema } from "@dankodeploy/shared";
import type { FastifyInstance } from "fastify";

import { toAiAgentPublic } from "../services/AiAgentService.js";
import type { AppContext } from "../context.js";

export function registerAiAgentRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/ai/agents", () => ctx.aiAgents.list());

  app.post("/api/ai/agents", (req, reply) => {
    const parsed = createAiAgentSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return ctx.aiAgents.create(parsed.data);
  });

  app.delete("/api/ai/agents/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.aiAgents.delete(id)) return reply.status(404).send({ error: "Агент не найден" });
    return { ok: true };
  });

  // Установка/запуск агента (фоном; лог в WS-канал ai:<id>)
  app.post("/api/ai/agents/:id/deploy", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.aiAgents.deploy(id);
    if ("error" in result) return reply.status(400).send(result);
    return result;
  });

  // Удаление CLI агента с сервера (фоном; лог в WS-канал ai:<id>)
  app.post("/api/ai/agents/:id/uninstall", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.aiAgents.uninstall(id);
    if ("error" in result) return reply.status(400).send(result);
    return result;
  });

  app.post("/api/ai/agents/:id/start", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await ctx.aiAgents.start(id);
    if ("error" in result) return reply.status(400).send(result);
    return result;
  });

  app.post("/api/ai/agents/:id/stop", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await ctx.aiAgents.stop(id);
    if ("error" in result) return reply.status(400).send(result);
    return result;
  });

  app.get("/api/ai/agents/:id/status", async (req, reply) => {
    const { id } = req.params as { id: string };
    const agent = ctx.aiAgents.get(id);
    if (!agent) return reply.status(404).send({ error: "Агент не найден" });
    const status = await ctx.aiAgents.sessionStatus(id);
    return { status, agent: toAiAgentPublic(agent) };
  });
}
