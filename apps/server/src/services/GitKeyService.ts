import { decryptSecret, encryptSecret, KeyManager } from "@dankodeploy/core";
import { type Db, gitKeys, type GitKeyRow } from "@dankodeploy/db";
import type { GenerateGitKeyInput, GitKeyPublic, ImportGitKeyInput } from "@dankodeploy/shared";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

export function toGitKeyPublic(row: GitKeyRow): GitKeyPublic {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    publicKey: row.publicKey,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt,
  };
}

/** Расшифрованный приватный git-ключ (для clone приватного репозитория). */
export interface DecryptedGitKey {
  privateKey: string;
  passphrase?: string;
}

/**
 * Хранилище Git deploy-ключей. Приватная часть шифруется AES-256-GCM; наружу
 * отдаются только публичные поля. Умеет генерировать пары и импортировать.
 * В отличие от SshKeyService, на сервер ничего не разворачивает — приватный
 * ключ временно подставляется при первичной раскатке и последующих git pull.
 */
export class GitKeyService {
  private readonly keys = new KeyManager();

  constructor(
    private readonly db: Db,
    private readonly masterKey: Buffer,
  ) {}

  list(): GitKeyPublic[] {
    return this.db.select().from(gitKeys).all().map(toGitKeyPublic);
  }

  getRow(id: string): GitKeyRow | undefined {
    return this.db.select().from(gitKeys).where(eq(gitKeys.id, id)).get();
  }

  /** Расшифровывает приватный ключ для использования при git clone. */
  decrypt(row: GitKeyRow): DecryptedGitKey {
    return {
      privateKey: decryptSecret(row.privateKeyEnc, this.masterKey),
      passphrase: row.passphraseEnc
        ? decryptSecret(row.passphraseEnc, this.masterKey)
        : undefined,
    };
  }

  private persist(opts: {
    name: string;
    type: string;
    publicKey: string;
    fingerprint: string;
    privateKey: string;
    passphrase?: string;
  }): GitKeyPublic {
    const id = nanoid();
    this.db
      .insert(gitKeys)
      .values({
        id,
        name: opts.name,
        type: opts.type,
        publicKey: opts.publicKey,
        fingerprint: opts.fingerprint,
        privateKeyEnc: encryptSecret(opts.privateKey, this.masterKey),
        passphraseEnc: opts.passphrase
          ? encryptSecret(opts.passphrase, this.masterKey)
          : null,
      })
      .run();
    return toGitKeyPublic(this.getRow(id)!);
  }

  /** Генерирует новую пару deploy-ключей и сохраняет в хранилище. */
  async generate(input: GenerateGitKeyInput): Promise<GitKeyPublic> {
    const generated = await this.keys.generate({
      type: input.type,
      bits: input.bits,
      passphrase: input.passphrase,
      comment: input.comment ?? input.name,
    });
    return this.persist({
      name: input.name,
      type: generated.type,
      publicKey: generated.publicKey,
      fingerprint: generated.fingerprint,
      privateKey: generated.privateKey,
      passphrase: input.passphrase,
    });
  }

  /** Импортирует существующий приватный ключ (извлекая публичный и fingerprint). */
  async import(input: ImportGitKeyInput): Promise<GitKeyPublic> {
    const info = await this.keys.inspectPrivateKey(input.privateKey, input.passphrase);
    return this.persist({
      name: input.name,
      type: info.type,
      publicKey: info.publicKey,
      fingerprint: info.fingerprint,
      privateKey: input.privateKey,
      passphrase: input.passphrase,
    });
  }

  delete(id: string): boolean {
    const res = this.db.delete(gitKeys).where(eq(gitKeys.id, id)).run();
    return res.changes > 0;
  }
}
