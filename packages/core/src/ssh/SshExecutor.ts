import { createHash, timingSafeEqual } from "node:crypto";

import { NodeSSH } from "node-ssh";
import type { ClientChannel } from "ssh2";

import type { ConnectionType, ServerCredentials } from "@dankodeploy/shared";

import type { LocalExecutor } from "../local/LocalExecutor.js";

/**
 * Fingerprint host key сервера в формате OpenSSH ("SHA256:base64-без-паддинга").
 * Совпадает с выводом `ssh-keygen -lf` — пользователь может сверить глазами.
 */
export function hostKeyFingerprint(key: Buffer): string {
  return "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
}

/** Сравнение fingerprint'ов в постоянное время (защита от timing-атак). */
function fingerprintsEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Хранилище запомненных host key (TOFU). Реализуется на уровне сервера (БД).
 * `get` — известный fingerprint сервера (или undefined, если ещё не запоминали);
 * `set` — запомнить fingerprint при первом подключении (идемпотентно, не перетирает).
 */
export interface HostKeyStore {
  get(serverId: string): string | undefined;
  set(serverId: string, fingerprint: string): void;
}

/** Бросается, когда предъявленный host key НЕ совпал с запомненным (возможен MITM). */
export class HostKeyMismatchError extends Error {
  constructor(
    readonly serverId: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      "⚠ Ключ хоста сервера ИЗМЕНИЛСЯ — соединение разорвано (возможна подмена/MITM). " +
        `Ожидался ${expected}, получен ${actual}. Если вы сами пересоздали сервер — ` +
        "сбросьте запомненный ключ (кнопка «Сбросить ключ хоста» / POST /api/servers/:id/reset-host-key).",
    );
    this.name = "HostKeyMismatchError";
  }
}

/** Параметры подключения к одному серверу (секреты уже расшифрованы). */
export interface SshTarget {
  id: string;
  host: string;
  port: number;
  username: string;
  credentials: ServerCredentials;
  /** Тип подключения: ssh (по сети) или local (тот же хост). По умолчанию ssh. */
  connectionType?: ConnectionType;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Колбэки для построчного стриминга вывода (live-логи деплоя). */
export interface ExecStreamHandlers {
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

/** Категория SSH-ошибки — для понятного текста и реакции (backoff/ретрай). */
export type SshErrorKind =
  | "unreachable" // не доехали по сети/порту (TCP/таймаут/refused)
  | "handshake" // соединение рвётся до рукопожатия (часто перегруз/атака/MaxStartups на sshd)
  | "auth" // отказ аутентификации (ключ/пароль не подошли)
  | "channel" // соединение живо, но новый канал/pty открыть нельзя (протухло/MaxSessions)
  | "hostkey" // host key сервера не совпал с запомненным (возможен MITM)
  | "unknown";

export interface SshErrorInfo {
  kind: SshErrorKind;
  /** Человекочитаемое объяснение на русском (можно показывать в UI). */
  message: string;
  /** Исходное сообщение ssh2/node-ssh (для логов/дебага). */
  raw: string;
}

/**
 * Классифицирует ошибку SSH в понятную категорию и текст. Нужно, чтобы UI
 * показывал внятное «сервер недоступен» / «sshd перегружен или под атакой»
 * вместо сырого `Channel open failure: open failed`.
 */
export function classifySshError(err: unknown): SshErrorInfo {
  if (err instanceof HostKeyMismatchError) {
    return { kind: "hostkey", message: err.message, raw: err.message };
  }
  const raw = err instanceof Error ? err.message : String(err);
  const m = raw.toLowerCase();

  if (
    /econnrefused|ehostunreach|enetunreach|etimedout|timed out|getaddrinfo|enotfound|connect etimedout/.test(
      m,
    )
  ) {
    return {
      kind: "unreachable",
      message:
        "Сервер недоступен по сети: не отвечает порт SSH (проверьте, что VPS включён, порт открыт и firewall не блокирует).",
      raw,
    };
  }
  if (/before handshake|kex_exchange|connection closed by remote|connection reset/.test(m)) {
    return {
      kind: "handshake",
      message:
        "SSH рвёт соединение до рукопожатия. Обычно это перегруз или атака на sshd (исчерпан MaxStartups). Включите fail2ban и запрет парольного входа, при необходимости поднимите MaxStartups.",
      raw,
    };
  }
  if (/all configured authentication methods failed|permission denied|authentication/.test(m)) {
    return {
      kind: "auth",
      message:
        "Сервер отклонил аутентификацию: ключ или пароль не подошли (проверьте привязанный ключ/доступ пользователя).",
      raw,
    };
  }
  if (/open failed|channel open failure|not connected|no response from server/.test(m)) {
    return {
      kind: "channel",
      message:
        "Соединение живо, но новый канал открыть не удалось (соединение протухло или исчерпан MaxSessions). Панель переподключится автоматически — повторите действие.",
      raw,
    };
  }
  return { kind: "unknown", message: raw, raw };
}

/** Возвращает true, если сервер локальный (без SSH). */
export function isLocalTarget(target: SshTarget): boolean {
  return target.connectionType === "local";
}

/**
 * Управляет SSH-соединениями: на каждый сервер держит одно живое соединение
 * и переиспользует его между командами. Потокобезопасен на уровне "одно
 * подключение на target.id" — параллельные вызовы для одного сервера ждут
 * установки общего соединения.
 *
 * Для локальных серверов (connectionType = "local") делегирует вызовы
 * LocalExecutor (child_process вместо SSH), прозрачно для вызывающих.
 */
export class SshExecutor {
  private readonly connections = new Map<string, NodeSSH>();
  private readonly connecting = new Map<string, Promise<NodeSSH>>();
  private local: LocalExecutor | undefined;
  private hostKeys: HostKeyStore | undefined;

  /** Устанавливает LocalExecutor для локальных серверов. Вызывается при сборке контекста. */
  setLocal(executor: LocalExecutor): void {
    this.local = executor;
  }

  /** Подключает хранилище host key (TOFU-верификация). Вызывается при сборке контекста. */
  setHostKeyStore(store: HostKeyStore): void {
    this.hostKeys = store;
  }

  /**
   * Строит ssh2 hostVerifier с TOFU-логикой: при первом подключении запоминает
   * fingerprint, при последующих — сверяет. Несовпадение → cb(false) (ssh2 рвёт
   * рукопожатие), а getMismatch() даёт детали, чтобы бросить HostKeyMismatchError.
   * getFingerprint() — предъявленный ключ (для показа в UI после теста).
   */
  private buildHostVerifier(target: SshTarget): {
    hostVerifier: (key: Buffer, cb: (valid: boolean) => void) => void;
    getMismatch: () => HostKeyMismatchError | undefined;
    getFingerprint: () => string | undefined;
  } {
    let mismatch: HostKeyMismatchError | undefined;
    let seen: string | undefined;
    const hostVerifier = (key: Buffer, cb: (valid: boolean) => void): void => {
      const fp = hostKeyFingerprint(key);
      seen = fp;
      const known = this.hostKeys?.get(target.id);
      if (!known) {
        // TOFU: запоминаем при первом подключении (для probe/неизвестного id — no-op).
        this.hostKeys?.set(target.id, fp);
        cb(true);
        return;
      }
      if (fingerprintsEqual(known, fp)) {
        cb(true);
        return;
      }
      mismatch = new HostKeyMismatchError(target.id, known, fp);
      cb(false);
    };
    return { hostVerifier, getMismatch: () => mismatch, getFingerprint: () => seen };
  }

  /** Возвращает (создавая при необходимости) живое соединение к серверу. */
  private async getConnection(target: SshTarget): Promise<NodeSSH> {
    const existing = this.connections.get(target.id);
    if (existing && existing.isConnected()) return existing;

    const pending = this.connecting.get(target.id);
    if (pending) return pending;

    const promise = this.connect(target)
      .then((ssh) => {
        this.connections.set(target.id, ssh);
        this.connecting.delete(target.id);
        return ssh;
      })
      .catch((err) => {
        this.connecting.delete(target.id);
        throw err;
      });

    this.connecting.set(target.id, promise);
    return promise;
  }

  private async connect(target: SshTarget): Promise<NodeSSH> {
    const ssh = new NodeSSH();
    const { credentials } = target;
    const verifier = this.buildHostVerifier(target);
    try {
      await ssh.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        ...(credentials.authMethod === "key"
          ? { privateKey: credentials.privateKey, passphrase: credentials.passphrase }
          : { password: credentials.password }),
        hostVerifier: verifier.hostVerifier,
        readyTimeout: 15_000,
        keepaliveInterval: 10_000,
      });
    } catch (err) {
      // Если рукопожатие упало из-за несовпадения host key — бросаем понятную ошибку.
      const mismatch = verifier.getMismatch();
      if (mismatch) throw mismatch;
      throw err;
    }
    ssh.connection?.on("error", (err) => {
      console.error(`[ssh] соединение к ${target.id} (${target.host}) упало:`, classifySshError(err).message);
      this.disconnect(target.id);
    });
    return ssh;
  }

  /** Признак «соединение живо по TCP, но новый канал на нём открыть нельзя». */
  private isChannelOpenError(err: unknown): boolean {
    return classifySshError(err).kind === "channel";
  }

  /**
   * Выполняет операцию на пуловом соединении. Если падает на открытии канала
   * — сбрасывает соединение из пула и пробует ОДИН раз переподключиться.
   */
  private async withConnection<T>(
    target: SshTarget,
    op: (ssh: NodeSSH) => Promise<T>,
  ): Promise<T> {
    const ssh = await this.getConnection(target);
    try {
      return await op(ssh);
    } catch (err) {
      if (!this.isChannelOpenError(err)) throw err;
      this.disconnect(target.id);
      const fresh = await this.getConnection(target);
      return op(fresh);
    }
  }

  // ─── Публичные методы ────────────────────────────────────────────

  /** Выполняет команду и возвращает полный результат (SSH или локально). */
  async exec(target: SshTarget, command: string, cwd?: string): Promise<ExecResult> {
    if (isLocalTarget(target)) return this.local!.exec(target, command, cwd);
    return this.withConnection(target, async (ssh) => {
      const res = await ssh.execCommand(command, cwd ? { cwd } : {});
      return { code: res.code, stdout: res.stdout, stderr: res.stderr };
    });
  }

  /** Выполняет команду, стримя stdout/stderr построчно (SSH или локально). */
  async execStream(
    target: SshTarget,
    command: string,
    handlers: ExecStreamHandlers,
    cwd?: string,
  ): Promise<number> {
    if (isLocalTarget(target)) return this.local!.execStream(target, command, handlers, cwd);

    const flush = (buf: string, emit?: (line: string) => void): string => {
      const parts = buf.split("\n");
      const rest = parts.pop() ?? "";
      for (const line of parts) emit?.(line);
      return rest;
    };

    return this.withConnection(target, async (ssh) => {
      let stdoutBuf = "";
      let stderrBuf = "";

      const result = await ssh.execCommand(command, {
        cwd,
        onStdout: (chunk) => {
          stdoutBuf += chunk.toString("utf8");
          stdoutBuf = flush(stdoutBuf, handlers.onStdout);
        },
        onStderr: (chunk) => {
          stderrBuf += chunk.toString("utf8");
          stderrBuf = flush(stderrBuf, handlers.onStderr);
        },
      });
      if (stdoutBuf) handlers.onStdout?.(stdoutBuf);
      if (stderrBuf) handlers.onStderr?.(stderrBuf);

      return result.code ?? -1;
    });
  }

  /** Загружает локальный файл на сервер (SSH или локально). */
  async upload(target: SshTarget, localPath: string, remotePath: string): Promise<void> {
    if (isLocalTarget(target)) return this.local!.upload(target, localPath, remotePath);
    const ssh = await this.getConnection(target);
    await ssh.putFile(localPath, remotePath);
  }

  /** Скачивает файл с сервера на машину панели (SSH или локально). */
  async download(target: SshTarget, remotePath: string, localPath: string): Promise<void> {
    if (isLocalTarget(target)) return this.local!.download(target, remotePath, localPath);
    const ssh = await this.getConnection(target);
    await ssh.getFile(localPath, remotePath);
  }

  /** Записывает строку в файл на сервере (SSH/SFTP или локально). */
  async writeFile(target: SshTarget, remotePath: string, content: string): Promise<void> {
    if (isLocalTarget(target)) return this.local!.writeFile(target, remotePath, content);
    return this.withConnection(target, async (ssh) => {
      const sftp = await ssh.requestSFTP();
      await new Promise<void>((resolve, reject) => {
        const stream = sftp.createWriteStream(remotePath);
        stream.on("error", reject);
        stream.on("close", () => resolve());
        stream.end(content);
      });
    });
  }

  /** Открывает интерактивный shell с pty (SSH или локально). */
  async openShell(
    target: SshTarget,
    opts: { rows: number; cols: number; term?: string },
  ): Promise<ClientChannel> {
    if (isLocalTarget(target)) return this.local!.openShell(target, opts);
    return this.withConnection(target, (ssh) =>
      ssh.requestShell({
        term: opts.term ?? "xterm-256color",
        rows: opts.rows,
        cols: opts.cols,
      }),
    );
  }

  /** Проверяет соединение (SSH или локально). */
  async testConnection(
    target: SshTarget,
  ): Promise<{
    ok: boolean;
    uname?: string;
    error?: string;
    latencyMs: number;
    hostKeyFingerprint?: string;
  }> {
    if (isLocalTarget(target)) return this.local!.testConnection(target);

    const started = Date.now();
    const ssh = new NodeSSH();
    const verifier = this.buildHostVerifier(target);
    try {
      const { credentials } = target;
      await ssh.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        ...(credentials.authMethod === "key"
          ? { privateKey: credentials.privateKey, passphrase: credentials.passphrase }
          : { password: credentials.password }),
        hostVerifier: verifier.hostVerifier,
        readyTimeout: 15_000,
      });
      const res = await ssh.execCommand("uname -a");
      return {
        ok: res.code === 0,
        uname: res.stdout.trim() || undefined,
        error: res.code === 0 ? undefined : res.stderr.trim() || "Ненулевой код выхода",
        latencyMs: Date.now() - started,
        hostKeyFingerprint: verifier.getFingerprint(),
      };
    } catch (err) {
      const mismatch = verifier.getMismatch();
      return {
        ok: false,
        error: classifySshError(mismatch ?? err).message,
        latencyMs: Date.now() - started,
        hostKeyFingerprint: verifier.getFingerprint(),
      };
    } finally {
      ssh.dispose();
    }
  }

  /** Закрывает соединение к конкретному серверу (SSH или локально). */
  disconnect(serverId: string): void {
    this.connections.get(serverId)?.dispose();
    this.connections.delete(serverId);
    this.local?.disconnect(serverId);
  }

  /** Закрывает все соединения (graceful shutdown). */
  disposeAll(): void {
    for (const ssh of this.connections.values()) ssh.dispose();
    this.connections.clear();
    this.local?.disposeAll();
  }
}