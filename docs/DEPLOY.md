# Развёртывание DankoDeploy на VPS

> Панель спроектирована как **локальный** инструмент (слушает `127.0.0.1`). Веб-терминалы дают
> **прямой shell-доступ к вашим серверам**, поэтому вынос наружу допустим только за HTTPS и с
> обязательным паролем панели. Этот гайд описывает безопасную прод-раскатку через Docker + nginx.

## Архитектура раскатки

```
Интернет → nginx (TLS, контейнер web) ──┬── /            → статика фронта (Vite build)
                                         ├── /api         → server:3001 (Fastify)
                                         └── /ws          → server:3001 (WebSocket)
                                              (только внутренняя docker-сеть)
```

Наружу торчит **только** nginx (80/443). Backend (`server:3001`) доступен лишь во внутренней
docker-сети — порт не публикуется.

## Файлы

| Файл | Назначение |
|------|-----------|
| [docker-compose.prod.yml](../docker-compose.prod.yml) | server + web (nginx); пробрасывает master-key, password-hash, session-secret |
| [apps/server/Dockerfile](../apps/server/Dockerfile) | образ backend (Fastify через tsx) |
| [apps/web/Dockerfile](../apps/web/Dockerfile) | сборка Vite-бандла → раздача через nginx |
| [deploy/nginx/dankodeploy.conf](../deploy/nginx/dankodeploy.conf) | конфиг сайта: статика + прокси `/api` и `/ws` + TLS |
| [.env.prod.example](../.env.prod.example) | шаблон env для прода |

## Предпосылки на VPS

- Docker Engine + Compose plugin.
- Доменное имя, A-запись которого указывает на VPS (нужно для TLS).
- Открытые порты 80 и 443.

## Шаги

### 1. Код и зависимости

```bash
git clone <repo> dankodeploy && cd dankodeploy
```

Для генерации секретов нужен либо локальный Node + pnpm, либо разовый контейнер.

### 2. Секреты и .env

```bash
cp .env.prod.example .env

# мастер-ключ шифрования (base64, 32 байта)
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# пароль панели + секрет cookie (выведет DANKODEPLOY_AUTH_PASSWORD_HASH и SESSION_SECRET)
corepack enable && pnpm install && pnpm gen-password
```

Впишите в `.env`: `DANKODEPLOY_MASTER_KEY`, `DANKODEPLOY_AUTH_PASSWORD_HASH`,
`DANKODEPLOY_SESSION_SECRET`, `WEB_ORIGIN=https://ВАШ-ДОМЕН`.

> Без Node на VPS секреты можно сгенерировать локально и перенести — мастер-ключ нужен один и тот же
> на всё время жизни данных (иначе сохранённые SSH-доступы не расшифруются).

### 3. Домен в nginx-конфиге

В [deploy/nginx/dankodeploy.conf](../deploy/nginx/dankodeploy.conf) замените все `ВАШ-ДОМЕН`
на реальный домен.

### 4. TLS-сертификат (Let's Encrypt)

Сертификаты монтируются в nginx из `./deploy/letsencrypt`. Разовый выпуск через certbot
(webroot-челлендж обслуживает `./deploy/certbot-www`):

```bash
mkdir -p deploy/letsencrypt deploy/certbot-www

docker run --rm \
  -v "$PWD/deploy/letsencrypt:/etc/letsencrypt" \
  -v "$PWD/deploy/certbot-www:/var/www/certbot" \
  -p 80:80 \
  certbot/certbot certonly --standalone -d ВАШ-ДОМЕН --agree-tos -m you@example.com -n
```

Обновление — `certbot renew` тем же образом (по cron); после обновления `docker compose -f
docker-compose.prod.yml exec web nginx -s reload`.

### 5. Запуск

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Откройте `https://ВАШ-ДОМЕН`, войдите по паролю, добавьте сервер на вкладке **Серверы** →
**Test connection**, затем заводите проекты и деплои.

## Что бэкапить и беречь

- **`DANKODEPLOY_MASTER_KEY`** — потеря = невозможность расшифровать все сохранённые SSH-доступы.
- **`./data`** (SQLite-база панели) — серверы, проекты, деплои, история.
- **`./backups`** — скачанные артефакты бэкапов проектов.

Для переноса между машинами есть штатный экспорт/импорт конфигурации (вкладка «Бэкап» в UI):
секреты в архиве перешифрованы под пароль, а не под master-key.

## Чек-лист безопасности перед выносом наружу

- [ ] Задан `DANKODEPLOY_AUTH_PASSWORD_HASH` (панель без пароля = открытый shell к вашим серверам).
- [ ] Задан постоянный `DANKODEPLOY_SESSION_SECRET` (иначе сессии слетают при рестарте).
- [ ] HTTPS работает, HTTP редиректит на HTTPS.
- [ ] Порт `3001` **не** опубликован наружу (в compose у `server` нет `ports`).
- [ ] `.env`, `data/`, `backups/`, `deploy/letsencrypt/` не попадают в git.
- [ ] (Опционально) firewall/`ufw` пропускает только 80/443 и ваш SSH.
