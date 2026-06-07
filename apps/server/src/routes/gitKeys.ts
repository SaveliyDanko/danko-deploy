import { generateGitKeySchema, importGitKeySchema } from "@dankodeploy/shared";
import type { FastifyInstance } from "fastify";

import type { AppContext } from "../context.js";

export function registerGitKeyRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/git-keys", () => ctx.gitKeys.list());

  // Сгенерировать новую пару deploy-ключей. Сбой ssh-keygen → бросаем:
  // глобальный error-handler логирует детали и отдаёт клиенту безопасный текст.
  app.post("/api/git-keys/generate", async (req, reply) => {
    const parsed = generateGitKeySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return ctx.gitKeys.generate(parsed.data);
  });

  // Импортировать существующий приватный ключ
  app.post("/api/git-keys/import", async (req, reply) => {
    const parsed = importGitKeySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    try {
      return await ctx.gitKeys.import(parsed.data);
    } catch (err) {
      return reply.status(400).send({
        error: `Не удалось разобрать ключ: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });

  app.delete("/api/git-keys/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.gitKeys.delete(id)) return reply.status(404).send({ error: "Ключ не найден" });
    return { ok: true };
  });
}
