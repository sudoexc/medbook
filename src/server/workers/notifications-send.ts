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
 * second 300s, with 1800s as the ceiling. The backoff moves `scheduledFor`,
 * so the 5s dispatch loop does not hand the row back early (audit TG-12).
 * On final failure the row is marked FAILED and left for the UI to retry via
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
import {
  MAX_DELIVERY_ATTEMPTS,
  deliveryAttemptKey,
  pinnedAnchor,
  reminderAnchorMs,
} from "@/server/notifications/delivery-state";
import { mirrorNotificationToConversation } from "@/server/conversations/notification-mirror";
import { getRateLimiter } from "@/server/notifications/rate-limit";
import { enqueue, getQueue } from "@/server/queue";
import { MANUAL_APPOINTMENT_REMINDER_KEY } from "@/server/notifications/default-templates";
import { patientTexts } from "@/server/notifications/patient-texts";
import { skipsWhenConfirmed } from "@/server/notifications/rules";
// A fallback block signal for patients whose `my_chat_member` update we never
// saw (e.g. blocks predating Layer 2).
import { isTgBlockedError } from "@/server/telegram/send-errors";

export const QUEUE_NAME = "notifications:send";
export const JOB_NAME = "deliver";

const MAX_ATTEMPTS = MAX_DELIVERY_ATTEMPTS;
/** Clock slack between the web and worker processes for the «not yet due» check. */
const FUTURE_SLACK_MS = 5_000;
const BACKOFF_MS = [60_000, 300_000, 1_800_000];
/** How far a rate-limited send is pushed back. Not a failed attempt. */
const RATE_LIMIT_DEFER_MS = 60_000;

export type DeliverJob = { sendId: string };

/**
 * Hand one delivery attempt to the queue. The dedupe key ties it to the
 * row's current `scheduledFor`, so the dispatch loop re-offering the same
 * attempt every 5 s, or a direct enqueue racing the loop, never stacks
 * duplicate jobs (audit TG-12). The job waits until `scheduledFor`.
 */
export async function enqueueDelivery(
  send: { id: string; scheduledFor: Date },
  now: Date = new Date(),
): Promise<void> {
  const delay = Math.max(0, send.scheduledFor.getTime() - now.getTime());
  await enqueue(
    QUEUE_NAME,
    JOB_NAME,
    { sendId: send.id },
    { delay, dedupeId: deliveryAttemptKey(send) },
  );
}

/**
 * Template keys whose message is only useful with a way into the Mini App
 * screen it talks about: the pre-visit questionnaire and the visit rating
 * have no entry on the Mini App home, so without this button the patient
 * reads «заполните анкету» and has nowhere to tap (audit TG-09). Labels are
 * `notifications.patientMessages.*` in the patient's language (INF-11).
 */
const MINI_APP_BUTTONS: Record<
  string,
  { path: string; label: "questionnaireButton" | "npsButton" }
> = {
  "appointment.pre-visit-questionnaire": {
    path: "pre-visit",
    label: "questionnaireButton",
  },
  "appointment.nps-request": {
    path: "nps",
    label: "npsButton",
  },
};

/**
 * The public https origin the Mini App is served from, or null. Telegram
 * opens `web_app` buttons over https only, so a plain-http dev origin gets
 * no button rather than a broken one.
 */
function publicOrigin(): string | null {
  const raw = (
    process.env.PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    ""
  )
    .trim()
    .replace(/\/+$/, "");
  return raw.startsWith("https://") ? raw : null;
}

/** The `web_app` button that opens the screen a message asks to use. */
export function miniAppButtonFor(send: {
  appointmentId: string | null;
  templateKey: string | null;
  clinicSlug: string | null;
  lang: "RU" | "UZ" | null;
}): { text: string; web_app: { url: string } } | null {
  const spec = send.templateKey ? MINI_APP_BUTTONS[send.templateKey] : undefined;
  if (!spec || !send.appointmentId || !send.clinicSlug) return null;
  const origin = publicOrigin();
  if (!origin) return null;
  return {
    text: patientTexts(send.lang)(spec.label),
    web_app: {
      url: `${origin}/c/${send.clinicSlug}/my/${spec.path}/${send.appointmentId}`,
    },
  };
}

/**
 * D-1 — atomically claim a QUEUED send for dispatch. The flip QUEUED→SENDING
 * happens in one conditional `updateMany`, so under concurrent workers (the
 * 5s dispatch loop re-enqueues every QUEUED+due row, and BullMQ will add real
 * parallelism in Phase 6) exactly one caller wins the row and performs the
 * external send. Losers get `count === 0` and bail without re-sending. The
 * transient-retry path resets the row to QUEUED so a later attempt re-claims
 * it; a row stranded in SENDING (worker crashed mid-send) is returned to
 * work by the scheduler's sweep once `claimedAt` is stale (audit TG-12), or
 * by staff via the /retry endpoint.
 */
async function claimForDispatch(sendId: string): Promise<boolean> {
  const claimed = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.updateMany({
      where: { id: sendId, status: "QUEUED" },
      data: { status: "SENDING", claimedAt: new Date() },
    }),
  );
  return claimed.count === 1;
}

/**
 * An appointment reminder («ждём вас …») is pointless once the visit is
 * closed, and wrong once the patient is already in the hall (WAITING) or in
 * the cabinet (IN_PROGRESS).
 */
function isPastReminderStage(status: string): boolean {
  return (
    status === "CANCELLED" ||
    status === "NO_SHOW" ||
    status === "COMPLETED" ||
    status === "WAITING" ||
    status === "IN_PROGRESS"
  );
}

/**
 * The language of whoever reads a Telegram row: the patient, or for a
 * reminder relayed to a family owner (audit P1D-01), the owner. A failed
 * lookup falls back to the patient's language.
 */
async function recipientLang(send: {
  clinicId: string;
  recipient: string;
  patient: { telegramId: string | null; preferredLang: "RU" | "UZ" } | null;
}): Promise<"RU" | "UZ" | null> {
  const own = send.patient?.preferredLang ?? null;
  if (!send.patient || send.patient.telegramId === send.recipient) return own;
  try {
    const reader = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.patient.findFirst({
        where: { clinicId: send.clinicId, telegramId: send.recipient },
        select: { preferredLang: true },
      }),
    );
    return reader?.preferredLang ?? own;
  } catch {
    return own;
  }
}

async function deliver(job: DeliverJob): Promise<void> {
  const send = await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.findUnique({
      where: { id: job.sendId },
      include: {
        patient: {
          select: { id: true, phone: true, telegramId: true, preferredLang: true },
        },
        // `triggerConfig.offsetMin` tells us which cascade band this row is,
        // which is what makes the stale-time guard below possible.
        template: { select: { key: true, trigger: true, triggerConfig: true } },
        // The slug builds the Mini App link of questionnaire / rating messages.
        clinic: { select: { slug: true } },
      },
    }),
  );
  if (!send) return;
  if (send.status !== "QUEUED") return;

  // Never before its time. The dispatch loop only hands over rows whose
  // `scheduledFor` has passed, but a direct enqueue does not: the manual
  // «Напомнить всем» button used to pick up the day's future cascade rows
  // and push them here, so «ждём вас через 3 часа» went out at 09:00 for a
  // 16:00 visit and the real 13:00 reminder was spent (audit AP-02). A
  // future row stays QUEUED untouched; the dispatch loop delivers it on time.
  if (send.scheduledFor.getTime() > Date.now() + FUTURE_SLACK_MS) return;

  // D-3 — decide reminder handling by the template's `trigger` enum, NOT its
  // `key` slug. The slug is admin-editable and the seeded reminder keys
  // (`appointment.reminder-24h`, …) never matched the old hardcoded
  // `reminder.24h`/`reminder.2h` checks, so the guards + confirm button were
  // silently dead.
  const isBeforeReminder = send.template?.trigger === "APPOINTMENT_BEFORE";
  // Whether the visit is already confirmed; read with the appointment below
  // and used again for the confirm button.
  let alreadyConfirmed = false;
  // The staff-sent reminder («Напомнить всем», AP-02) asks the same «are you
  // coming?», so it gets the confirm button and the closed-appointment
  // guard, but not the cascade's confirmed / drift checks: staff chose to
  // send it now, to this patient.
  const isManualReminder =
    send.template?.key === MANUAL_APPOINTMENT_REMINDER_KEY &&
    Boolean(send.appointmentId);
  if (isManualReminder) {
    const appt = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.appointment.findUnique({
        where: { id: send.appointmentId! },
        select: { status: true },
      }),
    );
    if (!appt || isPastReminderStage(appt.status)) {
      await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.notificationSend.updateMany({
          where: { id: send.id, status: "QUEUED" },
          data: {
            status: "CANCELLED",
            failedReason: "appointment closed or patient already arrived",
          },
        }),
      );
      return;
    }
  }
  if (isBeforeReminder && send.appointmentId) {
    const appt = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.appointment.findUnique({
        where: { id: send.appointmentId! },
        select: { confirmedAt: true, status: true, date: true },
      }),
    );
    if (appt && isPastReminderStage(appt.status)) {
      await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.notificationSend.updateMany({
          // Guard on QUEUED so we never clobber a row another worker has
          // already claimed (SENDING) or finalised.
          where: { id: send.id, status: "QUEUED" },
          data: {
            status: "CANCELLED",
            failedReason: "appointment closed or patient already arrived",
          },
        }),
      );
      return;
    }
    alreadyConfirmed = Boolean(appt && appt.confirmedAt !== null);
    // Stage 2.D no-spam guard, narrowed by audit TG-03: once the visit is
    // confirmed (any path: TG_BUTTON, MANUAL_CRM, INBOUND_CALL, BOOKING_AUTO
    // for every PHONE / KIOSK booking), only the reminder that ASKS to confirm
    // is pointless. «Завтра в 11:00 ждём вас» still goes out: dropping it left
    // phone bookings, the bulk of reception's work, with no reminder at all.
    if (alreadyConfirmed && skipsWhenConfirmed(send.template?.triggerConfig)) {
      await runWithTenant({ kind: "SYSTEM" }, () =>
        prisma.notificationSend.updateMany({
          where: { id: send.id, status: "QUEUED" },
          data: {
            status: "CANCELLED",
            failedReason: "patient already confirmed",
          },
        }),
      );
      return;
    }

    // Backstop against stale reminders. The cascade is materialised eagerly
    // with the wall-clock time rendered into `body`, so a row that outlived a
    // reschedule would tell the patient to come at an hour that no longer
    // exists. The reschedule path cancels these rows up front; this is the
    // safety net for anything that slips past it (a race with an in-flight
    // dispatch, a direct DB edit, a legacy row predating the fix).
    //
    // A row is valid only while the appointment still starts when the row
    // was written for. The row records that start (`appointmentAt`), so a
    // retry, a backoff or a staff «Повторить» that moved `scheduledFor` is
    // not mistaken for a reschedule (audit TG-08: every manual retry of a
    // reminder used to end CANCELLED here). Older rows derive it from
    // `scheduledFor - offsetMin`. Rows with neither are left alone: we can't
    // infer an expected time for them, and refusing to send would be worse
    // than sending.
    const offsetMin = (send.template?.triggerConfig as { offsetMin?: unknown } | null)
      ?.offsetMin;
    const anchorMs = reminderAnchorMs(send, offsetMin);
    if (appt && anchorMs !== null) {
      // One minute of slack: `scheduledFor` is stored to the millisecond but
      // the scheduler ticks on a 60s cadence, so exact equality would flag
      // healthy rows.
      const driftMs = Math.abs(appt.date.getTime() - anchorMs);
      if (driftMs > 60_000) {
        await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.notificationSend.updateMany({
            where: { id: send.id, status: "QUEUED" },
            data: {
              status: "CANCELLED",
              failedReason: "appointment time changed after reminder was queued",
            },
          }),
        );
        return;
      }
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
            failedAt: new Date(),
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
    // Defer: push the row back by 60s. We don't count this against the
    // retry budget — rate limit is a policy decision, not a failure. The
    // deferral moves `scheduledFor`: a delayed job alone was overtaken by
    // the 5s dispatch loop, which saw the row still due (audit TG-12).
    const deferred = new Date(Date.now() + RATE_LIMIT_DEFER_MS);
    const moved = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.notificationSend.updateMany({
        where: { id: send.id, status: "QUEUED" },
        data: { scheduledFor: deferred, ...pinnedAnchor(send) },
      }),
    );
    if (moved.count === 1) {
      await enqueueDelivery({ id: send.id, scheduledFor: deferred });
    }
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
      // D-3 — gate on the APPOINTMENT_BEFORE trigger, not the template slug.
      // A confirmed visit's reminders go out without it (audit TG-03): asking
      // again is noise. The staff-sent reminder keeps it, its text asks for
      // the tap.
      const wantsConfirmButton =
        Boolean(send.appointmentId) &&
        (isManualReminder || (isBeforeReminder && !alreadyConfirmed));
      // The button speaks the reader's language (audit INF-11): «✅
      // Подтверждаю» to a patient who reads Uzbek left the visit
      // unconfirmed. A relayed reminder is read by the family owner.
      const readerLang = wantsConfirmButton ? await recipientLang(send) : null;
      const miniAppButton = miniAppButtonFor({
        appointmentId: send.appointmentId,
        templateKey: send.template?.key ?? null,
        clinicSlug: send.clinic?.slug ?? null,
        lang: send.patient?.preferredLang ?? null,
      });
      const replyMarkup = wantsConfirmButton
        ? {
            inline_keyboard: [
              [
                {
                  text: patientTexts(readerLang)("confirmButton"),
                  callback_data: `confirm:${send.appointmentId}`,
                },
              ],
            ],
          }
        : miniAppButton
          ? { inline_keyboard: [[miniAppButton]] }
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
    const sentAt = new Date();
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
          sentAt,
        },
      }),
    );
    // Audit G6-08: the reminder or broadcast also appears in the patient's
    // dialog, so the operator sees what «Не смогу» answers. Best effort: the
    // patient already has the message, and a throw here would land in the
    // retry branch below and send it again.
    await mirrorNotificationToConversation({
      clinicId: send.clinicId,
      sendId: send.id,
      patientId: send.patientId ?? null,
      chatId: send.recipient,
      body: send.body,
      campaignId: send.campaignId ?? null,
      sentAt,
    }).catch(() => null);
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
    // The backoff moves `scheduledFor` (audit TG-12): the row used to go back
    // to QUEUED with its old, long-past time, so the 5s dispatch loop resent
    // it at once and a two-minute Telegram outage burnt all three attempts.
    const nextAt = new Date(Date.now() + delay);
    const released = await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.notificationSend.updateMany({
        // SENDING: our claim. QUEUED: the attempt failed before claiming
        // (a channel with no adapter); it still spends the attempt, or the
        // row would be offered back every 5 s forever.
        where: { id: send.id, status: { in: ["SENDING", "QUEUED"] } },
        data: {
          // D-1 — release the SENDING claim back to QUEUED so the scheduler +
          // retry endpoint re-pick it. The delayed job below and the dispatch
          // loop offer the same attempt under one dedupe key.
          status: "QUEUED",
          failedReason: message.slice(0, 500),
          retryCount: nextAttempt,
          scheduledFor: nextAt,
          claimedAt: null,
          ...pinnedAnchor(send),
        },
      }),
    );
    if (released.count === 1) {
      await enqueueDelivery({ id: send.id, scheduledFor: nextAt });
    }
  }
}

/** Start the worker; idempotent (safe to call multiple times). */
export function startNotificationsSendWorker(): void {
  getQueue().registerWorker<DeliverJob>(QUEUE_NAME, JOB_NAME, deliver);
  console.info("[worker] notifications-send registered");
}

// Named export for tests
export { deliver as _deliverForTests };
