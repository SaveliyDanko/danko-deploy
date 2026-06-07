import { createDeploymentSchema, restoreRequestSchema } from "@dankodeploy/shared";
import type { FastifyInstance } from "fastify";

import type { AppContext } from "../context.js";

function isRouteError(result: unknown): result is { error: string } {
  return (
    !!result &&
    typeof result === "object" &&
    "error" in result &&
    typeof (result).error === "string" &&
    !("status" in result)
  );
}

export function registerDeploymentRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Список всех деплоев или деплоев одного проекта (?projectId=).
  app.get("/api/deployments", (req) => {
    const { projectId } = req.query as { projectId?: string };
    return projectId ? ctx.deployments.listByProject(projectId) : ctx.deployments.list();
  });

  // Детальная сводка деплоя (проект + сервер + рантайм-статус по SSH).
  app.get("/api/deployments/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const detail = await ctx.deployments.detail(id);
    if (!detail) return reply.status(404).send({ error: "Деплой не найден" });
    return detail;
  });

  app.post("/api/deployments", (req, reply) => {
    const parsed = createDeploymentSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = ctx.deployments.create(parsed.data);
    if ("error" in result) return reply.status(400).send(result);
    ctx.scheduler.reload(); // у проекта появился деплой → расписание бэкапов
    return result;
  });

  app.delete("/api/deployments/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.deployments.delete(id)) return reply.status(404).send({ error: "Деплой не найден" });
    ctx.scheduler.reload();
    return { ok: true };
  });

  // --- Первичная раскатка (git clone) ---
  app.post("/api/deployments/:id/provision", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.provision.provision(id);
    if ("error" in result) return reply.status(400).send(result);
    return result; // { runId }
  });

  // --- Деплой / снятие ---
  app.post("/api/deployments/:id/deploy", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.deploys.start(id);
    if ("error" in result) return reply.status(400).send(result);
    return result; // { runId }
  });

  app.post("/api/deployments/:id/undeploy", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.deploys.undeploy(id);
    if ("error" in result) return reply.status(400).send(result);
    return result; // { runId }
  });

  app.get("/api/deployments/:id/deploys", (req) => {
    const { id } = req.params as { id: string };
    return ctx.deploys.history(id);
  });

  app.delete("/api/deployments/:id/deploys", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.deployments.get(id)) return reply.status(404).send({ error: "Деплой не найден" });
    return ctx.deploys.clearHistory(id);
  });

  // --- Бэкапы (запуск/восстановление на сервере этого деплоя) ---
  app.post("/api/deployments/:id/backup", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.backups.startRun(id);
    if (isRouteError(result)) return reply.status(400).send(result);
    return result;
  });

  app.post("/api/deployments/:id/restore", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = restoreRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = ctx.backups.startRestore(id, parsed.data.backupId, parsed.data.artifactNames);
    return result;
  });

  // --- Записать сохранённый .env проекта на сервер этого деплоя (<workdir>/.env, 600) ---
  app.post("/api/deployments/:id/env/deploy", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await ctx.env.deployToServer(id);
    if (!result.ok) return reply.status(400).send(result);
    return result;
  });
}
