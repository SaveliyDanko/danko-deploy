import { createReadStream } from "node:fs";
import { basename } from "node:path";

import {
  createProjectSchema,
  saveProjectEnvSchema,
  updateProjectSchema,
} from "@dankodeploy/shared";
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

export function registerProjectRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/projects", () => ctx.projects.list());

  app.get("/api/projects/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const project = ctx.projects.get(id);
    if (!project) return reply.status(404).send({ error: "Проект не найден" });
    return project;
  });

  app.post("/api/projects", (req, reply) => {
    const parsed = createProjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return ctx.projects.create(parsed.data);
  });

  app.patch("/api/projects/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateProjectSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const updated = ctx.projects.update(id, parsed.data);
    if (!updated) return reply.status(404).send({ error: "Проект не найден" });
    ctx.scheduler.reload(); // мог измениться backupCron
    return updated;
  });

  app.delete("/api/projects/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.projects.delete(id)) return reply.status(404).send({ error: "Проект не найден" });
    ctx.scheduler.reload(); // удалились деплои проекта → их расписания
    return { ok: true };
  });

  // --- Бэкапы (история на проекте, общая по всем деплоям) ---
  app.get("/api/projects/:id/backups", (req) => {
    const { id } = req.params as { id: string };
    return ctx.backups.history(id);
  });

  app.delete("/api/projects/:id/backups/:backupId", async (req, reply) => {
    const { id, backupId } = req.params as { id: string; backupId: string };
    const result = await ctx.backups.delete(id, backupId);
    if (isRouteError(result)) return reply.status(400).send(result);
    return result;
  });

  // Скачать файл артефакта бэкапа на ПК пользователя (стрим файла с машины панели).
  app.get("/api/projects/:id/backups/:backupId/artifacts/:name/download", (req, reply) => {
    const { id, backupId, name } = req.params as {
      id: string;
      backupId: string;
      name: string;
    };
    const resolved = ctx.backups.resolveArtifact(id, backupId, name);
    if (isRouteError(resolved)) return reply.status(404).send(resolved);

    // basename — на случай неожиданных символов в имени файла для заголовка.
    return reply
      .header("Content-Type", "application/octet-stream")
      .header(
        "Content-Disposition",
        `attachment; filename="${basename(resolved.filename)}"`,
      )
      .send(createReadStream(resolved.path));
  });

  // Загрузка файла бэкапа с ПК пользователя → сохраняется в историю проекта (uploaded=true).
  app.post("/api/projects/:id/backups/upload", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.projects.get(id)) return reply.status(404).send({ error: "Проект не найден" });

    const file = await req.file();
    if (!file) return reply.status(400).send({ error: "Файл не передан" });

    let data: Buffer;
    try {
      data = await file.toBuffer();
    } catch (err) {
      // Превышен лимит размера или ошибка чтения потока.
      return reply.status(400).send({
        error: `Не удалось прочитать файл: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    if (data.length === 0) return reply.status(400).send({ error: "Файл пуст" });

    const artifactField = file.fields.artifactName;
    const artifactName =
      artifactField && !Array.isArray(artifactField) && "value" in artifactField
        ? String(artifactField.value)
        : undefined;
    const result = await ctx.backups.saveUploaded(id, data, artifactName);
    if (isRouteError(result)) return reply.status(400).send(result);
    return result;
  });

  // --- Переменные окружения (.env) — хранятся на проекте (один шаблон) ---
  app.get("/api/projects/:id/env", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.projects.get(id)) return reply.status(404).send({ error: "Проект не найден" });
    return ctx.env.get(id);
  });

  app.put("/api/projects/:id/env", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.projects.get(id)) return reply.status(404).send({ error: "Проект не найден" });
    const parsed = saveProjectEnvSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return ctx.env.save(id, parsed.data.content);
  });
}
