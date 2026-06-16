import { z } from "zod";

/**
 * Тип упаковки сервиса определяет, какие команды выполняет DeployRunner/MetricsCollector.
 * - "docker-compose": git pull + docker compose up -d --build
 * - "systemd": загрузка артефакта + systemctl restart <unit>
 * - "script": git pull + выполнение скрипта раскатки из репозитория (deployScript)
 * - "process": произвольные команды деплоя из конфига
 */
export const serviceKindSchema = z.enum(["docker-compose", "systemd", "script", "process"]);
export type ServiceKind = z.infer<typeof serviceKindSchema>;

/** Один шаг деплоя (команда, выполняемая по SSH в рабочей директории) */
export const deployStepSchema = z.object({
  name: z.string().min(1),
  /** Shell-команда, выполняется в workdir проекта */
  run: z.string().min(1),
});
export type DeployStep = z.infer<typeof deployStepSchema>;

/**
 * Источник кода для первичной раскатки (git clone в workdir).
 * Если не задан — считается, что код уже лежит в workdir (раскатка недоступна).
 * - "git-public": clone по https-URL без авторизации.
 * - "git-private": clone по ssh-URL с deploy-ключом (gitKeyId).
 */
export const projectSourceSchema = z
  .object({
    type: z.enum(["git-public", "git-private"]),
    /** URL репозитория: https://… для public, git@host:org/repo.git для private */
    repoUrl: z.string().trim().min(1, "Укажите URL репозитория"),
    /** Ветка для clone (--branch). Если пусто — ветка по умолчанию репозитория. */
    branch: z.string().trim().optional(),
    /** Ссылка на git deploy-ключ (для type === "git-private") */
    gitKeyId: z.string().optional(),
  })
  .superRefine((source, ctx) => {
    if (source.type === "git-public") {
      if (!/^https?:\/\//i.test(source.repoUrl)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["repoUrl"],
          message: "Для публичного репозитория укажите HTTPS URL",
        });
      }
      return;
    }

    // GIT_SSH_COMMAND с deploy-ключом работает только с SSH remote.
    if (!/^(git@[^:]+:.+|ssh:\/\/.+)$/i.test(source.repoUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["repoUrl"],
        message: "Для приватного репозитория нужен SSH URL вида git@github.com:org/repo.git",
      });
    }
    if (!source.gitKeyId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["gitKeyId"],
        message: "Для приватного репозитория выберите Git deploy-ключ",
      });
    }
  });
export type ProjectSource = z.infer<typeof projectSourceSchema>;

/**
 * Именованный артефакт бэкапа (например "db", "media"). У каждого своя пара
 * команд: backup ({{OUT}} = путь к файлу) и опционально restore ({{IN}} = файл).
 */
export const backupArtifactSchema = z.object({
  /** Имя артефакта (slug): db, media, … — должно быть уникальным в проекте */
  name: z.string().min(1, "Укажите имя артефакта"),
  /** Команда бэкапа ({{OUT}} = путь к файлу на сервере) */
  backupCommand: z.string().min(1, "Укажите команду бэкапа"),
  /** Команда восстановления ({{IN}} = путь к залитому файлу). Без неё restore недоступен. */
  restoreCommand: z.string().optional(),
});
export type BackupArtifact = z.infer<typeof backupArtifactSchema>;

/**
 * Метаинформация проекта (справочная, не влияет на деплой/механику). Помогает
 * быстрее ориентироваться перед раскаткой: порты, контейнеры, env, чек-лист, ссылки.
 * Все поля опциональны.
 */
export const projectMetaSchema = z.object({
  /** Порты, которые занимает проект (80, 443, 5432, …) */
  ports: z
    .array(z.object({ port: z.string(), description: z.string().optional() }))
    .optional(),
  /** Контейнеры/сервисы проекта (web, db, …) */
  containers: z
    .array(z.object({ name: z.string(), note: z.string().optional() }))
    .optional(),
  /** Переменные окружения, которые нужно задать (чек-лист, без значений) */
  envVars: z
    .array(z.object({ key: z.string(), note: z.string().optional() }))
    .optional(),
  /** Чек-лист перед раскаткой (что должно быть готово на сервере) */
  checklist: z
    .array(z.object({ text: z.string(), done: z.boolean().default(false) }))
    .optional(),
  /** Ссылки: прод-домен, дашборды, доки */
  links: z.array(z.object({ label: z.string(), url: z.string() })).optional(),
  /** Свободные заметки (markdown-текст) */
  notes: z.string().optional(),
});
export type ProjectMeta = z.infer<typeof projectMetaSchema>;

/**
 * Декларативная конфигурация проекта/сервиса.
 * Кастомные шаги (deploySteps/backupCommand) переопределяют дефолты для kind.
 */
export const projectConfigSchema = z.object({
  /** Рабочая директория проекта на сервере */
  workdir: z.string().min(1),
  /** Источник кода для первичной раскатки (git clone). Опционально. */
  source: projectSourceSchema.optional(),
  /** Справочная метаинформация (порты, контейнеры, env, чек-лист, ссылки). */
  meta: projectMetaSchema.optional(),
  /** systemd-юнит (для kind === "systemd") */
  systemdUnit: z.string().optional(),
  /** Имя docker-compose проекта/файла, если нестандартное */
  composeFile: z.string().optional(),
  /**
   * Путь к скрипту раскатки относительно workdir (для kind === "script").
   * Если пусто — дефолт "deploy.sh". Запускается как `bash ./<deployScript>` после git pull.
   */
  deployScript: z.string().optional(),
  /**
   * Путь к скрипту снятия проекта относительно workdir (для kind === "script").
   * Если пусто — undeploy недоступен (как у kind === "process" без undeploySteps).
   */
  undeployScript: z.string().optional(),
  /** Кастомные шаги деплоя (если заданы — используются вместо дефолтных для kind) */
  deploySteps: z.array(deployStepSchema).optional(),
  /** Кастомные шаги остановки/снятия проекта (если заданы — используются вместо дефолтных) */
  undeploySteps: z.array(deployStepSchema).optional(),
  /**
   * Именованные артефакты бэкапа (БД, медиа, …). Каждый — своя пара команд.
   * Если задан — используется вместо одиночных backupCommand/restoreCommand.
   */
  backupArtifacts: z.array(backupArtifactSchema).optional(),
  /**
   * LEGACY: одиночная команда бэкапа ({{OUT}} = файл). Оставлена для совместимости —
   * нормализуется в артефакт "default" (см. resolveBackupArtifacts). Новые проекты
   * задают backupArtifacts.
   */
  backupCommand: z.string().optional(),
  /** Cron-выражение для авто-бэкапов (node-cron). Если пусто — только вручную. */
  backupCron: z.string().optional(),
  /** LEGACY: одиночная команда восстановления ({{IN}} = файл). См. backupCommand. */
  restoreCommand: z.string().optional(),
});
export type ProjectConfig = z.infer<typeof projectConfigSchema>;

/**
 * Резолвит список артефактов бэкапа из конфига с учётом совместимости:
 * - если заданы backupArtifacts — возвращает их;
 * - иначе, если есть legacy backupCommand — оборачивает в артефакт "default";
 * - иначе — пустой список (бэкап не настроен).
 */
export function resolveBackupArtifacts(config: ProjectConfig): BackupArtifact[] {
  if (config.backupArtifacts?.length) return config.backupArtifacts;
  if (config.backupCommand) {
    return [
      {
        name: "default",
        backupCommand: config.backupCommand,
        restoreCommand: config.restoreCommand,
      },
    ];
  }
  return [];
}

export const createProjectSchema = z.object({
  name: z.string().min(1, "Укажите название проекта"),
  kind: serviceKindSchema,
  /** Стек/описание для сводки, напр. "Node + Postgres" */
  stack: z.string().optional(),
  description: z.string().optional(),
  config: projectConfigSchema,
});
export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();
export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

/**
 * Проект — карточка БЕЗ привязки к серверу. Раскатка/бэкапы — через деплои
 * (см. deployment.ts). serverId здесь больше нет.
 */
export const projectPublicSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: serviceKindSchema,
  stack: z.string().nullable(),
  description: z.string().nullable(),
  config: projectConfigSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ProjectPublic = z.infer<typeof projectPublicSchema>;

/**
 * Содержимое .env проекта. Хранится зашифрованным в БД панели, по запросу
 * записывается на сервер в <workdir>/.env. Наружу отдаётся расшифрованным
 * (только для аутентифицированного пользователя панели).
 */
export const projectEnvSchema = z.object({
  /** Сырое содержимое файла .env (как есть, многострочное) */
  content: z.string(),
  /** ISO-время последнего сохранения; null если ещё не задан */
  updatedAt: z.string().nullable(),
});
export type ProjectEnv = z.infer<typeof projectEnvSchema>;

/** Тело запроса на сохранение .env */
export const saveProjectEnvSchema = z.object({
  content: z.string(),
});
export type SaveProjectEnvInput = z.infer<typeof saveProjectEnvSchema>;

/** Результат записи .env на сервер */
export const deployEnvResultSchema = z.object({
  ok: z.boolean(),
  /** Путь к файлу на сервере при успехе */
  path: z.string().optional(),
  error: z.string().optional(),
});
export type DeployEnvResult = z.infer<typeof deployEnvResultSchema>;

/** Тело запроса восстановления: какой бэкап и какие артефакты восстанавливать. */
export const restoreRequestSchema = z.object({
  backupId: z.string().min(1),
  /** Имена артефактов для восстановления. Пусто/не задано = все артефакты бэкапа. */
  artifactNames: z.array(z.string()).optional(),
});
export type RestoreRequest = z.infer<typeof restoreRequestSchema>;

/** Результат восстановления одного артефакта. */
export const restoreArtifactResultSchema = z.object({
  name: z.string(),
  ok: z.boolean(),
  error: z.string().optional(),
});
export type RestoreArtifactResult = z.infer<typeof restoreArtifactResultSchema>;

/** Результат восстановления из бэкапа (по каждому артефакту). */
export const restoreResultSchema = z.object({
  ok: z.boolean(),
  /** Результаты по каждому восстановленному артефакту */
  artifacts: z.array(restoreArtifactResultSchema).default([]),
  error: z.string().optional(),
});
export type RestoreResult = z.infer<typeof restoreResultSchema>;

/**
 * Результат запуска первичной раскатки. Раскатка стримит логи как деплой,
 * поэтому возвращаем runId — клиент подписывается на WS-канал deploy:<runId>.
 */
export const provisionResultSchema = z.object({
  runId: z.string(),
});
export type ProvisionResult = z.infer<typeof provisionResultSchema>;

/** Текущий статус сервиса (определяется по SSH в момент запроса сводки деплоя) */
export const serviceStatusSchema = z.enum(["running", "stopped", "unknown"]);
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
