import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

export interface BackupResult {
  ok: boolean;
  /** Путь к файлу бэкапа на сервере */
  remotePath?: string;
  sizeBytes?: number;
  error?: string;
}

export interface BackupArtifactRun {
  /** Имя артефакта (для уникального имени файла на сервере) */
  artifactName: string;
  /** Команда бэкапа ({{OUT}} = путь к файлу) */
  backupCommand: string;
  /** Рабочая директория проекта */
  workdir: string;
  /** Безопасное имя проекта (для имени файла) */
  projectName: string;
}

export interface BackupRunHandlers {
  onStdout?: (line: string) => void;
  onStderr?: (line: string) => void;
}

/**
 * Выполняет бэкап ОДНОГО артефакта по SSH. Команда должна писать результат в файл;
 * путь подставляется через плейсхолдер {{OUT}} (если его нет — раннер добавит `> <путь>`).
 */
export class BackupRunner {
  constructor(private readonly ssh: SshExecutor) {}

  async run(
    target: SshTarget,
    run: BackupArtifactRun,
    handlers: BackupRunHandlers = {},
  ): Promise<BackupResult> {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeProject = run.projectName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeArtifact = run.artifactName.replace(/[^a-zA-Z0-9_-]/g, "_");
    const remotePath = `/tmp/dankodeploy-backup-${safeProject}-${safeArtifact}-${stamp}.bak`;

    const command = run.backupCommand.includes("{{OUT}}")
      ? run.backupCommand.replaceAll("{{OUT}}", remotePath)
      : `${run.backupCommand} > ${remotePath}`;

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

      const size = await this.ssh.exec(target, `stat -c %s ${remotePath} 2>/dev/null || echo 0`);
      const sizeBytes = Number(size.stdout.trim()) || 0;

      return { ok: true, remotePath, sizeBytes };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}
