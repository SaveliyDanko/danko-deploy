# AGENTS.md

Инструкции для AI-агентов (Claude Code, Cursor, Copilot и др.), работающих в этом репозитории.
Совместимо со стандартом [agents.md](https://agents.md). Для Claude Code см. также `CLAUDE.md`,
для полного контекста — [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), для навигации по файлам
(«где именно лежит X») — [docs/CODEMAP.md](docs/CODEMAP.md).

## Проект в одном абзаце

**DankoDeploy** — TypeScript-монорепо (pnpm workspaces): локальная веб-панель для деплоя,
мониторинга, бэкапов и управления сервисами на VPS **по SSH, без агентов на серверах**,
а также на локальном хосте (через `child_process`, из Docker — `nsenter`).
Backend на Fastify + node-ssh + SQLite/Drizzle + WebSocket; frontend на React + Vite + Tailwind +
TanStack Query. Общие типы — Zod в `packages/shared`. Запускается локально (`127.0.0.1`).

## Карта репозитория

| Путь | Пакет | Что внутри |
|------|-------|-----------|
| `apps/server` | `@dankodeploy/server` | Fastify API + WS + планировщик + auth + PTY-мост. Вход: `src/main.ts`. Сборка DI: `src/context.ts` |
| `apps/web` | `@dankodeploy/web` | React + Vite дашборд (+ xterm.js терминал). Вход: `src/main.tsx` |
| `packages/shared` | `@dankodeploy/shared` | **Zod-схемы и типы — источник истины** (вкл. WS-протокол в `deploy.ts`) |
| `packages/db` | `@dankodeploy/db` | Drizzle schema (`src/schema.ts`); схему применять `pnpm db:push` |
| `packages/core` | `@dankodeploy/core` | Доменная логика: `SshExecutor` (SSH) + `LocalExecutor` (локальные команды через `child_process`, из Docker — `nsenter`), `KeyManager`, `DeployRunner`/`UndeployRunner`/`ProvisionRunner`, `MetricsCollector`, `BackupRunner`/`RestoreRunner`, `AgentInstaller`, `DockerInstaller`/`NodeInstaller`/`SshHardeningInstaller`, crypto |

**Полная карта сервисов, эндпоинтов, схемы БД и WS-протокола — в [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
(§5–§8). Читай её перед нетривиальными изменениями.** Плоский индекс всех файлов
(`путь → назначение`, + навигация по сценариям) — [docs/CODEMAP.md](docs/CODEMAP.md): начни с него,
чтобы быстро найти нужный файл. Ниже — только то, что нужно держать в голове постоянно.

## Настройка окружения

```bash
corepack enable          # включить pnpm
pnpm install             # Node >= 20; better-sqlite3/ssh2 собираются нативно
cp .env.example .env     # затем вписать DANKODEPLOY_MASTER_KEY (32 байта base64) и абсолютный DATABASE_URL
pnpm db:push             # создать/обновить схему БД напрямую из schema.ts
```

Сгенерировать мастер-ключ: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

## Команды разработки

| Команда | Действие |
|---------|---------|
| `pnpm dev` | server (:3001) + web (:5173) параллельно |
| `pnpm dev:server` / `pnpm dev:web` | по отдельности |
| `pnpm typecheck` | `tsc --noEmit` по всем пакетам — **запускать после изменений** |
| `pnpm test` | Vitest (unit-тесты чистых функций) — **запускать после изменений в core/web-утилитах** |
| `pnpm test:watch` | Vitest в watch-режиме (для разработки тестов) |
| `pnpm lint` | ESLint (flat-config, type-aware) по всему репо — **запускать после изменений** |
| `pnpm lint:fix` | ESLint с авто-фиксом |
| `pnpm format` / `format:check` | Prettier: форматирование / проверка |
| `pnpm build` | сборка всех пакетов |
| `pnpm db:push` | применить изменения `schema.ts` прямо к БД (**основной способ в dev**) |
| `pnpm db:studio` | просмотр данных (Drizzle Studio) |
| `pnpm gen-password` | сгенерировать хэш пароля панели (`DANKODEPLOY_AUTH_PASSWORD_HASH`) |

### Изменение схемы БД
Проект **в активной разработке — миграции не ведём**. Меняешь `packages/db/src/schema.ts` →
`pnpm db:push` применяет напрямую. **Не запускай `pnpm db:generate`/`db:migrate`** без явной
просьбы (они нужны только для версионирования в продакшене).

## Правила для кода

- **ESM, `"type": "module"`.** В относительных импортах указывай расширение `.js` (даже для `.ts`).
- **Порядок импортов:** node-встроенные → внешние пакеты → внутренние `@dankodeploy/*` → относительные.
- **Типы определяются один раз** в `packages/shared` через Zod. Меняешь форму данных → сначала схема.
- **Комментарии на русском**, краткие, объясняют «почему», в стиле окружающего кода.
- Backend-роуты: валидируй тело `schema.safeParse(req.body)`, при ошибке → `400 { error: ...flatten() }`.
- **Необработанные исключения безопасны:** глобальный `setErrorHandler` (`plugins/errorHandler.ts`) ловит любой throw,
  логирует детали на сервере и отдаёт клиенту `{ error }` без стектрейса (5xx → общий текст). Поэтому при
  внутреннем сбое (ssh-keygen/SSH и т.п.) — **бросай**, не делай `500 { error: err.message }` (это утечка).
  Контракт ответа об ошибке всегда `{ error: string | object }`.
- **Фоновая SSH-операция** (раскатка/установка со стримом лога) — через `BackgroundRunner`
  (`services/BackgroundRunner.ts`): `runner.run(async (publish) => { …; return status })` сам
  выдаёт `{ runId }`, шлёт лог в `deploy:<runId>` и публикует `deploy:done`. Не дублируй runId/catch/WS вручную.
- Новые сервисы регистрируй в `apps/server/src/context.ts` (DI-контейнер `AppContext`).
- Новый WS-тип сообщения → в discriminatedUnion `packages/shared/src/deploy.ts` (иначе `safeParse` отбросит).
- Frontend: серверный стейт через TanStack Query; после мутаций инвалидируй `queryKey`.

## Безопасность (критично)

- SSH-секреты и приватные ключи **всегда** шифруются (`encryptSecret`, AES-256-GCM) до записи в БД.
- **Пользовательские значения в shell-командах** (`composeFile`, `systemdUnit`, `workdir`, пути) оборачивай
  в `shellQuote` (`@dankodeploy/core`, `util/shell.ts`). Пользовательский ввод в путях ФС панели — санитизируй.
- **Host key — TOFU:** `SshExecutor` передаёт `hostVerifier` (запомнить при первом подключении в
  `servers.host_key_fp`, сверять дальше, `HostKeyMismatchError` при несовпадении). Новые SSH-подключения
  не ослабляй до «принимать любой ключ». Сброс — `POST /api/servers/:id/reset-host-key`.
- Публичные типы (`*Public`) и API-ответы **не содержат** приватных ключей/паролей.
- **Аутентификация:** пароль панели — scrypt-хэш в env, сессия в подписанной httpOnly cookie.
  Токен сессии **истекает** (TTL 30 дней, `validateSessionToken` проверяет `issuedAt`) и **отзывается**
  сменой пароля (ключ HMAC завязан на хэш пароля). Не выдавай токены без TTL-проверки.
  `/api/*` защищён guard'ом (`plugins/authGuard.ts`); `/ws` — проверкой **Origin** (`isAllowedWsOrigin`,
  анти-CSWSH) И сессии на handshake (`routes/ws.ts`, `close(1008)` иначе). **Веб-терминал = прямой shell к серверу:**
  любой новый WS-канал с доступом к серверу обязан быть за этой проверкой; auth на `/ws` не ослаблять.
  `POST /api/auth/login` — **rate-limit** (`@fastify/rate-limit`, 5 попыток / 15 мин на IP) против брутфорса.
- **Fail-closed по биндингу** (`config.ts`): не-петлевой `HOST` + выключенная auth → сервер не стартует
  (`loadConfig` бросает). Обход — только `DANKODEPLOY_ALLOW_NO_AUTH=true` (панель за доверенным прокси).
- Не логировать секреты и содержимое терминала. Не коммитить `.env`, `*.sqlite`, `backups/`, `data/`.
- **Импорт конфигурации — недоверенный ввод** (`ConfigBackupService`): имена колонок при upsert бери
  из схемы (`PRAGMA`, белый список), не из файла (анти-SQLi); пути артефактов конфайни в `BACKUP_DIR`
  (`confineToBackupDir`, анти-traversal). Не ослабляй это при правках импорта.

## Проверка результата

Функциональные проверки локальные (typecheck/lint/test); из CI настроен только
`security-audit` (`pnpm audit`) + Dependabot. Перед завершением задачи:

1. `pnpm typecheck` должен проходить чисто (для UI-правок — ещё `pnpm build` фронта).
2. `pnpm lint` должен проходить **без ошибок** (warnings допустимы). Конфиг — `eslint.config.js` (см. ниже).
3. `pnpm test` — **Vitest unit-тесты** (см. ниже). Менял чистую функцию (парсер/crypto/config-builder/форматтер) — **добавь/обнови тест**.
4. Для backend-изменений: поднять сервер с тестовой БД и проверить эндпоинты `curl`'ом.
   После — удалить тестовые данные через `DELETE`-эндпоинты.
5. Менял зависимости — `pnpm run audit` (гейт по prod high/critical; `audit:all` — полный отчёт).

### Линтинг (ESLint + Prettier)
Flat-config `eslint.config.js` (ESLint 9, **type-aware** typescript-eslint). Уровни прагматичные:
**опасное → error** (`no-floating-promises`/`no-misused-promises`/`no-unused-vars`), стилевое → warn
(`no-explicit-any`, `no-non-null-assertion`), `console` разрешён. Идиоматичный fire-and-forget
(`void qc.invalidateQueries(...)`, `void navigate(...)`) — помечай `void`. Тесты линтятся без type-info.
Prettier (`.prettierrc.json`, printWidth 100) — форматирование; стилевые ESLint-правила отключены через
`eslint-config-prettier`. Новый файл — гоняй `pnpm lint` (0 errors) перед завершением.

### Тесты (Vitest)

Юнит-тесты лежат рядом с кодом как `*.test.ts` (один корневой `vitest.config.ts`, запуск `pnpm test`).
Покрываем прежде всего **чистые функции** (без SSH/БД/сети) — там тесты дёшевы и ловят реальные регрессы:

- `packages/core/src/crypto.test.ts` — шифрование/хэш/derive-key (round-trip, GCM-аутентификация).
- `packages/core/src/deploy/resolveDeploySteps.test.ts` — дефолтные шаги деплоя по типу сервиса.
- `packages/core/src/metrics/parseCpuPercent.test.ts` / `parseDisks.test.ts` / `StorageCollector.test.ts` — разбор метрик и диска (loadavg/df/docker df/du).
- `packages/core/src/server/vless/parseVlessUri.test.ts` — разбор subscription/`vless://` (REALITY-поля, метки, приватность публичного списка).
- `packages/core/src/server/vless/buildSingBoxConfig.test.ts` — генерация sing-box конфига (новый формат DNS, **route-правило `source_port:[SSH]→direct`**, tcp/grpc).
- `apps/server/src/plugins/errorHandler.test.ts` — формат ответа об ошибке, сокрытие 5xx.
- `apps/server/src/services/BackgroundRunner.test.ts` — контракт фоновой SSH-операции (runId/publish/done).
- `apps/server/src/services/backupFilename.test.ts` — имя файла бэкапа.
- `apps/web/src/lib/format.test.ts` — форматтеры UI.

**Правила:** новый тест — рядом с исходником (`foo.ts` → `foo.test.ts`); импорты с расширением `.js`;
`describe/it/expect` импортируй явно из `vitest` (глобалы выключены). Тесты исключены из `tsc`-сборки
(`exclude` в tsconfig пакетов) — в `dist` не попадают. Для логики поверх SSH/БД (сервисы) — пока ручной
e2e через curl; при желании покрыть их юнитами понадобятся моки `SshExecutor`/`Db`.

## Подводные камни

- **Схему меняй через `pnpm db:push`**, не через миграции (см. раздел выше).
- **`DATABASE_URL` относительный резолвится от cwd**; сервер и drizzle-kit имеют разный cwd — в dev
  путь абсолютный, а `drizzle.config.ts` сам подхватывает корневой `.env`.
- `better-sqlite3`/`ssh2` нативные → `allowBuilds: true` в `pnpm-workspace.yaml`; при смене Node — `pnpm rebuild`.
- `KeyManager` требует системный `ssh-keygen` в PATH.
- **AI-агенты требуют `tmux`+`npm` на целевом сервере.** `AgentInstaller` ставит/проверяет CLI и удаляет через `npm uninstall -g`.
  **Для локального сервера:** если tmux не найден — ошибка «Установите вручную: sudo apt-get install -y tmux»
  (без попытки sudo через child_process, которое без TTY зависает на запросе пароля).
- **WS-протокол** — единый discriminatedUnion в `packages/shared/src/deploy.ts`: новый тип сообщения
  добавляй туда, иначе `safeParse` его отбросит. Байты pty (`terminal:*`/`server-terminal:*`) — base64.
- **Локальный сервер (`connectionType: "local"`):**
  - Команды выполняются через `LocalExecutor` (child_process: `execSync`/`spawn`), из Docker — `nsenter -t 1 -m -u -i -n -p`.
  - Терминал: PTY через системный `script -qfc "exec $SHELL" /dev/null` (не `spawn` — он неинтерактивен).
  - Таймаут команд: 60 секунд (защита от зависаний при недоступной сети).
  - Кнопки «Установить Docker/Node/SSH hardening» скрыты на UI (на хосте уже есть).
  - В production docker-compose: `pid: "host"` + volume `/var/run/docker.sock`.

## Язык

Общение с пользователем и комментарии в коде — **на русском**.