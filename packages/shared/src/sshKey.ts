import { z } from "zod";

export const sshKeyTypeSchema = z.enum(["ed25519", "rsa"]);
export type SshKeyType = z.infer<typeof sshKeyTypeSchema>;

/** Публичное представление ключа (без приватной части) */
export const sshKeyPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  publicKey: z.string(),
  fingerprint: z.string(),
  createdAt: z.string(),
});
export type SshKeyPublic = z.infer<typeof sshKeyPublicSchema>;

/** Импорт существующего ключа (вставка приватного PEM) */
export const importSshKeySchema = z.object({
  name: z.string().min(1, "Укажите название ключа"),
  privateKey: z.string().min(1, "Вставьте приватный ключ (PEM)"),
  passphrase: z.string().optional(),
});
export type ImportSshKeyInput = z.infer<typeof importSshKeySchema>;

/** Генерация новой пары ключей на backend */
export const generateSshKeySchema = z.object({
  name: z.string().min(1, "Укажите название ключа"),
  type: sshKeyTypeSchema.default("ed25519"),
  /** Длина для RSA (по умолчанию 4096). Для ed25519 игнорируется. */
  bits: z.number().int().min(2048).max(8192).optional(),
  /** Опциональная passphrase для шифрования приватного ключа */
  passphrase: z.string().optional(),
  /** comment в публичном ключе (по умолчанию name) */
  comment: z.string().optional(),
});
export type GenerateSshKeyInput = z.infer<typeof generateSshKeySchema>;

/** Запрос на развёртывание публичного ключа на сервер (ssh-copy-id) */
export const deployKeySchema = z.object({
  serverId: z.string().min(1),
});
export type DeployKeyInput = z.infer<typeof deployKeySchema>;

export const deployKeyResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
});
export type DeployKeyResult = z.infer<typeof deployKeyResultSchema>;
