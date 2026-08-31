import { describe, expect, it } from "vitest";

import {
  generateAutomationToken,
  hashAutomationToken,
  verifyAutomationToken,
} from "./AutomationToken.js";

describe("AutomationToken", () => {
  it("генерирует токен и проверяет его по SHA-256", () => {
    const token = generateAutomationToken();
    const hash = hashAutomationToken(token);

    expect(token).toMatch(/^ddp_[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyAutomationToken(token, hash)).toBe(true);
  });

  it("отклоняет другой токен и некорректный хэш", () => {
    const token = generateAutomationToken();

    expect(verifyAutomationToken(`${token}x`, hashAutomationToken(token))).toBe(false);
    expect(verifyAutomationToken(token, "not-a-hash")).toBe(false);
    expect(verifyAutomationToken("secret", hashAutomationToken("secret"))).toBe(false);
  });
});
