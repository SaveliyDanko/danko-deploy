import { NodeSSH } from "node-ssh";
import type { ClientChannel } from "ssh2";

import type { ServerCredentials } from "@dankodeploy/shared";

/** Параметры подключения к одному серверу (секреты уже расшифрованы). */
export interface SshTarget {
  id: string;
  host: string;
  port: number;
  username: string;
  credentials: ServerCredentials;
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

/**
 * Управляет SSH-соединениями: на каждый сервер держит одно живое соединение
 * и переиспользует его между командами. Потокобезопасен на уровне "одно
 * подключение на target.id" — параллельные вызовы для одного сервера ждут
 * установки общего соединения.
 */
export class SshExecutor {
  private readonly connections = new Map<string, NodeSSH>();
  private readonly connecting = new Map<string, Promise<NodeSSH>>();

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
    await ssh.connect({
      host: target.host,
      port: target.port,
      username: target.username,
      ...(credentials.authMethod === "key"
        ? { privateKey: credentials.privateKey, passphrase: credentials.passphrase }
        : { password: credentials.password }),
      readyTimeout: 15_000,
      keepaliveInterval: 10_000,
    });
    // Критично: ssh2-клиент пуловый и живёт долго. Асинхронные ошибки на нём
    // (keepalive-timeout простаивающего соединения, обрыв сети) эмитятся как
    // событие 'error' ВНЕ контекста промиса — необработанное оно роняет весь
    // процесс сервера. Гасим: логируем и выкидываем протухшее соединение из
    // пула, чтобы getConnection пересоздал его при следующем обращении.
    ssh.connection?.on("error", (err) => {
      console.error(`[ssh] соединение к ${target.id} (${target.host}) упало:`, classifySshError(err).message);
      this.disconnect(target.id);
    });
    return ssh;
  }

  /**
   * Признак «соединение живо по TCP, но новый канал на нём открыть нельзя».
   * Бывает на протухшем соединении из пула (сервер ребутнули / порвалась сеть, а
   * `isConnected()` ещё врёт `true`) или при упоре в `MaxSessions`. sshd отвечает
   * `Channel open failure: open failed`. По этому признаку соединение пересоздаём.
   */
  private isChannelOpenError(err: unknown): boolean {
    return classifySshError(err).kind === "channel";
  }

  /**
   * Выполняет операцию на пуловом соединении. Если падает на открытии канала
   * (см. isChannelOpenError) — сбрасывает соединение из пула и пробует ОДИН раз
   * переподключиться. Так протухшие соединения самоисцеляются без рестарта панели.
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
      // Соединение непригодно — выбрасываем из пула и переподключаемся заново.
      this.disconnect(target.id);
      const fresh = await this.getConnection(target);
      return op(fresh);
    }
  }

  /** Выполняет команду и возвращает полный результат. */
  async exec(target: SshTarget, command: string, cwd?: string): Promise<ExecResult> {
    return this.withConnection(target, async (ssh) => {
      const res = await ssh.execCommand(command, cwd ? { cwd } : {});
      return { code: res.code, stdout: res.stdout, stderr: res.stderr };
    });
  }

  /**
   * Выполняет команду, стримя stdout/stderr построчно в колбэки.
   * Возвращает код выхода. Используется для live-логов деплоя.
   */
  async execStream(
    target: SshTarget,
    command: string,
    handlers: ExecStreamHandlers,
    cwd?: string,
  ): Promise<number> {
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
      // Долить остатки без перевода строки
      if (stdoutBuf) handlers.onStdout?.(stdoutBuf);
      if (stderrBuf) handlers.onStderr?.(stderrBuf);

      return result.code ?? -1;
    });
  }

  /** Загружает локальный файл на сервер (для systemd-артефактов и т.п.). */
  async upload(target: SshTarget, localPath: string, remotePath: string): Promise<void> {
    const ssh = await this.getConnection(target);
    await ssh.putFile(localPath, remotePath);
  }

  /** Скачивает файл с сервера на машину панели (например, готовый бэкап). */
  async download(target: SshTarget, remotePath: string, localPath: string): Promise<void> {
    const ssh = await this.getConnection(target);
    await ssh.getFile(localPath, remotePath);
  }

  /**
   * Записывает строку в файл на сервере через SFTP (без временного файла на машине панели).
   * Используется для .env-файлов проектов; права выставляются отдельной командой вызывающим.
   */
  async writeFile(target: SshTarget, remotePath: string, content: string): Promise<void> {
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

  /**
   * Открывает интерактивный shell с pty (для веб-терминала). Возвращает ssh2-канал:
   * .on("data") — вывод, .write() — ввод, .setWindow() — ресайз, .end() — закрытие.
   * ssh2 мультиплексирует каналы на одном соединении, поэтому shell не мешает execCommand.
   */
  async openShell(
    target: SshTarget,
    opts: { rows: number; cols: number; term?: string },
  ): Promise<ClientChannel> {
    // withConnection пересоздаёт протухшее соединение, если sshd отвечает
    // "Channel open failure: open failed" на requestShell (главная причина
    // ошибки веб-терминала — мёртвое соединение в пуле после ребута VPS/сети).
    return this.withConnection(target, (ssh) =>
      ssh.requestShell({
        term: opts.term ?? "xterm-256color",
        rows: opts.rows,
        cols: opts.cols,
      }),
    );
  }

  /**
   * Проверяет соединение, выполняя `uname -a`. Открывает временное соединение,
   * чтобы не оставлять висящих коннектов при неуспехе настройки.
   */
  async testConnection(
    target: SshTarget,
  ): Promise<{ ok: boolean; uname?: string; error?: string; latencyMs: number }> {
    const started = Date.now();
    const ssh = new NodeSSH();
    try {
      const { credentials } = target;
      await ssh.connect({
        host: target.host,
        port: target.port,
        username: target.username,
        ...(credentials.authMethod === "key"
          ? { privateKey: credentials.privateKey, passphrase: credentials.passphrase }
          : { password: credentials.password }),
        readyTimeout: 15_000,
      });
      const res = await ssh.execCommand("uname -a");
      return {
        ok: res.code === 0,
        uname: res.stdout.trim() || undefined,
        error: res.code === 0 ? undefined : res.stderr.trim() || "Ненулевой код выхода",
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return {
        ok: false,
        error: classifySshError(err).message,
        latencyMs: Date.now() - started,
      };
    } finally {
      ssh.dispose();
    }
  }

  /** Закрывает соединение к конкретному серверу (например, после удаления/правки доступа). */
  disconnect(serverId: string): void {
    this.connections.get(serverId)?.dispose();
    this.connections.delete(serverId);
  }

  /** Закрывает все соединения (graceful shutdown). */
  disposeAll(): void {
    for (const ssh of this.connections.values()) ssh.dispose();
    this.connections.clear();
  }
}
