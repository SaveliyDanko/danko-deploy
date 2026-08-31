import { randomBytes } from "node:crypto";

import { loadMasterKey } from "@dankodeploy/core";

/**
 * true, если адрес прослушивания — петлевой (наружу не торчит): localhost, ::1
 * или любой 127.0.0.0/8. Всё остальное (`0.0.0.0`, `::`, конкретный внешний IP) —
 * считается «наружу» и требует включённой аутентификации.
 */
export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === "localhost" || h === "::1" || h === "[::1]" || /^127\./.test(h);
}

/** Конфиг сервера из переменных окружения. Валидируется при старте. */
export interface AppConfig {
  port: number;
  host: string;
  databaseUrl: string;
  masterKey: Buffer;
  backupDir: string;
  webOrigin: string;
  /** Хэш пароля панели (scrypt "salt:hash"). Если не задан — аутентификация выключена. */
  authPasswordHash: string | undefined;
  /** Секрет для подписи cookie сессии (HMAC). */
  sessionSecret: string;
  /** Включена ли аутентификация панели (true, если задан authPasswordHash). */
  authEnabled: boolean;
  /** SHA-256 Bearer-токена с ограниченными правами для CLI-автоматизации. */
  automationTokenHash: string | undefined;
  /** Максимальный размер загружаемого файла (байты) — лимит multipart против заполнения диска. */
  maxUploadBytes: number;
}

export function loadConfig(): AppConfig {
  const authPasswordHash = process.env.DANKODEPLOY_AUTH_PASSWORD_HASH || undefined;
  const automationTokenHash = process.env.DANKODEPLOY_AUTOMATION_TOKEN_HASH || undefined;
  const authEnabled = !!authPasswordHash;
  const host = process.env.HOST ?? "127.0.0.1";

  if (automationTokenHash && !/^[a-f0-9]{64}$/i.test(automationTokenHash)) {
    throw new Error("DANKODEPLOY_AUTOMATION_TOKEN_HASH должен быть SHA-256 в hex-формате");
  }

  if (!authEnabled) {
    // Fail-closed: панель = прямой shell ко всем серверам. Без пароля её НЕЛЬЗЯ
    // слушать на не-петлевом адресе — иначе любой из сети получит доступ. Явный
    // escape-hatch (DANKODEPLOY_ALLOW_NO_AUTH=true) — для запуска за доверенным
    // обратным прокси, который сам делает аутентификацию.
    const allowNoAuth = /^(1|true|yes)$/i.test(process.env.DANKODEPLOY_ALLOW_NO_AUTH ?? "");
    if (!isLoopbackHost(host) && !allowNoAuth) {
      throw new Error(
        `Отказ запуска: HOST=${host} (не localhost) при ВЫКЛЮЧЕННОЙ аутентификации. ` +
          "Панель даёт прямой shell-доступ к серверам — открывать её наружу без пароля опасно. " +
          "Задайте DANKODEPLOY_AUTH_PASSWORD_HASH (pnpm gen-password) или слушайте 127.0.0.1. " +
          "Если панель за доверенным прокси с собственной аутентификацией — DANKODEPLOY_ALLOW_NO_AUTH=true.",
      );
    }
    console.warn(
      "[auth] DANKODEPLOY_AUTH_PASSWORD_HASH не задан — аутентификация ВЫКЛЮЧЕНА (только для dev). " +
        "Перед выставлением панели наружу задайте хэш пароля.",
    );
  }

  return {
    port: Number(process.env.PORT ?? 3001),
    host,
    databaseUrl: process.env.DATABASE_URL ?? "./data/dankodeploy.sqlite",
    masterKey: loadMasterKey(process.env.DANKODEPLOY_MASTER_KEY),
    backupDir: process.env.BACKUP_DIR ?? "./backups",
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    authPasswordHash,
    // Если секрет не задан — генерируем разовый (сессии слетят при рестарте, для dev ок).
    sessionSecret: process.env.DANKODEPLOY_SESSION_SECRET || randomBytes(32).toString("hex"),
    authEnabled,
    automationTokenHash,
    // Лимит загрузки (импорт конфигурации/файл бэкапа). Дефолт 1 GiB — вровень с
    // nginx client_max_body_size в проде; предохранитель от заполнения диска одним запросом.
    maxUploadBytes:
      Math.max(1, Number(process.env.DANKODEPLOY_MAX_UPLOAD_MB) || 1024) * 1024 * 1024,
  };
}
