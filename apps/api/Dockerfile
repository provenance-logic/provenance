# Provenance API — multi-stage Dockerfile
# Build context: monorepo root (../../ relative to docker-compose.yml)
# Stage 'development' is used by Docker Compose for local dev with hot-reload.
# Stage 'production' builds an optimized image for deployment.

FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

# ---------------------------------------------------------------------------
# Dependencies stage
# Install from monorepo root so pnpm can resolve workspace:* deps and
# find the root pnpm-lock.yaml.
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Development stage — mounts source via volume, runs nest start --watch
# ---------------------------------------------------------------------------
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY tsconfig.base.json ./
WORKDIR /app/apps/api
EXPOSE 3001
CMD ["pnpm", "dev"]

# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY tsconfig.base.json ./
COPY packages/types/ ./packages/types/
COPY packages/openapi/ ./packages/openapi/
COPY apps/api/ ./apps/api/
WORKDIR /app/apps/api
RUN pnpm build

# ---------------------------------------------------------------------------
# Production stage — minimal image
# ---------------------------------------------------------------------------
FROM node:20-alpine AS production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/node_modules ./node_modules
COPY --from=build /app/apps/api/package.json ./
# OpenAPI specs are read at request time by the in-product /docs route.
# Copy them under packages/openapi alongside the api so the same relative
# walk used in dev (`../../packages/openapi`) resolves in prod too.
COPY --from=build /app/packages/openapi /app/packages/openapi
EXPOSE 3001
USER node
CMD ["node", "dist/apps/api/src/main"]
