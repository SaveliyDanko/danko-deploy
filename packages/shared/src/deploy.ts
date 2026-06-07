import { z } from "zod";

export const deployStatusSchema = z.enum(["running", "success", "failed"]);
export type DeployStatus = z.infer<typeof deployStatusSchema>;

/**
 * Что именно сделала запись истории действий деплоя:
 * - deploy: обычный деплой (git pull + up);
 * - provision: первичная раскатка (git clone);
 * - undeploy: снятие сервиса (down);
 * - backup: создание бэкапа.
 */
export const runKindSchema = z.enum(["deploy", "provision", "undeploy", "backup"]);
export type RunKind = z.infer<typeof runKindSchema>;

/** Запись истории действий (привязана к деплою = проект×сервер) */
export const deployRunSchema = z.object({
  id: z.string(),
  deploymentId: z.string(),
  /** Тип действия. default — для старых записей без поля. */
  kind: runKindSchema.default("deploy"),
  status: deployStatusSchema,
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  /** Полный накопленный лог (для просмотра завершённых запусков) */
  log: z.string(),
});
export type DeployRun = z.infer<typeof deployRunSchema>;

/** Запись о бэкапе */
export const backupStatusSchema = z.enum(["running", "success", "failed"]);
export type BackupStatus = z.infer<typeof backupStatusSchema>;

/** Один скачанный артефакт в записи бэкапа (имя + локальный путь + размер). */
export const backupArtifactResultSchema = z.object({
  name: z.string(),
  /** Локальный путь к файлу артефакта на машине панели */
  path: z.string(),
  sizeBytes: z.number().nullable(),
});
export type BackupArtifactResult = z.infer<typeof backupArtifactResultSchema>;

export const backupRecordSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  /** С какого деплоя (проект×сервер) снят. NULL у загруженных вручную. */
  deploymentId: z.string().nullable().default(null),
  status: backupStatusSchema,
  /** LEGACY: путь к одиночному файлу бэкапа. Для одно-артефактных/загруженных. */
  path: z.string().nullable(),
  sizeBytes: z.number().nullable(),
  /** Артефакты бэкапа (db, media, …). Для старых записей синтезируется из path. */
  artifacts: z.array(backupArtifactResultSchema).default([]),
  /** Был ли бэкап запущен по расписанию */
  scheduled: z.boolean(),
  /** Загружен пользователем файлом (а не снят с сервера) */
  uploaded: z.boolean().default(false),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type BackupRecord = z.infer<typeof backupRecordSchema>;

// ---------------------------------------------------------------------------
// WebSocket-протокол: одно соединение /ws, мультиплексирование по каналам.
// ---------------------------------------------------------------------------

/** Сообщения клиент → сервер */
export const wsClientMessageSchema = z.discriminatedUnion("type", [
  /** Подписаться на стрим логов деплоя */
  z.object({ type: z.literal("subscribe:deploy"), runId: z.string() }),
  /** Подписаться на live-метрики сервера */
  z.object({ type: z.literal("subscribe:metrics"), serverId: z.string() }),
  z.object({ type: z.literal("unsubscribe:metrics"), serverId: z.string() }),
  /** Подписаться на лог установки AI-агента (канал ai:<agentId>) */
  z.object({ type: z.literal("subscribe:ai"), agentId: z.string() }),
  /** Открыть/закрыть веб-терминал к агенту (PTY-мост) */
  z.object({ type: z.literal("subscribe:terminal"), agentId: z.string() }),
  z.object({ type: z.literal("unsubscribe:terminal"), agentId: z.string() }),
  /** Ввод в терминал (base64-кодированные байты — поддержка не-ASCII и paste) */
  z.object({ type: z.literal("terminal:input"), agentId: z.string(), data: z.string() }),
  /** Изменение размера pty */
  z.object({
    type: z.literal("terminal:resize"),
    agentId: z.string(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
  /** Открыть/закрыть веб-терминал к конкретному серверу (прямой SSH shell) */
  z.object({ type: z.literal("subscribe:server-terminal"), serverId: z.string() }),
  z.object({ type: z.literal("unsubscribe:server-terminal"), serverId: z.string() }),
  /** Ввод в серверный терминал (base64-кодированные байты) */
  z.object({ type: z.literal("server-terminal:input"), serverId: z.string(), data: z.string() }),
  /** Изменение размера pty серверного терминала */
  z.object({
    type: z.literal("server-terminal:resize"),
    serverId: z.string(),
    cols: z.number().int().positive(),
    rows: z.number().int().positive(),
  }),
]);
export type WsClientMessage = z.infer<typeof wsClientMessageSchema>;

/** Сообщения сервер → клиент */
export const wsServerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("deploy:log"),
    runId: z.string(),
    line: z.string(),
    stream: z.enum(["stdout", "stderr", "info"]),
  }),
  z.object({
    type: z.literal("deploy:done"),
    runId: z.string(),
    status: deployStatusSchema,
  }),
  z.object({
    type: z.literal("metrics:update"),
    serverId: z.string(),
    // metricsSnapshot, импортируется отдельно во избежание циклов — оставляем unknown,
    // фронт валидирует через metricsSnapshotSchema
    snapshot: z.unknown(),
  }),
  // --- AI-агенты ---
  z.object({
    type: z.literal("ai:log"),
    agentId: z.string(),
    line: z.string(),
    stream: z.enum(["stdout", "stderr", "info"]),
  }),
  z.object({
    type: z.literal("ai:status"),
    agentId: z.string(),
    // строка статуса агента; фронт валидирует через aiAgentStatusSchema
    status: z.string(),
  }),
  // --- Веб-терминал (PTY) ---
  /** Вывод pty (base64-кодированные байты) */
  z.object({ type: z.literal("terminal:data"), agentId: z.string(), data: z.string() }),
  /** Терминальная сессия закрыта (канал упал/сервер недоступен) */
  z.object({ type: z.literal("terminal:exit"), agentId: z.string(), reason: z.string().optional() }),
  /** Вывод серверного pty (base64-кодированные байты) */
  z.object({ type: z.literal("server-terminal:data"), serverId: z.string(), data: z.string() }),
  /** Серверная терминальная сессия закрыта */
  z.object({
    type: z.literal("server-terminal:exit"),
    serverId: z.string(),
    reason: z.string().optional(),
  }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type WsServerMessage = z.infer<typeof wsServerMessageSchema>;
