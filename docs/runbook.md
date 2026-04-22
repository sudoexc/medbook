# MedBook / NeuroFax — Operations Runbook

Dejurnye procedures for the production VPS. Target audience: whoever is holding the pager.

## 1. Layout

```
/opt/medbook/              # git checkout + .env
├── docker-compose.yml
├── .env                   # real secrets (not in git)
├── ops/
│   ├── deploy.sh          # idempotent deploy entrypoint
│   ├── backup.sh          # nightly pg_dump → MinIO
│   ├── restore.sh         # interactive restore from MinIO
│   ├── certbot-init.sh    # first-run Let's Encrypt cert issuance
│   └── migrate-secrets.ts # one-shot: migrate base64 legacy → AES-GCM
└── nginx/                 # reverse-proxy config + ACME webroot
```

All services run under `docker compose`. No bare-metal Node / Postgres.

## 2. Routine

### Check system status

```bash
docker compose ps                                    # container health
curl -fsS https://neurofax.uz/api/health | jq        # public readiness
curl -fsS -H "cookie: $ADMIN_SESSION" \
  https://neurofax.uz/api/platform/health | jq       # detailed SUPER_ADMIN view
```

### Tail logs

```bash
docker compose logs -f --tail=200 app        # Next.js
docker compose logs -f --tail=200 worker     # BullMQ workers
docker compose logs -f --tail=200 nginx
docker compose logs -f --tail=200 postgres
```

### Restart a service (zero-data-loss)

```bash
docker compose restart app          # usually enough for a stuck process
docker compose restart worker       # if notifications fall behind
```

### Full restart

```bash
docker compose down && docker compose up -d
```

## 3. Deploy

### Automatic (CI/CD)

Pushing to `main` triggers GitHub Actions → `.github/workflows/ci.yml` → on green, `deploy.yml` SSHes into the VPS and runs `ops/deploy.sh`.

### Manual

```bash
cd /opt/medbook
./ops/deploy.sh              # git pull + build + up -d + migrate
```

`deploy.sh` waits on `/api/health` before running `prisma migrate deploy` — if migration fails the app keeps running on the old schema. Check logs and fix forward.

### Rollback

```bash
cd /opt/medbook
git log --oneline -n 20                      # pick a known-good SHA
git reset --hard <sha>
docker compose build app worker
docker compose up -d
# If a schema change is involved, restore from the nightly backup (§6).
```

## 4. Certificates

Initial issuance (once, after DNS is pointed):

```bash
cd /opt/medbook
./ops/certbot-init.sh
```

Renewal is automatic — the `certbot` sidecar runs `certbot renew` every 12h and nginx picks up new certs via `ssl_certificate` path-based reload. Force-renew:

```bash
docker compose run --rm --entrypoint "" certbot certbot renew --force-renewal
docker compose exec nginx nginx -s reload
```

## 5. Backups

Nightly `ops/backup.sh` (cron at 03:00 UTC — see `ops/crontab.example`) streams `pg_dump | gzip` into MinIO at `medbook-backups/backups/pg-medbook-<iso>.sql.gz`. Retention = 30 days.

### Verify a backup

```bash
docker compose exec postgres pg_dump -U medbook medbook | wc -c   # live DB size
mc ls backup/medbook-backups/backups/ | tail -5                   # list recent
```

### Restore

```bash
./ops/restore.sh pg-medbook-2026-04-22T03-00-00Z.sql.gz
```

Drops the current DB and restores from the named backup. Interactive confirmation required.

## 6. Common Incidents

### Disk full (postgres volume)

```bash
docker compose exec postgres df -h /var/lib/postgresql/data
docker compose exec postgres psql -U medbook -c "
  SELECT schemaname, relname, pg_size_pretty(pg_total_relation_size(relid))
  FROM pg_catalog.pg_statio_user_tables ORDER BY pg_total_relation_size(relid) DESC LIMIT 10;"
```

Quick wins:
- `VACUUM FULL audit_log;` (largest write table — Phase 1 audit middleware).
- Shrink `notification_send` retention to 90d via a scheduled job.

### Redis OOM

Default `maxmemory 256mb + allkeys-lru` in `docker-compose.yml`. If BullMQ queues are spiking:

```bash
docker compose exec redis redis-cli INFO memory
docker compose exec redis redis-cli --scan --pattern 'bull:*' | head
```

Bump `--maxmemory 512mb` in compose and `docker compose up -d redis`.

### Certbot renewal failure

```bash
docker compose logs certbot | tail -100
```

Common causes:
- DNS changed — ensure A record still points at the VPS.
- Rate limit — `LE_STAGING=1 ./ops/certbot-init.sh` to test with staging.
- Port 80 blocked — verify with `curl -v http://neurofax.uz/.well-known/acme-challenge/test`.

### Telegram webhook dropped

```bash
curl "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
```

Re-set from SUPER_ADMIN → Clinic → Integrations → "Set webhook". Endpoint: `POST /api/crm/integrations/tg/set-webhook`. Tg will respond within seconds.

### Workers stuck

```bash
docker compose logs --tail=200 worker
docker compose restart worker
```

If the in-memory queue was in use (REDIS_URL unset), restarting drops queued jobs. Switch to BullMQ + Redis by setting `REDIS_URL` in `.env`.

### App returns 503 from /api/health

The DB probe failed. Check `docker compose ps postgres` and `docker compose logs postgres`.

## 7. Secrets

All clinic-level secrets (`ProviderConnection.secretCipher`) are AES-256-GCM encrypted with `APP_SECRET`. Rotating `APP_SECRET` will brick all stored secrets — re-entry via the SUPER_ADMIN UI is required for each clinic.

If a legacy clinic still has Phase-4 base64 secrets after upgrade:

```bash
docker compose exec app npx tsx ops/migrate-secrets.ts            # dry-run
docker compose exec app npx tsx ops/migrate-secrets.ts --apply    # migrate
```

## 8. Monitoring

UptimeRobot hits `GET /api/health` every 5 min. Expected:
- 200 + `status=ok` — green.
- 200 + `status=degraded` — Redis/MinIO not configured or slow; investigate.
- 503 + `status=down` — DB unreachable. Page immediately.

Sentry (if `SENTRY_DSN` is set) groups errors by `clinicId` + `userId` — pivot dashboards on those tags.

## 9. Access

- SSH: provisioned via GitHub Actions deploy key (`secrets.SSH_KEY`).
- Postgres: only via `docker compose exec postgres psql -U medbook`.
- MinIO console: http://<vps>:9001 — SSH tunnel recommended, not published.
- SUPER_ADMIN UI: `/admin` — role gated in `src/app/admin/layout.tsx`.
