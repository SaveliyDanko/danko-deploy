import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Хранилище SSH-ключей. Приватный ключ шифруется AES-256-GCM мастер-ключом;
 * публичный ключ и fingerprint лежат открыто (нужны для UI и ssh-copy-id).
 */
export const sshKeys = sqliteTable("ssh_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  /** Тип ключа: ed25519 | rsa (для сгенерированных; у импортированных — best-effort) */
  type: text("type").notNull(),
  /** Открытый ключ в формате authorized_keys */
  publicKey: text("public_key").notNull(),
  /** SHA256-fingerprint (как у ssh-keygen -lf) */
  fingerprint: text("fingerprint").notNull(),
  /** Зашифрованный приватный ключ (PEM). Формат iv:tag:cipher base64 */
  privateKeyEnc: text("private_key_enc").notNull(),
  /** Зашифрованная passphrase приватного ключа (если задана) */
  passphraseEnc: text("passphrase_enc"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/**
 * Хранилище Git deploy-ключей. Аналогично ssh_keys, но назначение другое:
 * на сервер при clone кладётся ПРИВАТНАЯ часть (для доступа к приватному репо),
 * а публичную пользователь добавляет как Deploy key в GitHub/GitLab.
 * Приватный ключ шифруется AES-256-GCM; наружу отдаётся только публичная часть.
 */
export const gitKeys = sqliteTable("git_keys", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  type: text("type").notNull(),
  /** Открытый ключ (его добавляют как Deploy key в GitHub/GitLab) */
  publicKey: text("public_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  /** Зашифрованный приватный ключ (PEM). Формат iv:tag:cipher base64 */
  privateKeyEnc: text("private_key_enc").notNull(),
  /** Зашифрованная passphrase приватного ключа (если задана) */
  passphraseEnc: text("passphrase_enc"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/** Зарегистрированные VPS. Секреты SSH хранятся зашифрованными (AES-256-GCM). */
export const servers = sqliteTable("servers", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  host: text("host").notNull(),
  port: integer("port").notNull().default(22),
  username: text("username").notNull(),
  authMethod: text("auth_method", { enum: ["key", "password", "stored-key"] }).notNull(),
  /**
   * Зашифрованный JSON {privateKey?, passphrase?, password?} для inline-аутентификации
   * (authMethod = key|password). Для authMethod = stored-key пусто — используется keyId.
   */
  secretEnc: text("secret_enc"),
  /** Ссылка на ключ из хранилища (authMethod = stored-key) */
  keyId: text("key_id").references(() => sshKeys.id, { onDelete: "set null" }),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/**
 * Проект — карточка сервиса БЕЗ привязки к серверу: метаинформация, источник кода,
 * конфиг раскатки (kind, workdir, deploySteps, backupArtifacts, …). config — JSON-текст.
 * Факт раскатки на конкретный сервер — отдельная сущность deployments.
 */
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: text("kind", { enum: ["docker-compose", "systemd", "process"] }).notNull(),
  stack: text("stack"),
  description: text("description"),
  /** JSON ProjectConfig */
  config: text("config").notNull(),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/**
 * Деплой — постоянная привязка проекта к серверу (проект × сервер). На него
 * вешаются история раскаток (deploy_runs) и источник бэкапов. Один проект можно
 * развернуть на несколько серверов (по деплою на каждый). Пара (projectId, serverId) уникальна.
 */
export const deployments = sqliteTable(
  "deployments",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    /** Последний завершённый запуск деплоя/раскатки на этом сервере. */
    lastDeployStatus: text("last_deploy_status", { enum: ["success", "failed", "running"] }),
    lastDeployAt: text("last_deploy_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => ({
    // Один деплой на пару проект↔сервер.
    projectServerUq: uniqueIndex("deployments_project_server_uq").on(t.projectId, t.serverId),
  }),
);

/**
 * Переменные окружения проекта (.env), хранятся зашифрованными (AES-256-GCM).
 * Один ряд на проект. Контент пишется на сервер в <workdir>/.env по запросу.
 */
export const projectEnv = sqliteTable("project_env", {
  projectId: text("project_id")
    .primaryKey()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** Зашифрованное содержимое .env (формат iv:tag:cipher base64) */
  contentEnc: text("content_enc").notNull(),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/** История запусков деплоя (привязана к деплою = проект×сервер). */
export const deployRuns = sqliteTable("deploy_runs", {
  id: text("id").primaryKey(),
  deploymentId: text("deployment_id")
    .notNull()
    .references(() => deployments.id, { onDelete: "cascade" }),
  /** Что именно было сделано: деплой / первичная раскатка / снятие / бэкап / восстановление. */
  kind: text("kind", { enum: ["deploy", "provision", "undeploy", "backup", "restore"] })
    .notNull()
    .default("deploy"),
  status: text("status", { enum: ["running", "success", "failed"] }).notNull(),
  log: text("log").notNull().default(""),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  finishedAt: text("finished_at"),
});

/** История бэкапов. */
export const backups = sqliteTable("backups", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  /** С какого деплоя (проект×сервер) снят бэкап. NULL у загруженных вручную/старых. */
  deploymentId: text("deployment_id").references(() => deployments.id, { onDelete: "set null" }),
  status: text("status", { enum: ["running", "success", "failed"] }).notNull(),
  path: text("path"),
  sizeBytes: integer("size_bytes"),
  /** JSON BackupArtifactResult[] — артефакты бэкапа (db, media, …). NULL у старых записей. */
  artifacts: text("artifacts"),
  scheduled: integer("scheduled", { mode: "boolean" }).notNull().default(false),
  /** Загружен пользователем файлом (а не снят с сервера) */
  uploaded: integer("uploaded", { mode: "boolean" }).notNull().default(false),
  error: text("error"),
  startedAt: text("started_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  finishedAt: text("finished_at"),
});

/**
 * Последний собранный снимок метрик каждого сервера (один ряд на сервер).
 * Нужен, чтобы дашборд показывал данные мгновенно (stale-while-revalidate),
 * не дожидаясь первого WS-сообщения. snapshot — JSON MetricsSnapshot.
 */
export const metricsSnapshots = sqliteTable("metrics_snapshots", {
  serverId: text("server_id")
    .primaryKey()
    .references(() => servers.id, { onDelete: "cascade" }),
  /** JSON сериализованного MetricsSnapshot */
  snapshot: text("snapshot").notNull(),
  collectedAt: text("collected_at").notNull(),
});

/**
 * AI-кодинг-агенты (Claude Code, Codex), развёрнутые на серверах.
 * Запускаются в tmux-сессии; доступ — через веб-терминал (PTY-мост по SSH).
 */
export const aiAgents = sqliteTable("ai_agents", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  serverId: text("server_id")
    .notNull()
    .references(() => servers.id, { onDelete: "cascade" }),
  agentType: text("agent_type", { enum: ["claude-code", "codex"] }).notNull(),
  workdir: text("workdir").notNull(),
  /** Имя tmux-сессии на сервере (детерминировано: dd-agent-<id>) */
  tmuxSession: text("tmux_session").notNull(),
  status: text("status", {
    enum: ["installing", "uninstalling", "ready", "running", "stopped", "error"],
  })
    .notNull()
    .default("stopped"),
  lastError: text("last_error"),
  createdAt: text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`),
  updatedAt: text("updated_at")
    .notNull()
    .default(sql`(current_timestamp)`),
});

/**
 * VPN-инсталляции, развёрнутые на серверах (Outline/Shadowsocks и др.).
 * Management-доступ Outline (apiUrl содержит токен) шифруется AES-256-GCM;
 * наружу отдаётся только публичная часть. Одна инсталляция на пару (сервер, kind).
 */
export const vpnInstallations = sqliteTable(
  "vpn_installations",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["outline"] }).notNull().default("outline"),
    status: text("status", { enum: ["installing", "active", "error", "removed"] })
      .notNull()
      .default("installing"),
    /** Host/IP сервера (копия для удобства отображения списка без джойна). */
    host: text("host").notNull(),
    /** Порт management API Outline (известен после раскатки). */
    apiPort: integer("api_port"),
    /** Зашифрованный management apiUrl Outline (формат iv:tag:cipher base64). */
    apiUrlEnc: text("api_url_enc"),
    /** SHA256-отпечаток TLS-сертификата management API (нужен для подключения к API). */
    certSha256: text("cert_sha256"),
    lastError: text("last_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => ({
    // Одна VPN-инсталляция данного типа на сервер.
    serverKindUq: uniqueIndex("vpn_installations_server_kind_uq").on(t.serverId, t.kind),
  }),
);

/**
 * VPN-клиенты (sing-box на сервере): VPS гонит весь исходящий трафик через
 * VPN-провайдера по subscription-ссылке. Ссылка шифруется AES-256-GCM.
 * Один клиент на сервер (нельзя гнать трафик в два туннеля сразу).
 */
export const vpnClients = sqliteTable(
  "vpn_clients",
  {
    id: text("id").primaryKey(),
    serverId: text("server_id")
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    /** Зашифрованная subscription-ссылка провайдера (формат iv:tag:cipher base64). */
    subscriptionUrlEnc: text("subscription_url_enc").notNull(),
    /** Выбранная локация (метка из подписки; по ней матчим сервер при авто-обновлении). */
    selectedLabel: text("selected_label").notNull(),
    status: text("status", {
      enum: ["installing", "active", "syncing", "error", "removed"],
    })
      .notNull()
      .default("installing"),
    /** Host/IP сервера (копия для списка без джойна). */
    host: text("host").notNull(),
    /** Внешний IP сервера после включения VPN (для проверки в UI). */
    externalIp: text("external_ip"),
    lastError: text("last_error"),
    /** cron-выражение авто-обновления подписки (nullable — тогда дефолт планировщика). */
    syncCron: text("sync_cron"),
    lastSyncedAt: text("last_synced_at"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`(current_timestamp)`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`(current_timestamp)`),
  },
  (t) => ({
    // Один VPN-клиент на сервер.
    serverUq: uniqueIndex("vpn_clients_server_uq").on(t.serverId),
  }),
);

export type SshKeyRow = typeof sshKeys.$inferSelect;
export type NewSshKeyRow = typeof sshKeys.$inferInsert;
export type GitKeyRow = typeof gitKeys.$inferSelect;
export type NewGitKeyRow = typeof gitKeys.$inferInsert;
export type AiAgentRow = typeof aiAgents.$inferSelect;
export type NewAiAgentRow = typeof aiAgents.$inferInsert;
export type ServerRow = typeof servers.$inferSelect;
export type NewServerRow = typeof servers.$inferInsert;
export type ProjectRow = typeof projects.$inferSelect;
export type NewProjectRow = typeof projects.$inferInsert;
export type DeploymentRow = typeof deployments.$inferSelect;
export type NewDeploymentRow = typeof deployments.$inferInsert;
export type ProjectEnvRow = typeof projectEnv.$inferSelect;
export type NewProjectEnvRow = typeof projectEnv.$inferInsert;
export type DeployRunRow = typeof deployRuns.$inferSelect;
export type NewDeployRunRow = typeof deployRuns.$inferInsert;
export type BackupRow = typeof backups.$inferSelect;
export type NewBackupRow = typeof backups.$inferInsert;
export type MetricsSnapshotRow = typeof metricsSnapshots.$inferSelect;
export type NewMetricsSnapshotRow = typeof metricsSnapshots.$inferInsert;
export type VpnInstallationRow = typeof vpnInstallations.$inferSelect;
export type NewVpnInstallationRow = typeof vpnInstallations.$inferInsert;
export type VpnClientRow = typeof vpnClients.$inferSelect;
export type NewVpnClientRow = typeof vpnClients.$inferInsert;
