# Образ фронта DankoDeploy: собираем Vite-бандл и отдаём его через nginx.
# Этот же nginx проксирует /api и /ws на backend-контейнер (см. deploy/nginx).
# Сборка ведётся из корня монорепо: docker build -f apps/web/Dockerfile .

# --- сборка ---
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable
WORKDIR /app

# зависимости воркспейса (web + shared, на который он ссылается)
COPY pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --filter @dankodeploy/web... --frozen-lockfile=false

# исходники и сборка
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @dankodeploy/web build

# --- раздача через nginx ---
FROM nginx:1.27-alpine AS runtime
COPY apps/web/dist /usr/share/nginx/html
# Конфиг сайта подкладывается через volume в compose (deploy/nginx/*.conf),
# чтобы менять домен/сертификаты без пересборки образа.
EXPOSE 80 443
