import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import { registerErrorHandler } from "./errorHandler.js";

/** Поднимает мини-приложение с тестовыми роутами и зарегистрированным обработчиком. */
function buildTestApp() {
  const app = Fastify();
  registerErrorHandler(app);

  // Роут, бросающий необработанное исключение (имитация сбоя ssh-keygen/SSH).
  app.get("/boom", () => {
    throw new Error("ssh-keygen: command not found /usr/internal/path");
  });

  // Роут с явной клиентской ошибкой (4xx) — сообщение должно сохраниться.
  app.get("/bad", (_req, reply) => {
    reply.status(400).send({ error: "Понятная ошибка клиента" });
  });

  // Роут, бросающий ошибку с statusCode 4xx (как плагины Fastify).
  app.get("/unauthorized", () => {
    const err = new Error("нет доступа") as Error & { statusCode: number };
    err.statusCode = 403;
    throw err;
  });

  return app;
}

describe("registerErrorHandler", () => {
  it("5xx: НЕ отдаёт стектрейс/внутренние детали клиенту", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    const body = res.json();
    expect(body.error).toBe("Внутренняя ошибка сервера");
    // Главное: внутренности не утекли наружу.
    expect(JSON.stringify(body)).not.toContain("ssh-keygen");
    expect(JSON.stringify(body)).not.toContain("/usr/internal/path");
    expect(body).not.toHaveProperty("stack");
    await app.close();
  });

  it("4xx из reply.status: сообщение сохраняется как есть", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/bad" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Понятная ошибка клиента");
    await app.close();
  });

  it("брошенная ошибка с statusCode 4xx: статус и сообщение сохраняются", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/unauthorized" });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("нет доступа");
    await app.close();
  });

  it("404: единый формат { error }", async () => {
    const app = buildTestApp();
    const res = await app.inject({ method: "GET", url: "/no-such-route" });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toContain("Маршрут не найден");
    await app.close();
  });
});
