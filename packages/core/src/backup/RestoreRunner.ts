import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

export interface RestoreResult {
  ok: boolean;
  error?: string;
}

export interface RestoreArtifactRun {
  /** Имя артефакта (для уникального имени временного файла) */
  artifactName: string;
  /** Команда восстановления ({{IN}} = путь к залитому файлу) */
  restoreCommand: string;
  /** Рабочая директория проекта */
  workdir: string;
  /** Безопасное имя проекта */
  projectName: string;
  /** Локальный путь к файлу артефакта на машине панели */
  localBackupPath: string;
}

export interface RestoreRunHandlers {
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

/**
 * Восстанавливает ОДИН артефакт по SSH. Симметрично BackupRunner: заливает
 * локальный файл на сервер и выполняет restoreCommand с плейсхолдером {{IN}}.
 * Временный файл на сервере удаляется после (в любом случае).
 */
export class RestoreRunner {
  constructor(private readonly ssh: SshExecutor) {}

  async run(
    target: SshTarget,
    run: RestoreArtifactRun,
    handlers: RestoreRunHandlers = {},
  ): Promise<RestoreResult> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeProject = run.projectName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeArtifact = run.artifactName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const remotePath = `/tmp/dankodeploy-restore-${safeProject}-${safeArtifact}-${stamp}.bak`;

    const command = run.restoreCommand.includes("{{IN}}")
      ? run.restoreCommand.replaceAll("{{IN}}", remotePath)
      : `${run.restoreCommand} < ${remotePath}`;

    try {
      await this.ssh.upload(target, run.localBackupPath, remotePath);

      try {
        let stderr = "";
        const code = await this.ssh.execStream(
          target,
          command,
          {
            onStdout: handlers.onStdout,
            onStderr: (line) => {
              stderr += `${line}\n`;
              handlers.onStderr?.(line);
            },
          },
          run.workdir,
        );
        if (code !== 0) {
          return { ok: false, error: stderr.trim() || `Код выхода ${code}` };
        }
        return { ok: true };
      } finally {
        await this.ssh.exec(target, `rm -f ${remotePath}`).catch(() => {});
      }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
