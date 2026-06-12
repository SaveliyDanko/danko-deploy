# DankoDeploy web (React/Vite дашборд) → статика за nginx.
#
# nginx тут одновременно:
#  - отдаёт собранную SPA (с history-fallback на index.html);
#  - проксирует /api и /ws на контейнер сервера (тот же origin, как ждёт apps/web,
#    который ходит на location.host без хардкода адреса бэкенда).
# Наружу (в Traefik) торчит ТОЛЬКО этот сервис на одном домене.

# ---------- build: сборка статики ----------
FROM node:22-bookworm-slim AS build
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN pnpm install --frozen-lockfile --filter @dankodeploy/web...

# tsconfig.base.json из корня — apps/web и packages/shared наследуют его (extends).
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm --filter @dankodeploy/web build

# ---------- runtime: nginx со статикой ----------
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY deploy/docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
