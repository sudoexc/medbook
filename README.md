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
- `npm run build` — production build (`prisma generate` + `.next/standalone` ready for Docker).
- `rm -rf .next/dev && node --max-old-space-size=8192 ./node_modules/typescript/bin/tsc --noEmit` —
  type-check. Обе части обязательны: устаревший `.next/dev` даёт ложные ошибки,
  а с дефолтной кучей `tsc` на этом проекте падает по OOM.
- `npx vitest run` (= `npm test`) — unit-тесты.
- `npm run lint` — eslint. Сейчас **красный** (~71 старая ошибка) — в CI идёт
  отдельным non-blocking шагом.
- `npm run i18n:check` — паритет ru/uz словарей next-intl.
- `npm run i18n:audit` — inline-строки в mini-app.
- `npm run test:e2e:local` — Playwright e2e одной командой: создаёт БД
  `neurofax_e2e` → миграции → сид → build → прогон против `next start`.
  Требует локальный Postgres и остановленный `npm run dev` —
  см. [`tests/e2e/README.md`](./tests/e2e/README.md).
- `npm run e2e:seed` — идемпотентный сид e2e-базы (`tests/e2e/seed.ts`).
- `npm run test:e2e` — только прогон Playwright (окружение готовишь сам).
- `npx tsx src/server/workers/start.ts` — run background workers locally.
- `npx tsx scripts/seed-demo-data.ts` — populate the `neurofax` clinic with a
  realistic demo load: ~150 patients, today's storyline of ~270 appointments
  (mix of completed / in-chair / waiting / no-show / cancelled), payments,
  documents (placeholder PDFs in `public/uploads/demo/`), conversations, calls,
  and leads. Idempotent — tagged via `demo:` markers, safe to re-run.

## Documentation

**[`docs/README.md`](./docs/README.md) is the entry point** — user manuals (doctor,
reception, clinic admin, patient), architecture, operations, API reference.

Note: `docs/TZ*.md` are **specifications** ("what we planned"), not descriptions of
current behaviour — parts were never built or were later reworked. For how the system
actually behaves today, read [`docs/architecture/`](./docs/architecture/).

## Deployment

Full guide: [`docs/operations/DEPLOY.md`](./docs/operations/DEPLOY.md).
Incidents, backups, demo data: [`docs/operations/RUNBOOK.md`](./docs/operations/RUNBOOK.md).

Deployment is **manual**, not CI-driven. Prod lives at `/opt/neurofax` on the Hetzner
VPS as a checkout of `origin/main`:

```bash
cd /opt/neurofax && git pull --ff-only && nohup bash _deploy.sh >/tmp/deploy.out 2>&1 &
# wait for /tmp/deploy.done (PIPELINE_OK) or /tmp/deploy.fail; log in /tmp/deploy.log
```

`_deploy.sh` runs: `docker compose build app worker` → `prisma migrate deploy` **via the
`worker` container** (the slim `app` image lacks the Prisma CLI's transitive deps) →
`up -d --no-deps --force-recreate app worker` → `nginx -s reload` (mandatory — nginx
otherwise holds the old container IP and serves 502).

⚠️ The VPS is **shared** with unrelated sites (rtxshop, orientatravel, …). Never touch
`nginx/conf.d/*.conf` or the compose bind mounts without smoke-testing the neighbours.

CI (`.github/workflows/ci.yml`) гоняет проверки на каждый push/PR в `main`
(typecheck, unit, i18n, build, secret-scan; lint и npm audit — non-blocking),
но **ничего не деплоит**. Бывший `deploy.yml` удалён: он целился в несуществующий
`/opt/medbook`, его секреты не были настроены, а автодеплой по зелёному CI
противоречит правилу проекта «деплой только по явной просьбе».

> Stale, kept only for history: `ops/deploy.sh` + `ops/crontab.example` (they
> target `/opt/medbook`) and `docs/runbook.md` — superseded by
> [`docs/operations/`](./docs/operations/).

## Architecture

- `src/app/[locale]/crm/*` — clinic CRM (tenanted).
- `src/app/admin/*` — SUPER_ADMIN platform console.
- `src/app/c/[slug]/my/*` — patient-facing Telegram Mini App.
- `src/app/api/*` — REST endpoints (CRM + miniapp + webhooks).
- `src/server/*` — server modules (queue, workers, notifications, realtime, storage, crypto, telegram, telephony).
- `prisma/schema.prisma` — data model (28 tenant tables, AES-GCM-encrypted secrets).

Phase log: [`docs/progress/LOG.md`](./docs/progress/LOG.md).
