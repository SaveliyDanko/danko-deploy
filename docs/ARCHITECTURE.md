# DankoDeploy — Архитектура и контекст проекта

> Документ для быстрого онбординга человека или LLM. Описывает, что это за проект,
> как он устроен, какие решения приняты и почему, и как с ним работать.

## 1. Что это

**DankoDeploy** — локальная веб-панель для управления собственными сервисами на VPS-серверах
через SSH. Один пользователь (владелец) запускает панель у себя на машине и из браузера:

- ведёт **проекты-карточки** (метаинформация, git-репо, описание, конфиг раскатки — без сервера);
- **деплоит** проект на сервер через **деплой** (проект × сервер), live-лог в реальном времени;
  один проект можно развернуть на несколько серверов (по деплою на каждый);
- **мониторит** серверы (CPU / RAM / диск / docker-контейнеры);
- делает **бэкапы** (вручную и по cron-расписанию) с конкретного деплоя;
- видит **сводку** по каждому деплою (статус, git-ревизия, последний деплой);
- управляет **SSH-ключами** (генерация, импорт, развёртывание на серверы);
- открывает прямой **SSH-терминал** конкретного сервера в браузере;
- разворачивает **AI-агентов** (Claude Code / Codex) на серверах и работает с ними через
  живой **веб-терминал** в браузере (в т.ч. с телефона).

Ключевой принцип: **никаких агентов мониторинга на серверах**. Панель подключается к VPS по SSH
и выполняет обычные shell-команды (метрики собираются опросом). AI-агенты — исключение: это
сами CLI-инструменты, которые ставятся на сервер и живут в tmux; панель лишь даёт к ним терминал.

Доступ к панели защищён опциональной **аутентификацией по паролю** (обязательна перед выносом
наружу, т.к. веб-терминал = прямой shell-доступ к серверу).

## 2. Зафиксированные продуктовые решения

| Решение | Выбор | Почему |
|---------|-------|--------|
| Интерфейс | Веб-дашборд | Наглядно для мониторинга и сводок |
| Язык | TypeScript (фронт + бэк) | Единый стек, общие типы |
| Связь с VPS | SSH с панели, без агентов | Ничего не ставить на серверы |
| Хостинг панели | Локально на ПК (`127.0.0.1`) | Безопасность: наружу не торчит |
| Упаковка сервисов | Смешанная: docker-compose / systemd / process | Под реальные проекты пользователя |
| БД | SQLite | Zero-config, локально; легко перенести на Postgres |

## 3. Технологический стек

**Backend** (`apps/server`): Node + TypeScript + **Fastify**, `@fastify/websocket`, `@fastify/cors`.
**SSH**: `node-ssh` (обёртка над `ssh2`). **БД**: SQLite через `better-sqlite3` + **Drizzle ORM**.
**Шифрование секретов**: встроенный `node:crypto` (AES-256-GCM). **Планировщик**: `node-cron`.
**Генерация ключей**: системный `ssh-keygen` (вызывается через `child_process`).

**Frontend** (`apps/web`): React 18 + **Vite** + TypeScript, **Tailwind CSS**, **TanStack Query**
(серверный стейт/кэш/поллинг), **React Router**.

**Общее**: **Zod** — единый источник истины для типов и валидации (`packages/shared`).

## 4. Структура монорепо

Монорепо на **pnpm workspaces**. Внутренние пакеты ссылаются друг на друга через `workspace:*`
и импортируются по исходникам (`main`/`types` указывают на `src/index.ts`), отдельная сборка
пакетов для dev не нужна — `tsx` и Vite резолвят TypeScript напрямую.

```
apps/
  server/   @dankodeploy/server  — Fastify API + WS + SSH-движок + планировщик
  web/      @dankodeploy/web      — React-дашборд (Vite)
packages/
  shared/   @dankodeploy/shared   — Zod-схемы и типы (ИСТОЧНИК ИСТИНЫ)
  db/       @dankodeploy/db        — Drizzle schema + миграции + клиент SQLite
  core/     @dankodeploy/core      — доменная логика, не зависит от Fastify/React
```

**Граф зависимостей** (кто кого импортирует):

```
shared  ← db        (db использует только типы при необходимости)
shared  ← core
shared, core, db ← server
shared           ← web
```

`core` не знает про HTTP/Fastify — это переиспользуемая доменная логика поверх SSH.
`server` склеивает `core` + `db` и выставляет REST/WS API.

## 5. Доменное ядро (`packages/core`)

Чистые классы поверх SSH, без знания об HTTP. Все принимают `SshExecutor` и `SshTarget`.

| Модуль | Файл | Назначение |
|--------|------|-----------|
| `SshExecutor` | `ssh/SshExecutor.ts` | Пул SSH-соединений (одно на сервер, переиспользуется). `exec`, `execStream`, `openShell` (pty для веб-терминала), `upload`, `download`, `testConnection`, `disconnect`. **Self-heal:** при ошибке открытия канала (`Channel open failure`) протухшее соединение сбрасывается из пула и пересоздаётся (`withConnection`). `classifySshError` — понятная категория ошибки (unreachable/handshake/auth/channel/**hostkey**) для UI. `setLocal()` подключает `LocalExecutor`: для серверов с `connectionType: "local"` команды/pty идут не по SSH, а локально. **Верификация host key (TOFU):** `setHostKeyStore()` подключает хранилище fingerprint'ов; `hostVerifier` при первом подключении запоминает ключ сервера (`hostKeyFingerprint` — формат `SHA256:base64`), при последующих сверяет и при несовпадении бросает `HostKeyMismatchError` (защита от MITM) |
| `LocalExecutor` | `local/LocalExecutor.ts` | Локальное выполнение команд на хосте панели (`child_process`: `execSync`/`spawn`); из Docker-контейнера — через `nsenter -t 1 -m -u -i -n -p`. PTY терминала — через системный `script -qfc`. Таймаут команд 60 с. Реализует тот же интерфейс, что нужен `SshExecutor` для локального режима |
| `KeyManager` | `ssh/KeyManager.ts` | Генерация пары (`ssh-keygen`), анализ импортированного ключа (публичный + fingerprint), развёртывание публичного ключа в `authorized_keys` (идемпотентно) |
| `AgentInstaller` | `agents/AgentInstaller.ts` | Установка/удаление AI-CLI (Claude Code/Codex) и tmux по SSH (идемпотентно), создание/убийство tmux-сессии. `AGENT_SPECS` — расширяемые спецификации агентов |
| `DeployRunner` | `deploy/DeployRunner.ts` | Выполняет шаги деплоя по SSH, стримит логи через колбэки. `resolveDeploySteps` даёт дефолтные шаги по типу сервиса |
| `UndeployRunner` | `deploy/UndeployRunner.ts` | Выполняет шаги undeploy по SSH (зеркало DeployRunner). `resolveUndeploySteps` даёт дефолтные шаги остановки по типу сервиса |
| `ProvisionRunner` | `deploy/ProvisionRunner.ts` | Первичная раскатка: `git clone` репо в `workdir` (public по https; private — приватный ключ во временный файл + `GIT_SSH_COMMAND`, удаляется в `finally`). Падает, если `workdir` не пуст. Стримит логи как DeployRunner |
| `MetricsCollector` | `metrics/MetricsCollector.ts` | Собирает метрики ОДНОЙ ssh-командой (`/proc/loadavg`, `free`, `df`, `docker ps`, `docker stats --no-stream`, `ss -tulnp`), разделитель `===DANKO_SEP===`. Нагрузка по контейнерам (CPU%/RAM) мёрджится в `docker ps` по имени; `ss` даёт слушающие порты хоста (порт/протокол/адрес/процесс, публичный vs локальный). Экспортирует чистые `parseDisks`/`parseCpuPercent` (покрыты юнит-тестами) |
| `StorageCollector` | `metrics/StorageCollector.ts` | Детальный разбор диска ОДНОЙ ssh-командой ПО КНОПКЕ (тяжелее обычных метрик: `du` по корню), разделитель `===DANKO_STORAGE_SEP===`: `df` (все ФС), `docker system df` (images/containers/volumes/build-cache в байтах, `parseDockerDf`), `du -x -d1 /` (топ-каталоги). Питает `GET /api/servers/:id/storage` → `StorageBreakdown` |
| `BackupRunner` | `backup/BackupRunner.ts` | Выполняет команду бэкапа ОДНОГО артефакта (плейсхолдер `{{OUT}}` = путь к файлу), возвращает путь + размер. Сервис вызывает по каждому артефакту |
| `RestoreRunner` | `backup/RestoreRunner.ts` | Заливает файл артефакта на сервер (`upload`) и выполняет его `restoreCommand` (плейсхолдер `{{IN}}` = путь к файлу); временный файл удаляется после |
| `collectProjectRuntime` | `summary/ProjectStatus.ts` | Определяет статус сервиса (running/stopped/unknown) и git-ревизию по SSH |
| `DockerInstaller` / `NodeInstaller` / `SshHardeningInstaller` | `server/*.ts` | Bootstrap VPS по SSH (идемпотентно). Hardening: drop-in `sshd_config.d/99-dankodeploy.conf` (лимиты, keepalive, fail2ban, опц. запрет пароля), `sshd -t` + `reload` |
| `OutlineInstaller` | `server/OutlineInstaller.ts` | Раскатка/удаление **Outline Server (Shadowsocks)** по SSH через официальный `install_server.sh` от Jigsaw (сам ставит Docker + контейнер `shadowbox`). Стримит лог (как DockerInstaller), парсит из вывода `{apiUrl, certSha256}` и отдаёт через `onResult`. `remove` гасит контейнеры и чистит `/opt/outline` |
| `VpnReadinessChecker` | `server/VpnReadinessChecker.ts` | Проверка технической готовности сервера к VPN ОДНОЙ ssh-командой (root/sudo, curl/wget, архитектура, тип виртуализации, наличие docker), разделитель `===DANKO_VPN_SEP===`. Возвращает булевы `VpnReadinessCheck[]` |
| `SingBoxInstaller` | `server/SingBoxInstaller.ts` | Включение/выключение **VPN-клиента** (sing-box) по SSH: VPS гонит весь исходящий трафик через VPN-провайдера в режиме TUN. `run` ставит sing-box, пишет готовый конфиг (генерит панель) и `systemctl enable --now`. **Критично:** ДО старта поднимает kernel-страховку доступа к серверу (policy routing `table 100` на физ. шлюз): ответы на входящие соединения идут мимо TUN, иначе уходят с IP VPN-провайдера и клиент их не принимает. Три источника заворачиваются в `table 100`: SSH (`iptables` MARK по `--sport SSH` + `ip rule fwmark`), **ответы docker-контейнеров** (`ip rule from <docker-subnet>` для docker0/br-* — ловим по docker-src, т.к. MASQUERADE на внешний IP происходит позже) и процессы хоста (`from <host-src>`). Так доступ к SSH и сайтам за Traefik/docker сохраняется. `remove` снимает службу+страховку. `getExternalIp` — внешний IP для проверки в UI |
| vless-модуль | `server/vless/{parseVlessUri,buildSingBoxConfig}.ts` | `decodeSubscription` (base64→строки), `parseVlessUri` (`vless://` → узел с REALITY-полями), `parseSubscriptionServers` (список локаций без секретов для UI), `buildSingBoxConfig` (узел → sing-box JSON: TUN inbound + vless outbound + route-правило `source_port:[SSH]→direct`) |
| `VpnClientReadinessChecker` | `server/VpnClientReadinessChecker.ts` | Готовность сервера к VPN-клиенту ОДНОЙ ssh-командой (root/sudo, curl/wget, **`/dev/net/tun`**, systemd, iptables/ip, virt не openvz/lxc), разделитель `===DANKO_VPNC_SEP===` |
| crypto | `crypto.ts` | `loadMasterKey`, `encryptSecret`, `decryptSecret` (AES-256-GCM); `hashPassword`/`verifyPassword` (scrypt, **N=2^15**, формат `scrypt$N$salt$hash` с разбором легаси `salt:hash`); `deriveKeyFromPassword` (scrypt-ключ из пароля для бэкапа конфигурации; стоимость в `kdf.n`) |
| shellQuote | `util/shell.ts` | Экранирование строки для безопасной вставки в shell (используется в Deploy/Undeploy/Provision-раннерах и ProjectStatus для `composeFile`/`systemdUnit`/путей) |

**Дефолтные шаги деплоя** (если не заданы `config.deploySteps`):
- `docker-compose`: `git pull` → `docker compose pull --ignore-buildable` → `docker compose up -d --build` → `docker image prune -f`
- `systemd`: `git pull` → `sudo systemctl restart <unit>` → `systemctl is-active <unit>`
- `process`: только `git pull` (ожидается, что пользователь задаст свои `deploySteps`)

**Дефолтные шаги undeploy**:
- `docker-compose`: `docker compose down --remove-orphans` (volumes не удаляются)
- `systemd`: `sudo systemctl stop <unit>` → проверка, что unit не active
- `process`: требуется `config.undeploySteps`

## 6. Backend (`apps/server`)

### Сборка зависимостей — `context.ts`
`buildContext(config)` создаёт единый `AppContext` со всеми сервисами и общим `SshExecutor`/`WsHub`.
Здесь же разрывается **циклическая зависимость** ServerService ↔ SshKeyService через ленивый
`keyResolver`: сервер с `authMethod = "stored-key"` при построении `SshTarget` запрашивает
расшифрованный приватный ключ из `SshKeyService`.

### Сервисы (`services/`)
- **`AuthService`** — `verify(password)` (scrypt), `issueSessionToken`/`validateSessionToken`.
  Сессия stateless, но: **истекает** через `SESSION_TTL_MS` (30 дней — `validateSessionToken`
  проверяет `issuedAt`, не только подпись) и **отзывается** сменой пароля (ключ HMAC завязан на
  `sessionSecret` + хэш пароля → новый пароль инвалидирует все ранее выданные токены). `maxAge`
  cookie синхронизирован с TTL (`SESSION_TTL_SECONDS`).
- **`ServerService`** — CRUD серверов, шифрование секретов, `toTarget(row)` строит `SshTarget`
  (для `stored-key` резолвит ключ через `keyResolver`).
- **`ServerSetupService`** — фоновые bootstrap-операции для VPS: установка Docker Engine +
  Compose plugin, Node.js/npm и **hardening SSH** (`hardenSsh`) по SSH с live-логом в WS-канал
  `deploy:<runId>`. Hardening пишет настройки в drop-in `sshd_config.d/99-dankodeploy.conf`
  (лимиты `MaxStartups`/`MaxSessions`, keepalive, fail2ban), валидирует `sshd -t`, применяет
  через `reload` (не restart). `PasswordAuthentication no` ставится ТОЛЬКО для серверов,
  подключённых по ключу (key/stored-key) — иначе доступ панели может оборваться.
- **`SshKeyService`** — CRUD ключей, генерация/импорт, `decrypt(row)`, развёртывание на сервер.
- **`GitKeyService`** — CRUD Git deploy-ключей (отдельно от VPS-ключей), генерация/импорт, `decrypt(row)`.
  На сервер ничего не разворачивает — приватная часть нужна для `git clone` приватного репо.
- **`ProvisionService`** — `provision(deploymentId)`: первичная раскатка из `config.source` на сервере
  деплоя. Для private достаёт/расшифровывает git-ключ, создаёт `deploy_runs`, гоняет `ProvisionRunner`,
  стримит логи в WS-канал `deploy:<runId>` (как обычный деплой).
- **`ProjectService`** — CRUD проектов-**карточек** (без привязки к серверу). Только метаинформация и
  конфиг раскатки; статус/история/бэкапы живут на деплоях.
- **`DeploymentService`** — CRUD **деплоев** (проект × сервер). `create({projectId, serverId})`
  (с проверкой уникальности пары), `listByProject`, `detail(id)` (карточка проекта + сервер +
  рантайм-статус по SSH через `collectProjectRuntime`), `resolve(id) → {deployment, project, server}` —
  общий резолвер для Deploy/Provision/Backup/Env, `setLastDeploy` (статус последней раскатки).
- **`EnvService`** — `.env` проектов (один шаблон на проект): хранит зашифрованно (AES-256-GCM),
  `get`/`save(projectId)` (upsert), `deployToServer(deploymentId)` пишет `<workdir>/.env` на сервер
  ВЫБРАННОГО деплоя (`writeFile` + `chmod 600`).
- **`DeployService`** — `start(deploymentId)`/`undeploy(deploymentId)`: резолвит проект+сервер через
  `DeploymentService`, создаёт `deploy_runs` (с `deploymentId`), запускает `DeployRunner` в фоне,
  стримит логи в WS-канал `deploy:<runId>`, по завершении пишет лог/статус в `deploy_runs` и
  `deployments.lastDeploy*`. Для `git-private` временно подставляет Git deploy-ключ.
- **`BackupService`** — `run(deploymentId, scheduled?)`: резолвит проект (команды/.env/workdir) +
  сервер; по каждому артефакту (`resolveBackupArtifacts`) бэкап по SSH → скачивание в `BACKUP_DIR` →
  удаление временного файла → одна запись истории (с `projectId` + `deploymentId`). `restore(deploymentId,
  backupId, artifactNames?)` — заливает выбранные артефакты на сервер деплоя и выполняет `restoreCommand`.
  `saveUploaded(projectId, …)` — загруженный файл как артефакт `default` (без сервера). `history(projectId)`.
- **`BackupScheduler`** — `reload()` пересобирает cron-задачи из `config.backupCron` проектов; бэкап
  гоняется по КАЖДОМУ деплою проекта (`listByProject`); у проекта без деплоев расписание не активно.
- **`MetricsBroadcaster`** — `setInterval` (5 c) собирает метрики ТОЛЬКО для серверов с активными
  WS-подписчиками и публикует в `metrics:<serverId>`; кэширует последний снимок в `MetricsStore`.
  **Backoff:** при ошибке сбора интервал опроса сервера растёт экспоненциально (5с→…→2мин) и
  сбрасывается при успехе — панель не долбит недоступный/атакованный sshd каждые 5 секунд.
- **`MetricsStore`** — хранилище последнего снимка метрик по каждому серверу (таблица
  `metrics_snapshots`): `save`/`get`/`getAll`. Питает `GET /api/metrics/last` (мгновенный показ
  без ожидания свежего опроса).
- **`ConfigBackupService`** — экспорт/импорт всей конфигурации панели в **ZIP** (`config.json` +
  опц. файлы артефактов бэкапов). Секреты при экспорте **перешифрованы под пароль** (scrypt →
  AES-256-GCM), а не под master-key — архив переносим между машинами. Импорт принимает ZIP (v2)
  или legacy-JSON (v1), проверяет пароль (verifier), перешифровывает под master-key, восстанавливает
  файлы артефактов в `BACKUP_DIR` и делает **upsert по id** в FK-safe порядке (ключи → серверы →
  проекты → деплои → env → backups). Режимы: `merge` (upsert) / `replace` (очистка перед вставкой).
  После импорта роут дёргает `scheduler.reload()` (могли измениться `backupCron`).
  **Импорт-файл считается недоверенным** (бэкапы переносимы/«поделиться»): имена колонок при upsert
  берутся из реальной схемы (`PRAGMA table_info`, белый список) — не из файла (анти-SQL-инъекция;
  `confineToBackupDir`); пути артефактов жёстко конфайнятся в `BACKUP_DIR` по `basename` (анти-traversal —
  иначе импорт мог бы указать `path:"/etc/passwd"` и выгрузить чужой файл).
- **`VpnService`** — управление VPN-инсталляциями на серверах (Outline/Shadowsocks). `checkReadiness(serverId)`
  — синхронно: `VpnReadinessChecker` + `MetricsCollector` (CPU/RAM/диск) → `VpnReadiness`. `install(serverId)`
  в фоне (`OutlineInstaller`): создаёт `vpn_installations` (status `installing`), стримит лог в WS-канал
  `deploy:<runId>` (переиспользует существующий канал, как install-docker), в `onResult` шифрует management
  `apiUrl` (`encryptSecret`), по завершении ставит `active`/`error`. `remove(id)` — фоновое снятие Outline,
  по успеху удаляет строку. Наружу (`VpnInstallationPublic`) токен/cert не отдаются (только `managed: boolean`).
- **`VpnClientService`** — управление **VPN-клиентами** (sing-box): VPS ходит в интернет через VPN-провайдера
  по subscription-ссылке. `parseSubscription(url)` — тянет ссылку (server-side) и парсит в список локаций без
  секретов. `checkReadiness` — `VpnClientReadinessChecker` + метрики. `install(serverId)` в фоне: fetch+parse
  подписки, выбор узла по `selectedLabel`, `buildSingBoxConfig`, лог в WS-канал `deploy:<runId>`. Ссылка хранится
  **зашифрованной** (`encryptSecret`); конфиг с секретами пишется на сервер, наружу (`VpnClientPublic`) не уходит.
  `sync(id)` — авто-обновление подписки (re-fetch, матч по label, перезапись конфига, рестарт). `externalIp(id)`
  — внешний IP для проверки в UI. `remove(id)` — выключение + снятие kernel-страховки SSH.
- **`VpnClientScheduler`** — `node-cron` (образец `BackupScheduler`): авто-обновление подписки активных
  VPN-клиентов по `syncCron` (дефолт каждые 6 ч). `reload()` пересобирает задачи при install/remove.
- **`AiAgentService`** — CRUD AI-агентов; `deploy(agentId)` в фоне (`AgentInstaller`:
  ensureTmux→ensureInstalled→ensureSession), `uninstall(agentId)` гасит tmux-сессию и удаляет
  CLI через `npm uninstall -g`, лог в WS-канал `ai:<agentId>`, статусы в БД; `start/stop` (tmux),
  `sessionStatus` (синхронизация с `tmux has-session`).
- **`TerminalBridge`** — PTY-мост: на WS-подписку открывает `openShell`; для AI делает
  `tmux attach` к сессии агента, для серверов оставляет прямой SSH shell. Проксирует байты ↔ WS
  (`terminal:*` и `server-terminal:*`, base64). Один pty на сокет; на закрытие — `channel.end()`,
  tmux AI-агента НЕ убивается.

Аутентификация: cookie-плагин + `registerAuthGuard` (onRequest-hook, защищает `/api/*` кроме
whitelist) в `app.ts`. `/ws` проверяется в `routes/ws.ts` на handshake (`isRequestAuthenticated`
→ `close(1008)`). При `authEnabled=false` (нет хэша пароля) — всё открыто (dev).
`POST /api/auth/login` ограничен `@fastify/rate-limit` (5 попыток / 15 мин на IP, иначе 429) —
анти-брутфорс пароля. Плагин зарегистрирован с `global: false` (лимит только на этом роуте).

**`BackgroundRunner`** (`services/BackgroundRunner.ts`) — общий паттерн фоновой SSH-операции
(раньше дублировался в ServerSetupService/VpnService/VpnClientService): `run(task)` генерит `runId`,
даёт задаче `publish(line, stream)` → канал `deploy:<runId>` (`deploy:log`), по завершении публикует
`deploy:done` со статусом, на исключении — info-строку + `deploy:done failed`. Доменные сайд-эффекты
(статус в БД, disconnect, onResult installer'а) остаются в задаче.

**Обработка ошибок:** глобальный `registerErrorHandler` (`plugins/errorHandler.ts`, регистрируется до роутов)
+ `setNotFoundHandler`. Единый формат ответа `{ error }`; клиентские ошибки (4xx) отдаются как есть, а
необработанные 5xx **логируются на сервере и НЕ раскрывают стектрейс/внутренности** наружу (общий текст;
детали — только при `NODE_ENV=development`). Поэтому в роутах при внутреннем сбое достаточно бросить исключение.

### REST API
Все ответы — JSON. Тела валидируются Zod-схемами из `@dankodeploy/shared` (`safeParse` → 400 при ошибке).
Формат ошибки — `{ error }` (гарантируется глобальным error-handler'ом).

```
GET    /api/health                              (public)
# Аутентификация (public)
GET    /api/auth/me                  → { authenticated, authRequired }
POST   /api/auth/login               body: { password } → setCookie dd_session
POST   /api/auth/logout
# Серверы
GET    /api/servers
GET    /api/servers/:id
POST   /api/servers                  body: CreateServerInput
PATCH  /api/servers/:id              body: UpdateServerInput
DELETE /api/servers/:id
POST   /api/servers/:id/test         → ConnectionTestResult (uname -a по SSH)
POST   /api/servers/test             body: CreateServerInput (тест до сохранения)
POST   /api/servers/:id/install-docker → { runId } (live-лог в WS deploy:<runId>)
POST   /api/servers/:id/install-node   → { runId } (live-лог в WS deploy:<runId>)
POST   /api/servers/:id/harden-ssh     → { runId } (hardening SSH: лимиты/keepalive/fail2ban/опц. запрет пароля)
POST   /api/servers/:id/reset-host-key  → { ok } (сбросить запомненный host key после пересоздания сервера)
GET    /api/servers/:id/metrics      → MetricsSnapshot (разовый снимок)
GET    /api/servers/:id/storage      → StorageBreakdown (детальный разбор диска по кнопке: df/docker/du)
GET    /api/metrics/last             → MetricsSnapshot[] (кэш для мгновенного показа)
# SSH-ключи
GET    /api/keys
POST   /api/keys/generate            body: GenerateSshKeyInput → SshKeyPublic
POST   /api/keys/import              body: ImportSshKeyInput   → SshKeyPublic
DELETE /api/keys/:id
POST   /api/keys/:id/deploy          body: { serverId }       → DeployKeyResult
# Git deploy-ключи (для clone приватных репо)
GET    /api/git-keys
POST   /api/git-keys/generate        body: GenerateGitKeyInput → GitKeyPublic
POST   /api/git-keys/import          body: ImportGitKeyInput   → GitKeyPublic
DELETE /api/git-keys/:id
# Проекты (карточки, без сервера)
GET    /api/projects
GET    /api/projects/:id
POST   /api/projects                 body: CreateProjectInput
PATCH  /api/projects/:id
DELETE /api/projects/:id
GET    /api/projects/:id/backups         → BackupRecord[] (история на проекте, общая по всем деплоям)
POST   /api/projects/:id/backups/upload  multipart (file) → BackupRecord (загрузка файла бэкапа с ПК, uploaded=true)
GET    /api/projects/:id/env         → ProjectEnv (расшифрованный .env, шаблон проекта)
PUT    /api/projects/:id/env         body: { content } → сохранить (шифрует в БД)
# Деплои (проект × сервер) — единственная точка раскатки/бэкапа/restore
GET    /api/deployments              [?projectId=] → DeploymentPublic[]
GET    /api/deployments/:id          → DeploymentDetail (проект + сервер + рантайм-статус)
POST   /api/deployments              body: { projectId, serverId } → DeploymentPublic
DELETE /api/deployments/:id
POST   /api/deployments/:id/provision   → { runId }  (git clone из config.source; логи в WS)
POST   /api/deployments/:id/deploy      → { runId }  (логи идут в WS)
POST   /api/deployments/:id/undeploy    → { runId }  (в историю деплоев не пишется)
GET    /api/deployments/:id/deploys     → DeployRun[]
DELETE /api/deployments/:id/deploys     → { deleted } (очистка завершённых логов)
POST   /api/deployments/:id/backup          → BackupRecord
POST   /api/deployments/:id/restore         body: { backupId, artifactNames? } → RestoreResult
POST   /api/deployments/:id/env/deploy      → DeployEnvResult (пишет <workdir>/.env на сервере деплоя, chmod 600)
# VPN (Outline/Shadowsocks) — раскатка на серверы
GET    /api/vpn                      → VpnInstallationPublic[] (без токенов)
GET    /api/vpn/:id                  → VpnInstallationPublic
POST   /api/vpn/readiness            body: { serverId } → VpnReadiness (checks + текущие метрики)
POST   /api/vpn                      body: CreateVpnInstallationInput → { runId } (фон, лог в WS deploy:<runId>)
DELETE /api/vpn/:id                  → { runId } (фоновое удаление с сервера)
# VPN-клиент (sing-box) — VPS гонит весь трафик через VPN-провайдера
GET    /api/vpn-client                   → VpnClientPublic[] (без ссылки подписки)
GET    /api/vpn-client/:id               → VpnClientPublic
POST   /api/vpn-client/readiness         body: { serverId } → VpnClientReadiness (TUN-чеки + метрики)
POST   /api/vpn-client/parse             body: { subscriptionUrl } → VpnClientServer[] (список локаций, без секретов)
POST   /api/vpn-client                   body: CreateVpnClientInput → { runId } (фон, лог в WS deploy:<runId>)
POST   /api/vpn-client/:id/sync          → { ok } (ручное обновление подписки)
GET    /api/vpn-client/:id/external-ip   → { externalIp } (проверка, что трафик идёт через VPN)
DELETE /api/vpn-client/:id               → { runId } (фоновое выключение + снятие kernel-страховки SSH)
# Бэкап/восстановление конфигурации панели (перенос между машинами)
POST   /api/config/export            body: { password, includeBackupFiles? } → ZIP-файл (attachment)
POST   /api/config/import            multipart (file + password + mode=merge|replace) → ImportResult
# AI-агенты
GET    /api/ai/agents
POST   /api/ai/agents                body: CreateAiAgentInput → AiAgentPublic
DELETE /api/ai/agents/:id
POST   /api/ai/agents/:id/deploy     → { ok }  (лог установки в WS-канал ai:<id>)
POST   /api/ai/agents/:id/start
POST   /api/ai/agents/:id/stop
GET    /api/ai/agents/:id/status     → { status, agent }
```

### WebSocket — `/ws`
Одно соединение, мультиплексирование по каналам через `WsHub` (+ `TerminalBridge` для pty).
Протокол — единый discriminatedUnion в `packages/shared/src/deploy.ts`. На handshake проверяются
**(1) `Origin`** (`isAllowedWsOrigin` — должен совпасть с `webOrigin`; анти-CSWSH, т.к. WS не
подчиняется CORS) и **(2) сессия** (cookie). Несоответствие — `close(1008)`.

- Клиент → сервер: `subscribe:deploy {runId}`, `subscribe:metrics {serverId}`, `unsubscribe:metrics`,
  `subscribe:ai {agentId}`, `subscribe:terminal {agentId}`, `unsubscribe:terminal`,
  `terminal:input {agentId, data}` (base64), `terminal:resize {agentId, cols, rows}`,
  `subscribe:server-terminal {serverId}`, `unsubscribe:server-terminal`,
  `server-terminal:input {serverId, data}` (base64),
  `server-terminal:resize {serverId, cols, rows}`.
- Сервер → клиент: `deploy:log`, `deploy:done`, `metrics:update`,
  `ai:log {agentId, line, stream}`, `ai:status {agentId, status}`,
  `terminal:data {agentId, data}` (base64), `terminal:exit {agentId, reason?}`,
  `server-terminal:data {serverId, data}` (base64),
  `server-terminal:exit {serverId, reason?}`, `error {message}`.

## 7. Frontend (`apps/web`)

Vite-приложение. В dev-режиме `vite.config.ts` **проксирует** `/api` и `/ws` на `http://127.0.0.1:3001`,
поэтому фронт ходит на свой же origin (CORS в dev не мешает).

- `lib/api.ts` — тонкая обёртка над `fetch` (`credentials: "include"` для cookie), типизированные методы.
- `lib/ws.ts` — хук `useWebSocket(subscribe, onMessage, enabled)`, возвращает `socketRef` для отправки.
- `pages/` — `DashboardPage` (live-метрики), `ProjectsPage` / `ProjectDetailPage` (карточки
  проектов), `DeploymentsPage` / `DeploymentDetailPage` (деплои = проект × сервер: раскатка,
  rollout-лог, env, рантайм-статус), `ServersPage` / `ServerDetailPage` (обслуживание VPS:
  проверка SSH, установка Docker/Node, hardening), `KeysPage` (VPS-ключи), `GitKeysPage`
  (git deploy-ключи), `BackupPage` (история бэкапов + экспорт/импорт конфигурации панели),
  `AiAgentsPage` (список + развернуть агента), VPN на `/vpn` — **таб-хаб** `VpnHubPage.tsx`
  (экспортирует `VpnPage`; активная вкладка в `?tab=`): вкладка «VPN-сервер» — секция `VpnServerSection`
  (из `VpnPage.tsx`: раскатка Outline/Shadowsocks — выбор сервера → readiness-чек с чек-листом +
  `MeterBar` метрики → «Развернуть VPN» открывает `DeployDrawer`); вкладка «VPN-клиент» — секция
  `VpnClientSection` (из `VpnClientPage.tsx`: sing-box — сервер → subscription-ссылка → «Загрузить
  локации» → выбор локации → readiness → «Включить VPN»; список с проверкой внешнего IP и ручным
  обновлением подписки). `DocsPage` (`/docs/:section` — встроенная
  документация в UI), `LoginPage` (вход по паролю); `AiAgentTerminalPage` и `ServerTerminalPage`
  (полноэкранные веб-терминалы, вне общего layout).
- `components/` — `DeployDrawer`/`AiDeployDrawer` (live-логи), `Terminal` (xterm.js + кнопки-хоткеи
  для мобильных), `RequireAuth` (гейт аутентификации), `ui.tsx` (StatusBadge, MeterBar, Modal, Spinner).
- Роутинг (`main.tsx`): `/login` публичный; `/ai/:id/terminal` и `/servers/:id/terminal` —
  full-screen вне layout; остальное (`projects`, `deployments`, `servers`, `keys`, `git-keys`,
  `ai`, `vpn`, `backup`, `docs`) под `RequireAuth` + `App`-layout. Legacy-путь `/vpn-client`
  редиректит на `/vpn?tab=client`. Серверный стейт — TanStack Query (инвалидация после мутаций).

## 8. Модель данных (`packages/db/src/schema.ts`)

| Таблица | Ключевые поля | Заметки |
|---------|---------------|---------|
| `ssh_keys` | `public_key`, `fingerprint`, `private_key_enc`, `passphrase_enc` | Приватник шифрован; публичный и fingerprint открыто |
| `git_keys` | `public_key`, `fingerprint`, `private_key_enc`, `passphrase_enc` | Git deploy-ключи (отдельно от VPS). Приватник шифрован; на сервер кладётся при clone приватного репо |
| `servers` | `auth_method` (key/password/stored-key), `secret_enc`, `key_id`, `host_key_fp` | `secret_enc` NULL для stored-key; `key_id` → `ssh_keys` (onDelete: set null); `host_key_fp` — запомненный fingerprint host key (TOFU, NULL до первого подключения) |
| `projects` | `kind`, `config` (JSON ProjectConfig), `stack` | Карточка **БЕЗ сервера**. `config` — JSON-текст; `config.source` (опц.) — источник git-clone; `config.meta` (опц.) — справочная метаинформация (порты/контейнеры/env/чек-лист/ссылки/заметки) |
| `deployments` | `project_id`, `server_id`, `last_deploy_status`, `last_deploy_at` | **Проект × сервер**. Пара `(project_id, server_id)` уникальна (`deployments_project_server_uq`). Оба FK onDelete: cascade |
| `deploy_runs` | `deployment_id`, `status`, `log`, `started_at`, `finished_at` | Привязаны к деплою (не проекту). Полный лог раскатки для истории |
| `backups` | `project_id`, `deployment_id`, `status`, `path`, `size_bytes`, `artifacts`, `scheduled`, `uploaded` | История на проекте; `deployment_id` (NULL у загруженных) — с какого деплоя снят. `artifacts` (JSON) — `[{name,path,sizeBytes}]`; `uploaded=true` — загружен файлом |
| `metrics_snapshots` | `server_id` (PK), `snapshot` (JSON), `collected_at` | Кэш последнего снимка метрик (по 1 на сервер) |
| `project_env` | `project_id` (PK), `content_enc`, `updated_at` | Зашифрованный `.env` проекта — шаблон (по 1 на проект); пишется на сервер выбранного деплоя в `<workdir>/.env` |
| `ai_agents` | `agent_type`, `workdir`, `tmux_session`, `status`, `last_error` | Статус: installing/uninstalling/ready/running/stopped/error; сессия `dd-agent-<id>` |
| `vpn_installations` | `server_id`, `kind`, `status`, `host`, `api_port`, `api_url_enc`, `cert_sha256` | VPN на сервере (Outline). Пара `(server_id, kind)` уникальна; FK onDelete: cascade. `api_url_enc` (management-токен) шифрован; наружу не отдаётся |
| `vpn_clients` | `server_id`, `subscription_url_enc`, `selected_label`, `status`, `host`, `external_ip`, `sync_cron`, `last_synced_at` | VPN-клиент (sing-box): VPS гонит трафик через провайдера. `server_id` уникален (один клиент на сервер); FK onDelete: cascade. `subscription_url_enc` шифрован; список серверов подписки в БД НЕ хранится (тянется на лету) |

> Пароль панели **не хранится в БД** — только scrypt-хэш в env (`DANKODEPLOY_AUTH_PASSWORD_HASH`).

## 9. Безопасность

- **SSH-секреты и приватные ключи** шифруются AES-256-GCM. В БД лежит только шифротекст.
  Мастер-ключ — `DANKODEPLOY_MASTER_KEY` (env, base64, 32 байта), **не коммитится**.
  Без него расшифровать доступы нельзя.
- **Верификация host key (TOFU).** `SshExecutor` передаёт `hostVerifier` в `ssh2`: при первом
  подключении запоминает fingerprint ключа сервера (`servers.host_key_fp`, формат `SHA256:base64`),
  при последующих — сверяет и рвёт соединение при несовпадении (`HostKeyMismatchError`, защита от
  MITM/подмены сервера). При легитимном пересоздании VPS — `POST /api/servers/:id/reset-host-key`
  (также сбрасывается автоматически при смене `host`/`port`). Без этого `ssh2` принимал бы любой ключ.
- **Аутентификация панели** — scrypt-хэш пароля в env (`DANKODEPLOY_AUTH_PASSWORD_HASH`,
  генерится `pnpm gen-password`), сессия — подписанная httpOnly cookie. Guard защищает `/api/*`,
  `/ws` проверяется на handshake. Без хэша — выключена (только локальный dev).
- **Жизненный цикл сессии:** токен **истекает** через 30 дней (TTL, `AuthService` проверяет `issuedAt`)
  и **отзывается** сменой пароля панели (подпись завязана на хэш пароля — `pnpm gen-password` + рестарт
  инвалидирует все старые сессии). `logout` чистит cookie текущего браузера.
- **Веб-терминалы = прямой shell-доступ к серверу.** Поэтому: auth обязательна перед выносом
  наружу; на WS-handshake проверяются сессия И `Origin` (анти-CSWSH: WS не подчиняется CORS,
  иначе чужой сайт открыл бы `/ws` с cookie жертвы), несоответствие — `close(1008)`; за reverse-proxy
  с TLS, порт `3001` не публиковать напрямую. Панель по умолчанию слушает `127.0.0.1`.
- **Fail-closed по биндингу** (`config.ts`): если `HOST` не петлевой (не `127.0.0.0/8`/`::1`/
  `localhost`), а аутентификация выключена (нет `DANKODEPLOY_AUTH_PASSWORD_HASH`) — сервер
  **отказывается стартовать** (бросает при `loadConfig`). Это защита от мисконфига «открыли наружу
  без пароля». Осознанный обход (панель за доверенным прокси с собственной auth) — `DANKODEPLOY_ALLOW_NO_AUTH=true`.
- `.env`, `*.sqlite`, `backups/`, `data/`, `dankodeploy.config.yaml` — в `.gitignore`.
- Публичные представления (`*Public` типы) никогда не содержат секретов — API не отдаёт приватные ключи/пароли.
- **Сканирование зависимостей.** `pnpm audit` (`pnpm run audit` — гейт по prod high/critical;
  `audit:all` — полный отчёт). Автоматизировано: Dependabot (`.github/dependabot.yml`, еженедельные
  PR-апдейты npm/docker/actions) + workflow `.github/workflows/security-audit.yml` (audit на PR и по
  расписанию). Версии зафиксированы `pnpm-lock.yaml` (в проде `--frozen-lockfile`).
- **Лимит загрузки.** Multipart-аплоад (импорт конфигурации / файл бэкапа) ограничен
  `DANKODEPLOY_MAX_UPLOAD_MB` (дефолт 1 GiB, вровень с nginx) — предохранитель от заполнения диска.
- **Веб-терминал рендерит вывод управляемых (потенциально скомпрометированных) серверов** в xterm.js.
  xterm не исполняет управляющие последовательности как команды; дополнительно: ограничен `scrollback`
  (анти-flood памяти вкладки), ссылки из вывода открываются с `noopener,noreferrer`.

## 10. Конфигурация (env)

См. `.env.example`. Сервер читает `.env` из корня репо (`--env-file=../../.env` в dev-скрипте).

| Переменная | Назначение | Дефолт |
|-----------|-----------|--------|
| `PORT` | Порт API | `3001` |
| `HOST` | Адрес прослушивания | `127.0.0.1` |
| `DANKODEPLOY_ALLOW_NO_AUTH` | Разрешить не-петлевой `HOST` при выключенной auth (обход fail-closed; только за доверенным прокси) | — (выкл.) |
| `DANKODEPLOY_MAX_UPLOAD_MB` | Лимит размера загружаемого файла (импорт/бэкап), МБ | `1024` (1 GiB) |
| `DATABASE_URL` | Путь к SQLite | `./data/dankodeploy.sqlite` |
| `DANKODEPLOY_MASTER_KEY` | Мастер-ключ AES-256-GCM (base64, 32 байта) | — (обязателен) |
| `BACKUP_DIR` | Куда складывать бэкапы | `./backups` |
| `WEB_ORIGIN` | Origin фронта для CORS | `http://localhost:5173` |
| `DANKODEPLOY_AUTH_PASSWORD_HASH` | scrypt-хэш пароля панели (`pnpm gen-password`). Пусто = auth выключена | — (dev: пусто) |
| `DANKODEPLOY_SESSION_SECRET` | Секрет подписи cookie сессии. Пусто = разовый при старте | — (генерится) |

> **Важно про `DATABASE_URL`:** относительный путь резолвится от cwd. Сервер запускается из
> `apps/server`, а миграции — из `packages/db`. Чтобы оба указывали на ОДИН файл, в dev
> используется **абсолютный** путь в `.env`.

## 11. Команды

```bash
corepack enable && pnpm install   # установка (Node >= 20; better-sqlite3/ssh2 — нативная сборка)
pnpm db:push                      # создать/обновить схему БД напрямую из schema.ts (для dev)
pnpm dev                          # параллельно server (:3001) + web (:5173)
pnpm dev:server / pnpm dev:web    # по отдельности
pnpm build                        # сборка всех пакетов
pnpm typecheck                    # tsc --noEmit по всем пакетам
pnpm test                         # Vitest (unit-тесты чистых функций); test:watch — watch-режим
pnpm lint                         # ESLint (flat-config, type-aware); lint:fix — авто-фикс
pnpm format                       # Prettier (format:check — только проверка)
pnpm db:studio                    # просмотр данных (Drizzle Studio)
pnpm gen-password                 # сгенерировать хэш пароля панели (вывод вставить в .env)
```

### Тестирование (Vitest)
Юнит-тесты — рядом с кодом как `*.test.ts`, один корневой `vitest.config.ts`. Покрыты прежде всего
**чистые функции** (без SSH/БД/сети), где регрессы дороги: `crypto` (шифрование/хэш), `vless/parseVlessUri`
(разбор подписки), `vless/buildSingBoxConfig` (sing-box конфиг + критическое route-правило исключения SSH),
`web/lib/format`. Тесты исключены из `tsc`-сборки (`exclude` в tsconfig) — в `dist` не попадают.
Логика поверх SSH/БД (сервисы) пока проверяется ручным e2e (curl); для юнит-покрытия нужны моки
`SshExecutor`/`Db`. Тестового CI нет — `pnpm test` гоняется локально (из CI настроен только
`security-audit`: `pnpm audit` на PR/по расписанию + Dependabot).

### Линтинг (ESLint + Prettier)
`eslint.config.js` — flat-config (ESLint 9, **type-aware** typescript-eslint). Опасное → error
(плавающие промисы, unused), стилевое → warn (`any`, non-null), `console` разрешён. `react-hooks`/
`react-refresh` для `apps/web`. Prettier (`.prettierrc.json`, printWidth 100) форматирует код; стилевые
ESLint-правила сняты через `eslint-config-prettier`. `pnpm lint` (0 errors) — часть локальной проверки.

### Управление схемой БД
Проект **в активной разработке — миграции не ведутся**. Рабочий цикл:
1. Правишь `packages/db/src/schema.ts`.
2. `pnpm db:push` — drizzle-kit сравнивает схему с реальной БД и применяет diff напрямую
   (добавление/удаление колонок и таблиц, без SQL-файлов миграций).

`drizzle.config.ts` подхватывает корневой `.env` (через `process.loadEnvFile`) и создаёт каталог
под файл БД, чтобы push/studio работали с тем же `DATABASE_URL`, что и сервер.

> Команды `pnpm db:generate` (создать SQL-миграцию) и `pnpm db:migrate` (применить) оставлены
> на будущее — для версионирования схемы в продакшене. В разработке они не нужны.

## 12. Известные гочи

1. **Схема БД — через `db:push`, не миграции** (см. §11). Если всё же генерируешь миграцию для
   продакшена — **проверяй её глазами**: drizzle-kit при пересоздании SQLite-таблицы может сослаться
   в `INSERT ... SELECT` на ещё не существующую колонку (так было с `0001_quiet_gideon.sql`).
2. **`better-sqlite3` / `ssh2` — нативные модули.** Требуют `allowBuilds: true` в `pnpm-workspace.yaml`
   и компилируются под ABI текущего Node. При смене версии Node — `pnpm rebuild`.
3. **Метрики ≠ пуш.** CPU оценивается из `loadavg/nproc` (грубо, не из двух замеров top) — достаточно
   для дашборда, но это оценка.
4. **Развёртывание ключа / Test connection / терминал** требуют рабочего SSH-доступа к серверу. Без него
   возвращается структурированная ошибка (`terminal:exit`/`server-terminal:exit`), а не исключение.
5. **WS-протокол — единый discriminatedUnion** в `packages/shared/src/deploy.ts`. Новый тип сообщения
   добавляй туда, иначе `safeParse` в `routes/ws.ts` его молча отбросит.
6. **Байты pty — base64** в `terminal:*` и `server-terminal:*` (вывод бинарен: ANSI/не-utf8).
   На фронте декодируй через `TextDecoder` (stream:true), кодируй через `TextEncoder`, не голый `btoa`.
7. **AI-агенты требуют tmux+npm на сервере.** `AgentInstaller` ставит/проверяет tmux и CLI, а также
   умеет удалять CLI через `npm uninstall -g`; OAuth-логин агента делается один раз в самом
   веб-терминале (токены остаются на сервере, переживают `stop`).
8. **Несколько клиентов на одну tmux-сессию** «сжимают» окно до минимального размера (на v1 принято).

## 13. Точки расширения

- **Агент на серверах** для метрик в реальном времени (архитектура `MetricsCollector`/`MetricsBroadcaster`
  к этому готова — можно добавить альтернативный источник).
- **Новые AI-агенты** (aider, gemini-cli и т.д.) — добавить значение в `aiAgentTypeSchema` и запись
  в `AGENT_SPECS` (`AgentInstaller.ts`): `installCheck`/`installScript`/`uninstallScript`/`startCommand`.
- **Новые VPN-стеки** (wg-easy/WireGuard, Outline access-keys) — добавить значение в `vpnKindSchema`
  и установщик по образцу `OutlineInstaller` (контракт `run`/`remove` с `onLog`/`onResult`/`onDone`),
  развести в `VpnService.install`. Управление клиентскими `ss://`-ключами Outline через management API — отдельная итерация.
- **Другие протоколы VPN-клиента** (vmess/trojan/shadowsocks помимо vless) — расширить `parseVlessUri`/
  `buildSingBoxConfig` (или добавить параллельные парсеры) и матчинг в `VpnClientService`. Выбор узла
  через `urltest` outbound (авто-быстрейший) вместо ручного выбора локации — альтернатива в `buildSingBoxConfig`.
- **Grouped tmux-сессии** (`tmux new-session -t`) — независимый размер окна для разных устройств.
- **Postgres** вместо SQLite — Drizzle позволяет сменить диалект.
- **Декларативный импорт** серверов/проектов из `dankodeploy.config.yaml` (структура уже описана в примере).
