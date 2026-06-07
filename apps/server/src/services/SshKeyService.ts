import {
  decryptSecret,
  encryptSecret,
  KeyManager,
  type SshExecutor,
} from "@dankodeploy/core";
import { type Db, sshKeys, type SshKeyRow } from "@dankodeploy/db";
import type {
  DeployKeyResult,
  GenerateSshKeyInput,
  ImportSshKeyInput,
  SshKeyPublic,
} from "@dankodeploy/shared";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { ServerService } from "./ServerService.js";

export function toSshKeyPublic(row: SshKeyRow): SshKeyPublic {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    publicKey: row.publicKey,
    fingerprint: row.fingerprint,
    createdAt: row.createdAt,
  };
}

/** Расшифрованный приватный ключ + passphrase (для построения SSH-доступа). */
export interface DecryptedKey {
  privateKey: string;
  passphrase?: string;
}

/**
 * Хранилище SSH-ключей. Приватная часть шифруется AES-256-GCM; наружу отдаются
 * только публичные поля. Умеет генерировать пары, импортировать, разворачивать
 * публичный ключ на сервер.
 */
export class SshKeyService {
  private readonly keys = new KeyManager();

  constructor(
    private readonly db: Db,
    private readonly ssh: SshExecutor,
    private readonly masterKey: Buffer,
    private readonly servers: ServerService,
  ) {}

  list(): SshKeyPublic[] {
    return this.db.select().from(sshKeys).all().map(toSshKeyPublic);
  }

  getRow(id: string): SshKeyRow | undefined {
    return this.db.select().from(sshKeys).where(eq(sshKeys.id, id)).get();
  }

  /** Расшифровывает приватный ключ для использования при SSH-подключении. */
  decrypt(row: SshKeyRow): DecryptedKey {
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
  }): SshKeyPublic {
    const id = nanoid();
    this.db
      .insert(sshKeys)
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
    return toSshKeyPublic(this.getRow(id)!);
  }

  /** Генерирует новую пару ключей и сохраняет в хранилище. */
  async generate(input: GenerateSshKeyInput): Promise<SshKeyPublic> {
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
  async import(input: ImportSshKeyInput): Promise<SshKeyPublic> {
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
    const res = this.db.delete(sshKeys).where(eq(sshKeys.id, id)).run();
    return res.changes > 0;
  }

  /** Разворачивает публичный ключ на указанный сервер (добавляет в authorized_keys). */
  async deployToServer(keyId: string, serverId: string): Promise<DeployKeyResult | undefined> {
    const keyRow = this.getRow(keyId);
    if (!keyRow) return undefined;
    const serverRow = this.servers.get(serverId);
    if (!serverRow) return { ok: false, message: "Сервер не найден" };

    const target = this.servers.toTarget(serverRow);
    return this.keys.deployPublicKey(this.ssh, target, keyRow.publicKey);
  }
}
