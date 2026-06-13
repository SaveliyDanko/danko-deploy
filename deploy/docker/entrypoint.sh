#!/usr/bin/env bash
# Entrypoint контейнера сервера DankoDeploy.
#  1) применяет схему БД (pnpm db:push, drizzle-kit) — миграций в проекте нет, схема катится напрямую;
#  2) запускает сервер собранным бандлом (node apps/server/dist/main.js) — без tsx в рантайме.
#
# Все секреты/настройки приходят через окружение (docker environment/.env).
# DATABASE_URL должен быть АБСОЛЮТНЫМ путём, чтобы сервер (cwd apps/server) и
# drizzle-kit (cwd packages/db) смотрели на один файл.
set -euo pipefail

: "${DATABASE_URL:=/app/data/dankodeploy.sqlite}"
export DATABASE_URL

case "$DATABASE_URL" in
  /*) ;;
  *) echo "[entrypoint] ВНИМАНИЕ: DATABASE_URL должен быть абсолютным путём (сейчас: $DATABASE_URL)";;
esac

mkdir -p "$(dirname "$DATABASE_URL")" "${BACKUP_DIR:-/app/backups}"

echo "[entrypoint] Применяю схему БД (db:push)…"
# drizzle-kit push неинтерактивен; берёт DATABASE_URL из окружения.
pnpm --filter @dankodeploy/db push

echo "[entrypoint] Запускаю сервер…"
cd /app/apps/server
exec node dist/main.js
