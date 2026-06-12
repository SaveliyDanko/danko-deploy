# DankoDeploy server (API + WS + SSH-движок).
#
# Особенности проекта, учтённые здесь:
#  - pnpm-монорепо; внутренние пакеты резолвятся НА ИСХОДНИКИ (main → src/index.ts),
#    поэтому сервер запускается через tsx (исполняет TS + резолвит workspace), а не
#    через скомпилированный dist — так надёжнее, чем собирать все пакеты в dist.
#  - better-sqlite3 / ssh2 — нативные модули: компилируются под платформу контейнера
#    в стадии deps (нужны python3 + build-essential).
#  - В рантайме нужны системные ssh-keygen (KeyManager) и tmux (AI-агенты).
#  - Схему БД применяет entrypoint (pnpm db:push) — миграций в проекте нет.

# ---------- deps: установка зависимостей + нативная сборка ----------
FROM node:22-bookworm-slim AS deps
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
# Тулчейн для нативных модулей (better-sqlite3/ssh2/node-pty).
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
# node_modules с уже собранными нативными модулями из стадии deps.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules
# Исходники (сервер исполняется через tsx прямо из src).
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
# tsconfig.base.json — пакеты наследуют его (extends); нужен tsx/drizzle-kit.
COPY tsconfig.base.json ./tsconfig.base.json
COPY apps/server ./apps/server
COPY packages/shared ./packages/shared
COPY packages/core ./packages/core
COPY packages/db ./packages/db
COPY deploy/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Данные/бэкапы — на volumes (см. docker-compose).
RUN mkdir -p /app/data /app/backups
EXPOSE 3001

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
