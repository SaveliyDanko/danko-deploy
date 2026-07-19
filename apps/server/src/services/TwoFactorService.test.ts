import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { type Db } from "@dankodeploy/db";
import * as schema from "@dankodeploy/db";

import { generateTotpCode, matchTotpCounter, TwoFactorService } from "./TwoFactorService.js";

const MASTER_KEY = Buffer.alloc(32, 7);
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("TOTP", () => {
  it("совпадает с RFC 6238 (шесть младших цифр SHA-1-вектора)", () => {
    expect(generateTotpCode(RFC_SECRET, 1)).toBe("287082");
  });

  it("принимает текущее и соседние 30-секундные окна", () => {
    const now = 1_700_000_000_000;
    const counter = Math.floor(now / 30_000);
    expect(matchTotpCounter(RFC_SECRET, generateTotpCode(RFC_SECRET, counter), now)).toBe(counter);
    expect(matchTotpCounter(RFC_SECRET, generateTotpCode(RFC_SECRET, counter - 1), now)).toBe(
      counter - 1,
    );
    expect(matchTotpCounter(RFC_SECRET, "12345", now)).toBeUndefined();
  });
});

describe("TwoFactorService", () => {
  let sqlite: Database.Database;
  let service: TwoFactorService;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE auth_settings (
        id INTEGER PRIMARY KEY,
        totp_secret_enc TEXT,
        pending_totp_secret_enc TEXT,
        recovery_code_hashes TEXT,
        last_totp_counter INTEGER,
        auth_version INTEGER NOT NULL DEFAULT 0,
        totp_enabled_at TEXT,
        updated_at TEXT NOT NULL DEFAULT (current_timestamp)
      )
    `);
    const db = drizzle(sqlite, { schema }) as Db;
    service = new TwoFactorService(db, MASTER_KEY);
  });

  afterEach(() => sqlite.close());

  it("подключает TOTP, не хранит секрет открыто и отзывает повторный код", () => {
    const now = 1_700_000_000_000;
    const secret = service.beginSetup();
    expect(secret).toBeDefined();
    expect(service.status()).toEqual({ enabled: false, pendingSetup: true });

    const stored = sqlite.prepare("SELECT pending_totp_secret_enc FROM auth_settings").get() as {
      pending_totp_secret_enc: string;
    };
    expect(stored.pending_totp_secret_enc).not.toContain(secret!);

    const counter = Math.floor(now / 30_000);
    const recoveryCodes = service.confirmSetup(generateTotpCode(secret!, counter), now);
    expect(recoveryCodes).toHaveLength(8);
    expect(service.status()).toEqual({ enabled: true, pendingSetup: false });
    expect(service.sessionVersion()).toBe(1);

    const loginCode = generateTotpCode(secret!, counter);
    expect(service.verifyCode(loginCode, now)).toBe(true);
    expect(service.verifyCode(loginCode, now)).toBe(false);
  });

  it("принимает recovery-код только один раз", () => {
    const now = 1_700_000_000_000;
    const secret = service.beginSetup()!;
    const recoveryCodes = service.confirmSetup(
      generateTotpCode(secret, Math.floor(now / 30_000)),
      now,
    )!;

    expect(service.verifyCode(recoveryCodes[0]!, now)).toBe(true);
    expect(service.verifyCode(recoveryCodes[0]!, now)).toBe(false);
  });
});
