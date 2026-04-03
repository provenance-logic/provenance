# Provenance Web — multi-stage Dockerfile
# Build context: monorepo root (../../ relative to docker-compose.yml)

FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

# ---------------------------------------------------------------------------
# Dependencies stage
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Development stage — mounts source via volume, runs Vite dev server
# ---------------------------------------------------------------------------
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY tsconfig.base.json ./
WORKDIR /app/apps/web
EXPOSE 3000
CMD ["pnpm", "dev", "--host"]

# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY tsconfig.base.json ./
COPY packages/types/ ./packages/types/
COPY apps/web/ ./apps/web/
WORKDIR /app/apps/web
RUN pnpm build

# ---------------------------------------------------------------------------
# Production stage — static files served by nginx
# ---------------------------------------------------------------------------
FROM nginx:1.25-alpine AS production
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
