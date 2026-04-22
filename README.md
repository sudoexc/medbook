# MedBook / NeuroFax

Multi-tenant clinic CRM — Next.js 16, Prisma 7, Postgres 16, Redis 7, MinIO.

## Quickstart (Docker)

```bash
# 1. Copy env template and fill in real secrets.
cp .env.example .env
$EDITOR .env      # set AUTH_SECRET, APP_SECRET, POSTGRES_PASSWORD, MINIO_*

# 2. Bring everything up.
docker compose up -d --build

# 3. Apply schema + seed.
docker compose exec app npx prisma migrate deploy
docker compose exec app npx prisma db seed   # optional, if a seed is defined

# 4. Open the app.
open http://localhost:3000
```

Health check: `curl http://localhost:3000/api/health`.

## Local dev (host Node)

```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev          # http://localhost:3000
```

The in-memory queue, SSE fallback, and `/tmp` upload stub kick in automatically when `REDIS_URL` / `MINIO_ENDPOINT` are unset.

## Scripts

- `npm run dev` — Next dev server (Turbopack).
- `npm run build` — production build (`.next/standalone` ready for Docker).
- `npm run lint` — eslint.
- `npx tsc --noEmit` — type-check.
- `npx vitest run` — unit tests.
- `npx tsx src/server/workers/start.ts` — run background workers locally.

## Deployment

See [`docs/runbook.md`](./docs/runbook.md) for the full operations guide
(deploy, rollback, backup/restore, incident response).

CI/CD: `.github/workflows/{ci,deploy}.yml`. Push to `main` → CI → SSH deploy via `ops/deploy.sh`.

## Architecture

- `src/app/[locale]/crm/*` — clinic CRM (tenanted).
- `src/app/admin/*` — SUPER_ADMIN platform console.
- `src/app/c/[slug]/my/*` — patient-facing Telegram Mini App.
- `src/app/api/*` — REST endpoints (CRM + miniapp + webhooks).
- `src/server/*` — server modules (queue, workers, notifications, realtime, storage, crypto, telegram, telephony).
- `prisma/schema.prisma` — data model (28 tenant tables, AES-GCM-encrypted secrets).

Phase log: [`docs/progress/LOG.md`](./docs/progress/LOG.md).
