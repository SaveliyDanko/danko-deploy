import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ClientChannel } from "ssh2";

import type { ExecResult, ExecStreamHandlers, SshTarget } from "../ssh/SshExecutor.js";

/**
 * Выполняет команды локально на том же хосте, где запущена панель.
 * Использует child_process (execSync / spawn) вместо SSH.
 *
 * Когда панель в Docker-контейнере — определяет PID namespace и использует
 * `nsenter -t 1 -m -u -i -n -p -- <command>` для доступа к хосту.
 */
export class LocalExecutor {
  private inContainer: boolean;

  constructor() {
    this.inContainer = existsSync("/.dockerenv");
  }

  /** Оборачивает команду в `nsenter`, если мы в контейнере. */
  private wrap(command: string): string {
    if (!this.inContainer) return command;
    return `nsenter -t 1 -m -u -i -n -p -- ${command}`;
  }

  /** Выполняет команду и возвращает полный результат. */
  exec(target: SshTarget, command: string, cwd?: string): ExecResult {
    const fullCmd = this.wrap(command);
    const options: { cwd?: string; timeout?: number } = {};
    if (cwd) options.cwd = cwd;
    try {
      const stdout = execSync(fullCmd, { ...options, encoding: "utf-8", timeout: 120_000 });
      return { code: 0, stdout, stderr: "" };
    } catch (err: unknown) {
      const e = err as { code?: number | null; stdout?: string; stderr?: string };
      return {
        code: e.code ?? -1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? String(err),
      };
    }
  }

  async execStream(
    target: SshTarget,
    command: string,
    handlers: ExecStreamHandlers,
    cwd?: string,
  ): Promise<number> {
    const fullCmd = this.wrap(command);
    return new Promise<number>((resolve) => {
      const proc = spawn(fullCmd, {
        shell: true,
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdoutBuf = "";
      let stderrBuf = "";

      const flush = (buf: string, emit?: (line: string) => void): string => {
        const parts = buf.split("\n");
        const rest = parts.pop() ?? "";
        for (const line of parts) emit?.(line);
        return rest;
      };

      proc.stdout?.on("data", (chunk: Buffer) => {
        stdoutBuf += chunk.toString("utf8");
        stdoutBuf = flush(stdoutBuf, handlers.onStdout);
      });
      proc.stderr?.on("data", (chunk: Buffer) => {
        stderrBuf += chunk.toString("utf8");
        stderrBuf = flush(stderrBuf, handlers.onStderr);
      });

      proc.on("close", (code) => {
        if (stdoutBuf) handlers.onStdout?.(stdoutBuf);
        if (stderrBuf) handlers.onStderr?.(stderrBuf);
        resolve(code ?? -1);
      });
      proc.on("error", () => resolve(-1));
    });
  }

  async upload(target: SshTarget, localPath: string, remotePath: string): Promise<void> {
    if (this.inContainer) {
      const content = await readFile(localPath);
      const b64 = content.toString("base64");
      this.exec(target, `mkdir -p "$(dirname '${remotePath}')"`);
      this.exec(target, `echo '${b64}' | base64 -d > '${remotePath}'`);
    } else {
      const dir = dirname(remotePath);
      await mkdir(dir, { recursive: true });
      await copyFile(localPath, remotePath);
    }
  }

  async download(target: SshTarget, remotePath: string, localPath: string): Promise<void> {
    if (this.inContainer) {
      const res = this.exec(target, `cat '${remotePath}' | base64`);
      const buf = Buffer.from(res.stdout.trim(), "base64");
      const dir = dirname(localPath);
      await mkdir(dir, { recursive: true });
      await writeFile(localPath, buf);
    } else {
      const dir = dirname(localPath);
      await mkdir(dir, { recursive: true });
      await copyFile(remotePath, localPath);
    }
  }

  writeFile(target: SshTarget, remotePath: string, content: string): void {
    const b64 = Buffer.from(content, "utf-8").toString("base64");
    this.exec(target, `mkdir -p "$(dirname '${remotePath}')"`);
    this.exec(target, `echo '${b64}' | base64 -d > '${remotePath}'`);
  }

  /**
   * Открывает интерактивный shell с настоящим PTY на локальном хосте.
   *
   * Использует системную утилиту `script` (util-linux) для создания
   * псевдотерминала: `script -qfc "exec $SHELL" /dev/null`.
   *
   * `script` создаёт PTY-пару, запускает shell внутри неё, и пробрасывает
   * stdin→PTY и PTY→stdout через pipe'ы. Это даёт bash полноценный интерактивный
   * режим: промпт, readline, цвета, управляющие последовательности.
   *
   * Из Docker используется `nsenter -t 1` для доступа к хосту.
   */
  openShell(
    target: SshTarget,
    opts: { rows: number; cols: number; term?: string },
  ): ClientChannel {
    const shell = process.env.SHELL ?? "/bin/bash";

    // script -qfc "exec bash" /dev/null
    //   -q  тихий режим (не пишет "Script started/done")
    //   -f  flush после каждого write (нужно для интерактивности)
    //   -c CMD  команда вместо интерактивного shell
    const cmd = `script -qfc "exec ${shell}" /dev/null`;
    const fullCmd = this.wrap(cmd);

    const proc = spawn(fullCmd, {
      shell: true,
      env: {
        ...process.env,
        TERM: opts.term ?? "xterm-256color",
        COLUMNS: String(opts.cols),
        LINES: String(opts.rows),
      },
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Эмулируем интерфейс ClientChannel для совместимости с TerminalBridge.
    // ssh2 ClientChannel использует: .on("data", cb), .on("close", cb),
    // .write(buf), .setWindow(rows, cols), .end(), .close().
    const dataHandlers: Array<(buf: Buffer) => void> = [];
    const closeHandlers: Array<(code?: number) => void> = [];

    proc.stdout?.on("data", (chunk: Buffer) => {
      for (const h of dataHandlers) h(chunk);
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      for (const h of dataHandlers) h(chunk);
    });

    proc.on("close", (code) => {
      for (const h of closeHandlers) h(code ?? undefined);
    });

    const channel = {
      on: (event: string, handler: (...args: unknown[]) => void): void => {
        if (event === "data") {
          dataHandlers.push(handler as (buf: Buffer) => void);
        } else if (event === "close") {
          closeHandlers.push(handler as (code?: number) => void);
        }
      },
      write: (data: string): boolean => {
        return proc.stdin?.write(data) ?? false;
      },
      setWindow: (_rows: number, _cols: number): void => {
        // stty применяется к PTY внутри script
        this.exec(target, `stty rows ${_rows} cols ${_cols} 2>/dev/null || true`);
      },
      end: (): void => {
        proc.stdin?.end();
        proc.kill("SIGTERM");
      },
      close: (): void => {
        proc.stdin?.end();
        proc.kill("SIGKILL");
      },
    } as unknown as ClientChannel;

    return channel;
  }

  testConnection(
    target: SshTarget,
  ): { ok: boolean; uname?: string; error?: string; latencyMs: number } {
    const started = Date.now();
    try {
      const res = this.exec(target, "uname -a");
      return {
        ok: true,
        uname: res.stdout.trim() || undefined,
        latencyMs: Date.now() - started,
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - started,
      };
    }
  }

  disconnect(_serverId: string): void {
    // Никаких соединений не держим
  }

  disposeAll(): void {
    // Ничего не чистим
  }
}