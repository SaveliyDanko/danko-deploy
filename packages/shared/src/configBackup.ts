import { z } from "zod";

/**
 * Экспорт/импорт всей конфигурации панели (серверы, ключи, проекты, деплои, .env).
 * Секреты (приватные ключи, пароли серверов, .env) хранятся в файле ПЕРЕШИФРОВАННЫМИ
 * под пароль экспорта (см. ConfigBackupService) — в открытом виде их в файле нет.
 */

/** Строки таблиц переносятся как есть (passthrough) — структура задаётся схемой БД. */
const rowSchema = z.record(z.string(), z.unknown());

/** Данные бэкапа по таблицам конфигурации. */
export const configBackupDataSchema = z.object({
  sshKeys: z.array(rowSchema).default([]),
  gitKeys: z.array(rowSchema).default([]),
  servers: z.array(rowSchema).default([]),
  projects: z.array(rowSchema).default([]),
  deployments: z.array(rowSchema).default([]),
  projectEnv: z.array(rowSchema).default([]),
  /**
   * VPN-инсталляции (Outline) и VPN-клиенты (sing-box). Опционально — старые
   * бэкапы их не содержат. Секреты (management apiUrl, subscription-ссылка)
   * перешифрованы под пароль, как и прочие *_enc.
   */
  vpnInstallations: z.array(rowSchema).default([]),
  vpnClients: z.array(rowSchema).default([]),
  /**
   * История бэкапов проектов (таблица backups). Опционально — старые бэкапы (v1)
   * её не содержат. Сами файлы артефактов лежат в ZIP рядом (см. артефакт path).
   */
  backups: z.array(rowSchema).default([]),
});
export type ConfigBackupData = z.infer<typeof configBackupDataSchema>;

/** Полный файл бэкапа конфигурации (содержимое config.json). */
export const configBackupSchema = z.object({
  format: z.literal("dankodeploy-backup"),
  /** 1 — без истории бэкапов; 2 — с таблицей backups (и опц. файлами в ZIP). */
  version: z.union([z.literal(1), z.literal(2)]),
  createdAt: z.string(),
  /** Параметры KDF для вывода ключа из пароля (scrypt). salt — base64. */
  kdf: z.object({
    algo: z.literal("scrypt"),
    salt: z.string(),
    keylen: z.literal(32),
    /** Стоимость scrypt (N). Опционально — старые бэкапы без него читаются как 2^14. */
    n: z.number().int().positive().optional(),
  }),
  /** Проверочный шифротекст: encryptSecret("dankodeploy-backup", exportKey). */
  verifier: z.string(),
  /** Вложены ли в архив сами файлы бэкапов (.bak в папке backups/ внутри ZIP). */
  includesBackupFiles: z.boolean().default(false),
  data: configBackupDataSchema,
});
export type ConfigBackup = z.infer<typeof configBackupSchema>;

/** Тело запроса экспорта. */
export const exportConfigSchema = z.object({
  password: z.string().min(1, "Укажите пароль экспорта"),
  /** Включить ли в архив сами файлы бэкапов проектов (.bak). По умолчанию нет. */
  includeBackupFiles: z.boolean().default(false),
});
export type ExportConfigInput = z.infer<typeof exportConfigSchema>;

/** Режим импорта: merge (добавить/обновить по id) или replace (очистить и залить). */
export const importModeSchema = z.enum(["merge", "replace"]);
export type ImportMode = z.infer<typeof importModeSchema>;

/** Тело запроса импорта: пароль, режим и сам файл бэкапа. */
export const importConfigSchema = z.object({
  password: z.string().min(1, "Укажите пароль бэкапа"),
  mode: importModeSchema.default("merge"),
  data: configBackupSchema,
});
export type ImportConfigInput = z.infer<typeof importConfigSchema>;

/** Сколько строк по каждой таблице импортировано. */
export const importResultSchema = z.object({
  ok: z.boolean(),
  mode: importModeSchema,
  counts: z.object({
    sshKeys: z.number(),
    gitKeys: z.number(),
    servers: z.number(),
    projects: z.number(),
    deployments: z.number(),
    projectEnv: z.number(),
    vpnInstallations: z.number(),
    vpnClients: z.number(),
    backups: z.number(),
  }),
  /** Сколько файлов бэкапов восстановлено на диск из ZIP. */
  restoredFiles: z.number().default(0),
});
export type ImportResult = z.infer<typeof importResultSchema>;
