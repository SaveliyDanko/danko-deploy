# DankoDeploy server (API + WS + SSH-движок).
#
# Особенности проекта, учтённые здесь:
#  - pnpm-монорепо; внутренние пакеты резолвятся НА ИСХОДНИКИ (main → src/index.ts).
#    В рантайме сервер запускается НЕ через tsx, а собранным бандлом: esbuild
#    складывает весь наш TypeScript (server + @dankodeploy/*) в один dist/main.js,
#    npm-зависимости остаются external. Так в проде НЕ живёт резидентный транспилятор
#    tsx (экономия ~100+ МБ RAM) и нет процесса-обёртки pnpm.
#  - better-sqlite3 / ssh2 — нативные модули: компилируются под платформу контейнера
#    в стадии deps (нужны python3 + build-essential). В бандле они external и
#    резолвятся из node_modules (объявлены прямыми зависимостями @dankodeploy/server).
#  - В рантайме нужны системные ssh-keygen (KeyManager) и tmux (AI-агенты).
#  - Схему БД применяет entrypoint (pnpm db:push, drizzle-kit) — миграций в проекте нет.

# ---------- deps: установка зависимостей + нативная сборка ----------
FROM node:22-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
# Тулчейн для нативных модулей (better-sqlite3/ssh2).
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Сначала только манифесты — кешируем слой установки.
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/server/package.json apps/server/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/db/package.json packages/db/package.json
# Полная установка с нативной сборкой разрешённых пакетов (allowBuilds в workspace).
RUN pnpm install --frozen-lockfile

# ---------- build: бандл сервера в один dist/main.js ----------
FROM deps AS build
WORKDIR /app
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/server ./apps/server
COPY packages/shared ./packages/shared
COPY packages/core ./packages/core
COPY packages/db ./packages/db
RUN pnpm --filter @dankodeploy/server build

# ---------- runtime ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
# Рантайм-зависимости: openssh-client (ssh-keygen для KeyManager), tmux (AI-агенты),
# ca-certificates (исходящие HTTPS: ipinfo, sing-box install и т.п.).
RUN apt-get update && apt-get install -y --no-install-recommends \
      openssh-client tmux ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# node_modules с собранными нативными модулями + симлинками external-зависимостей бандла.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
# tsconfig.base.json — drizzle-kit (db:push) подхватывает его через extends.
COPY tsconfig.base.json ./tsconfig.base.json
# Сервер запускается из собранного бандла; package.json нужен для "type":"module".
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/dist ./apps/server/dist
# packages/db — для db:push (drizzle-kit читает schema.ts + drizzle.config.ts).
# packages/core и packages/shared — НЕ нужны рантайму (они уже внутри бандла), но
# нужны pnpm для целостности workspace: entrypoint зовёт `pnpm --filter db push`, а
# pnpm 11 валидирует весь workspace и падает (WORKSPACE_PKG_NOT_FOUND), если пакеты,
# на которые ссылается apps/server (workspace:*), отсутствуют. На RAM не влияет.
COPY --from=build /app/packages/db ./packages/db
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/packages/shared ./packages/shared
COPY deploy/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Данные/бэкапы — на volumes (см. docker-compose).
RUN mkdir -p /app/data /app/backups

# Commit меняется на каждой раскатке. Держим ARG в конце, чтобы не сбрасывать кеш тяжёлых слоёв.
ARG DANKODEPLOY_COMMIT=unknown
ENV DANKODEPLOY_COMMIT=$DANKODEPLOY_COMMIT
EXPOSE 3001

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
