import { createHmac, timingSafeEqual } from "node:crypto";

import { verifyPassword } from "@dankodeploy/core";

/**
 * Аутентификация панели (один пользователь). Пароль проверяется против scrypt-хэша
 * из env; сессия — самоподписанный токен (HMAC на sessionSecret), который кладётся
 * в httpOnly cookie. Токен не хранит состояние на сервере (stateless).
 */
export class AuthService {
  constructor(
    private readonly passwordHash: string | undefined,
    private readonly sessionSecret: string,
  ) {}

  /** Проверяет введённый пароль против хранимого хэша. */
  verify(password: string): boolean {
    if (!this.passwordHash) return false;
    return verifyPassword(password, this.passwordHash);
  }

  /**
   * Выдаёт токен сессии: "<issuedAt>.<hmac>". HMAC подписывает issuedAt,
   * поэтому подделать токен без sessionSecret нельзя.
   */
  issueSessionToken(): string {
    const issuedAt = String(Date.now());
    return `${issuedAt}.${this.sign(issuedAt)}`;
  }

  /** Проверяет валидность токена (корректная подпись). */
  validateSessionToken(token: string | undefined): boolean {
    if (!token) return false;
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return false;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = this.sign(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private sign(payload: string): string {
    return createHmac("sha256", this.sessionSecret).update(payload).digest("hex");
  }
}
