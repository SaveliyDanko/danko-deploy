# Автоматическая раскатка DankoDeploy на VPS (Ansible)

Ansible сам ставит Docker, поднимает общий Traefik (HTTPS), тянет код, генерит секреты и
поднимает стек панели. Вы заполняете **минимум**: адрес VPS, домен, репозиторий, email и пароль панели.

Деплой **независим от состояния сервера**: если Docker/Traefik/сети `web` нет — роль их создаст;
если Traefik уже крутится (например, рядом с вашими сайтами) — использует существующий.

## Что делает плейбук

1. Ставит Docker Engine + Compose plugin, создаёт пользователя-владельца.
2. Перед обновлением останавливает только backend, архивирует persistent volumes и секреты,
   затем обязательно запускает старый backend обратно. На первом деплое шаг пропускается.
3. `git clone`/`pull` репозитория на сервер.
4. Создаёт общую docker-сеть `web` и поднимает Traefik, **если его ещё нет** (иначе использует
   существующий). Traefik сам выпускает Let's Encrypt и редиректит http→https.
5. **Генерит секреты один раз** (master-key, session-secret) и сохраняет в `secrets/` на сервере —
   повторный прогон их **не перетирает** (смена master-key = потеря зашифрованных SSH-доступов).
   Хэш пароля панели считается самим проектом (`pnpm gen-password`), не дублируя crypto.
6. `docker compose up -d --build` (server + web за Traefik по домену) и ждёт `/api/health`.

Всё идемпотентно — повторный прогон обновляет код и пересобирает только изменившееся.

## Предпосылки

- На вашей машине: `ansible` (`pip install ansible`).
- VPS на Ubuntu/Debian, доступ по SSH с sudo.
- Домен с A-записью на VPS (нужно для Let's Encrypt), открытые порты 80/443.
- Host key VPS заранее проверен через доверенный канал и записан в `~/.ssh/known_hosts`.
  Роль использует `host_key_checking=True` и не принимает неизвестный ключ автоматически.

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

# 4. Первый раз подключитесь обычным SSH и сравните fingerprint с консолью провайдера.
ssh <пользователь>@<VPS-IP>
```

## Запуск

```bash
ansible-playbook site.yml --ask-vault-pass
```

После прогона панель доступна на `https://<ваш-домен>` (вход по заданному паролю).

Для CLI сначала выполните в локальном клоне `pnpm gen-token`, сохраните сырой
`DANKODEPLOY_TOKEN` у агента, а SHA-256 запишите в `dankodeploy_automation_token_hash` в
`group_vars/dankodeploy.yml`. Затем повторите прогон с `--tags secrets,deploy`.

## Полезное

| Действие                             | Команда                                                                                        |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Только обновить код и пересобрать    | `ansible-playbook site.yml --ask-vault-pass --tags code,deploy` (backup включён автоматически) |
| Только создать backup                | `ansible-playbook site.yml --ask-vault-pass --tags backup`                                     |
| Прогнать без изменений (проверка)    | `ansible-playbook site.yml --ask-vault-pass --check`                                           |
| Сменить пароль панели                | отредактировать vault → прогон с `--tags secrets,deploy`                                       |
| Тестовый сертификат (без лимитов LE) | `dankodeploy_acme_staging: true` в `group_vars/dankodeploy.yml`                                |
| Не трогать Traefik (управляю сам)    | `dankodeploy_manage_traefik: false`                                                            |
| Подключить к своему Traefik          | оставьте `manage_traefik: true` — роль увидит запущенный Traefik и подключит панель меткой     |

## Что беречь на сервере

- `/var/backups/dankodeploy/<timestamp>/` — автоматический снимок перед обновлением:
  SQLite, артефакты бэкапов, исходящие SSH-данные, `.env` и `secrets/`.
- Снимки по умолчанию хранятся 14 дней. Путь и срок задаются через
  `dankodeploy_backup_dir`/`dankodeploy_backup_retention_days`.
- Compose использует named volumes: обычный `up -d --build` их не удаляет. Никогда не запускайте
  `docker compose down -v` при обновлении — `-v` удалит постоянные данные.
- Backup на том же VPS защищает от неудачного обновления, но не от потери самого VPS. Регулярно
  копируйте каталог снимков во внешнее хранилище с шифрованием и ограниченным доступом.

Восстановление перезаписывает текущие данные, поэтому skill деплоя не делает его автоматически:
сначала выберите снимок, проверьте `manifest.txt` и отдельно подтвердите операцию восстановления.

Подробнее об архитектуре раскатки — [../../docs/DEPLOY.md](../../docs/DEPLOY.md).
