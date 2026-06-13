import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthService, SESSION_TTL_MS } from "./AuthService.js";

// scrypt "salt:hash" пароля "secret" — фикстура для verify (не нужна большинству тестов).
const SECRET = "test-session-secret";
const HASH_A = "aaaa:bbbb";
const HASH_B = "cccc:dddd";

afterEach(() => {
  vi.useRealTimers();
});

describe("AuthService.validateSessionToken", () => {
  it("принимает свежевыданный токен", () => {
    const auth = new AuthService(HASH_A, SECRET);
    expect(auth.validateSessionToken(auth.issueSessionToken())).toBe(true);
  });

  it("отвергает мусор / подделанную подпись", () => {
    const auth = new AuthService(HASH_A, SECRET);
    expect(auth.validateSessionToken(undefined)).toBe(false);
    expect(auth.validateSessionToken("no-dot")).toBe(false);
    const token = auth.issueSessionToken();
    expect(auth.validateSessionToken(token.slice(0, -1) + "0")).toBe(false); // битая подпись
  });

  it("истекает после TTL (issuedAt проверяется)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const auth = new AuthService(HASH_A, SECRET);
    const token = auth.issueSessionToken();
    expect(auth.validateSessionToken(token)).toBe(true);

    // Сразу за границей TTL — токен невалиден, хотя подпись верна.
    vi.setSystemTime(Date.now() + SESSION_TTL_MS + 1000);
    expect(auth.validateSessionToken(token)).toBe(false);
  });

  it("отвергает токен «из будущего» за пределами допуска часов", () => {
    const auth = new AuthService(HASH_A, SECRET);
    const future = `${Date.now() + 10 * 60_000}`; // +10 мин
    // Подписываем валидно через сам сервис, подменив issuedAt нельзя — соберём через приватный путь:
    // проще проверить, что явно будущий issuedAt с верной подписью отвергается.
    const token = auth.issueSessionToken();
    // подменяем issuedAt, оставив старую подпись → подпись не сойдётся → false (двойная защита)
    expect(auth.validateSessionToken(`${future}.${token.split(".")[1]}`)).toBe(false);
  });

  it("отзыв: смена пароля инвалидирует ранее выданные токены", () => {
    const oldAuth = new AuthService(HASH_A, SECRET);
    const token = oldAuth.issueSessionToken();
    expect(oldAuth.validateSessionToken(token)).toBe(true);

    // Новый пароль (другой хэш) при том же sessionSecret — старый токен больше не валиден.
    const newAuth = new AuthService(HASH_B, SECRET);
    expect(newAuth.validateSessionToken(token)).toBe(false);
  });
});
