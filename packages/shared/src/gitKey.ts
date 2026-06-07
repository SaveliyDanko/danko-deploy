import { z } from "zod";

import { sshKeyTypeSchema } from "./sshKey.js";

/**
 * Git deploy-ключи. Отдельная сущность от VPS-ключей: приватная часть нужна
 * на сервере для clone приватного репозитория, публичную добавляют как Deploy
 * key в GitHub/GitLab. Наружу отдаётся только публичная часть.
 */

/** Публичное представление git-ключа (без приватной части) */
export const gitKeyPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  publicKey: z.string(),
  fingerprint: z.string(),
  createdAt: z.string(),
});
export type GitKeyPublic = z.infer<typeof gitKeyPublicSchema>;

/** Генерация новой пары git deploy-ключей */
export const generateGitKeySchema = z.object({
  name: z.string().min(1, "Укажите название ключа"),
  type: sshKeyTypeSchema.default("ed25519"),
  /** Длина для RSA (по умолчанию 4096). Для ed25519 игнорируется. */
  bits: z.number().int().min(2048).max(8192).optional(),
  /** Опциональная passphrase для шифрования приватного ключа */
  passphrase: z.string().optional(),
  /** comment в публичном ключе (по умолчанию name) */
  comment: z.string().optional(),
});
export type GenerateGitKeyInput = z.infer<typeof generateGitKeySchema>;

/** Импорт существующего приватного ключа (вставка PEM) */
export const importGitKeySchema = z.object({
  name: z.string().min(1, "Укажите название ключа"),
  privateKey: z.string().min(1, "Вставьте приватный ключ (PEM)"),
  passphrase: z.string().optional(),
});
export type ImportGitKeyInput = z.infer<typeof importGitKeySchema>;
