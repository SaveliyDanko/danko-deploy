import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AppContext } from "../context.js";

const COOKIE_NAME = "dd_session";

/** Пути, доступные без аутентификации (логин, проверка статуса, health). */
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/login", "/api/auth/me"]);

/**
 * Проверяет сессию по cookie запроса. Используется и в REST-guard, и при WS-handshake.
 * При выключенной аутентификации всегда true.
 */
export function isRequestAuthenticated(app: FastifyInstance, ctx: AppContext, req: FastifyRequest): boolean {
  if (!ctx.config.authEnabled) return true;
  const raw = req.cookies[COOKIE_NAME];
  if (!raw) return false;
  const unsigned = app.unsignCookie(raw);
  return unsigned.valid && ctx.auth.validateSessionToken(unsigned.value ?? undefined);
}

/**
 * Регистрирует onRequest-hook, защищающий все /api/* кроме whitelisted.
 * /ws проверяется отдельно в самом WS-хендлере (см. routes/ws.ts).
 */
export function registerAuthGuard(app: FastifyInstance, ctx: AppContext): void {
  app.addHook("onRequest", (req, reply, done) => {
    if (!ctx.config.authEnabled) return done();
    const url = req.url.split("?")[0] ?? req.url;
    // WS-upgrade и не-API пути пропускаем (WS защищён в хендлере).
    if (!url.startsWith("/api/") || PUBLIC_PATHS.has(url)) return done();
    if (isRequestAuthenticated(app, ctx, req)) return done();
    reply.status(401).send({ error: "Требуется аутентификация" });
  });
}
