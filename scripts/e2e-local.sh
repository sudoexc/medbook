#!/usr/bin/env bash
# One-command local e2e run: DB create → migrate → seed → playwright.
#
#   npm run test:e2e:local            # full suite
#   npm run test:e2e:local -- 04      # only specs matching "04"
#
# Requirements:
#   - Postgres reachable (defaults to the Homebrew instance on localhost:5432,
#     superuser = current macOS user). Override with E2E_DB_URL.
#   - `npm run dev` MUST be stopped: Next 16 refuses to start a second dev
#     server in the same project dir, and the Playwright webServer needs 3001.
#
# Env knobs:
#   E2E_DB_URL   full postgres url for the e2e database
#                (default postgresql://<whoami>@localhost:5432/neurofax_e2e)
#   E2E_PORT     app port (default 3001, see playwright.config.ts)
set -euo pipefail
cd "$(dirname "$0")/.."

E2E_DB_URL="${E2E_DB_URL:-postgresql://$(whoami)@localhost:5432/neurofax_e2e}"

# 1. Create the e2e database if it does not exist yet. Uses the `pg` package
#    (already a prod dependency) so we do not depend on psql being on PATH.
node - "$E2E_DB_URL" <<'EOF'
const { Client } = require("pg");
const url = new URL(process.argv[2]);
const dbName = url.pathname.replace(/^\//, "");
url.pathname = "/postgres";
(async () => {
  const client = new Client({ connectionString: url.toString() });
  try {
    await client.connect();
  } catch (e) {
    console.error(`[e2e-local] Postgres not reachable at ${url.host}: ${e.message}`);
    console.error("[e2e-local] Start it (e.g. `brew services start postgresql@16`) or set E2E_DB_URL.");
    process.exit(1);
  }
  const { rows } = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (rows.length === 0) {
    await client.query(`CREATE DATABASE "${dbName}"`);
    console.log(`[e2e-local] created database ${dbName}`);
  } else {
    console.log(`[e2e-local] database ${dbName} exists`);
  }
  await client.end();
})();
EOF

# 2. Refuse to run while another `next dev` is up in this project dir —
#    Next 16 holds a per-project dev-server lock and the webServer would die.
if pgrep -f "next dev" >/dev/null 2>&1; then
  echo "[e2e-local] a 'next dev' server is already running — stop it first" >&2
  echo "[e2e-local] (Next 16 allows only one dev server per project dir)" >&2
  exit 1
fi

# 3. Migrate + seed (both idempotent).
DATABASE_URL="$E2E_DB_URL" npx prisma migrate deploy
DATABASE_URL="$E2E_DB_URL" npm run e2e:seed

# 4. Build once and run the suite against `next start` (production server).
#    `next dev` as the webServer compiles routes lazily — cold-compile
#    latency makes API-heavy specs flake (10s+ first hits). The prebuilt
#    server is deterministic. Set E2E_DEV=1 to skip the build and use the
#    dev server anyway (faster inner loop, flakier).
if [ "${E2E_DEV:-0}" = "1" ]; then
  DATABASE_URL_TEST="$E2E_DB_URL" npx playwright test "$@"
else
  npm run build
  DATABASE_URL_TEST="$E2E_DB_URL" \
    E2E_START_COMMAND="next start --port ${E2E_PORT:-3001}" \
    npx playwright test "$@"
fi
