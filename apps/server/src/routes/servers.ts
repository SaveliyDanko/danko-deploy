import { createServerSchema, updateServerSchema } from "@dankodeploy/shared";
import type { FastifyInstance } from "fastify";

import type { AppContext } from "../context.js";

export function registerServerRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/api/servers", () => ctx.servers.list());

  app.get("/api/servers/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const server = ctx.servers.getPublic(id);
    if (!server) return reply.status(404).send({ error: "Сервер не найден" });
    return server;
  });

  app.post("/api/servers", (req, reply) => {
    const parsed = createServerSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return ctx.servers.create(parsed.data);
  });

  app.patch("/api/servers/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    const parsed = updateServerSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    const updated = ctx.servers.update(id, parsed.data);
    if (!updated) return reply.status(404).send({ error: "Сервер не найден" });
    return updated;
  });

  app.delete("/api/servers/:id", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.servers.delete(id)) return reply.status(404).send({ error: "Сервер не найден" });
    return { ok: true };
  });

  // Проверка соединения с уже сохранённым сервером
  app.post("/api/servers/:id/test", async (req, reply) => {
    const { id } = req.params as { id: string };
    const result = await ctx.servers.testConnection(id);
    if (!result) return reply.status(404).send({ error: "Сервер не найден" });
    return result;
  });

  // Установка Docker Engine + Compose plugin на сохранённый сервер.
  app.post("/api/servers/:id/install-docker", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.serverSetup.installDocker(id);
    if ("error" in result) return reply.status(404).send(result);
    return result;
  });

  // Установка Node.js + npm на сохранённый сервер.
  app.post("/api/servers/:id/install-node", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.serverSetup.installNode(id);
    if ("error" in result) return reply.status(404).send(result);
    return result;
  });

  // Настройка SSH (hardening: лимиты подключений, keepalive, fail2ban, опц. запрет пароля).
  app.post("/api/servers/:id/harden-ssh", (req, reply) => {
    const { id } = req.params as { id: string };
    const result = ctx.serverSetup.hardenSsh(id);
    if ("error" in result) return reply.status(404).send(result);
    return result;
  });

  // Сброс запомненного host key (TOFU): после легитимного пересоздания сервера
  // следующее подключение запомнит новый ключ заново.
  app.post("/api/servers/:id/reset-host-key", (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.servers.forgetHostKey(id)) return reply.status(404).send({ error: "Сервер не найден" });
    return { ok: true };
  });

  // Проверка соединения с параметрами из формы (до сохранения)
  app.post("/api/servers/test", async (req, reply) => {
    const parsed = createServerSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
    return ctx.servers.testRaw(parsed.data);
  });

  // Текущие метрики сервера (разовый снимок; live идёт через WS)
  app.get("/api/servers/:id/metrics", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = ctx.servers.get(id);
    if (!row) return reply.status(404).send({ error: "Сервер не найден" });
    const { MetricsCollector } = await import("@dankodeploy/core");
    const snapshot = await new MetricsCollector(ctx.ssh).collect(ctx.servers.toTarget(row));
    ctx.metricsStore.save(snapshot); // обновляем кэш и при разовом запросе
    return snapshot;
  });

  // Детальная разбивка диска (df + docker system df + du по каталогам).
  // Тяжелее обычных метрик — запрашивается ПО КНОПКЕ, не в фоновом опросе.
  app.get("/api/servers/:id/storage", async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = ctx.servers.get(id);
    if (!row) return reply.status(404).send({ error: "Сервер не найден" });
    const { StorageCollector } = await import("@dankodeploy/core");
    return new StorageCollector(ctx.ssh).collect(ctx.servers.toTarget(row));
  });

  // Логи отдельного docker-контейнера (снимок последних строк) — для дашборда.
  app.get("/api/servers/:id/containers/:name/logs", async (req, reply) => {
    const { id, name } = req.params as { id: string; name: string };
    const { tail } = req.query as { tail?: string };
    const result = await ctx.servers.containerLogs(id, name, Number(tail) || 200);
    if ("error" in result) {
      const status = result.error === "Сервер не найден" ? 404 : 400;
      return reply.status(status).send({ error: result.error });
    }
    return { name, tail: Number(tail) || 200, logs: result.logs };
  });

  // Последние сохранённые снимки всех серверов — дашборд показывает их мгновенно,
  // а свежие данные подтягивает по WebSocket.
  app.get("/api/metrics/last", () => ctx.metricsStore.listLatest());
}
