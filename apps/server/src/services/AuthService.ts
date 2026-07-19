import { createHmac, timingSafeEqual } from "node:crypto";

import { verifyPassword } from "@dankodeploy/core";

/** Срок жизни сессии. После него токен невалиден, даже если подпись верна. */
export const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30; // 30 дней
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;

/** Допуск рассинхрона часов (токен «из будущего» дальше этого — невалиден). */
const CLOCK_SKEW_MS = 60_000;

/**
 * Аутентификация панели (один пользователь). Пароль проверяется против scrypt-хэша
 * из env; сессия — самоподписанный токен (HMAC), который кладётся в httpOnly cookie.
 * Токен не хранит состояние на сервере (stateless), но:
 *  - **истекает** через SESSION_TTL_MS (проверяется issuedAt);
 *  - **отзывается** сменой пароля: подпись завязана на хэш пароля, поэтому новый
 *    пароль (pnpm gen-password + рестарт) инвалидирует ВСЕ ранее выданные токены.
 */
export class AuthService {
  constructor(
    private readonly passwordHash: string | undefined,
    private readonly sessionSecret: string,
    private readonly getSessionVersion: () => number = () => 0,
  ) {}

  /** Проверяет введённый пароль против хранимого хэша. */
  verify(password: string): boolean {
    if (!this.passwordHash) return false;
    return verifyPassword(password, this.passwordHash);
  }

  /**
   * Выдаёт токен сессии: "<issuedAt>.<hmac>". HMAC подписывает issuedAt ключом,
   * завязанным на sessionSecret + хэш пароля — подделать без секрета нельзя, а
   * смена пароля делает старые токены невалидными.
   */
  issueSessionToken(): string {
    const issuedAt = String(Date.now());
    return `${issuedAt}.${this.sign(issuedAt)}`;
  }

  /** Проверяет токен: корректная подпись И не истёкший срок (issuedAt в окне TTL). */
  validateSessionToken(token: string | undefined, now: number = Date.now()): boolean {
    if (!token) return false;
    const dot = token.lastIndexOf(".");
    if (dot <= 0) return false;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);

    // Подпись (timing-safe) — до проверки срока, чтобы не разглашать валидность по таймингу.
    const expected = this.sign(payload);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return false;

    // Срок жизни: issuedAt — целое мс; токен не истёк и не «из будущего».
    const issuedAt = Number(payload);
    if (!Number.isInteger(issuedAt)) return false;
    const age = now - issuedAt;
    return age >= -CLOCK_SKEW_MS && age <= SESSION_TTL_MS;
  }

  /**
   * Ключ подписи: sessionSecret + хэш пароля + версия auth-настроек. Привязка
   * отзывает все сессии при смене пароля, включении/отключении 2FA или пересоздании
   * recovery-кодов.
   */
  private sign(payload: string): string {
    const key = `${this.sessionSecret}\0${this.passwordHash ?? ""}\0${this.getSessionVersion()}`;
    return createHmac("sha256", key).update(payload).digest("hex");
  }
}
