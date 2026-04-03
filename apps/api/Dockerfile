# Provenance API — multi-stage Dockerfile
# Stage 'development' is used by Docker Compose for local dev with hot-reload.
# Stage 'production' builds an optimized image for deployment.

FROM node:20-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

# ---------------------------------------------------------------------------
# Dependencies stage
# ---------------------------------------------------------------------------
FROM base AS deps
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# Development stage — mounts source via volume, runs nest start --watch
# ---------------------------------------------------------------------------
FROM base AS development
COPY --from=deps /app/node_modules ./node_modules
COPY . .
EXPOSE 3001
CMD ["pnpm", "dev"]

# ---------------------------------------------------------------------------
# Build stage
# ---------------------------------------------------------------------------
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---------------------------------------------------------------------------
# Production stage — minimal image
# ---------------------------------------------------------------------------
FROM node:20-alpine AS production
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.1.0 --activate

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./

EXPOSE 3001
USER node
CMD ["node", "dist/main"]
