# DankoDeploy — карта кода (CODEMAP)

> **Плоский индекс файлов для быстрой навигации** (человек/LLM-агент): `путь — что делает / когда трогать`.
> Это карта «**где именно**». Концепции и «**как и почему**» — в [ARCHITECTURE.md](ARCHITECTURE.md)
> (ссылки на §-разделы ниже). Правила работы — в [../AGENTS.md](../AGENTS.md).
>
> Карту держим в синхроне с кодом: добавил/удалил/переименовал значимый файл — поправь строку здесь.

## Навигация по сценариям («хочу сделать X — смотри сюда»)

| Задача                                               | Файлы                                                                              |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Добавить/поменять **тип данных или контракт API/WS** | `packages/shared/src/*` (сначала Zod-схема!), затем роут + сервис                  |
| Изменить **схему БД**                                | `packages/db/src/schema.ts` → `pnpm db:push`                                       |
| Добавить **REST-эндпоинт**                           | `apps/server/src/routes/<area>.ts` + сервис в `services/` + регистрация в `app.ts` |
| Добавить **сервис** (бизнес-логика)                  | `apps/server/src/services/*` + DI в `context.ts`                                   |
| Новый **WS-тип сообщения**                           | `packages/shared/src/deploy.ts` (discriminatedUnion) + `routes/ws.ts` / `WsHub`    |
| Новая **фоновая SSH-операция** со стрим-логом        | паттерн `services/BackgroundRunner.ts`                                             |
| Доменная логика **поверх SSH** (без HTTP)            | `packages/core/src/*`                                                              |
| Новая **страница/вкладка UI**                        | `apps/web/src/pages/*` + роут в `main.tsx` + ссылка в `App.tsx`                    |
| Тронул **чистую функцию** (парсер/crypto/форматтер)  | добавь/обнови `*.test.ts` рядом (см. §тесты)                                       |

---

## `packages/shared` — `@dankodeploy/shared` (источник истины: Zod-схемы и типы)

> Любое изменение формы данных начинается здесь. Реэкспорт — `src/index.ts`.

| Файл                  | Что внутри                                                                                                  |
| --------------------- | ----------------------------------------------------------------------------------------------------------- |
| `src/index.ts`        | Барель-реэкспорт всех схем                                                                                  |
| `src/server.ts`       | Серверы: `CreateServerInput`/`UpdateServerInput`, `auth_method`, `ConnectionTestResult`, `*Public`          |
| `src/sshKey.ts`       | VPS SSH-ключи: generate/import input, `SshKeyPublic`, `DeployKeyResult`                                     |
| `src/gitKey.ts`       | Git deploy-ключи (для clone приватных репо): generate/import, `GitKeyPublic`                                |
| `src/project.ts`      | Проекты-карточки: `ProjectConfig` (workdir/deploySteps/backupArtifacts/meta), `kind`, `*Public`             |
| `src/deployment.ts`   | Деплои (проект × сервер): `CreateDeploymentInput`, `DeploymentPublic/Detail`, `DeployRun`                   |
| `src/deploy.ts`       | **WS-протокол** — единый discriminatedUnion `WsClientMessage`/`WsServerMessage`. Новый тип сообщения → сюда |
| `src/metrics.ts`      | `MetricsSnapshot`, `StorageBreakdown`/`DirUsage`/`DockerUsageEntry` (детальный разбор диска)                |
| `src/aiAgent.ts`      | AI-агенты: `aiAgentTypeSchema` (расширять для нового агента), `CreateAiAgentInput`, `AiAgentPublic`         |
| `src/configBackup.ts` | Экспорт/импорт конфигурации панели: `ImportMode`, `ImportResult`                                            |
| `src/vpn.ts`          | VPN-сервер (Outline): `vpnKindSchema`, `VpnReadiness`, `VpnInstallationPublic` (без токенов)                |
| `src/vpnClient.ts`    | VPN-клиент (sing-box): `CreateVpnClientInput`, `VpnClientPublic`, `VpnClientServer`, `VpnClientExitInfo`    |
| `src/auth.ts`         | Auth/2FA: login input, `AuthMe`, статус/подключение TOTP, recovery-коды                                     |

## `packages/db` — `@dankodeploy/db` (Drizzle + SQLite)

| Файл             | Что внутри                                                                                |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `src/schema.ts`  | **Схема БД** (все таблицы). Менять → `pnpm db:push`. Карта таблиц — ARCHITECTURE.md §8    |
| `src/client.ts`  | `createDb(url)` → `{db, sqlite}`; резолв относительного `DATABASE_URL`, создание каталога |
| `src/index.ts`   | Реэкспорт schema + client                                                                 |
| `src/migrate.ts` | `pnpm db:migrate` (только для прод-версионирования; в dev не используется)                |

## `packages/core` — `@dankodeploy/core` (доменная логика поверх SSH, без HTTP)

> Полные описания — ARCHITECTURE.md §5. Все классы принимают `SshExecutor` + `SshTarget`.

| Файл                                      | Что делает                                                                                                                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                            | Публичный API пакета (реэкспорт)                                                                                                                                                                                                                          |
| `src/crypto.ts`                           | AES-256-GCM (`encryptSecret`/`decryptSecret`/`loadMasterKey`), scrypt-пароль (N=2^15, формат `scrypt$N$salt$hash` + легаси), `deriveKeyFromPassword`                                                                                                      |
| `src/util/shell.ts`                       | `shellQuote` — экранирование для shell (Deploy/Undeploy/Provision/ProjectStatus: `composeFile`/`systemdUnit`/пути)                                                                                                                                        |
| `src/ssh/SshExecutor.ts`                  | Пул SSH-соединений: `exec`/`execStream`/`openShell`(pty)/`upload`/`download`; self-heal, `classifySshError`. `setLocal()` → LocalExecutor для `local`. `setHostKeyStore()` + `hostVerifier` (TOFU host key, `hostKeyFingerprint`, `HostKeyMismatchError`) |
| `src/local/LocalExecutor.ts`              | Локальное выполнение (child_process; из Docker — `nsenter -t 1`); pty через `script`. Таймаут 60с                                                                                                                                                         |
| `src/ssh/KeyManager.ts`                   | Генерация/анализ ключей (`ssh-keygen`), идемпотентный деплой публичного ключа в `authorized_keys`                                                                                                                                                         |
| `src/agents/AgentInstaller.ts`            | Установка/удаление AI-CLI + tmux по SSH; `AGENT_SPECS` (расширять для нового агента)                                                                                                                                                                      |
| `src/deploy/DeployRunner.ts`              | Шаги деплоя по SSH со стримом лога; `resolveDeploySteps` (дефолты по kind)                                                                                                                                                                                |
| `src/deploy/UndeployRunner.ts`            | Шаги undeploy (зеркало DeployRunner); `resolveUndeploySteps`                                                                                                                                                                                              |
| `src/deploy/ProvisionRunner.ts`           | Первичная раскатка `git clone` в workdir (public/private с временным ключом)                                                                                                                                                                              |
| `src/metrics/MetricsCollector.ts`         | Метрики ОДНОЙ ssh-командой (loadavg/free/df/docker/ss); экспорт `parseDisks`, `parseCpuPercent`                                                                                                                                                           |
| `src/metrics/StorageCollector.ts`         | Детальный разбор диска ПО КНОПКЕ (`df`/`docker system df`/`du -d1`); `parseDockerDf`                                                                                                                                                                      |
| `src/summary/ProjectStatus.ts`            | `collectProjectRuntime` — статус сервиса (running/stopped/unknown) + git-ревизия по SSH                                                                                                                                                                   |
| `src/backup/BackupRunner.ts`              | Бэкап одного артефакта (`{{OUT}}`) → путь+размер                                                                                                                                                                                                          |
| `src/backup/RestoreRunner.ts`             | Заливка артефакта + `restoreCommand` (`{{IN}}`)                                                                                                                                                                                                           |
| `src/server/DockerInstaller.ts`           | Bootstrap: Docker Engine + Compose plugin по SSH (идемпотентно, стрим лога)                                                                                                                                                                               |
| `src/server/NodeInstaller.ts`             | Bootstrap: Node.js/npm по SSH                                                                                                                                                                                                                             |
| `src/server/SshHardeningInstaller.ts`     | Hardening sshd: drop-in `99-dankodeploy.conf`, fail2ban, `sshd -t` + reload                                                                                                                                                                               |
| `src/server/OutlineInstaller.ts`          | Раскатка/удаление Outline (Shadowsocks) через `install_server.sh`; парсит `{apiUrl,certSha256}`                                                                                                                                                           |
| `src/server/VpnReadinessChecker.ts`       | Готовность сервера к VPN-серверу ОДНОЙ ssh-командой                                                                                                                                                                                                       |
| `src/server/SingBoxInstaller.ts`          | VPN-клиент (sing-box, TUN): установка + kernel-страховка SSH/docker/host (policy routing `table 100`)                                                                                                                                                     |
| `src/server/VpnClientReadinessChecker.ts` | Готовность к VPN-клиенту (вкл. `/dev/net/tun`) ОДНОЙ ssh-командой                                                                                                                                                                                         |
| `src/server/vless/parseVlessUri.ts`       | `decodeSubscription`/`parseVlessUri`/`parseSubscriptionServers` (REALITY-поля, список без секретов)                                                                                                                                                       |
| `src/server/vless/buildSingBoxConfig.ts`  | Узел → sing-box JSON (TUN + vless + route `source_port:[SSH]→direct`)                                                                                                                                                                                     |

## `apps/server` — `@dankodeploy/server` (Fastify API + WS + планировщик)

### Точка входа и сборка

| Файл             | Что делает                                                                                                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/main.ts`    | Старт: loadConfig → buildContext → buildApp → listen; `reconcileOrphans` (зависшие running→failed), запуск планировщиков/метрик                                                |
| `src/config.ts`  | `AppConfig` из env (валидация при старте) + **fail-closed**: не-петлевой `HOST` без auth → throw. Список env — ARCHITECTURE.md §10                                             |
| `src/context.ts` | **DI-контейнер `AppContext`**: создаёт все сервисы + общий `SshExecutor`/`WsHub`. Новый сервис регистрируй здесь. Разрыв цикла ServerService↔SshKeyService через `keyResolver` |
| `src/app.ts`     | Сборка Fastify: плагины (cookie/cors/multipart/rate-limit/websocket), errorHandler, authGuard, регистрация всех роутов                                                         |

### Плагины (`src/plugins/`)

| Файл                      | Что делает                                                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/errorHandler.ts` | Глобальный `setErrorHandler` + 404; формат `{error}`, 5xx без стектрейса. **Бросай исключение — не отдавай `500{error:err.message}`** |
| `plugins/authGuard.ts`    | onRequest-hook: защищает `/api/*` кроме whitelist; при `authEnabled=false` пропускает                                                 |

### Роуты (`src/routes/`) — карта эндпоинтов в ARCHITECTURE.md §6

| Файл                     | Эндпоинты                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `routes/auth.ts`         | `/api/auth/me`/`login`(rate-limit)/`logout` + подключение/отключение TOTP и recovery-коды                                                                                  |
| `routes/servers.ts`      | CRUD серверов, `test`, `install-docker`/`install-node`/`harden-ssh`, `reset-host-key` (TOFU-сброс), `metrics`, **`storage`** (детальный разбор диска), `/api/metrics/last` |
| `routes/keys.ts`         | CRUD VPS-ключей, generate/import, `deploy`                                                                                                                                 |
| `routes/gitKeys.ts`      | CRUD git deploy-ключей                                                                                                                                                     |
| `routes/projects.ts`     | CRUD проектов-карточек, `backups`/`backups/upload`, `env` (get/put)                                                                                                        |
| `routes/deployments.ts`  | CRUD деплоев, `provision`/`deploy`/`undeploy`, `deploys`(история), `backup`/`restore`, `env/deploy`                                                                        |
| `routes/vpn.ts`          | VPN-сервер (Outline): CRUD, `readiness`                                                                                                                                    |
| `routes/vpnClient.ts`    | VPN-клиент (sing-box): CRUD, `readiness`, `parse`, `sync`, `external-ip`                                                                                                   |
| `routes/configBackup.ts` | `config/export` (ZIP) / `config/import` (multipart)                                                                                                                        |
| `routes/aiAgents.ts`     | CRUD AI-агентов, `deploy`/`start`/`stop`/`status`                                                                                                                          |
| `routes/ws.ts`           | `/ws`: проверка Origin (`isAllowedWsOrigin`, анти-CSWSH) + auth на handshake (`close(1008)`), парсинг сообщений → `WsHub`/`TerminalBridge`                                 |

### Сервисы (`src/services/`) — описания в ARCHITECTURE.md §6

| Файл                              | Что делает                                                                                                                                                                                                                                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `services/BackgroundRunner.ts`    | **Паттерн фоновой SSH-операции**: `run(task)` → `{runId}`, лог в `deploy:<runId>`, `deploy:done`. Не дублируй runId/WS вручную                                                                                                                                                     |
| `services/AuthService.ts`         | scrypt-verify пароля, выдача/проверка сессии (HMAC); TTL 30 дней + отзыв сменой пароля/версии 2FA                                                                                                                                                                                  |
| `services/TwoFactorService.ts`    | TOTP Google Authenticator, зашифрованный секрет, replay-защита, одноразовые recovery-коды                                                                                                                                                                                          |
| `services/ServerService.ts`       | CRUD серверов, шифрование секретов, `toTarget(row)` → `SshTarget`                                                                                                                                                                                                                  |
| `services/ServerSetupService.ts`  | Bootstrap VPS (Docker/Node/hardening) в фоне с live-логом                                                                                                                                                                                                                          |
| `services/SshKeyService.ts`       | CRUD VPS-ключей, generate/import, `decrypt`, деплой на сервер                                                                                                                                                                                                                      |
| `services/GitKeyService.ts`       | CRUD git deploy-ключей, `decrypt` (на сервер не разворачивает)                                                                                                                                                                                                                     |
| `services/ProjectService.ts`      | CRUD проектов-карточек                                                                                                                                                                                                                                                             |
| `services/DeploymentService.ts`   | CRUD деплоев, `detail` (рантайм-статус по SSH), `resolve(id)` — общий резолвер                                                                                                                                                                                                     |
| `services/EnvService.ts`          | `.env`-шаблон проекта (шифрован), `deployToServer` пишет `<workdir>/.env` (chmod 600)                                                                                                                                                                                              |
| `services/DeployService.ts`       | `start`/`undeploy`: DeployRunner в фоне, лог в WS, статус в БД. `reconcileOrphans`                                                                                                                                                                                                 |
| `services/ProvisionService.ts`    | `provision` — первичный clone из `config.source`                                                                                                                                                                                                                                   |
| `services/BackupService.ts`       | `run`/`restore`/`saveUploaded`/`history` по артефактам                                                                                                                                                                                                                             |
| `services/BackupScheduler.ts`     | node-cron бэкапы из `config.backupCron`; `reload()`                                                                                                                                                                                                                                |
| `services/ConfigBackupService.ts` | Экспорт/импорт всей конфигурации в ZIP (перешифровка под пароль), upsert по id. Импорт недоверенного файла: колонки по whitelist (`PRAGMA`, анти-SQLi), пути в `BACKUP_DIR` (`confineToBackupDir`, анти-traversal). Экспортирует `backupFilename` (тесты `backupFilename.test.ts`) |
| `services/MetricsBroadcaster.ts`  | setInterval(5с) сбор метрик только для подписанных серверов + backoff                                                                                                                                                                                                              |
| `services/MetricsStore.ts`        | Кэш последнего снимка метрик по серверу (таблица `metrics_snapshots`)                                                                                                                                                                                                              |
| `services/AiAgentService.ts`      | CRUD AI-агентов, `deploy`/`uninstall`/`start`/`stop`/`sessionStatus`; лог в `ai:<id>`                                                                                                                                                                                              |
| `services/VpnService.ts`          | VPN-сервер (Outline): `checkReadiness`/`install`/`remove`; токен шифрован                                                                                                                                                                                                          |
| `services/VpnClientService.ts`    | VPN-клиент (sing-box): `parseSubscription`/`install`/`sync`/`externalIp`/`remove`                                                                                                                                                                                                  |
| `services/VpnClientScheduler.ts`  | node-cron авто-обновление подписки активных клиентов (`syncCron`)                                                                                                                                                                                                                  |
| `services/TerminalBridge.ts`      | PTY-мост WS↔shell: для AI — `tmux attach`, для серверов — прямой shell (base64)                                                                                                                                                                                                    |

### WS и скрипты

| Файл                         | Что делает                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `src/ws/WsHub.ts`            | Мультиплексор каналов одного `/ws`-соединения (subscribe/publish по каналам) |
| `src/scripts/genPassword.ts` | `pnpm gen-password` — scrypt-хэш пароля панели + session-secret              |

## `apps/web` — `@dankodeploy/web` (React + Vite + Tailwind + TanStack Query)

> Структура и роутинг — ARCHITECTURE.md §7. Серверный стейт через TanStack Query (инвалидация после мутаций).

| Файл                                                     | Что делает                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/main.tsx`                                           | Роутинг: `/login` публичный; терминалы full-screen; остальное под `RequireAuth`+`App`. `/vpn-client`→redirect `/vpn?tab=client` |
| `src/App.tsx`                                            | Layout (навигация) + глобальный deploy-log drawer                                                                               |
| `src/index.css`                                          | Tailwind + темы                                                                                                                 |
| **lib/**                                                 |                                                                                                                                 |
| `lib/api.ts`                                             | Типизированная обёртка над `fetch` (`credentials:"include"`)                                                                    |
| `lib/ws.ts`                                              | Хук `useWebSocket(subscribe, onMessage, enabled)`                                                                               |
| `lib/format.ts`                                          | UI-форматтеры (`formatBytes`/`formatUptime`/…)                                                                                  |
| `lib/deployLogDrawer.ts`                                 | Глобальный drawer лога деплоя (живёт в App, не пропадает при смене вкладок)                                                     |
| **components/**                                          |                                                                                                                                 |
| `components/ui.tsx`                                      | `StatusBadge`/`MeterBar`/`Modal`/`Spinner`                                                                                      |
| `components/DeployDrawer.tsx`                            | Live-лог деплоя/установки (WS `deploy:<runId>`)                                                                                 |
| `components/AiDeployDrawer.tsx`                          | Live-лог установки AI-агента (WS `ai:<id>`)                                                                                     |
| `components/Terminal.tsx`                                | xterm.js поверх WS-pty + хоткей-кнопки; вывод сервера недоверенный (ограничен `scrollback`, ссылки — `noopener,noreferrer`)     |
| `components/RequireAuth.tsx`                             | Гейт аутентификации (спиннер→redirect на /login)                                                                                |
| **pages/**                                               |                                                                                                                                 |
| `pages/DashboardPage.tsx`                                | Live-метрики серверов                                                                                                           |
| `pages/ProjectsPage.tsx` / `ProjectDetailPage.tsx`       | Проекты-карточки (метаинфо, конфиг, env-шаблон)                                                                                 |
| `pages/DeploymentsPage.tsx` / `DeploymentDetailPage.tsx` | Деплои (проект × сервер): раскатка, лог, env, статус                                                                            |
| `pages/ServersPage.tsx` / `ServerDetailPage.tsx`         | Серверы: SSH-тест, install Docker/Node, hardening, storage                                                                      |
| `pages/KeysPage.tsx` / `GitKeysPage.tsx`                 | VPS-ключи / git deploy-ключи                                                                                                    |
| `pages/BackupPage.tsx`                                   | История бэкапов + экспорт/импорт конфигурации панели                                                                            |
| `pages/AiAgentsPage.tsx` / `AiAgentTerminalPage.tsx`     | Список агентов / full-screen веб-терминал агента                                                                                |
| `pages/ServerTerminalPage.tsx`                           | Full-screen веб-терминал сервера (вне layout)                                                                                   |
| `pages/VpnHubPage.tsx`                                   | Хаб VPN с табами (`?tab=`); экспортирует `VpnPage`, использует секции ниже                                                      |
| `pages/VpnPage.tsx`                                      | `VpnServerSection` — раскатка Outline на серверы (readiness + DeployDrawer)                                                     |
| `pages/VpnClientPage.tsx`                                | `VpnClientSection` — VPN-клиент (subscription → локации → readiness → внешний IP)                                               |
| `pages/DocsPage.tsx`                                     | Встроенная документация в UI (`/docs/:section`)                                                                                 |
| `pages/LoginPage.tsx`                                    | Вход по паролю                                                                                                                  |
| `pages/SecurityPage.tsx`                                 | Подключение TOTP по QR, recovery-коды, отключение и управление 2FA                                                              |

## Тесты (Vitest, `*.test.ts` рядом с кодом)

Покрываем **чистые функции** (без SSH/БД/сети). Запуск `pnpm test`.

| Тест                                                        | Покрывает                                                                   |
| ----------------------------------------------------------- | --------------------------------------------------------------------------- |
| `packages/core/src/crypto.test.ts`                          | Шифрование/хэш/derive-key (round-trip, GCM, легаси-хэш)                     |
| `packages/core/src/util/shell.test.ts`                      | `shellQuote` (метасимволы, одинарная кавычка)                               |
| `packages/core/src/ssh/SshExecutor.test.ts`                 | `hostKeyFingerprint` (формат SHA256) + классификация `HostKeyMismatchError` |
| `packages/core/src/deploy/resolveDeploySteps.test.ts`       | Дефолтные шаги деплоя по kind                                               |
| `packages/core/src/metrics/parseCpuPercent.test.ts`         | Оценка CPU из loadavg/nproc                                                 |
| `packages/core/src/metrics/parseDisks.test.ts`              | Разбор `df`                                                                 |
| `packages/core/src/metrics/StorageCollector.test.ts`        | Разбор `docker system df`/`du`                                              |
| `packages/core/src/server/vless/parseVlessUri.test.ts`      | Разбор subscription/`vless://`                                              |
| `packages/core/src/server/vless/buildSingBoxConfig.test.ts` | sing-box конфиг + route `source_port:[SSH]→direct`                          |
| `apps/server/src/config.test.ts`                            | `isLoopbackHost` + fail-closed `loadConfig` (бинд наружу без auth)          |
| `apps/server/src/services/AuthService.test.ts`              | Сессия: round-trip, подделка, истечение TTL, отзыв сменой пароля            |
| `apps/server/src/services/TwoFactorService.test.ts`         | RFC-вектор TOTP, окно времени, replay-защита, recovery-коды                 |
| `apps/server/src/routes/ws.test.ts`                         | `isAllowedWsOrigin` (анти-CSWSH: чужой/отсутствующий Origin)                |
| `apps/server/src/plugins/errorHandler.test.ts`              | Формат ответа об ошибке, сокрытие 5xx                                       |
| `apps/server/src/services/BackgroundRunner.test.ts`         | runId/publish/done-контракт фоновой операции                                |
| `apps/server/src/services/backupFilename.test.ts`           | Имя файла бэкапа + `confineToBackupDir` (анти path-traversal импорта)       |
| `apps/web/src/lib/format.test.ts`                           | UI-форматтеры                                                               |

---

## Конфиги репозитория (корень)

| Файл                                                | Что                                                                                                 |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `pnpm-workspace.yaml`                               | Workspaces + `allowBuilds` (нативные better-sqlite3/ssh2)                                           |
| `tsconfig.base.json`                                | Базовый TS-конфиг (наследуют пакеты)                                                                |
| `eslint.config.js`                                  | Flat-config ESLint 9 (type-aware); правила — AGENTS.md                                              |
| `vitest.config.ts`                                  | Один корневой конфиг Vitest                                                                         |
| `packages/db/drizzle.config.ts`                     | Конфиг drizzle-kit (`db:push`/`studio`); подхватывает корневой `.env`                               |
| `docker-compose.yml`                                | Локальный запуск панели в Docker                                                                    |
| `.github/dependabot.yml`                            | Еженедельные апдейты зависимостей (npm/docker/actions)                                              |
| `.github/workflows/security-audit.yml`              | `pnpm audit` на PR/по расписанию (гейт по prod high/critical)                                       |
| `.agents/skills/deploy/SKILL.md`                    | Repo-skill Codex для внешнего backup/deploy панели; `.claude/skills/deploy` — compatibility symlink |
| `deploy/`                                           | Раскатка панели на VPS (Docker Compose + Traefik + Ansible) — см. [DEPLOY.md](DEPLOY.md)            |
| `deploy/ansible/roles/dankodeploy/tasks/backup.yml` | Согласованный pre-deploy backup named volumes и секретов; backend всегда возвращается после попытки |
| `dankodeploy.config.example.yaml`                   | Примеры `config` проекта по типам сервисов — см. [SERVICE-SPEC.md](SERVICE-SPEC.md)                 |
