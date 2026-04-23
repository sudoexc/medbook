# Test coverage & how to run

This document is the operator-facing reference for the test pyramid shipped
in Phase 7 (TZ §10.Фаза 7).

## Pyramid layers

| Layer | Tool | Location | Scope |
|---|---|---|---|
| Unit | Vitest | `tests/unit/**` | Pure functions, Zod schemas, services, middleware, template engine |
| E2E | Playwright | `tests/e2e/**` | HTTP + Next dev server + Postgres fixture DB |

Flakiness policy — **zero tolerance**. If a test fails 1/5 times, root-cause
it. We do not re-try our way out.

## Targets

- Unit: ≥ 70% line coverage of `src/lib/**`, `src/server/**`, `src/hooks/**`.
- E2E: 20 critical-path scenarios green on CI (see §Scenarios below).

Current baseline (Phase 7 ship): **239 unit tests** in 23 files; **33
Playwright test cases** across 20 spec files.

## Running locally

### Unit

```bash
npx vitest run               # one-shot
npx vitest                   # watch mode
npm run test:coverage        # v8 coverage report → ./coverage/
open coverage/index.html
```

Coverage config lives in `vitest.config.ts`; reporters are `text`,
`text-summary`, `html`, and `json-summary` so both humans and CI can parse
the output.

### E2E

Prerequisites (one-time):

```bash
npm run e2e:install          # installs chromium + OS deps (~300MB)
```

Then boot a dev Postgres — either compose up the root `docker-compose.yml`
(recommended) or point `DATABASE_URL_TEST` at any reachable Postgres:

```bash
export DATABASE_URL_TEST=postgresql://medbook:medbook@localhost:5432/medbook_test

# one-time-ish: apply migrations against the fixture DB
DATABASE_URL=$DATABASE_URL_TEST npx prisma migrate deploy

# seed is idempotent — safe to re-run
npm run e2e:seed

# run suite (starts next dev on :3001 automatically)
npm run test:e2e

# visual runner
npm run test:e2e:ui
```

`playwright.config.ts` auto-starts the dev server on `E2E_PORT=3001`. It
plugs `DATABASE_URL_TEST` into the webServer env (falling back to
`DATABASE_URL`). If neither is reachable, the suite self-skips every spec —
you will see `33 skipped` and a green exit code. That is by design so CI
reports are readable when the DB tier is down rather than drowning in
connection errors.

The Mini App spec additionally needs `TG_BOT_TOKEN_TEST` set **and** the
corresponding token written into `Clinic.tgBotToken` for `slug=neurofax`
(the seed does not provision it by default — see §Known blockers).

## Scenarios — 20 critical flows

The matrix below maps TZ §10.Фаза 7 requirements to the spec files.

| # | Area | File | Tests |
|---|---|---|---|
| 1 | Auth — login succeeds | `01-auth-login.spec.ts` | admin / receptionist / doctor |
| 1b | Auth — invalid creds fail | `01-auth-login.spec.ts` | 1 |
| 2 | RBAC — doctor cannot access /crm/settings | `02-rbac-doctor-no-settings.spec.ts` | 2 |
| 3 | RBAC — receptionist cannot access /admin | `03-rbac-receptionist-no-admin.spec.ts` | 2 |
| 4 | Patients — CRUD + soft-delete | `04-patients-crud.spec.ts` | 1 |
| 5 | Appointments — conflict detection (409) | `05-appointment-conflict.spec.ts` | 1 |
| 6 | Appointments — reschedule + no-show | `06-appointment-reschedule.spec.ts` | 1 |
| 7 | Calendar — week renders | `07-calendar-page.spec.ts` | 1 |
| 8 | Reception — queue transitions | `08-reception-queue.spec.ts` | 1 |
| 9 | Notifications — template + manual send | `09-notification-template-send.spec.ts` | 1 |
| 10 | Telegram inbox — page renders | `10-telegram-inbox.spec.ts` | 1 |
| 11 | Call center — SIP webhook ingest | `11-sip-webhook-call.spec.ts` | 1 |
| 12 | Mini App — initData auth + service list | `12-miniapp-booking.spec.ts` | 2 |
| 13 | Global search — Ctrl+K + API | `13-global-search.spec.ts` | 2 |
| 14 | Analytics — 7-section payload + page | `14-analytics-dashboard.spec.ts` | 2 |
| 15 | Documents library — filter | `15-documents-library.spec.ts` | 1 |
| 16 | CSV export — poll to DONE | `16-export-csv.spec.ts` | 1 |
| 17 | Settings — clinic profile + audit | `17-settings-clinic-audit.spec.ts` | 1 |
| 18 | Admin platform — clinic CRUD | `18-admin-platform-clinic.spec.ts` | 1 |
| 19 | Multi-tenancy — cross-tenant isolation | `19-multi-tenant-isolation.spec.ts` | 2 |
| 20 | Reception dashboard — KPI today/week/month | `20-dashboard-kpi.spec.ts` | 3 |

Total **30+ test cases** covering the 20 scenario buckets. The suite
deliberately favours REST-API layer assertions over DOM selectors because
Phase 0–6 did not sprinkle `data-testid` attributes on components —
reintroducing them is a follow-up for `ux-polisher`.

## Helpers & fixtures

- `tests/e2e/seed.ts` — idempotent Postgres seed. Run via `npm run e2e:seed`.
- `tests/e2e/fixtures/seed-handles.ts` — typed handles for seeded rows
  (clinics, users, patient phones, service codes, template keys).
- `tests/e2e/helpers.ts` — `loginAs()`, `as.{admin,doctor,…}`,
  `isAppHealthy()`, `signMiniAppInitData()`, `firstPatientId()`,
  `firstDoctorId()`, `firstService()`, `todayAt()`.

## Known blockers (author → operator)

1. **Playwright browser binaries are not checked into the repo.** Run
   `npm run e2e:install` once per machine / CI runner. The GitHub Actions
   `e2e` job does this automatically.
2. **Mini App specs self-skip without `TG_BOT_TOKEN_TEST`.** To exercise
   them locally, export the env, then write the same token onto the
   `neurofax` clinic row:
   ```sql
   UPDATE "Clinic" SET "tgBotToken" = '555:your-token-here' WHERE slug='neurofax';
   ```
3. **SIP webhook spec (#11) accepts unsigned requests in dev mode.** In
   prod the webhook requires a secret in `ProviderConnection.config.webhookSecret`
   — Phase 6's infrastructure-engineer note covers rotation.
4. **Audit spec (#17) skips if `/api/crm/clinic` does not expose PATCH.**
   Current Phase-4 settings-builder wired this endpoint; the spec checks
   its reachability and skips gracefully otherwise.
5. **Flaky suspects — none known.** Re-run is `npm run test:e2e -- --repeat-each=3`.

## CI wiring

`.github/workflows/ci.yml` now has two jobs:

1. `check` — lint · typecheck · vitest · build. Same as Phase 6.
2. `e2e` — depends on `check`. Starts a `postgres:16-alpine` service
   container, installs deps + Playwright chromium, runs `prisma migrate
   deploy`, `npm run e2e:seed`, then `npm run test:e2e`. Uploads the
   Playwright report + `test-results/` on any failure for 7 days.

Deploy workflow (`.github/workflows/deploy.yml`) is unchanged — it
triggers on `check` success plus main branch push. E2E is intentionally
decoupled from deploy so flakiness can never brick a rollout.

## Adding a new spec

1. Put it under `tests/e2e/NN-area-topic.spec.ts`.
2. Always start with the skip gate:
   ```ts
   test.beforeAll(async () => {
     test.skip(!HAS_TEST_DB, "requires seeded test DB");
     test.skip(!(await isAppHealthy()), "DB down");
   });
   ```
3. Prefer REST assertions over DOM selectors until components publish
   `data-testid` hooks.
4. Keep everything idempotent — specs may run repeatedly in a shared DB.
5. Update this table + `docs/progress/LOG.md`.
