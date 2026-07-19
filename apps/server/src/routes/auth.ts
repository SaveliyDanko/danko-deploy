import type { FastifyInstance, FastifyReply } from "fastify";
import QRCode from "qrcode";

import {
  loginInputSchema,
  twoFactorCodeInputSchema,
  twoFactorPasswordInputSchema,
} from "@dankodeploy/shared";

import type { AppContext } from "../context.js";
import { SESSION_TTL_SECONDS } from "../services/AuthService.js";

const COOKIE_NAME = "dd_session";
const AUTH_RATE_LIMIT = { max: 5, timeWindow: "15 minutes" } as const;

function setSessionCookie(reply: FastifyReply, ctx: AppContext): void {
  reply.setCookie(COOKIE_NAME, ctx.auth.issueSessionToken(), {
    signed: true,
    httpOnly: true,
    sameSite: "lax",
    secure: ctx.config.webOrigin.startsWith("https://"),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

function panelAccount(webOrigin: string): string {
  try {
    return new URL(webOrigin).hostname;
  } catch {
    return "owner";
  }
}

function buildOtpAuthUri(secret: string, webOrigin: string): string {
  const issuer = "DankoDeploy";
  const label = encodeURIComponent(`${issuer}:${panelAccount(webOrigin)}`);
  return (
    `otpauth://totp/${label}?secret=${encodeURIComponent(secret)}` +
    `&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`
  );
}

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): void {
  // Нужен ли логин, включён ли второй фактор и залогинен ли браузер.
  app.get("/api/auth/me", (req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!ctx.config.authEnabled) {
      return { authenticated: true, authRequired: false, twoFactorRequired: false };
    }
    const raw = req.cookies[COOKIE_NAME];
    const unsigned = raw ? app.unsignCookie(raw) : { valid: false, value: null };
    const authenticated =
      unsigned.valid && ctx.auth.validateSessionToken(unsigned.value ?? undefined);
    return {
      authenticated,
      authRequired: true,
      twoFactorRequired: ctx.twoFactor.status().enabled,
    };
  });

  // Пароль и TOTP/recovery-код проверяются одним rate-limited запросом: отдельного
  // безлимитного oracle для перебора второго фактора нет.
  app.post("/api/auth/login", { config: { rateLimit: AUTH_RATE_LIMIT } }, (req, reply) => {
    if (!ctx.config.authEnabled) return { ok: true };
    const parsed = loginInputSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });

    const passwordValid = ctx.auth.verify(parsed.data.password);
    const twoFactorEnabled = ctx.twoFactor.status().enabled;
    const codeValid =
      !twoFactorEnabled ||
      (!!parsed.data.code && passwordValid && ctx.twoFactor.verifyCode(parsed.data.code));
    if (!passwordValid || !codeValid) {
      return reply.status(401).send({ error: "Неверный пароль или одноразовый код" });
    }

    setSessionCookie(reply, ctx);
    return { ok: true };
  });

  app.post("/api/auth/logout", (_req, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: "/" });
    return { ok: true };
  });

  app.get("/api/auth/two-factor", (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!ctx.config.authEnabled) return { enabled: false, pendingSetup: false };
    return ctx.twoFactor.status();
  });

  app.post(
    "/api/auth/two-factor/setup",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    async (req, reply) => {
      if (!ctx.config.authEnabled) {
        return reply.status(409).send({ error: "Сначала включите вход по паролю" });
      }
      const parsed = twoFactorPasswordInputSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      if (!ctx.auth.verify(parsed.data.password)) {
        return reply.status(401).send({ error: "Неверный пароль" });
      }

      const secret = ctx.twoFactor.beginSetup();
      if (!secret) return reply.status(409).send({ error: "Двухфакторная защита уже включена" });
      const otpAuthUri = buildOtpAuthUri(secret, ctx.config.webOrigin);
      const qrCodeDataUrl = await QRCode.toDataURL(otpAuthUri, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 240,
      });
      reply.header("Cache-Control", "no-store");
      return { secret, qrCodeDataUrl };
    },
  );

  app.delete("/api/auth/two-factor/setup", (_req, reply) => {
    ctx.twoFactor.cancelSetup();
    return reply.send({ ok: true });
  });

  app.post(
    "/api/auth/two-factor/confirm",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    (req, reply) => {
      const parsed = twoFactorCodeInputSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      if (!ctx.auth.verify(parsed.data.password)) {
        return reply.status(401).send({ error: "Неверный пароль или одноразовый код" });
      }
      const recoveryCodes = ctx.twoFactor.confirmSetup(parsed.data.code);
      if (!recoveryCodes) {
        return reply.status(401).send({ error: "Неверный пароль или одноразовый код" });
      }

      // Версия auth уже изменилась: выдаём новую cookie этому браузеру, остальные
      // ранее открытые сессии становятся недействительными.
      setSessionCookie(reply, ctx);
      reply.header("Cache-Control", "no-store");
      return { ok: true, recoveryCodes };
    },
  );

  app.post(
    "/api/auth/two-factor/disable",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    (req, reply) => {
      const parsed = twoFactorCodeInputSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      if (!ctx.auth.verify(parsed.data.password) || !ctx.twoFactor.verifyCode(parsed.data.code)) {
        return reply.status(401).send({ error: "Неверный пароль или одноразовый код" });
      }
      ctx.twoFactor.disable();
      setSessionCookie(reply, ctx);
      return { ok: true };
    },
  );

  app.post(
    "/api/auth/two-factor/recovery-codes",
    { config: { rateLimit: AUTH_RATE_LIMIT } },
    (req, reply) => {
      const parsed = twoFactorCodeInputSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      if (!ctx.auth.verify(parsed.data.password) || !ctx.twoFactor.verifyCode(parsed.data.code)) {
        return reply.status(401).send({ error: "Неверный пароль или одноразовый код" });
      }
      const recoveryCodes = ctx.twoFactor.regenerateRecoveryCodes();
      setSessionCookie(reply, ctx);
      reply.header("Cache-Control", "no-store");
      return { ok: true, recoveryCodes };
    },
  );
}
