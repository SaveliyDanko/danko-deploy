# Образ для запуска backend-панели DankoDeploy.
# Сборка ведётся из корня монорепо: docker build -f apps/server/Dockerfile .
FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# better-sqlite3/ssh2 требуют тулчейн для нативной сборки
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ openssh-client \
  && rm -rf /var/lib/apt/lists/*

# --- зависимости ---
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/core/package.json packages/core/
COPY apps/server/package.json apps/server/
RUN pnpm install --frozen-lockfile=false

# --- исходники ---
COPY packages ./packages
COPY apps/server ./apps/server

EXPOSE 3001
# Сервер запускается через tsx (без отдельного build-шага), читает /app/.env при наличии
CMD ["pnpm", "--filter", "@dankodeploy/server", "exec", "tsx", "src/main.ts"]
