import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { SshKeyType } from "@dankodeploy/shared";

import type { SshExecutor, SshTarget } from "./SshExecutor.js";

const execFileAsync = promisify(execFile);

export interface GeneratedKey {
  type: string;
  privateKey: string;
  publicKey: string;
  fingerprint: string;
}

/**
 * Генерирует и анализирует SSH-ключи через системный ssh-keygen
 * (надёжнее, чем собирать OpenSSH-формат вручную). Все операции идут во
 * временной директории, которая удаляется после.
 */
export class KeyManager {
  /**
   * Генерирует новую пару ключей. Возвращает приватный/публичный ключ и fingerprint.
   * comment попадает в конец публичного ключа.
   */
  async generate(opts: {
    type: SshKeyType;
    bits?: number;
    passphrase?: string;
    comment: string;
  }): Promise<GeneratedKey> {
    const dir = await mkdtemp(join(tmpdir(), "dankokey-"));
    const keyPath = join(dir, "id");
    try {
      const args = [
        "-t",
        opts.type,
        "-f",
        keyPath,
        "-N",
        opts.passphrase ?? "",
        "-C",
        opts.comment,
        "-q",
      ];
      if (opts.type === "rsa") args.push("-b", String(opts.bits ?? 4096));

      await execFileAsync("ssh-keygen", args);

      const [privateKey, publicKey] = await Promise.all([
        readFile(keyPath, "utf8"),
        readFile(`${keyPath}.pub`, "utf8"),
      ]);
      const fingerprint = await this.fingerprintFromFile(`${keyPath}.pub`);

      return { type: opts.type, privateKey, publicKey: publicKey.trim(), fingerprint };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /**
   * Анализирует импортированный приватный ключ: извлекает публичную часть и fingerprint.
   * passphrase нужна, если ключ зашифрован.
   */
  async inspectPrivateKey(
    privateKey: string,
    passphrase?: string,
  ): Promise<{ type: string; publicKey: string; fingerprint: string }> {
    const dir = await mkdtemp(join(tmpdir(), "dankokey-"));
    const keyPath = join(dir, "id");
    try {
      await writeFile(keyPath, privateKey.endsWith("\n") ? privateKey : privateKey + "\n", {
        mode: 0o600,
      });
      // -y печатает публичный ключ; -P passphrase для зашифрованных ключей
      const { stdout: pub } = await execFileAsync("ssh-keygen", [
        "-y",
        "-P",
        passphrase ?? "",
        "-f",
        keyPath,
      ]);
      const publicKey = pub.trim();
      // Запишем публичный во временный файл и снимем fingerprint
      await writeFile(`${keyPath}.pub`, publicKey + "\n");
      const fingerprint = await this.fingerprintFromFile(`${keyPath}.pub`);
      const type = publicKey.split(/\s+/)[0]?.replace(/^ssh-/, "") ?? "unknown";
      return { type, publicKey, fingerprint };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async fingerprintFromFile(pubPath: string): Promise<string> {
    const { stdout } = await execFileAsync("ssh-keygen", ["-lf", pubPath]);
    // формат: "256 SHA256:xxxxx comment (ED25519)" — берём поле SHA256:...
    const parts = stdout.trim().split(/\s+/);
    return parts[1] ?? stdout.trim();
  }

  /**
   * Разворачивает публичный ключ на сервере: добавляет его в ~/.ssh/authorized_keys,
   * если его там ещё нет (идемпотентно, как ssh-copy-id). Подключение идёт по
   * текущим доступам сервера (target), а не по самому разворачиваемому ключу.
   */
  async deployPublicKey(
    ssh: SshExecutor,
    target: SshTarget,
    publicKey: string,
  ): Promise<{ ok: boolean; message: string }> {
    const key = publicKey.trim().replace(/'/g, "'\\''");
    // Создаём ~/.ssh, дописываем ключ только если отсутствует
    const cmd = [
      "mkdir -p ~/.ssh",
      "chmod 700 ~/.ssh",
      "touch ~/.ssh/authorized_keys",
      "chmod 600 ~/.ssh/authorized_keys",
      `grep -qxF '${key}' ~/.ssh/authorized_keys || echo '${key}' >> ~/.ssh/authorized_keys`,
    ].join(" && ");

    try {
      const res = await ssh.exec(target, cmd);
      if (res.code === 0) {
        return { ok: true, message: "Публичный ключ добавлен в authorized_keys" };
      }
      return { ok: false, message: res.stderr.trim() || `Код выхода ${res.code}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }
}
