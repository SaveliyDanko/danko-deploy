import { deployKeySchema, generateSshKeySchema, importSshKeySchema } from "@dankodeploy/shared";
import type { FastifyInstance } from "fastify";

import type { AppContext } from "../context.js";

export function registerKeyRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/keys", () => ctx.keys.list());

  // Сгенерировать новую пару. Сбой ssh-keygen → бросаем: глобальный error-handler
  // залогирует детали на сервере и отдаст клиенту безопасный общий текст (без утечки).
  app.post("/api/keys/generate", async (req, reply) => {
    const parsed = generateSshKeySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return ctx.keys.generate(parsed.data);
  });

  // Импортировать существующий приватный ключ
  app.post("/api/keys/import", async (req, reply) => {
    const parsed = importSshKeySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      return await ctx.keys.import(parsed.data);
    } catch (err) {
      return reply.status(400).send({
        error: `Не удалось разобрать ключ: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  app.delete("/api/keys/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.keys.delete(id)) return reply.status(404).send({ error: "Ключ не найден" });
    return { ok: true };
  });

  // Развернуть публичный ключ на сервер (добавить в authorized_keys)
  app.post("/api/keys/:id/deploy", async (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = deployKeySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const result = await ctx.keys.deployToServer(id, parsed.data.serverId);
    if (!result) return reply.status(404).send({ error: "Ключ не найден" });
    return result;
  });
}
