/**
 * notifications-send worker.
 *
 * Job shape: `{ sendId: string }`. Loads the `NotificationSend` row,
 * resolves the clinic's adapters, checks the per-patient rate limit,
 * renders the body (already rendered at materialise-time, but we keep
 * the raw body on the row — re-rendering is a no-op if no placeholders
 * remain), sends, and updates the row's status.
 *
 * Retry policy: 3 attempts with exponential backoff (60s, 300s, 1800s).
 * On final failure the row is marked FAILED and left for the UI to retry
 * via POST /api/crm/notifications/sends/[id]/retry.
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

async function deliver(job: DeliverJob): Promise<void> {
  const send = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.findUnique({
      where: { id: job.sendId },
      include: {
        patient: { select: { id: true, phone: true, telegramId: true } },
        template: { select: { key: true } },
      },
    }),
  );
  if (!send) return;
  if (send.status !== "QUEUED") return;

  // Stage 2.D — no-spam guard for the confirm cascade. If the patient
  // has already confirmed (any path: TG_BUTTON, MANUAL_CRM, INBOUND_CALL,
  // BOOKING_AUTO; SMS_REPLY is legacy/no longer emitted — SMS removed in
  // `docs/TZ-sms-removal.md`) by the time the worker fires, skip the
  // send entirely. Same gate the detector uses (`confirmedAt IS NULL`),
  // applied to the three reminder keys that still ask "are you coming?".
  const templateKey = send.template?.key ?? null;
  const isConfirmCascade =
    templateKey === "reminder.3d" ||
    templateKey === "reminder.24h" ||
    templateKey === "reminder.2h";
  if (isConfirmCascade && send.appointmentId) {
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
        prisma.notificationSend.update({
          where: { id: send.id },
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
      // Stage 2.D — attach a "✅ Подтверждаю" inline keyboard for the two
      // confirm-CTA reminders (T-1d, T-2h). The callback_data shape is
      // `confirm:<appointmentId>` — the Stage 3.G webhook (not wired here)
      // routes it back through `confirmAppointment({ via: 'TG_BUTTON' })`.
      // The T-3d "gentle ping" intentionally has no button.
      const wantsConfirmButton =
        send.appointmentId &&
        (templateKey === "reminder.24h" || templateKey === "reminder.2h");
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
    const delay = BACKOFF_MS[Math.min(nextAttempt, BACKOFF_MS.length - 1)];
    await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.notificationSend.update({
        where: { id: send.id },
        data: {
          failedReason: message.slice(0, 500),
          retryCount: nextAttempt,
          // keep status QUEUED so the scheduler + retry endpoint see it
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
