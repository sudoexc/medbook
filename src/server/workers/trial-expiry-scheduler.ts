/**
 * Phase 9e — trial-expiry scheduler, now the whole subscription clock
 * (audit G5-02).
 *
 * Cron-style poller modeled on `notifications-scheduler.ts`. Every minute it
 * scans the subscriptions that may be due and takes one step for each, the
 * rule being `nextAutoStep` in `server/platform/subscription-lifecycle.ts`:
 *
 *   TRIAL,    trialEndsAt passed          → PAST_DUE, grace for GRACE_DAYS
 *   ACTIVE,   currentPeriodEndsAt passed  → PAST_DUE, grace for GRACE_DAYS
 *   PAST_DUE, no grace date yet           → grace starts now
 *   PAST_DUE, graceEndsAt passed          → CANCELLED
 *
 * It used to flip TRIAL to PAST_DUE and stop: PAST_DUE kept every feature
 * forever and ACTIVE never ended. PAST_DUE is still a grace period with the
 * plan's features (hostile to strip them mid-day), but now one that ends.
 * An ACTIVE subscription with no `currentPeriodEndsAt` (the platform owner's
 * open-ended ACTIVE, NeuroFax's) is never touched.
 *
 * The first tick after a deploy acts on every existing row at once, and a
 * cancelled subscription means Basic limits for the API quota guard. So
 * `scripts/subscription-lifecycle-dryrun.ts` runs before this worker
 * starts: it prints what the ticks will do to each clinic and fails unless
 * NeuroFax really is that open-ended ACTIVE (review of 79422ba). The deploy
 * runs it between the migration and the start of the new app and worker
 * (ops/deploy.sh, docs/operations/DEPLOY.md) and stops when it fails.
 *
 * Should that check be skipped all the same, the platform owner's own clinic
 * (`isPlatformClinic`) is never stepped here: left PAST_DUE by the old
 * scheduler, it would otherwise get a grace period on the first tick and be
 * CANCELLED 14 days later, which locks reception out of patient create,
 * booking and walk-in (402 on Basic limits). The tick says so in the log,
 * once per worker start, so the owner can pin it with the dry run.
 *
 * Every step writes a SUBSCRIPTION_AUTO_TRANSITION audit row with the
 * subscription as it was (`previous`), which is what the platform owner sees
 * in /admin/audit and what «Восстановить» brings back after an automatic
 * cancel. The clinic's ADMIN sees the state in the payment banner and the
 * billing page.
 *
 * Tenant context: a system-level scan across all clinics under
 * `runWithTenant({ kind: "SYSTEM" }, …)`.
 *
 * Idempotency and races: each write is conditional on the status (and grace
 * date) it was planned from, so a second tick or a concurrent admin action
 * makes it a no-op instead of a double step.
 *
 * `selectExpiredTrials` / `nextStatusFor` stay as the pure helpers they
 * were, `nextStatusFor` now covering every state.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { getQueue } from "@/server/queue";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import {
  isPlatformClinic,
  nextAutoStep,
  snapshotOf,
  type SubscriptionState,
} from "@/server/platform/subscription-lifecycle";

export const QUEUE_NAME = "trial-expiry";
export const JOB_NAME = "scan";

/**
 * Minimum row shape needed by the pure helpers. Mirrors
 * `Prisma.Subscription` but kept structural so unit tests don't have to
 * import the generated client. The lifecycle dates are optional: a row
 * without them is treated as having none.
 */
export type SubscriptionRow = {
  id: string;
  clinicId: string;
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED";
  trialEndsAt: Date | null;
  planId?: string;
  currentPeriodEndsAt?: Date | null;
  graceEndsAt?: Date | null;
  cancelledAt?: Date | null;
  /** The clinic's slug, read so the platform owner's clinic is left alone. */
  clinic?: { slug: string } | null;
};

function stateOfRow(row: SubscriptionRow): SubscriptionState {
  return {
    status: row.status,
    planId: row.planId ?? "",
    trialEndsAt: row.trialEndsAt,
    currentPeriodEndsAt: row.currentPeriodEndsAt ?? null,
    graceEndsAt: row.graceEndsAt ?? null,
    cancelledAt: row.cancelledAt ?? null,
  };
}

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
 * Pure helper. The status a subscription should be in at `now`:
 *
 *   - TRIAL, trial over                  → "PAST_DUE"
 *   - ACTIVE, paid period over           → "PAST_DUE"
 *   - PAST_DUE, grace period over        → "CANCELLED"
 *   - otherwise (incl. open-ended trial / ACTIVE, PAST_DUE with no grace
 *     date yet, CANCELLED)               → unchanged
 */
export function nextStatusFor(
  sub: SubscriptionRow,
  now: Date,
): SubscriptionRow["status"] {
  return nextAutoStep(stateOfRow(sub), now)?.to ?? sub.status;
}

/**
 * Subscriptions of the platform owner's clinic already reported in this
 * worker's log, so a row the scheduler would move is named once per worker
 * start, not every minute.
 */
const platformRowsReported = new Set<string>();

async function tick(): Promise<void> {
  const now = new Date();

  // SYSTEM context bypasses the tenant-scope extension so we see every
  // clinic's subscription. The `Subscription` model is not branch-scoped
  // (it's keyed on `clinicId`), so no `branchId` plumbing is needed.
  const due = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.subscription.findMany({
      where: {
        OR: [
          { status: "TRIAL", trialEndsAt: { lt: now } },
          { status: "ACTIVE", currentPeriodEndsAt: { lt: now } },
          { status: "PAST_DUE", graceEndsAt: null },
          { status: "PAST_DUE", graceEndsAt: { lt: now } },
        ],
      },
      select: {
        id: true,
        clinicId: true,
        planId: true,
        status: true,
        trialEndsAt: true,
        currentPeriodEndsAt: true,
        graceEndsAt: true,
        cancelledAt: true,
        clinic: { select: { slug: true } },
      },
    }),
  )) as SubscriptionRow[];

  let stepped = 0;
  for (const row of due) {
    const before = stateOfRow(row);
    const step = nextAutoStep(before, now);
    if (!step) continue;
    if (isPlatformClinic(row.clinic?.slug)) {
      // Never stepped: only the owner changes this row (see the header).
      if (!platformRowsReported.has(row.id)) {
        platformRowsReported.add(row.id);
        console.warn(
          `[trial-expiry] sub=${row.id} clinic=${row.clinicId} is the platform owner's clinic ` +
            `(${row.clinic?.slug}), left ${row.status} instead of ${step.reason} -> ${step.to}. ` +
            `Pin it to an open-ended ACTIVE: scripts/subscription-lifecycle-dryrun.ts with APPLY=1.`,
        );
      }
      continue;
    }
    const written = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.subscription.updateMany({
        // Planned from this status and grace date; anything else since (a
        // payment, an admin action, another tick) wins.
        where: { id: row.id, status: row.status, graceEndsAt: before.graceEndsAt },
        data: step.data,
      }),
    );
    if (written.count === 0) continue;
    stepped += 1;
    try {
      await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.auditLog.create({
          data: {
            clinicId: row.clinicId,
            actorRole: null,
            actorLabel: "system:trial-expiry",
            action: AUDIT_ACTION.SUBSCRIPTION_AUTO_TRANSITION,
            entityType: "Subscription",
            entityId: row.id,
            meta: {
              from: row.status,
              to: step.to,
              reason: step.reason,
              previous: snapshotOf(before),
              graceEndsAt: step.data.graceEndsAt?.toISOString() ?? null,
            },
          },
        }),
      );
    } catch (e) {
      console.warn(`[trial-expiry] audit failed sub=${row.id}`, e);
    }
    console.info(
      `[trial-expiry] sub=${row.id} clinic=${row.clinicId} ${row.status} → ${step.to} (${step.reason})`,
    );
  }

  console.info(`[trial-expiry] tick ok stepped=${stepped}/${due.length}`);
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
