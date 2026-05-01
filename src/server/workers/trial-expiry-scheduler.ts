/**
 * Phase 9e — trial-expiry scheduler.
 *
 * Cron-style poller modeled on `notifications-scheduler.ts`. Every minute it
 * scans every clinic's `Subscription` row, picks the ones whose TRIAL has
 * elapsed (`trialEndsAt < now()`), and flips them to `PAST_DUE`.
 *
 * Why `PAST_DUE` and not `CANCELLED`?
 *
 *   `getFeatureFlags` (see `src/lib/feature-flags.ts`, Phase 9b) treats
 *   `PAST_DUE` as a Stripe-style grace period and keeps the clinic's premium
 *   feature flags ON. Flipping to `CANCELLED` would immediately strip access
 *   to Telegram inbox / Call Center / Analytics-Pro mid-flight, which is
 *   hostile UX during the billing-overdue window. The countdown banner
 *   (`<TrialBanner />`) and the admin billing UI (Phase 9c) surface the
 *   warning so the operator can pay before grace period ends.
 *
 * Tenant context: this is a system-level scan across all clinics. We use the
 * same pattern as `notifications-scheduler.ts` — wrap the Prisma calls in
 * `runWithTenant({ kind: "SYSTEM" }, …)` so the tenant-scope extension
 * doesn't try to filter by `clinicId`.
 *
 * Idempotency: re-running the tick is safe. `selectExpiredTrials` only picks
 * rows still in `TRIAL`, so once flipped to `PAST_DUE` they're skipped.
 *
 * The pure helpers (`selectExpiredTrials`, `nextStatusFor`) are exported for
 * unit testing — the scheduler imports them too, so the production tick path
 * and the test path stay byte-identical.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getQueue } from "@/server/queue";

export const QUEUE_NAME = "trial-expiry";
export const JOB_NAME = "scan";

/**
 * Minimum row shape needed by the pure helpers. Mirrors
 * `Prisma.Subscription` but kept structural so unit tests don't have to
 * import the generated client.
 */
export type SubscriptionRow = {
  id: string;
  clinicId: string;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  trialEndsAt: Date | null;
};

/**
 * Pure helper. Given a list of subscriptions and a notion of "now", return
 * those that are TRIAL and whose `trialEndsAt` is strictly earlier than now.
 *
 *   - `null` `trialEndsAt` is never expired (open-ended trial — operator
 *     forgot to set it; treat as still active).
 *   - Exactly-on-boundary (trialEndsAt == now) is NOT expired yet — we use
 *     strict `<` to match Prisma's `lt` operator semantics.
 *   - Already PAST_DUE / ACTIVE / CANCELLED are skipped (no double-flip).
 */
export function selectExpiredTrials<T extends SubscriptionRow>(
  rows: ReadonlyArray<T>,
  now: Date,
): T[] {
  const cutoff = now.getTime();
  const out: T[] = [];
  for (const row of rows) {
    if (row.status !== "TRIAL") continue;
    if (!row.trialEndsAt) continue;
    if (row.trialEndsAt.getTime() < cutoff) {
      out.push(row);
    }
  }
  return out;
}

/**
 * Pure helper. Given a subscription row and "now", return the status it
 * should be in:
 *
 *   - TRIAL & expired                → "PAST_DUE" (grace period begins)
 *   - TRIAL & not yet expired        → "TRIAL"
 *   - PAST_DUE / ACTIVE / CANCELLED  → unchanged (idempotent — never
 *                                      double-flip, never resurrect)
 *
 * The function is a no-op for non-TRIAL rows; callers can invoke it on any
 * row without filtering first.
 */
export function nextStatusFor(
  sub: SubscriptionRow,
  now: Date,
): SubscriptionRow["status"] {
  if (sub.status !== "TRIAL") return sub.status;
  if (!sub.trialEndsAt) return "TRIAL";
  if (sub.trialEndsAt.getTime() < now.getTime()) return "PAST_DUE";
  return "TRIAL";
}

async function tick(): Promise<void> {
  const now = new Date();

  // SYSTEM context bypasses the tenant-scope extension so we see every
  // clinic's subscription. The `Subscription` model is not branch-scoped
  // (it's keyed on `clinicId`), so no `branchId` plumbing is needed.
  const expired = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.subscription.findMany({
      where: { status: "TRIAL", trialEndsAt: { lt: now } },
      select: {
        id: true,
        clinicId: true,
        status: true,
        trialEndsAt: true,
      },
    }),
  )) as SubscriptionRow[];

  if (expired.length === 0) {
    console.info(`[trial-expiry] tick ok flipped=0`);
    return;
  }

  let flipped = 0;
  for (const row of expired) {
    // Defense in depth: nextStatusFor is the source of truth for the
    // transition. The DB `where` already filtered to expired-TRIAL rows,
    // but nothing prevents another tick racing in between.
    const next = nextStatusFor(row, now);
    if (next === row.status) continue;
    await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.subscription.update({
        where: { id: row.id },
        data: { status: next },
      }),
    );
    flipped += 1;
    console.info(
      `[trial-expiry] flipped sub=${row.id} clinic=${row.clinicId} ${row.status} → ${next}`,
    );
  }

  console.info(`[trial-expiry] tick ok flipped=${flipped}/${expired.length}`);
}

/**
 * Register the scheduler with the in-memory queue adapter and kick off the
 * repeating timer. Returns a `{ stop }` handle — the worker entrypoint
 * (`start.ts`) wires this into the SIGINT/SIGTERM shutdown sequence.
 */
export function startTrialExpirySchedulerWorker(
  intervalMs = 60_000,
): { stop: () => void } {
  const q = getQueue();
  q.registerWorker(QUEUE_NAME, JOB_NAME, tick);
  const handle = q.repeat(QUEUE_NAME, JOB_NAME, {}, intervalMs);
  console.info(
    `[worker] trial-expiry-scheduler registered every ${intervalMs}ms`,
  );
  return handle;
}

export { tick as _tickForTests };
