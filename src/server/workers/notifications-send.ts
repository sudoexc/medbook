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
import { getRateLimiter } from "@/server/notifications/rate-limit";
import { enqueue, getQueue } from "@/server/queue";
import { publishEventSafe } from "@/server/realtime/publish";

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
  // has already confirmed (any path: SMS_REPLY, TG_BUTTON, MANUAL_CRM,
  // INBOUND_CALL, BOOKING_AUTO) by the time the worker fires, skip the
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
        prisma.notificationSend.update({
          where: { id: send.id },
          data: {
            status: "DELIVERED",
            sentAt: now,
            deliveredAt: now,
            externalId: res.inboxId,
            retryCount: { increment: 1 },
          },
        }),
      );
      publishEventSafe(send.clinicId, {
        type: "notification.sent",
        payload: {
          sendId: send.id,
          channel: "INAPP" as unknown as "SMS" | "TG",
          patientId: send.patientId ?? null,
          templateKey: send.templateId ?? undefined,
        },
      });
    } catch (e) {
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
  const ok = await limiter.check(send.patientId, send.channel as "SMS" | "TG");
  if (!ok) {
    // Defer: push the job back by 60s. We don't count this against the
    // retry budget — rate limit is a policy decision, not a failure.
    await enqueue(QUEUE_NAME, JOB_NAME, { sendId: send.id }, { delay: 60_000 });
    return;
  }

  try {
    if (send.channel === "SMS") {
      const res = await adapters.sms.send(send.recipient, send.body);
      await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.notificationSend.update({
          where: { id: send.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            externalId: res.providerId,
            retryCount: { increment: 1 },
          },
        }),
      );
    } else if (send.channel === "TG") {
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
      await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.notificationSend.update({
          where: { id: send.id },
          data: {
            status: "SENT",
            sentAt: new Date(),
            externalId: String(res.messageId),
            retryCount: { increment: 1 },
          },
        }),
      );
    } else {
      // Other channels (CALL/EMAIL/VISIT) not supported by adapters yet.
      throw new Error(`Channel ${send.channel} not yet implemented`);
    }
    publishEventSafe(send.clinicId, {
      type: "notification.sent",
      payload: {
        sendId: send.id,
        channel: send.channel as "SMS" | "TG",
        patientId: send.patientId ?? null,
        templateKey: send.templateId ?? undefined,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const nextAttempt = send.retryCount + 1;
    if (nextAttempt >= MAX_ATTEMPTS) {
      await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.notificationSend.update({
          where: { id: send.id },
          data: {
            status: "FAILED",
            failedReason: message.slice(0, 500),
            retryCount: nextAttempt,
          },
        }),
      );
      publishEventSafe(send.clinicId, {
        type: "notification.failed",
        payload: {
          sendId: send.id,
          channel: send.channel as "SMS" | "TG",
          patientId: send.patientId ?? null,
          templateKey: send.templateId ?? undefined,
          failedReason: message.slice(0, 200),
        },
      });
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
