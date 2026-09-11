# Multi-stage build for production

# Stage 1: Dependencies
FROM node:24-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json ./apps/server/
COPY packages/eslint-config/package.json ./packages/eslint-config/
COPY packages/tsconfig/package.json ./packages/tsconfig/

# Install all dependencies needed for the TypeScript build
RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:24-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/server/node_modules ./apps/server/node_modules

# Copy source code
COPY . .

# Build
RUN pnpm --filter @mta-market/server build

# Stage 3: Runner
FROM node:24-alpine AS runner
WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

# Copy built application
COPY --from=builder --chown=nodejs:nodejs /app/apps/server/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/apps/server/package.json ./
COPY --from=deps --chown=nodejs:nodejs /app/apps/server/node_modules ./node_modules

# Compiled server imports Prisma runtime from dist/prisma
COPY --from=builder --chown=nodejs:nodejs /app/apps/server/dist/prisma ./dist/prisma

# PLAN-004 L-002 (audit P0): the uploads volume mounts at /app/uploads. When
# the mount point does not exist, Docker creates it root-owned and the
# non-root process (uid 1001) cannot write — every upload fails EACCES.
# Pre-create the directory owned by the runtime user (also prunes any
# root-owned files COPY . . may have baked in from a dev checkout).
RUN mkdir -p /app/uploads && chown -R nodejs:nodejs /app/uploads

USER nodejs

EXPOSE 3001

ENV NODE_ENV production
ENV PORT 3001

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "dist/index.js"]
