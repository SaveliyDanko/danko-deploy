import { z } from "zod";

/**
 * Способ аутентификации при SSH-подключении к VPS.
 * - "key": приватный SSH-ключ, вставленный прямо в сервер
 * - "password": пароль (менее безопасно)
 * - "stored-key": ключ из хранилища (вкладка «Ключи»), сервер ссылается на него по keyId
 */
export const sshAuthMethodSchema = z.enum(["key", "password", "stored-key"]);
export type SshAuthMethod = z.infer<typeof sshAuthMethodSchema>;

/**
 * Секреты подключения, которые приходят с фронта при создании/обновлении сервера.
 * На бэке шифруются (AES-256-GCM) перед записью в БД и НИКОГДА не отдаются обратно.
 * Для authMethod = "stored-key" inline-секреты не нужны — используется keyId сервера.
 */
export const serverCredentialsSchema = z
  .object({
    authMethod: sshAuthMethodSchema,
    /** Приватный ключ в PEM (если authMethod === "key") */
    privateKey: z.string().optional(),
    /** Passphrase для зашифрованного приватного ключа */
    passphrase: z.string().optional(),
    /** Пароль (если authMethod === "password") */
    password: z.string().optional(),
  })
  .refine(
    (c) =>
      c.authMethod === "stored-key"
        ? true
        : c.authMethod === "key"
          ? !!c.privateKey
          : !!c.password,
    "Для выбранного метода аутентификации не заполнены учётные данные",
  );
export type ServerCredentials = z.infer<typeof serverCredentialsSchema>;

/** Тело запроса на создание сервера. Текстовые поля тримятся (убираем случайные пробелы). */
export const createServerSchema = z
  .object({
    name: z.string().trim().min(1, "Укажите название сервера"),
    host: z.string().trim().min(1, "Укажите host/IP"),
    port: z.number().int().min(1).max(65535).default(22),
    username: z.string().trim().min(1, "Укажите пользователя SSH"),
    credentials: serverCredentialsSchema,
    /** ID ключа из хранилища (обязателен при authMethod = "stored-key") */
    keyId: z.string().optional(),
  })
  .refine(
    (s) => s.credentials.authMethod !== "stored-key" || !!s.keyId,
    "Для метода «ключ из хранилища» нужно выбрать keyId",
  );
export type CreateServerInput = z.infer<typeof createServerSchema>;

/** Тело запроса на обновление сервера — секреты опциональны (меняем только если переданы) */
export const updateServerSchema = z.object({
  name: z.string().trim().min(1).optional(),
  host: z.string().trim().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().trim().min(1).optional(),
  credentials: serverCredentialsSchema.optional(),
  keyId: z.string().nullable().optional(),
});
export type UpdateServerInput = z.infer<typeof updateServerSchema>;

/** Публичное представление сервера (без секретов) — то, что уходит на фронт */
export const serverPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number(),
  username: z.string(),
  authMethod: sshAuthMethodSchema,
  keyId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ServerPublic = z.infer<typeof serverPublicSchema>;

/** Результат проверки соединения (кнопка Test connection) */
export const connectionTestResultSchema = z.object({
  ok: z.boolean(),
  /** Вывод `uname -a` при успехе */
  uname: z.string().optional(),
  /** Сообщение об ошибке при провале */
  error: z.string().optional(),
  /** Время отклика, мс */
  latencyMs: z.number().optional(),
});
export type ConnectionTestResult = z.infer<typeof connectionTestResultSchema>;
