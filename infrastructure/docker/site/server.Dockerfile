# Multi-stage build for the MTA Market API (site/server).
# Build from the REPOSITORY ROOT (build context = repo root):
#   docker build -f infrastructure/docker/site/server.Dockerfile -t mta-backend .
#
# The context covers the whole monorepo so pnpm sees the same workspace the
# developer uses; the .dockerignore at the root keeps secrets and build
# output out of the layers (PLAN-004 G-001 policy kept: **/.env, **/*.key
# excluded at any depth).

# Stage 1: Dependencies
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY site/server/package.json ./site/server/
COPY site/shared/package.json ./site/shared/
COPY site/packages/eslint-config/package.json ./site/packages/eslint-config/
COPY site/packages/tsconfig/package.json ./site/packages/tsconfig/

RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/site/server/node_modules ./site/server/node_modules

COPY . .

RUN pnpm --filter @mta-market/server build

# Stage 3: Runner
FROM node:24-alpine AS runner
WORKDIR /app

RUN apk add --no-cache dumb-init

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/site/server/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/site/server/package.json ./
COPY --from=deps --chown=nodejs:nodejs /app/site/server/node_modules ./node_modules

# Compiled server imports Prisma runtime from dist/prisma
COPY --from=builder --chown=nodejs:nodejs /app/site/server/dist/prisma ./dist/prisma

# PLAN-004 L-002 (audit P0): pre-create the uploads mount point owned by the
# runtime user so a root-owned auto-created mount never breaks uploads.
RUN mkdir -p /app/uploads && chown -R nodejs:nodejs /app/uploads

USER nodejs

EXPOSE 3001

ENV NODE_ENV production
ENV PORT 3001

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "dist/index.js"]
