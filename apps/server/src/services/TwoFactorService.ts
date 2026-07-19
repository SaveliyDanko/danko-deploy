import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { and, eq, isNull, lt, or, sql } from "drizzle-orm";

import { decryptSecret, encryptSecret } from "@dankodeploy/core";
import { authSettings, type AuthSettingsRow, type Db } from "@dankodeploy/db";

const SETTINGS_ID = 1;
const TOTP_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const TOTP_PERIOD_MS = 30_000;
const TOTP_DIGITS = 6;
const RECOVERY_CODE_COUNT = 8;

/** Кодирует байты в Base32 без padding — формат, который принимает Google Authenticator. */
export function encodeBase32(value: Buffer): string {
  let bits = 0;
  let accumulator = 0;
  let result = "";

  for (const byte of value) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += TOTP_ALPHABET[(accumulator >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) result += TOTP_ALPHABET[(accumulator << (5 - bits)) & 31];
  return result;
}

function decodeBase32(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/g, "");
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const index = TOTP_ALPHABET.indexOf(char);
    if (index < 0) throw new Error("Некорректный TOTP-секрет");
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

/** Генерирует шестизначный TOTP для тестов и внутренней проверки. */
export function generateTotpCode(secret: string, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret)).update(message).digest();
  const offset = (digest[digest.length - 1] ?? 0) & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** Возвращает совпавший счётчик с допуском ±1 период или undefined. */
export function matchTotpCounter(
  secret: string,
  code: string,
  now: number = Date.now(),
): number | undefined {
  if (!/^\d{6}$/.test(code)) return undefined;
  const current = Math.floor(now / TOTP_PERIOD_MS);

  for (const offset of [0, -1, 1]) {
    const counter = current + offset;
    const expected = Buffer.from(generateTotpCode(secret, counter));
    const actual = Buffer.from(code);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) return counter;
  }
  return undefined;
}

function parseRecoveryHashes(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeRecoveryCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z2-9]/g, "");
}

/** Персистентная настройка TOTP для единственного владельца панели. */
export class TwoFactorService {
  constructor(
    private readonly db: Db,
    private readonly masterKey: Buffer,
  ) {}

  status(): { enabled: boolean; pendingSetup: boolean } {
    const row = this.getRow();
    return {
      enabled: !!row?.totpSecretEnc,
      pendingSetup: !!row?.pendingTotpSecretEnc,
    };
  }

  /** Значение входит в ключ подписи cookie и меняется при критичных операциях с 2FA. */
  sessionVersion(): number {
    return this.getRow()?.authVersion ?? 0;
  }

  beginSetup(): string | undefined {
    const existing = this.getRow();
    if (existing?.totpSecretEnc) return undefined;

    const secret = encodeBase32(randomBytes(20));
    const pendingTotpSecretEnc = encryptSecret(secret, this.masterKey);
    const updatedAt = new Date().toISOString();
    this.db
      .insert(authSettings)
      .values({ id: SETTINGS_ID, pendingTotpSecretEnc, updatedAt })
      .onConflictDoUpdate({
        target: authSettings.id,
        set: { pendingTotpSecretEnc, updatedAt },
      })
      .run();
    return secret;
  }

  cancelSetup(): void {
    this.db
      .update(authSettings)
      .set({ pendingTotpSecretEnc: null, updatedAt: new Date().toISOString() })
      .where(eq(authSettings.id, SETTINGS_ID))
      .run();
  }

  confirmSetup(code: string, now: number = Date.now()): string[] | undefined {
    const row = this.getRow();
    if (!row?.pendingTotpSecretEnc || row.totpSecretEnc) return undefined;
    const secret = decryptSecret(row.pendingTotpSecretEnc, this.masterKey);
    if (matchTotpCounter(secret, code, now) === undefined) return undefined;

    const recoveryCodes = this.createRecoveryCodes();
    this.db
      .update(authSettings)
      .set({
        totpSecretEnc: row.pendingTotpSecretEnc,
        pendingTotpSecretEnc: null,
        recoveryCodeHashes: JSON.stringify(
          recoveryCodes.map((item) => this.hashRecoveryCode(item)),
        ),
        lastTotpCounter: null,
        totpEnabledAt: new Date(now).toISOString(),
        authVersion: sql`${authSettings.authVersion} + 1`,
        updatedAt: new Date(now).toISOString(),
      })
      .where(eq(authSettings.id, SETTINGS_ID))
      .run();
    return recoveryCodes;
  }

  /** Проверяет TOTP или одноразовый recovery-код и атомарно помечает его использованным. */
  verifyCode(code: string, now: number = Date.now()): boolean {
    const row = this.getRow();
    if (!row?.totpSecretEnc) return false;

    const normalized = code.trim();
    const secret = decryptSecret(row.totpSecretEnc, this.masterKey);
    const counter = matchTotpCounter(secret, normalized, now);
    if (counter !== undefined) {
      const result = this.db
        .update(authSettings)
        .set({ lastTotpCounter: counter, updatedAt: new Date(now).toISOString() })
        .where(
          and(
            eq(authSettings.id, SETTINGS_ID),
            or(isNull(authSettings.lastTotpCounter), lt(authSettings.lastTotpCounter, counter)),
          ),
        )
        .run();
      return result.changes > 0;
    }

    const recoveryCode = normalizeRecoveryCode(normalized);
    if (!recoveryCode) return false;
    const hashes = parseRecoveryHashes(row.recoveryCodeHashes);
    const hash = this.hashRecoveryCode(recoveryCode);
    const index = hashes.findIndex((item) => {
      const expected = Buffer.from(item);
      const actual = Buffer.from(hash);
      return expected.length === actual.length && timingSafeEqual(expected, actual);
    });
    if (index < 0 || !row.recoveryCodeHashes) return false;

    hashes.splice(index, 1);
    const result = this.db
      .update(authSettings)
      .set({ recoveryCodeHashes: JSON.stringify(hashes), updatedAt: new Date(now).toISOString() })
      .where(
        and(
          eq(authSettings.id, SETTINGS_ID),
          eq(authSettings.recoveryCodeHashes, row.recoveryCodeHashes),
        ),
      )
      .run();
    return result.changes > 0;
  }

  disable(): void {
    this.db
      .update(authSettings)
      .set({
        totpSecretEnc: null,
        pendingTotpSecretEnc: null,
        recoveryCodeHashes: null,
        lastTotpCounter: null,
        totpEnabledAt: null,
        authVersion: sql`${authSettings.authVersion} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(authSettings.id, SETTINGS_ID))
      .run();
  }

  regenerateRecoveryCodes(): string[] {
    const recoveryCodes = this.createRecoveryCodes();
    this.db
      .update(authSettings)
      .set({
        recoveryCodeHashes: JSON.stringify(
          recoveryCodes.map((item) => this.hashRecoveryCode(item)),
        ),
        authVersion: sql`${authSettings.authVersion} + 1`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(authSettings.id, SETTINGS_ID))
      .run();
    return recoveryCodes;
  }

  private getRow(): AuthSettingsRow | undefined {
    return this.db.select().from(authSettings).where(eq(authSettings.id, SETTINGS_ID)).get();
  }

  private createRecoveryCodes(): string[] {
    return Array.from({ length: RECOVERY_CODE_COUNT }, () => {
      const raw = Array.from(randomBytes(16), (byte) => RECOVERY_ALPHABET[byte & 31]).join("");
      return raw.match(/.{1,4}/g)?.join("-") ?? raw;
    });
  }

  private hashRecoveryCode(code: string): string {
    return createHmac("sha256", this.masterKey).update(normalizeRecoveryCode(code)).digest("hex");
  }
}
