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
    host: row.host,
    port: row.port,
    username: row.username,
    authMethod: row.authMethod,
    keyId: row.keyId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Резолвер приватного ключа из хранилища по keyId (внедряется после сборки SshKeyService). */
export type KeyResolver = (keyId: string) => { privateKey: string; passphrase?: string } | undefined;

/**
 * CRUD по серверам + сборка SshTarget (с расшифровкой секретов).
 * Секреты шифруются мастер-ключом при сохранении и расшифровываются только
 * в момент построения SshTarget для конкретной операции.
 */
export class ServerService {
  /** Лениво внедряется из SshKeyService — разрывает циклическую зависимость. */
  private keyResolver: KeyResolver | undefined;

  constructor(
    private readonly db: Db,
    private readonly ssh: SshExecutor,
    private readonly masterKey: Buffer,
  ) {}

  /** Устанавливает резолвер ключей из хранилища (вызывается при сборке контекста). */
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

  /**
   * Возвращает последние `tail` строк логов docker-контейнера (`docker logs`).
   * Имя контейнера валидируется (только символы docker-имён), чтобы не дать
   * инъекцию в shell. tail ограничивается разумным диапазоном.
   */
  async containerLogs(
    serverId: string,
    name: string,
    tail: number,
  ): Promise<{ logs: string } | { error: string }> {
    const row = this.get(serverId);
    if (!row) return { error: "Сервер не найден" };

    // Имена docker-контейнеров: буквы/цифры/_/./-. Любой другой символ — отказ.
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
    const isStored = input.credentials.authMethod === "stored-key";
    // Для stored-key inline-секреты не храним; иначе шифруем учётные данные.
    const secretEnc = isStored
      ? null
      : encryptSecret(JSON.stringify(input.credentials), this.masterKey);
    this.db
      .insert(servers)
      .values({
        id,
        name: input.name,
        host: input.host,
        port: input.port,
        username: input.username,
        authMethod: input.credentials.authMethod,
        secretEnc,
        keyId: isStored ? (input.keyId ?? null) : null,
      })
      .run();
    return toServerPublic(this.get(id)!);
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
    // Сбрасываем кэшированное соединение — параметры могли измениться
    this.ssh.disconnect(id);
    return toServerPublic(this.get(id)!);
  }

  delete(id: string): boolean {
    this.ssh.disconnect(id);
    const res = this.db.delete(servers).where(eq(servers.id, id)).run();
    return res.changes > 0;
  }

  /** Сбрасывает кэшированное SSH-соединение к серверу. */
  disconnect(id: string): void {
    this.ssh.disconnect(id);
  }

  /**
   * Строит SshTarget из строки БД, расшифровывая секреты.
   * Для authMethod = "stored-key" подтягивает приватный ключ из хранилища через keyResolver.
   */
  toTarget(row: ServerRow): SshTarget {
    let credentials: ServerCredentials;

    if (row.authMethod === "stored-key") {
      if (!row.keyId) throw new Error("Сервер использует ключ из хранилища, но keyId не задан");
      const resolved = this.keyResolver?.(row.keyId);
      if (!resolved) {
        throw new Error("Ключ из хранилища не найден (возможно, удалён). Назначьте серверу другой ключ.");
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

  /** Проверяет соединение с уже сохранённым сервером. */
  async testConnection(id: string): Promise<ConnectionTestResult | undefined> {
    const row = this.get(id);
    if (!row) return undefined;
    return this.ssh.testConnection(this.toTarget(row));
  }

  /** Проверяет соединение с ещё не сохранёнными параметрами (форма создания). */
  async testRaw(input: CreateServerInput): Promise<ConnectionTestResult> {
    let credentials = input.credentials;
    if (input.credentials.authMethod === "stored-key") {
      const resolved = input.keyId ? this.keyResolver?.(input.keyId) : undefined;
      if (!resolved) {
        return { ok: false, error: "Выбранный ключ из хранилища не найден", latencyMs: 0 };
      }
      credentials = {
        authMethod: "key",
        privateKey: resolved.privateKey,
        passphrase: resolved.passphrase,
      };
    }
    return this.ssh.testConnection({
      id: "probe",
      host: input.host,
      port: input.port,
      username: input.username,
      credentials,
    });
  }
}
