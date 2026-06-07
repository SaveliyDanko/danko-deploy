import type { AiAgentType } from "@dankodeploy/shared";

import type { SshExecutor, SshTarget } from "../ssh/SshExecutor.js";

/** Колбэк логирования установки (стримится в WS-канал ai:<agentId>). */
export type AgentLog = (line: string, stream: "stdout" | "stderr" | "info") => void;

export interface AgentSpec {
  /** Команда проверки «уже установлен» (exit 0 = установлен) */
  installCheck: string;
  /** Идемпотентная установка CLI */
  installScript: string;
  /** Удаление CLI, установленного через npm -g */
  uninstallScript: string;
  /** Бинарь, запускаемый внутри tmux-сессии */
  startCommand: string;
}

/**
 * Спецификации агентов. Расширяемо: добавить тип в aiAgentTypeSchema и запись сюда.
 * Установка через npm -g (требует Node на сервере — проверяется отдельно).
 */
export const AGENT_SPECS: Record<AiAgentType, AgentSpec> = {
  "claude-code": {
    installCheck: "command -v claude",
    installScript: "npm install -g @anthropic-ai/claude-code",
    uninstallScript: "npm uninstall -g @anthropic-ai/claude-code",
    startCommand: "claude",
  },
  codex: {
    installCheck: "command -v codex",
    installScript: "npm install -g @openai/codex",
    uninstallScript: "npm uninstall -g @openai/codex",
    startCommand: "codex",
  },
};

/** Безопасное экранирование строки для вставки в одинарные кавычки shell. */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function shellPath(s: string): string {
  if (s === "~") return "$HOME";
  if (s.startsWith("~/")) return `$HOME/${shellQuote(s.slice(2))}`;
  return shellQuote(s);
}

/**
 * Устанавливает и запускает AI-агентов на сервере по SSH. Все операции идемпотентны
 * (проверка перед действием). Логи установки стримятся построчно — тот же паттерн,
 * что в DeployRunner.
 */
export class AgentInstaller {
  constructor(private readonly ssh: SshExecutor) {}

  /** Убеждается, что на сервере есть tmux (ставит при отсутствии через доступный пакетник). */
  async ensureTmux(target: SshTarget, log: AgentLog): Promise<void> {
    const check = await this.ssh.exec(target, "command -v tmux");
    if (check.code === 0) {
      log("tmux уже установлен", "info");
      return;
    }
    log("Устанавливаю tmux...", "info");
    // Пробуем популярные пакетники; что-нибудь да сработает.
    const installCmd =
      "(command -v apt-get && sudo apt-get update && sudo apt-get install -y tmux) || " +
      "(command -v dnf && sudo dnf install -y tmux) || " +
      "(command -v yum && sudo yum install -y tmux) || " +
      "(command -v apk && sudo apk add tmux) || " +
      "(command -v brew && brew install tmux)";
    const code = await this.streamRun(target, installCmd, log);
    if (code !== 0) throw new Error("Не удалось установить tmux (нужен один из apt/dnf/yum/apk/brew)");
  }

  /** Убеждается, что CLI агента установлен; ставит при отсутствии. Требует Node для npm-агентов. */
  async ensureInstalled(target: SshTarget, type: AiAgentType, log: AgentLog): Promise<void> {
    const spec = AGENT_SPECS[type];
    const check = await this.ssh.exec(target, spec.installCheck);
    if (check.code === 0) {
      log(`${type} уже установлен`, "info");
      return;
    }
    // npm-агентам нужен Node.
    const node = await this.ssh.exec(target, "command -v node && command -v npm");
    if (node.code !== 0) {
      throw new Error(
        `На сервере нет Node/npm — нужны для установки ${type}. Установите Node и повторите.`,
      );
    }
    log(`Устанавливаю ${type}...`, "info");
    const code = await this.streamRun(target, spec.installScript, log);
    if (code !== 0) throw new Error(`Установка ${type} завершилась с кодом ${code}`);
  }

  /** Удаляет CLI агента с сервера, если он установлен через npm -g. */
  async uninstall(target: SshTarget, type: AiAgentType, log: AgentLog): Promise<void> {
    const spec = AGENT_SPECS[type];
    const check = await this.ssh.exec(target, spec.installCheck);
    if (check.code !== 0) {
      log(`${type} уже не установлен`, "info");
      return;
    }
    const npm = await this.ssh.exec(target, "command -v npm");
    if (npm.code !== 0) {
      throw new Error(`На сервере нет npm — не могу удалить ${type} через npm uninstall -g.`);
    }
    log(`Удаляю ${type} с сервера...`, "info");
    const code = await this.streamRun(target, spec.uninstallScript, log);
    if (code !== 0) throw new Error(`Удаление ${type} завершилось с кодом ${code}`);

    const after = await this.ssh.exec(target, spec.installCheck);
    if (after.code === 0) {
      throw new Error(`${type} всё ещё найден в PATH после удаления`);
    }
  }

  /**
   * Создаёт tmux-сессию с запущенным агентом, если её ещё нет (идемпотентно).
   * Сессия detached (-d), запускается агент в указанной рабочей директории.
   */
  async ensureSession(
    target: SshTarget,
    session: string,
    workdir: string,
    type: AiAgentType,
    log: AgentLog,
  ): Promise<void> {
    const has = await this.ssh.exec(target, `tmux has-session -t ${session} 2>/dev/null`);
    if (has.code === 0) {
      log(`tmux-сессия ${session} уже существует`, "info");
      return;
    }
    const spec = AGENT_SPECS[type];
    log(`Создаю tmux-сессию ${session} (${spec.startCommand}) в ${workdir}`, "info");
    const wrappedStart = [
      spec.startCommand,
      "code=$?",
      "echo",
      `echo "[DankoDeploy] ${spec.startCommand} завершился с кодом $code."`,
      `echo ${shellQuote(`[DankoDeploy] Исправьте причину выше и запустите ${spec.startCommand} ещё раз в этой сессии.`)}`,
      "exec bash -l",
    ].join("; ");
    const create = await this.ssh.exec(
      target,
      `tmux new-session -d -s ${shellQuote(session)} -c ${shellPath(workdir)} ${shellQuote(`bash -lc ${shellQuote(wrappedStart)}`)}`,
    );
    if (create.code !== 0) {
      throw new Error(create.stderr.trim() || `Не удалось создать tmux-сессию (код ${create.code})`);
    }
    const alive = await this.ssh.exec(target, `sleep 0.2 && tmux has-session -t ${shellQuote(session)} 2>/dev/null`);
    if (alive.code !== 0) {
      throw new Error(
        `tmux-сессия ${session} сразу завершилась. Проверьте, что команда ${spec.startCommand} запускается на сервере.`,
      );
    }
  }

  /** Останавливает (убивает) tmux-сессию агента. */
  async killSession(target: SshTarget, session: string): Promise<void> {
    await this.ssh.exec(target, `tmux kill-session -t ${session} 2>/dev/null || true`);
  }

  /** Проверяет, жива ли tmux-сессия. */
  async hasSession(target: SshTarget, session: string): Promise<boolean> {
    const res = await this.ssh.exec(target, `tmux has-session -t ${session} 2>/dev/null`);
    return res.code === 0;
  }

  private async streamRun(target: SshTarget, command: string, log: AgentLog): Promise<number> {
    return this.ssh.execStream(target, command, {
      onStdout: (line) => log(line, "stdout"),
      onStderr: (line) => log(line, "stderr"),
    });
  }
}
