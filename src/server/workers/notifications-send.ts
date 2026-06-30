/**
 * notifications-send worker.
 *
 * Job shape: `{ sendId: string }`. Loads the `NotificationSend` row,
 * resolves the clinic's adapters, checks the per-patient rate limit,
 * renders the body (already rendered at materialise-time, but we keep
 * the raw body on the row — re-rendering is a no-op if no placeholders
 * remain), sends, and updates the row's status.
 *
 * Retry policy: up to 3 attempts. Backoff between retries indexes
 * BACKOFF_MS by the row's current retryCount (0-based) — first retry 60s,
 * second 300s, with 1800s as the ceiling. On final failure the row is
 * marked FAILED and left for the UI to retry via
 * POST /api/crm/notifications/sends/[id]/retry.
 *
 * ## Running
 *
 * In dev, workers are NOT started inside the Next.js request process
 * (doing so leaks timers between HMR reloads). Instead run them via
 * `tsx src/server/workers/start.ts`. See `start.ts` for details.
 *
 * When BullMQ lands (Phase 6), replace `getQueue().registerWorker(...)`
 * with `new Worker("notifications:send", handler, { connection })`. The
 * job payload and DB writes stay identical.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { resolveAdapters } from "@/server/notifications/adapters";
import { recordNotificationDelivery } from "@/server/notifications/record-delivery";
import { getRateLimiter } from "@/server/notifications/rate-limit";
import { enqueue, getQueue } from "@/server/queue";

export const QUEUE_NAME = "notifications:send";
export const JOB_NAME = "deliver";

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [60_000, 300_000, 1_800_000];

export type DeliverJob = { sendId: string };

/**
 * Telegram hard-fail errors that mean the patient can no longer receive the
 * bot's messages — they blocked it, deleted their account, or the chat is gone.
 * Used as a fallback block signal for patients whose `my_chat_member` update we
 * never saw (e.g. blocks predating Layer 2).
 */
function isTgBlockedError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("bot was blocked") ||
    m.includes("user is deactivated") ||
    m.includes("chat not found")
  );
}

/**
 * D-1 — atomically claim a QUEUED send for dispatch. The flip QUEUED→SENDING
 * happens in one conditional `updateMany`, so under concurrent workers (the
 * 5s dispatch loop re-enqueues every QUEUED+due row, and BullMQ will add real
 * parallelism in Phase 6) exactly one caller wins the row and performs the
 * external send. Losers get `count === 0` and bail without re-sending. The
 * transient-retry path resets the row to QUEUED so a later attempt re-claims
 * it; a row stranded in SENDING (worker crashed mid-send) is recoverable via
 * the /retry endpoint.
 */
async function claimForDispatch(sendId: string): Promise<boolean> {
  const claimed = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.updateMany({
      where: { id: sendId, status: "QUEUED" },
      data: { status: "SENDING" },
    }),
  );
  return claimed.count === 1;
}

async function deliver(job: DeliverJob): Promise<void> {
  const send = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.findUnique({
      where: { id: job.sendId },
      include: {
        patient: { select: { id: true, phone: true, telegramId: true } },
        template: { select: { key: true, trigger: true } },
      },
    }),
  );
  if (!send) return;
  if (send.status !== "QUEUED") return;

  // Stage 2.D — no-spam guard for the confirm cascade. If the patient
  // has already confirmed (any path: TG_BUTTON, MANUAL_CRM, INBOUND_CALL,
  // BOOKING_AUTO; SMS_REPLY is legacy/no longer emitted — SMS removed in
  // `docs/TZ-sms-removal.md`) by the time the worker fires, skip the
  // send entirely. Same gate the detector uses (`confirmedAt IS NULL`).
  //
  // D-3 — decide this by the template's `trigger` enum, NOT its `key` slug.
  // The slug is admin-editable and the seeded reminder keys
  // (`appointment.reminder-24h`, …) never matched the old hardcoded
  // `reminder.24h`/`reminder.2h` checks, so the guard + confirm button were
  // silently dead. Every APPOINTMENT_BEFORE reminder asks "are you coming?",
  // so once the patient confirms (or the appointment closes) we suppress the
  // rest of the cascade.
  const isBeforeReminder = send.template?.trigger === "APPOINTMENT_BEFORE";
  if (isBeforeReminder && send.appointmentId) {
    const appt = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.appointment.findUnique({
        where: { id: send.appointmentId! },
        select: { confirmedAt: true, status: true },
      }),
    );
    if (
      appt &&
      (appt.confirmedAt !== null ||
        appt.status === "CANCELLED" ||
        appt.status === "NO_SHOW" ||
        appt.status === "COMPLETED")
    ) {
      await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.notificationSend.updateMany({
          // Guard on QUEUED so we never clobber a row another worker has
          // already claimed (SENDING) or finalised.
          where: { id: send.id, status: "QUEUED" },
          data: {
            status: "CANCELLED",
            failedReason: "patient already confirmed (or appointment closed)",
          },
        }),
      );
      return;
    }
  }

  const adapters = await resolveAdapters(send.clinicId);

  // INAPP is a local DB write — no rate limit, no external cost. Skip the
  // limiter check and inline the "send" so the row flips straight to
  // DELIVERED. The Mini App polls these rows from the inbox endpoint.
  if (send.channel === "INAPP") {
    // D-1 — claim before the inbox write so a re-dispatched job can't insert
    // a duplicate banner.
    if (!(await claimForDispatch(send.id))) return;
    try {
      const res = await adapters.inapp.send(send.id, send.body);
      const now = new Date();
      await runWithTenant({ kind: "SYSTEM" }, () =>
        recordNotificationDelivery({
          send: {
            id: send.id,
            clinicId: send.clinicId,
            patientId: send.patientId ?? null,
            channel: "INAPP",
            templateKey: send.template?.key ?? null,
            campaignId: send.campaignId ?? null,
          },
          outcome: {
            kind: "delivered",
            externalId: res.inboxId,
            sentAt: now,
            deliveredAt: now,
          },
        }),
      );
    } catch (e) {
      // INAPP failure stays a silent bare update (no event) — same as the
      // pre-§7.8 behavior. INAPP is a local DB write so this branch is
      // effectively dead code; if it fires the operator sees the FAILED row.
      const message = e instanceof Error ? e.message : String(e);
      await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.notificationSend.update({
          where: { id: send.id },
          data: {
            status: "FAILED",
            failedReason: message.slice(0, 500),
            retryCount: { increment: 1 },
          },
        }),
      );
    }
    return;
  }

  const limiter = getRateLimiter();
  // Channel is widened in the DB row but the limiter only models TG today.
  // Legacy SMS rows fall through to the throw below — the limiter hit is a
  // harmless rounding error against the TG bucket.
  const ok = await limiter.check(send.patientId, "TG");
  if (!ok) {
    // Defer: push the job back by 60s. We don't count this against the
    // retry budget — rate limit is a policy decision, not a failure.
    await enqueue(QUEUE_NAME, JOB_NAME, { sendId: send.id }, { delay: 60_000 });
    return;
  }

  try {
    let externalId: string;
    if (send.channel === "TG") {
      const chatId = send.recipient;
      // Stage 2.D — attach a "✅ Подтверждаю" inline keyboard so the patient
      // can confirm in one tap. The callback_data shape is
      // `confirm:<appointmentId>` — the Stage 3.G webhook (not wired here)
      // routes it back through `confirmAppointment({ via: 'TG_BUTTON' })`.
      // D-3 — gate on the APPOINTMENT_BEFORE trigger (see no-spam guard
      // above), not the template slug. Once a patient confirms, the no-spam
      // guard cancels the remaining cascade so they aren't asked again.
      const wantsConfirmButton = isBeforeReminder && Boolean(send.appointmentId);
      const replyMarkup = wantsConfirmButton
        ? {
            inline_keyboard: [
              [
                {
                  text: "✅ Подтверждаю",
                  callback_data: `confirm:${send.appointmentId}`,
                },
              ],
            ],
          }
        : undefined;
      // D-1 — claim the row immediately before the irreversible network send.
      if (!(await claimForDispatch(send.id))) return;
      const res = await adapters.tg.send(
        chatId,
        send.body,
        replyMarkup ? { replyMarkup } : undefined,
      );
      externalId = String(res.messageId);
    } else {
      // Other channels cannot be dispatched: SMS is legacy (no adapter
      // since `docs/TZ-sms-removal.md` Wave 3); CALL/EMAIL/VISIT have no
      // adapters yet. Throwing surfaces the row as FAILED so the
      // operator routes the patient through TG / call instead.
      throw new Error(`Channel ${send.channel} not dispatchable`);
    }
    await runWithTenant({ kind: "SYSTEM" }, () =>
      recordNotificationDelivery({
        send: {
          id: send.id,
          clinicId: send.clinicId,
          patientId: send.patientId ?? null,
          channel: send.channel as "TG",
          templateKey: send.template?.key ?? null,
          campaignId: send.campaignId ?? null,
        },
        outcome: {
          kind: "sent",
          externalId,
          sentAt: new Date(),
        },
      }),
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);

    // Fallback block tracking — if Telegram says the bot is blocked, stamp the
    // patient so reachability counters and broadcast audience drop them even
    // when no `my_chat_member` update arrived. Best-effort; guarded so it only
    // writes once. Scoped by clinicId because SYSTEM ctx disables auto-scoping.
    if (send.channel === "TG" && send.patientId && isTgBlockedError(message)) {
      try {
        await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.patient.updateMany({
            where: { id: send.patientId!, clinicId: send.clinicId, tgBlockedAt: null },
            data: { tgBlockedAt: new Date() },
          }),
        );
      } catch {
        // Ignore — delivery bookkeeping below remains the source of truth.
      }
    }

    const nextAttempt = send.retryCount + 1;
    if (nextAttempt >= MAX_ATTEMPTS) {
      await runWithTenant({ kind: "SYSTEM" }, () =>
        recordNotificationDelivery({
          send: {
            id: send.id,
            clinicId: send.clinicId,
            patientId: send.patientId ?? null,
            channel: send.channel as "TG",
            templateKey: send.template?.key ?? null,
            campaignId: send.campaignId ?? null,
          },
          outcome: {
            kind: "failed",
            failedReason: message,
            retryCount: nextAttempt,
          },
        }),
      );
      return;
    }
    // D-2 — index by the row's current retryCount (0-based) so the first
    // retry waits 60s, not 300s. The old `nextAttempt` index skipped
    // BACKOFF_MS[0] entirely.
    const delay = BACKOFF_MS[Math.min(send.retryCount, BACKOFF_MS.length - 1)]!;
    await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.notificationSend.update({
        where: { id: send.id },
        data: {
          // D-1 — release the SENDING claim back to QUEUED so the scheduler +
          // retry endpoint re-pick it. The delayed re-enqueue below and the
          // dispatch loop may both fire; the next claim dedupes them.
          status: "QUEUED",
          failedReason: message.slice(0, 500),
          retryCount: nextAttempt,
        },
      }),
    );
    await enqueue(QUEUE_NAME, JOB_NAME, { sendId: send.id }, { delay });
  }
}

/** Start the worker; idempotent (safe to call multiple times). */
export function startNotificationsSendWorker(): void {
  getQueue().registerWorker<DeliverJob>(QUEUE_NAME, JOB_NAME, deliver);
  console.info("[worker] notifications-send registered");
}

// Named export for tests
export { deliver as _deliverForTests };
