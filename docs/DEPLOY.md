# Развёртывание DankoDeploy на VPS

> Панель спроектирована как **локальный** инструмент (слушает `127.0.0.1`). Веб-терминалы дают
> **прямой shell-доступ к вашим серверам**, поэтому вынос наружу допустим только за HTTPS и с
> обязательным паролем панели. Этот гайд описывает безопасную прод-раскатку через Docker Compose
> за общим **Traefik**, автоматизированную **Ansible**.

Весь комплект раскатки — в каталоге [deploy/](../deploy/). Два пути:
**автоматический (Ansible)** — рекомендуется, и **ручной (Docker Compose)** — если без Ansible.

## Архитектура раскатки

```
            :443 (HTTPS)
   браузер ──────────────►  Traefik  ──Host(домен)──►  web (nginx)
                            (общий edge,                 │  ├─ статика SPA (Vite build)
                             авто Let's Encrypt,         │  └─ proxy /api,/ws ─► server:3001
                             http→https)                 внутренняя сеть       (Fastify API + WS + SSH-движок)
```

- Наружу торчит **только** Traefik (80/443) и через него — сервис `web`.
- **`server`** (`:3001`) порт **не публикует** — доступен лишь во внутренней docker-сети.
- Фронт ходит на тот же origin (`/api`, `/ws` через `location.host`), поэтому отдельный адрес
  бэкенда нигде не зашит — nginx внутри `web` проксирует их на `server`.

## Файлы

| Файл | Назначение |
|------|-----------|
| [deploy/docker-compose.yml](../deploy/docker-compose.yml) | стек панели: `server` + `web` за Traefik (метки домена), volumes |
| [deploy/docker/server.Dockerfile](../deploy/docker/server.Dockerfile) | образ backend (native-модули, ssh-keygen/tmux, запуск собранным бандлом `node dist/main.js`) |
| [deploy/docker/entrypoint.sh](../deploy/docker/entrypoint.sh) | `db:push` (применение схемы) + старт сервера |
| [deploy/docker/web.Dockerfile](../deploy/docker/web.Dockerfile) + [nginx.conf](../deploy/docker/nginx.conf) | сборка Vite → nginx со статикой и прокси `/api`,`/ws` |
| [deploy/.env.example](../deploy/.env.example) | домен + секреты прода |
| [deploy/ansible/](../deploy/ansible/) | автоматизация (Docker, Traefik, секреты, запуск) |

## Ключевые особенности (почему именно так)

- **Запуск сервера собранным бандлом (`node dist/main.js`), а не через `tsx`.** Весь наш
  TypeScript (`apps/server` + `@dankodeploy/shared|core|db`, которые резолвятся на исходники
  `main → src/index.ts`) esbuild складывает в один `dist/main.js`; npm-зависимости остаются
  external. Так в проде не живёт резидентный транспилятор tsx (экономия ~100+ МБ RAM).
  Хэш пароля считает второй бандл-эндпоинт — `dist/genPassword.js` (`node`, без tsx).
- **Схему БД применяет entrypoint (`pnpm db:push`).** Миграций в проекте нет — схема катится
  напрямую из `schema.ts`. Это же снимает класс ошибок «no such column …» после обновлений.
- **`DATABASE_URL` абсолютный** (`/app/data/dankodeploy.sqlite`) — чтобы сервер (cwd `apps/server`)
  и drizzle-kit (cwd `packages/db`) смотрели на один файл.
- **Native-модули** (`better-sqlite3`, `ssh2`) компилируются в образе под платформу контейнера;
  в рантайме нужны системные `ssh-keygen` (KeyManager) и `tmux` (AI-агенты) — они в образе.
- **Pre-deploy backup** выполняется внешним Ansible до `git pull`: backend кратко останавливается,
  три named volume и постоянные секреты архивируются в `/var/backups/dankodeploy`, после чего
  старый backend запускается обратно. Даже ошибка архивации не оставляет панель выключенной и
  блокирует дальнейшее обновление.
- **SSH host key проверяется строго:** первый fingerprint подтверждается вне Ansible, последующие
  подключения сверяются с `~/.ssh/known_hosts` управляющей машины.

---

## Путь 1 — автоматический (Ansible) ✅

Ansible сам ставит Docker, поднимает Traefik (если его нет) и сеть `web`, генерит секреты,
тянет код и запускает стек. Деплой **независим от состояния VPS**.

### Предпосылки

- На вашей машине: `ansible` (роль работает через docker-команды, доп. коллекции не нужны).
- VPS на Ubuntu/Debian, SSH с sudo, открытые 80/443.
- Домен с A-записью на VPS, код в git-репозитории.

### Запуск

```bash
cd deploy/ansible

cp inventory.example.ini inventory.ini && $EDITOR inventory.ini    # адрес VPS, SSH-пользователь
$EDITOR group_vars/dankodeploy.yml                                  # домен, repo, acme_email

cp group_vars/vault.example.yml group_vars/vault.yml
$EDITOR group_vars/vault.yml                                        # пароль панели
ansible-vault encrypt group_vars/vault.yml

ansible-playbook site.yml --ask-vault-pass
```

После прогона панель — на `https://<домен>`. Команды обслуживания и нюансы (свой Traefik vs
существующий, staging-сертификаты, смена пароля) — в [deploy/ansible/README.md](../deploy/ansible/README.md).

---

## Путь 2 — вручную (Docker Compose)

На VPS с Docker и уже запущенным Traefik (сеть `web`):

```bash
git clone <repo> /opt/dankodeploy && cd /opt/dankodeploy
docker network create web 2>/dev/null || true     # если сети ещё нет

cp deploy/.env.example deploy/.env
```

Заполните `deploy/.env`:

```bash
# домен (A-запись → IP сервера)
DANKODEPLOY_DOMAIN=panel.example.com

# мастер-ключ шифрования (base64, 32 байта)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# секрет cookie сессии (hex)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Хэш пароля панели — через сам проект (локальный pnpm **или** разовый контейнер):

```bash
# вариант с контейнером (без локального Node). Хэш считает бандл dist/genPassword.js
# тем же scrypt, что и панель (в прод-образе нет tsx/исходников — только dist):
docker compose -f deploy/docker-compose.yml build server
docker compose -f deploy/docker-compose.yml run --rm --no-deps \
  --entrypoint node server apps/server/dist/genPassword.js 'ВАШ_ПАРОЛЬ'
# из вывода взять строку DANKODEPLOY_AUTH_PASSWORD_HASH=... в deploy/.env
# ВАЖНО: хэш в формате scrypt$N$salt$hash — при вставке в .env удвойте каждый '$'
# (scrypt$$N$$salt$$hash), иначе docker compose воспримет $ как подстановку и испортит хэш.
```

Запуск:

```bash
docker compose -f deploy/docker-compose.yml up -d --build
```

Откройте `https://<домен>`, войдите по паролю, добавьте сервер на вкладке **Серверы** →
**Test connection**, затем заводите проекты и деплои.

> Без Traefik на сервере его можно поднять заготовкой из Ansible-роли
> ([traefik-compose.yml.j2](../deploy/ansible/roles/dankodeploy/templates/traefik-compose.yml.j2))
> или любым своим edge на 80/443 — главное, чтобы он был в сети `web` и понимал метки `traefik.*`.

---

## Что бэкапить и беречь

- **`DANKODEPLOY_MASTER_KEY`** — потеря = невозможность расшифровать все сохранённые SSH-доступы.
- **`/var/backups/dankodeploy`** — pre-deploy снимки SQLite, backup-артефактов, SSH-volume и
  конфигурации. По умолчанию хранятся 14 дней; копируйте их за пределы VPS.
- **volume `dankodeploy_data`** (SQLite-база) — серверы, проекты, деплои, история.
- **volume `dankodeploy_backups`** — скачанные артефакты бэкапов проектов.
- **volume `dankodeploy_ssh`** — known_hosts/ключи исходящих SSH самой панели.
- При Ansible-раскатке — каталог `secrets/` на сервере (master-key, session-secret).

Для переноса между машинами есть штатный экспорт/импорт конфигурации (вкладка «Бэкап» в UI):
секреты в архиве перешифрованы под пароль, а не под master-key.

## Чек-лист безопасности перед выносом наружу

- [ ] Задан `DANKODEPLOY_AUTH_PASSWORD_HASH` (панель без пароля = открытый shell к вашим серверам).
- [ ] Задан постоянный `DANKODEPLOY_SESSION_SECRET` (иначе сессии слетают при рестарте).
- [ ] HTTPS работает, HTTP редиректит на HTTPS (Traefik делает это сам).
- [ ] Порт `3001` **не** опубликован наружу (у `server` в compose нет `ports`).
- [ ] `.env`, vault, `secrets/`, volumes не попадают в git.
- [ ] Fingerprint SSH-хоста проверен через консоль провайдера; неизвестные host keys не принимаются вслепую.
- [ ] (Опционально) firewall/`ufw` пропускает только 80/443 и ваш SSH.
