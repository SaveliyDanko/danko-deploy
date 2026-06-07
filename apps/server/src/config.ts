import { randomBytes } from "node:crypto";

import { loadMasterKey } from "@dankodeploy/core";

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
}

export function loadConfig(): AppConfig {
  const authPasswordHash = process.env.DANKODEPLOY_AUTH_PASSWORD_HASH || undefined;
  const authEnabled = !!authPasswordHash;

  if (!authEnabled) {
    console.warn(
      "[auth] DANKODEPLOY_AUTH_PASSWORD_HASH не задан — аутентификация ВЫКЛЮЧЕНА (только для dev). " +
        "Перед выставлением панели наружу задайте хэш пароля.",
    );
  }

  return {
    port: Number(process.env.PORT ?? 3001),
    host: process.env.HOST ?? "127.0.0.1",
    databaseUrl: process.env.DATABASE_URL ?? "./data/dankodeploy.sqlite",
    masterKey: loadMasterKey(process.env.DANKODEPLOY_MASTER_KEY),
    backupDir: process.env.BACKUP_DIR ?? "./backups",
    webOrigin: process.env.WEB_ORIGIN ?? "http://localhost:5173",
    authPasswordHash,
    // Если секрет не задан — генерируем разовый (сессии слетят при рестарте, для dev ок).
    sessionSecret: process.env.DANKODEPLOY_SESSION_SECRET || randomBytes(32).toString("hex"),
    authEnabled,
  };
}
