import { z } from "zod";
import type { FastifyInstance } from "fastify";

import type { AppContext } from "../context.js";
import { SESSION_TTL_SECONDS } from "../services/AuthService.js";

const COOKIE_NAME = "dd_session";
const loginSchema = z.object({ password: z.string().min(1) });

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Нужен ли вообще логин (и залогинен ли уже) — фронт спрашивает при старте.
  app.get("/api/auth/me", (req) => {
    if (!ctx.config.authEnabled) return { authenticated: true, authRequired: false };
    const raw = req.cookies[COOKIE_NAME];
    const unsigned = raw ? app.unsignCookie(raw) : { valid: false, value: null };
    const ok =
      unsigned.valid && ctx.auth.validateSessionToken(unsigned.value ?? undefined);
    return { authenticated: ok, authRequired: true };
  });

  // Анти-брутфорс пароля: не больше 5 попыток входа с одного IP за 15 минут (далее 429).
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 5, timeWindow: "15 minutes" } } },
    (req, reply) => {
      if (!ctx.config.authEnabled) return { ok: true };
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: "Укажите пароль" });
      if (!ctx.auth.verify(parsed.data.password)) {
        return reply.status(401).send({ error: "Неверный пароль" });
      }
      const token = ctx.auth.issueSessionToken();
      reply.setCookie(COOKIE_NAME, token, {
        signed: true,
        httpOnly: true,
        sameSite: "lax",
        secure: ctx.config.webOrigin.startsWith("https://"),
        path: "/",
        maxAge: SESSION_TTL_SECONDS, // синхронно с TTL токена (см. AuthService)
      });
      return { ok: true };
    },
  );

  app.post("/api/auth/logout", (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });
}
