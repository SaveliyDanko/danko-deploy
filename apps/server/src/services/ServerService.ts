import { decryptSecret, encryptSecret, type SshExecutor, type SshTarget } from "@dankodeploy/core";
import {
  type Db,
  servers,
  type ServerRow,
} from "@dankodeploy/db";
import {
  type ConnectionTestResult,
  type CreateServerInput,
  type ServerCredentials,
  type ServerPublic,
  type UpdateServerInput,
} from "@dankodeploy/shared";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";

/** Преобразует строку БД в публичный вид (без секретов). */
export function toServerPublic(row: ServerRow): ServerPublic {
  return {
    id: row.id,
    name: row.name,
    connectionType: row.connectionType as "ssh" | "local",
    host: row.host,
    port: row.port,
    username: row.username,
    authMethod: row.authMethod as "key" | "password" | "stored-key" | null,
    keyId: row.keyId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Резолвер приватного ключа из хранилища по keyId (внедряется после сборки SshKeyService). */
export type KeyResolver = (keyId: string) => { privateKey: string; passphrase?: string } | undefined;

/**
 * CRUD по серверам + сборка SshTarget (с расшифровкой секретов).
 */
export class ServerService {
  private keyResolver: KeyResolver | undefined;

  constructor(
    private readonly db: Db,
    private readonly ssh: SshExecutor,
    private readonly masterKey: Buffer,
  ) {}

  setKeyResolver(resolver: KeyResolver): void {
    this.keyResolver = resolver;
  }

  list(): ServerPublic[] {
    return this.db.select().from(servers).all().map(toServerPublic);
  }

  get(id: string): ServerRow | undefined {
    return this.db.select().from(servers).where(eq(servers.id, id)).get();
  }

  getPublic(id: string): ServerPublic | undefined {
    const row = this.get(id);
    return row ? toServerPublic(row) : undefined;
  }

  async containerLogs(
    serverId: string,
    name: string,
    tail: number,
  ): Promise<{ logs: string } | { error: string }> {
    const row = this.get(serverId);
    if (!row) return { error: "Сервер не найден" };

    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name)) {
      return { error: "Недопустимое имя контейнера" };
    }
    const tailN = Math.min(Math.max(Math.trunc(tail) || 200, 1), 2000);

    try {
      const res = await this.ssh.exec(
        this.toTarget(row),
        `docker logs --tail ${tailN} --timestamps ${name} 2>&1 || true`,
      );
      return { logs: res.stdout || "(логи пусты)" };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }

  create(input: CreateServerInput): ServerPublic {
    const id = nanoid();
    const isLocal = input.connectionType === "local";
    const isStored = !isLocal && input.credentials?.authMethod === "stored-key";

    const secretEnc =
      isLocal || isStored
        ? null
        : input.credentials
          ? encryptSecret(JSON.stringify(input.credentials), this.masterKey)
          : null;

    this.db
      .insert(servers)
      .values({
        id,
        name: input.name,
        connectionType: input.connectionType,
        host: isLocal ? "localhost" : (input.host ?? "localhost"),
        port: isLocal ? 22 : (input.port ?? 22),
        username: isLocal ? "root" : (input.username ?? "root"),
        authMethod: isLocal ? null : (input.credentials?.authMethod ?? null),
        secretEnc,
        keyId: isStored ? (input.keyId ?? null) : null,
      })
      .run();
    const row = this.get(id);
    if (!row) throw new Error("Не удалось создать сервер");
    return toServerPublic(row);
  }

  update(id: string, input: UpdateServerInput): ServerPublic | undefined {
    const existing = this.get(id);
    if (!existing) return undefined;

    const patch: Partial<ServerRow> = { updatedAt: new Date().toISOString() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.host !== undefined) patch.host = input.host;
    if (input.port !== undefined) patch.port = input.port;
    if (input.username !== undefined) patch.username = input.username;
    if (input.keyId !== undefined) patch.keyId = input.keyId;
    if (input.connectionType !== undefined) patch.connectionType = input.connectionType;

    if (input.credentials) {
      patch.authMethod = input.credentials.authMethod;
      if (input.credentials.authMethod === "stored-key") {
        patch.secretEnc = null;
        if (input.keyId !== undefined) patch.keyId = input.keyId;
      } else {
        patch.secretEnc = encryptSecret(JSON.stringify(input.credentials), this.masterKey);
        patch.keyId = null;
      }
    }

    this.db.update(servers).set(patch).where(eq(servers.id, id)).run();
    this.ssh.disconnect(id);
    const row = this.get(id);
    if (!row) return undefined;
    return toServerPublic(row);
  }

  delete(id: string): boolean {
    this.ssh.disconnect(id);
    const res = this.db.delete(servers).where(eq(servers.id, id)).run();
    return res.changes > 0;
  }

  disconnect(id: string): void {
    this.ssh.disconnect(id);
  }

  toTarget(row: ServerRow): SshTarget {
    if (row.connectionType === "local") {
      return {
        id: row.id,
        host: "localhost",
        port: 22,
        username: "root",
        credentials: { authMethod: "key", privateKey: "" },
        connectionType: "local",
      };
    }

    let credentials: ServerCredentials;

    if (row.authMethod === "stored-key") {
      if (!row.keyId) throw new Error("Сервер использует ключ из хранилища, но keyId не задан");
      const resolved = this.keyResolver?.(row.keyId);
      if (!resolved) {
        throw new Error(
          "Ключ из хранилища не найден (возможно, удалён). Назначьте серверу другой ключ.",
        );
      }
      credentials = {
        authMethod: "key",
        privateKey: resolved.privateKey,
        passphrase: resolved.passphrase,
      };
    } else {
      if (!row.secretEnc) throw new Error("У сервера отсутствуют сохранённые учётные данные");
      credentials = JSON.parse(decryptSecret(row.secretEnc, this.masterKey)) as ServerCredentials;
    }

    return {
      id: row.id,
      host: row.host,
      port: row.port,
      username: row.username,
      credentials,
    };
  }

  testConnection(id: string): Promise<ConnectionTestResult | undefined> {
    const row = this.get(id);
    if (!row) return Promise.resolve(undefined);
    return this.ssh.testConnection(this.toTarget(row));
  }

  testRaw(input: CreateServerInput): Promise<ConnectionTestResult> {
    if (input.connectionType === "local") {
      return this.ssh.testConnection({
        id: "probe",
        host: "localhost",
        port: 22,
        username: "root",
        credentials: { authMethod: "key", privateKey: "" },
        connectionType: "local",
      });
    }

    let credentials = input.credentials!;
    if (credentials.authMethod === "stored-key") {
      const resolved = input.keyId ? this.keyResolver?.(input.keyId) : undefined;
      if (!resolved) {
        return Promise.resolve({
          ok: false,
          error: "Выбранный ключ из хранилища не найден",
          latencyMs: 0,
        });
      }
      credentials = {
        authMethod: "key",
        privateKey: resolved.privateKey,
        passphrase: resolved.passphrase,
      };
    }
    return this.ssh.testConnection({
      id: "probe",
      host: input.host!,
      port: input.port!,
      username: input.username!,
      credentials,
    });
  }
}