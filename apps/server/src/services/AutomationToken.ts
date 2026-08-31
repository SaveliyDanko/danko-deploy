import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "ddp_";

/** Генерирует токен автоматизации; открытое значение показывается пользователю один раз. */
export function generateAutomationToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** В env хранится только SHA-256 токена, поэтому утечка конфигурации не раскрывает сам токен. */
export function hashAutomationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Сравнивает токен в постоянное время. */
export function verifyAutomationToken(token: string, expectedHash: string | undefined): boolean {
  if (!expectedHash || !token.startsWith(TOKEN_PREFIX)) return false;
  const actual = Buffer.from(hashAutomationToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
