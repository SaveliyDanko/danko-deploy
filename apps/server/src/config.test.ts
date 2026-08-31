import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isLoopbackHost, loadConfig } from "./config.js";

describe("isLoopbackHost", () => {
  it("считает петлевыми localhost / 127.0.0.0/8 / ::1", () => {
    for (const h of [
      "127.0.0.1",
      "127.1.2.3",
      "localhost",
      "LOCALHOST",
      "::1",
      "[::1]",
      " 127.0.0.1 ",
    ]) {
      expect(isLoopbackHost(h)).toBe(true);
    }
  });

  it("считает не-петлевыми адреса «наружу»", () => {
    for (const h of ["0.0.0.0", "::", "192.168.1.10", "10.0.0.5", "185.46.11.174", "example.com"]) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });
});

describe("loadConfig fail-closed (M1)", () => {
  // 32 байта base64 — валидный master-key, чтобы дойти до проверки bind/auth.
  const MASTER_KEY = Buffer.alloc(32).toString("base64");
  const ENV_KEYS = [
    "HOST",
    "DANKODEPLOY_AUTH_PASSWORD_HASH",
    "DANKODEPLOY_ALLOW_NO_AUTH",
    "DANKODEPLOY_MASTER_KEY",
    "DANKODEPLOY_SESSION_SECRET",
    "DANKODEPLOY_AUTOMATION_TOKEN_HASH",
  ] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
    process.env.DANKODEPLOY_MASTER_KEY = MASTER_KEY;
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("отказывает: не-петлевой HOST без аутентификации", () => {
    process.env.HOST = "0.0.0.0";
    expect(() => loadConfig()).toThrow(/Отказ запуска/);
  });

  it("разрешает: не-петлевой HOST без auth, но с DANKODEPLOY_ALLOW_NO_AUTH", () => {
    process.env.HOST = "0.0.0.0";
    process.env.DANKODEPLOY_ALLOW_NO_AUTH = "true";
    expect(() => loadConfig()).not.toThrow();
  });

  it("разрешает: петлевой HOST без аутентификации (dev)", () => {
    process.env.HOST = "127.0.0.1";
    expect(loadConfig().authEnabled).toBe(false);
  });

  it("разрешает: не-петлевой HOST с включённой аутентификацией", () => {
    process.env.HOST = "0.0.0.0";
    process.env.DANKODEPLOY_AUTH_PASSWORD_HASH = "deadbeef:cafe";
    expect(loadConfig().authEnabled).toBe(true);
  });

  it("отклоняет некорректный хэш токена автоматизации", () => {
    process.env.DANKODEPLOY_AUTOMATION_TOKEN_HASH = "secret";
    expect(() => loadConfig()).toThrow(/AUTOMATION_TOKEN_HASH/);
  });
});
