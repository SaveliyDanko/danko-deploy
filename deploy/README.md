# Деплой DankoDeploy на VPS

Раскатка самой панели DankoDeploy на сервер: **Docker Compose** за общим **Traefik** (HTTPS),
автоматизировано через **Ansible**. Независимо от состояния VPS — роль ставит всё, чего не хватает.

## Архитектура

```
            :443 (HTTPS)
   браузер ──────────────►  Traefik  ──Host(домен)──►  web (nginx)
                            (общий edge,                 │  ├─ статика SPA
                             авто Let's Encrypt)         │  └─ proxy /api, /ws ─► server (3001)
                                                         внутренняя сеть          (API + WS + SSH-движок)
```

- **web** — единственный публичный сервис: nginx отдаёт собранный фронт и проксирует `/api`+`/ws`
  на сервер (фронт ходит на тот же origin, без хардкода адреса). За Traefik по домену.
- **server** — API/WS/SSH-движок, наружу **не публикуется** (только во внутренней docker-сети).
- Запуск сервера — через `tsx src/main.ts` (внутренние пакеты монорепо резолвятся на исходники,
  поэтому `node dist` не годится). Схему БД применяет entrypoint (`db:push` — миграций в проекте нет).

## Содержимое

| Путь | Что |
|------|-----|
| `docker-compose.yml` | Стек панели (server + web), volumes, метки Traefik |
| `.env.example` | Домен и секреты (заполняет Ansible; вручную — по образцу) |
| `docker/server.Dockerfile` | Образ сервера (native-модули, ssh-keygen/tmux, entrypoint) |
| `docker/web.Dockerfile` + `docker/nginx.conf` | Сборка фронта → nginx со статикой и прокси |
| `docker/entrypoint.sh` | `db:push` + запуск сервера |
| `ansible/` | Полная автоматизация (см. `ansible/README.md`) |

## Быстрый старт (Ansible — рекомендуется)

```bash
cd deploy/ansible
ansible-galaxy collection install community.docker
cp inventory.example.ini inventory.ini && $EDITOR inventory.ini            # адрес VPS
$EDITOR group_vars/dankodeploy.yml                                          # домен, repo, email
cp group_vars/vault.example.yml group_vars/vault.yml && $EDITOR group_vars/vault.yml
ansible-vault encrypt group_vars/vault.yml                                  # пароль панели
ansible-playbook site.yml --ask-vault-pass
```

После прогона панель — на `https://<домен>` (вход по заданному паролю). Подробности и команды
обслуживания — в [ansible/README.md](ansible/README.md).

## Вручную (без Ansible)

На сервере с Docker и запущенным Traefik (сеть `web`):

```bash
git clone <repo> /opt/dankodeploy && cd /opt/dankodeploy
docker network create web 2>/dev/null || true   # если ещё нет

cp deploy/.env.example deploy/.env
# заполнить deploy/.env:
#   DANKODEPLOY_DOMAIN          — домен панели (A-запись → IP)
#   DANKODEPLOY_MASTER_KEY      — node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
#   DANKODEPLOY_SESSION_SECRET  — node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
#   DANKODEPLOY_AUTH_PASSWORD_HASH — pnpm gen-password (или через образ, см. ниже)

docker compose -f deploy/docker-compose.yml up -d --build
```

Хэш пароля без локального pnpm — через собранный образ:
```bash
docker compose -f deploy/docker-compose.yml build server
docker compose -f deploy/docker-compose.yml run --rm --no-deps \
  --entrypoint pnpm server --filter @dankodeploy/server gen-password 'ВАШ_ПАРОЛЬ'
# из вывода взять строку DANKODEPLOY_AUTH_PASSWORD_HASH=... в deploy/.env
```

## Безопасность и что беречь

- **Аутентификация панели обязательна** перед выставлением наружу: веб-терминал = прямой shell к серверам.
- `DANKODEPLOY_MASTER_KEY` — без него не расшифровать сохранённые SSH-доступы. **Не теряйте**,
  бэкапьте вместе с volume `dankodeploy_data`.
- Бэкапить: volumes `dankodeploy_data` (SQLite), `dankodeploy_backups`, `dankodeploy_ssh`,
  и `secrets/` на сервере (master-key/session-secret при Ansible-раскатке).
