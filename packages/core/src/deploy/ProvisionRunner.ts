import type { DeployStatus, ProjectSource } from "@dankodeploy/shared";

import { shellQuote } from "../util/shell.js";
import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";
import type { DeployHandlers } from "./DeployRunner.js";

export interface ProvisionInput {
  source: ProjectSource;
  workdir: string;
  /** Расшифрованный приватный ключ (для source.type === "git-private") */
  privateKey?: string;
}

/**
 * Первичная раскатка проекта: `git clone` репозитория в workdir по SSH.
 * Дальше проект обслуживается обычным деплоем (git pull). Стримит логи через
 * те же DeployHandlers, что и DeployRunner — клиент видит их в общем drawer'е.
 */
export class ProvisionRunner {
  constructor(private readonly ssh: SshExecutor) {}

  async run(
    target: SshTarget,
    input: ProvisionInput,
    handlers: DeployHandlers,
  ): Promise<DeployStatus> {
    const { workdir, source } = input;
    handlers.onLog(`▶ Раскатка ${source.repoUrl} → ${workdir}`, "info");

    try {
      // 1. workdir не должен существовать непустым (перезапись не делаем).
      const check = await this.ssh.exec(
        target,
        `if [ -d ${shellQuote(workdir)} ] && [ -n "$(ls -A ${shellQuote(workdir)} 2>/dev/null)" ]; then echo NOTEMPTY; fi`,
      );
      if (check.stdout.includes("NOTEMPTY")) {
        handlers.onLog(
          `✖ Директория ${workdir} существует и не пуста. Если это уже git-репозиторий — используйте обычный Deploy.`,
          "info",
        );
        handlers.onDone("failed");
        return "failed";
      }

      // 2. Создаём родительскую директорию.
      const mkdir = await this.ssh.execStream(
        target,
        `mkdir -p ${shellQuote(workdir)}`,
        { onStdout: (l) => handlers.onLog(l, "stdout"), onStderr: (l) => handlers.onLog(l, "stderr") },
      );
      if (mkdir !== 0) {
        handlers.onLog(`✖ Не удалось создать ${workdir} (код ${mkdir})`, "info");
        handlers.onDone("failed");
        return "failed";
      }

      const branchArg = source.branch ? `--branch ${shellQuote(source.branch)} ` : "";
      const cloneInto = `git clone ${branchArg}${shellQuote(source.repoUrl)} ${shellQuote(workdir)}`;

      if (source.type === "git-public") {
        handlers.onLog(`\n$ ${cloneInto}`, "info");
        const code = await this.ssh.execStream(target, cloneInto, {
          onStdout: (l) => handlers.onLog(l, "stdout"),
          onStderr: (l) => handlers.onLog(l, "stderr"),
        });
        return this.finish(code, handlers);
      }

      // git-private: кладём приватный ключ во временный файл и clone'им с GIT_SSH_COMMAND.
      if (!input.privateKey) {
        handlers.onLog("✖ Для приватного репозитория не передан deploy-ключ", "info");
        handlers.onDone("failed");
        return "failed";
      }

      // mktemp на сервере; ключ пишем через SFTP (не через echo, чтобы не попал в логи/историю).
      const keyPath = (
        await this.ssh.exec(target, "mktemp /tmp/dd-gitkey.XXXXXX")
      ).stdout.trim();
      if (!keyPath) {
        handlers.onLog("✖ Не удалось создать временный файл для ключа", "info");
        handlers.onDone("failed");
        return "failed";
      }

      try {
        const pk = input.privateKey.endsWith("\n") ? input.privateKey : input.privateKey + "\n";
        await this.ssh.writeFile(target, keyPath, pk);
        await this.ssh.exec(target, `chmod 600 ${shellQuote(keyPath)}`);

        const gitSsh = `ssh -i ${shellQuote(keyPath)} -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new`;
        const cmd = `GIT_SSH_COMMAND=${shellQuote(gitSsh)} ${cloneInto}`;
        // В лог печатаем команду без значения ключа — путь не секрет, содержимое не печатаем.
        handlers.onLog(`\n$ ${cmd}`, "info");

        const code = await this.ssh.execStream(target, cmd, {
          onStdout: (l) => handlers.onLog(l, "stdout"),
          onStderr: (l) => handlers.onLog(l, "stderr"),
        });
        return this.finish(code, handlers);
      } finally {
        // Удаляем приватный ключ с сервера в любом случае.
        await this.ssh.exec(target, `rm -f ${shellQuote(keyPath)}`).catch(() => {});
      }
    } catch (err) {
      handlers.onLog(`✖ Ошибка: ${err instanceof Error ? err.message : String(err)}`, "info");
      handlers.onDone("failed");
      return "failed";
    }
  }

  private finish(code: number, handlers: DeployHandlers): DeployStatus {
    if (code === 0) {
      handlers.onLog("\n✔ Репозиторий склонирован. Теперь можно запускать Deploy.", "info");
      handlers.onDone("success");
      return "success";
    }
    handlers.onLog(`✖ git clone завершился с кодом ${code}`, "info");
    handlers.onDone("failed");
    return "failed";
  }
}
