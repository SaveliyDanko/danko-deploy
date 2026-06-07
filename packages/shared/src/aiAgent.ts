import { z } from "zod";

/** Тип AI-агента. Расширяемо: добавить значение здесь и спецификацию в AGENT_SPECS. */
export const aiAgentTypeSchema = z.enum(["claude-code", "codex"]);
export type AiAgentType = z.infer<typeof aiAgentTypeSchema>;

/**
 * Жизненный цикл агента:
 * - installing — идёт установка CLI/tmux-сессии
 * - uninstalling — идёт удаление CLI с сервера
 * - ready — установлен, сессия создана
 * - running — сессия активна (tmux has-session)
 * - stopped — сессии нет
 * - error — последняя операция упала (см. lastError)
 */
export const aiAgentStatusSchema = z.enum([
  "installing",
  "uninstalling",
  "ready",
  "running",
  "stopped",
  "error",
]);
export type AiAgentStatus = z.infer<typeof aiAgentStatusSchema>;

/** Публичное представление агента (то, что уходит на фронт). */
export const aiAgentPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  serverId: z.string(),
  agentType: aiAgentTypeSchema,
  workdir: z.string(),
  tmuxSession: z.string(),
  status: aiAgentStatusSchema,
  lastError: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AiAgentPublic = z.infer<typeof aiAgentPublicSchema>;

/** Тело запроса на создание агента. Текстовые поля тримятся. */
export const createAiAgentSchema = z.object({
  name: z.string().trim().min(1, "Укажите название агента"),
  serverId: z.string().min(1, "Выберите сервер"),
  agentType: aiAgentTypeSchema,
  /** Рабочая директория на сервере (где запускается агент) */
  workdir: z.string().trim().min(1).default("~"),
});
export type CreateAiAgentInput = z.infer<typeof createAiAgentSchema>;
