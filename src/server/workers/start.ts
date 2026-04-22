/**
 * Entry point for running BullMQ-style notification workers outside of the
 * Next.js HTTP server.
 *
 * Usage:
 *   npx tsx src/server/workers/start.ts
 *
 * Why a separate process?
 *   - Next.js dev (Turbopack) hot-reloads modules; setInterval timers
 *     leak across reloads which causes duplicate scheduler ticks.
 *   - Production workers belong in their own container so we can scale
 *     them independently (Phase 6 infra).
 *
 * What it does:
 *   1. Starts the in-memory queue adapter (swap to BullMQ when REDIS_URL
 *      is set — TODO for infrastructure-engineer).
 *   2. Registers the `notifications-send` worker.
 *   3. Starts the `notifications-scheduler` every minute.
 *   4. Logs + keeps the process alive.
 */
import { startNotificationsSendWorker } from "./notifications-send";
import { startNotificationsSchedulerWorker } from "./notifications-scheduler";

async function main() {
  console.info("[workers] starting…");
  startNotificationsSendWorker();
  const scheduler = startNotificationsSchedulerWorker(60_000);

  const shutdown = (signal: NodeJS.Signals) => {
    console.info(`[workers] received ${signal} — shutting down`);
    scheduler.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.info("[workers] ready");
}

void main();
