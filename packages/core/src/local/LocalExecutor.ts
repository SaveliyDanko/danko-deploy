import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ClientChannel } from "ssh2";

import type { ExecResult, ExecStreamHandlers, SshTarget } from "../ssh/SshExecutor.js";

const COMMAND_TIMEOUT = 60_000;

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

  /** Выполняет команду и возвращает полный результат (таймаут 60с). */
  exec(target: SshTarget, command: string, cwd?: string): ExecResult {
    const fullCmd = this.wrap(command);
    const options: { cwd?: string; timeout?: number } = {};
    if (cwd) options.cwd = cwd;
    try {
      const stdout = execSync(fullCmd, {
        ...options,
        encoding: "utf-8",
        timeout: COMMAND_TIMEOUT,
      });
      return { code: 0, stdout, stderr: "" };
    } catch (err: unknown) {
      const e = err as { code?: number | null; stdout?: string; stderr?: string; killed?: boolean };
      if (e.killed) {
        return {
          code: -1,
          stdout: e.stdout ?? "",
          stderr: `Команда прервана по таймауту (${COMMAND_TIMEOUT / 1000}с)`,
        };
      }
      return {
        code: e.code ?? -1,
        stdout: e.stdout ?? "",
        stderr: e.stderr ?? String(err),
      };
    }
  }

  /** Выполняет команду, стримя stdout/stderr построчно в колбэки (таймаут 60с). */
  async execStream(
    target: SshTarget,
    command: string,
    handlers: ExecStreamHandlers,
    cwd?: string,
  ): Promise<number> {
    const fullCmd = this.wrap(command);
    return new Promise<number>((resolve) => {
      const timer = setTimeout(() => {
        proc.kill("SIGKILL");
        handlers.onStderr?.(`Команда прервана по таймауту (${COMMAND_TIMEOUT / 1000}с)`);
        resolve(-1);
      }, COMMAND_TIMEOUT);

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
        clearTimeout(timer);
        if (stdoutBuf) handlers.onStdout?.(stdoutBuf);
        if (stderrBuf) handlers.onStderr?.(stderrBuf);
        resolve(code ?? -1);
      });
      proc.on("error", () => {
        clearTimeout(timer);
        resolve(-1);
      });
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
   * Использует системную утилиту `script` (util-linux): `script -qfc "exec $SHELL" /dev/null`.
   */
  openShell(
    target: SshTarget,
    opts: { rows: number; cols: number; term?: string },
  ): ClientChannel {
    const shell = process.env.SHELL ?? "/bin/bash";
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
        if (event === "data") dataHandlers.push(handler as (buf: Buffer) => void);
        else if (event === "close") closeHandlers.push(handler as (code?: number) => void);
      },
      write: (data: string): boolean => proc.stdin?.write(data) ?? false,
      setWindow: (_rows: number, _cols: number): void => {
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

  disconnect(_serverId: string): void {}

  disposeAll(): void {}
}