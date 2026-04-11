# Provenance Agent Query — multi-stage Dockerfile
# Build context: monorepo root (../../ relative to docker-compose.yml)

FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

# ---------------------------------------------------------------------------
# Dependencies stage
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/agent-query/package.json ./apps/agent-query/
COPY packages/types/package.json ./packages/types/
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Development stage — builds TS then runs with node --watch
# ---------------------------------------------------------------------------
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/agent-query/node_modules ./apps/agent-query/node_modules
COPY tsconfig.base.json ./
WORKDIR /app/apps/agent-query
EXPOSE 3002
CMD ["sh", "-c", "npx tsc && node dist/src/main.js"]
