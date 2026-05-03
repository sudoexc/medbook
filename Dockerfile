# syntax=docker/dockerfile:1.7
#
# MedBook / NeuroFax — Next.js 16 standalone image.
#
# Multi-stage:
#   1) builder  — full deps, `prisma generate`, `next build` → .next/standalone
#   2) runner   — minimal Node 20 slim, runs `node server.js` on port 3000
#
# Worker image reuses the builder output via a separate Dockerfile.worker.
#
# See node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md
# — `output: 'standalone'` is enabled in next.config.ts.

# ---------- Stage 1: builder ----------
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# System deps: openssl for Prisma, tini later. Keep the layer thin.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Install full deps (including dev) so `next build` + `tsx` work.
COPY package.json package-lock.json ./
RUN npm ci

# Copy the rest of the source tree. `.dockerignore` keeps node_modules / .next
# / .env out of the context.
COPY . .

# Prisma client → requires openssl. `npm run build` also runs
# `prisma generate` via package.json (`prisma generate && next build`).
# Force the build to skip DB reachability (prisma only needs schema).
ENV NEXT_TELEMETRY_DISABLED=1
ENV PRISMA_SKIP_POSTINSTALL_GENERATE=1
RUN npx prisma generate \
 && npm run build

# ---------- Stage 2: runner ----------
FROM node:20-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# openssl again for Prisma at runtime + curl for the HEALTHCHECK.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates curl tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 nodejs \
 && useradd  --system --uid 1001 --gid nodejs nextjs

# Copy the standalone output: a self-contained Node server bundle.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public          ./public

# Prisma schema + CLI are needed at runtime for `migrate deploy` on startup.
# Prisma 7's `prisma-client` provider emits to src/generated/prisma — Next.js
# standalone tracing carries that and @prisma/client along, so we don't COPY
# the generated client here. We *do* need the prisma CLI + its @prisma/* deps
# (engines, fetch-engine, etc.) for `npx prisma migrate deploy` to work.
COPY --from=builder --chown=nextjs:nodejs /app/prisma                    ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma      ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma       ./node_modules/prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.bin/prisma  ./node_modules/.bin/prisma
COPY --from=builder --chown=nextjs:nodejs /app/prisma.config.ts          ./prisma.config.ts

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
