import type { FastifyInstance, FastifyRequest } from "fastify";

import type { AppContext } from "../context.js";
import { verifyAutomationToken } from "../services/AutomationToken.js";

const COOKIE_NAME = "dd_session";

/** Пути, доступные без аутентификации (логин, проверка статуса, health). */
const PUBLIC_PATHS = new Set(["/api/health", "/api/auth/login", "/api/auth/me"]);

/**
 * Проверяет сессию по cookie запроса. Используется и в REST-guard, и при WS-handshake.
 * При выключенной аутентификации всегда true.
 */
export function isRequestAuthenticated(
  app: FastifyInstance,
  ctx: AppContext,
  req: FastifyRequest,
): boolean {
  if (!ctx.config.authEnabled) return true;
  const raw = req.cookies[COOKIE_NAME];
  if (!raw) return false;
  const unsigned = app.unsignCookie(raw);
  return unsigned.valid && ctx.auth.validateSessionToken(unsigned.value ?? undefined);
}

/** Bearer-токен намеренно ограничен операциями конкретного проекта/деплоя. */
export function isAutomationPathAllowed(method: string, url: string): boolean {
  const path = url.split("?")[0] ?? url;
  if (method === "GET") {
    return (
      /^\/api\/projects\/[^/]+(?:\/backups)?$/.test(path) ||
      /^\/api\/deployments\/[^/]+(?:\/deploys)?$/.test(path)
    );
  }
  if (method !== "POST") return false;
  return (
    /^\/api\/deployments\/[^/]+\/(?:provision|deploy|undeploy|backup|restore)$/.test(path) ||
    /^\/api\/deployments\/[^/]+\/env\/deploy$/.test(path)
  );
}

function bearerToken(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization;
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  return match?.[1];
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

    const token = bearerToken(req);
    if (token && verifyAutomationToken(token, ctx.config.automationTokenHash)) {
      if (isAutomationPathAllowed(req.method, req.url)) return done();
      reply.status(403).send({ error: "Токен автоматизации не имеет доступа к этому ресурсу" });
      return;
    }
    reply.status(401).send({ error: "Требуется аутентификация" });
  });
}
