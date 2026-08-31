import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import type { AppContext } from "./context.js";
import { appInfo } from "./appInfo.js";
import { registerAuthGuard } from "./plugins/authGuard.js";
import { registerErrorHandler } from "./plugins/errorHandler.js";
import { registerAiAgentRoutes } from "./routes/aiAgents.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerConfigBackupRoutes } from "./routes/configBackup.js";
import { registerDeploymentRoutes } from "./routes/deployments.js";
import { registerGitKeyRoutes } from "./routes/gitKeys.js";
import { registerKeyRoutes } from "./routes/keys.js";
import { registerProjectRoutes } from "./routes/projects.js";
import { registerServerRoutes } from "./routes/servers.js";
import { registerVpnRoutes } from "./routes/vpn.js";
import { registerVpnClientRoutes } from "./routes/vpnClient.js";
import { registerWsRoute } from "./routes/ws.js";

/** Собирает Fastify-приложение со всеми роутами и WS. */
export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  // credentials: true — чтобы браузер слал cookie сессии при кросс-origin запросах (dev).
  await app.register(cors, { origin: ctx.config.webOrigin, credentials: true });
  await app.register(cookie, { secret: ctx.config.sessionSecret });
  // Загрузка файлов бэкапа. Лимит настраивается (DANKODEPLOY_MAX_UPLOAD_MB, дефолт 1 GiB) —
  // предохранитель от заполнения диска одним большим запросом.
  await app.register(multipart, { limits: { fileSize: ctx.config.maxUploadBytes } });
  await app.register(websocket);
  // Rate-limit включаем глобально, но НЕ применяем по умолчанию (global: false) —
  // лимитируем точечно (см. config.rateLimit на /api/auth/login против брутфорса).
  await app.register(rateLimit, { global: false });

  // Глобальный обработчик ошибок и 404 — единый формат { error }, не светит стектрейсы.
  registerErrorHandler(app);

  // Guard защищает /api/* (кроме whitelist) — регистрируется до роутов.
  registerAuthGuard(app, ctx);

  app.get("/api/health", () => ({ ok: true as const, ...appInfo }));

  registerAuthRoutes(app, ctx);
  registerServerRoutes(app, ctx);
  registerKeyRoutes(app, ctx);
  registerGitKeyRoutes(app, ctx);
  registerProjectRoutes(app, ctx);
  registerDeploymentRoutes(app, ctx);
  registerConfigBackupRoutes(app, ctx);
  registerAiAgentRoutes(app, ctx);
  registerVpnRoutes(app, ctx);
  registerVpnClientRoutes(app, ctx);
  registerWsRoute(app, ctx);

  return app;
}
