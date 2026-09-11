# Multi-stage build for the MTA Market web app (site/web).
# Build from the REPOSITORY ROOT (build context = repo root):
#   docker build -f infrastructure/docker/site/web.Dockerfile -t mta-frontend .

# Stage 1: Dependencies
FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY site/web/package.json ./site/web/
COPY site/shared/package.json ./site/shared/
COPY site/packages/eslint-config/package.json ./site/packages/eslint-config/
COPY site/packages/tsconfig/package.json ./site/packages/tsconfig/

RUN pnpm install --frozen-lockfile

# Stage 2: Builder
FROM node:22-alpine AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.15.0 --activate

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/site/web/node_modules ./site/web/node_modules

COPY . .

ENV NEXT_TELEMETRY_DISABLED 1
ENV NEXT_OUTPUT_STANDALONE true

RUN pnpm --filter @mta-market/web build

# Stage 3: Runner
FROM node:22-alpine AS runner
WORKDIR /app

RUN apk add --no-cache dumb-init

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/site/web/public ./site/web/public
COPY --from=builder --chown=nextjs:nodejs /app/site/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/site/web/.next/static ./site/web/.next/static

USER nextjs

EXPOSE 3000

ENV NODE_ENV production
ENV PORT 3000
ENV HOSTNAME "0.0.0.0"

ENTRYPOINT ["dumb-init", "--"]

CMD ["node", "site/web/server.js"]
