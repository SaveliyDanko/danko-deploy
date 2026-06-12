# Автоматическая раскатка DankoDeploy на VPS (Ansible)

Ansible сам ставит Docker, поднимает общий Traefik (HTTPS), тянет код, генерит секреты и
поднимает стек панели. Вы заполняете **минимум**: адрес VPS, домен, репозиторий, email и пароль панели.

Деплой **независим от состояния сервера**: если Docker/Traefik/сети `web` нет — роль их создаст;
если Traefik уже крутится (например, рядом с вашими сайтами) — использует существующий.

## Что делает плейбук

1. Ставит Docker Engine + Compose plugin, создаёт пользователя-владельца.
2. `git clone`/`pull` репозитория на сервер.
3. Создаёт общую docker-сеть `web` и поднимает Traefik, **если его ещё нет** (иначе использует
   существующий). Traefik сам выпускает Let's Encrypt и редиректит http→https.
4. **Генерит секреты один раз** (master-key, session-secret) и сохраняет в `secrets/` на сервере —
   повторный прогон их **не перетирает** (смена master-key = потеря зашифрованных SSH-доступов).
   Хэш пароля панели считается самим проектом (`pnpm gen-password`), не дублируя crypto.
5. `docker compose up -d --build` (server + web за Traefik по домену) и ждёт `/api/health`.

Всё идемпотентно — повторный прогон обновляет код и пересобирает только изменившееся.

## Предпосылки

- На вашей машине: `ansible` (`pip install ansible`).
- VPS на Ubuntu/Debian, доступ по SSH с sudo.
- Домен с A-записью на VPS (нужно для Let's Encrypt), открытые порты 80/443.

## Минимальная настройка

```bash
cd deploy/ansible

# 1. Инвентарь — адрес VPS и SSH-пользователь
cp inventory.example.ini inventory.ini
$EDITOR inventory.ini

# 2. Параметры стенда — домен, repo, email
$EDITOR group_vars/dankodeploy.yml

# 3. Пароль панели — в зашифрованный vault
cp group_vars/vault.example.yml group_vars/vault.yml
$EDITOR group_vars/vault.yml
ansible-vault encrypt group_vars/vault.yml
```

## Запуск

```bash
ansible-playbook site.yml --ask-vault-pass
```

После прогона панель доступна на `https://<ваш-домен>` (вход по заданному паролю).

## Полезное

| Действие | Команда |
|----------|---------|
| Только обновить код и пересобрать | `ansible-playbook site.yml --ask-vault-pass --tags code,deploy` |
| Прогнать без изменений (проверка) | `ansible-playbook site.yml --ask-vault-pass --check` |
| Сменить пароль панели | отредактировать vault → прогон с `--tags secrets,deploy` |
| Тестовый сертификат (без лимитов LE) | `dankodeploy_acme_staging: true` в `group_vars/dankodeploy.yml` |
| Не трогать Traefik (управляю сам) | `dankodeploy_manage_traefik: false` |
| Подключить к своему Traefik | оставьте `manage_traefik: true` — роль увидит запущенный Traefik и подключит панель меткой |

## Что беречь на сервере

- `{{ dankodeploy_dir }}/secrets/` — master-key и session-secret. Потеря master-key =
  невозможность расшифровать сохранённые SSH-доступы. Бэкапьте вместе с `data/`.
- `{{ dankodeploy_dir }}/data/` — SQLite-база панели.
- `{{ dankodeploy_dir }}/backups/` — артефакты бэкапов проектов.

Подробнее об архитектуре раскатки — [../../docs/DEPLOY.md](../../docs/DEPLOY.md).
