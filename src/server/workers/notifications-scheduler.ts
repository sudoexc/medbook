/**
 * notifications-scheduler — cron-style poller.
 *
 * Every minute:
 *   1. Run trigger materialisation (birthday, 5d/3d/1d/3h reminders,
 *      payment.due) via the legacy `runScheduledTriggers()` pass — this
 *      honors the seeded offsetMin values (-7200, -4320, -1440, -180) and is
 *      idempotent (TZ-risk-outcomes §7 cascade). Only the band that asks to
 *      confirm (T-3d, `skipsWhenConfirmed`) is gated on `confirmedAt IS
 *      NULL`, so PHONE/KIOSK/WALKIN auto-confirms skip that ping and still
 *      get the 5d / 1d / 3h reminders (audit TG-03).
 *   2. Run a *dynamic* pass for any APPOINTMENT_BEFORE templates whose
 *      `triggerConfig.offsetMin` was customised by the admin in
 *      /crm/settings/notifications. The dynamic pass uses the same
 *      idempotency key (appointmentId, templateId) as the legacy pass, so
 *      it never double-schedules.
 *   3. Pick QUEUED NotificationSend rows whose `scheduledFor <= now()` and
 *      enqueue them on `notifications:send`.
 *
 * The scheduler does NOT send anything itself — it's a dispatcher. The
 * actual delivery + retry lives in `notifications-send.ts`.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { recordPatientNoChannel } from "@/server/notifications/no-channel-action";
import {
  isTriggerEnabled,
  resolveChannels,
  resolveOffsetMin,
  skipsWhenConfirmed,
} from "@/server/notifications/rules";
import {
  APPOINTMENT_REFS_INCLUDE,
  renderAppointmentBody,
  runScheduledTriggers,
  type AppointmentWithRefs,
} from "@/server/notifications/triggers";
import { enqueue, getQueue } from "@/server/queue";

import {
  JOB_NAME as SEND_JOB,
  QUEUE_NAME as SEND_QUEUE,
} from "./notifications-send";

export const QUEUE_NAME = "notifications:scheduler";
export const JOB_NAME = "tick";
// Lightweight dispatch loop — same queue, distinct job key. Runs far more
// often than the 60s materialisation tick so "send now" sends (broadcasts,
// just-due reminders) leave within seconds instead of waiting up to a minute.
export const DISPATCH_JOB = "dispatch";

export type TickResult = {
  triggered: Awaited<ReturnType<typeof runScheduledTriggers>>;
  dispatched: number;
};

/** Canonical cascade offsets, owned by `runScheduledTriggers`. */
const CANONICAL_OFFSETS = new Set([-7200, -4320, -1440, -180]);

/** The editor's widest offset (rules.ts `sanitizeTriggerConfig`): 7 days. */
const MAX_OFFSET_MIN = 7 * 24 * 60;

/**
 * A row whose fire moment passed more than this long ago is not built: a
 * «before» reminder that drifted would go out at once, which is unwanted.
 */
const LATE_GRACE_MS = 5 * 60 * 1000;

/**
 * Dynamic-rules pass: schedule reminders for templates whose
 * `triggerConfig.offsetMin` was customised by an admin (i.e. not the seeded
 * -7200/-4320/-1440/-180 cascade). The legacy pass owns those canonical
 * values via Prisma JSON-path WHERE clauses.
 *
 * Audit TG-02: this pass used to render with only the patient's name and the
 * date (time, doctor, service and clinic came out blank, always in Russian),
 * looked only 72 hours ahead while the editor allows 7 days (so «за 4 дня»
 * never fired), and raised a PATIENT_NO_CHANNEL call task on every tick,
 * days before the reminder was due. It now renders exactly like the cascade
 * (`renderAppointmentBody`: full appointment context, the patient's
 * language), looks as far ahead as the widest active offset, and raises the
 * call task only once the reminder's moment has come.
 */
export async function runDynamicReminders(
  now: Date = new Date(),
): Promise<{ created: number; skipped: number }> {
  // Fetch every active APPOINTMENT_BEFORE template across all clinics. The
  // tenant-scope extension is bypassed by SYSTEM context — we filter by
  // clinicId per appointment downstream.
  type TplRow = {
    id: string;
    clinicId: string;
    channel: "TG" | "EMAIL" | "CALL" | "VISIT";
    bodyRu: string;
    bodyUz: string;
    triggerConfig: unknown;
  };
  const templates = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationTemplate.findMany({
      where: {
        trigger: "APPOINTMENT_BEFORE",
        isActive: true,
      },
      select: {
        id: true,
        clinicId: true,
        channel: true,
        bodyRu: true,
        bodyUz: true,
        triggerConfig: true,
      },
    }),
  )) as TplRow[];

  const dynamicTemplates: TplRow[] = templates.filter((t: TplRow) => {
    if (!isTriggerEnabled(true, t.triggerConfig)) return false;
    const cfg =
      t.triggerConfig && typeof t.triggerConfig === "object"
        ? (t.triggerConfig as { offsetMin?: number })
        : {};
    const off = typeof cfg.offsetMin === "number" ? cfg.offsetMin : null;
    // Canonical cascade values are owned by `runScheduledTriggers` —
    // 5d/3d/1d/3h per TZ-risk-outcomes §7 (the -4320 band stays gated on
    // confirmedAt there). Ex-canon offsets (-300, -120, -60) now flow
    // through this dynamic pass like any admin-customised value.
    return off !== null && !CANONICAL_OFFSETS.has(off);
  });

  if (dynamicTemplates.length === 0) {
    return { created: 0, skipped: 0 };
  }

  // Look as far ahead as the widest active offset (plus an hour of slack for
  // a late tick), capped at the editor's maximum. A fixed 72h horizon made
  // every offset beyond three days «already past» by the time its
  // appointment was first seen.
  const widestLeadMin = Math.min(
    MAX_OFFSET_MIN,
    Math.max(
      ...dynamicTemplates.map((t) =>
        Math.abs(resolveOffsetMin(t.triggerConfig, -1440)),
      ),
    ),
  );
  const horizon = new Date(now.getTime() + (widestLeadMin + 60) * 60 * 1000);

  const clinicIds = Array.from(
    new Set(dynamicTemplates.map((t: TplRow) => t.clinicId)),
  );

  // Pull upcoming appointments per clinic in one shot, with everything the
  // body can name (the same include the cascade renders from).
  const appts = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        clinicId: { in: clinicIds },
        date: { gte: now, lte: horizon },
        // CONFIRMED rows still need ordinary reminders (e.g. day-of "in 1 hour"
        // pings). The dedicated 24h confirm-call detector keys on BOOKED only,
        // so a confirmed patient is already silent on that specific template.
        status: { in: ["BOOKED", "CONFIRMED", "WAITING"] },
      },
      include: APPOINTMENT_REFS_INCLUDE,
      // Nearest first, so a busy horizon never starves tomorrow's visits.
      orderBy: { date: "asc" },
      take: 2000,
    }),
  )) as AppointmentWithRefs[];

  // Index existing queued/sent rows for idempotency.
  const tplIds = dynamicTemplates.map((t: TplRow) => t.id);
  const apptIds = appts.map((a) => a.id);
  type ExistingRow = { appointmentId: string | null; templateId: string | null };
  const existing: ExistingRow[] =
    apptIds.length === 0
      ? []
      : ((await runWithTenant({ kind: "SYSTEM" }, () =>
          prisma.notificationSend.findMany({
            where: {
              appointmentId: { in: apptIds },
              templateId: { in: tplIds },
              status: { in: ["QUEUED", "SENT", "DELIVERED", "READ"] },
            },
            select: { appointmentId: true, templateId: true },
          }),
        )) as ExistingRow[]);
  const existingSet = new Set(
    existing.map((e: ExistingRow) => `${e.appointmentId}|${e.templateId}`),
  );

  const tplsByClinic = new Map<string, TplRow[]>();
  for (const t of dynamicTemplates) {
    const arr = tplsByClinic.get(t.clinicId) ?? [];
    arr.push(t);
    tplsByClinic.set(t.clinicId, arr);
  }

  type Insert = {
    clinicId: string;
    patientId: string;
    appointmentId: string;
    templateId: string;
    channel: "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";
    recipient: string;
    body: string;
    scheduledFor: Date;
    status: "QUEUED";
  };
  const toInsert: Insert[] = [];
  let skipped = 0;

  for (const appt of appts) {
    const tpls = tplsByClinic.get(appt.clinicId) ?? [];
    for (const tpl of tpls) {
      if (existingSet.has(`${appt.id}|${tpl.id}`)) {
        skipped += 1;
        continue;
      }
      const offset = resolveOffsetMin(tpl.triggerConfig, -1440);
      const scheduledFor = new Date(appt.date.getTime() + offset * 60 * 1000);
      // Skip if the fire-time has already passed (we'd dispatch immediately
      // which is generally unwanted for "before" reminders that drifted).
      if (scheduledFor.getTime() < now.getTime() - LATE_GRACE_MS) {
        skipped += 1;
        continue;
      }
      // A reminder that asks to confirm is not built for a confirmed visit
      // (audit TG-03); the send worker applies the same rule at send time.
      if (appt.confirmedAt !== null && skipsWhenConfirmed(tpl.triggerConfig)) {
        skipped += 1;
        continue;
      }
      // Channels: if triggerConfig.channels has values, use the first one;
      // otherwise fall back to template.channel + patient preference.
      const channels = resolveChannels(tpl.channel, tpl.triggerConfig, {
        telegramId: appt.patient.telegramId,
      });
      const channel = channels[0] as Insert["channel"] | undefined;
      const recipient = !channel
        ? null
        : channel === "TG"
          ? appt.patient.telegramId
          : appt.patient.phone;
      if (!channel || !recipient) {
        // Wave 4 of `docs/TZ-sms-removal.md`: no way to reach the patient,
        // so reception gets a call task instead. Only once the reminder's
        // moment has come (audit TG-02): raised days ahead it asked reception
        // to call about a reminder that was not due yet, and was raised again
        // on every tick. Nothing is inserted for this pair, so ticks inside
        // the grace window repeat the call; the action dedupes per day.
        if (scheduledFor.getTime() <= now.getTime()) {
          await recordPatientNoChannel({
            clinicId: appt.clinicId,
            patientId: appt.patientId,
            patientName: appt.patient.fullName,
            triggerKey: "appointment.before",
            appointmentId: appt.id,
            appointmentAt: appt.date,
          });
        }
        skipped += 1;
        continue;
      }
      const body = renderAppointmentBody(tpl, appt);
      toInsert.push({
        clinicId: appt.clinicId,
        patientId: appt.patientId,
        appointmentId: appt.id,
        templateId: tpl.id,
        channel,
        recipient,
        body,
        scheduledFor,
        status: "QUEUED",
      });
      // Parallel INAPP mirror for TG-using patients — same rationale as
      // the legacy 24h/5h/2h pass: free secondary touch in the Mini App.
      if (
        appt.patient.telegramId &&
        channel !== "INAPP" &&
        channel !== "VISIT" &&
        channel !== "CALL"
      ) {
        toInsert.push({
          clinicId: appt.clinicId,
          patientId: appt.patientId,
          appointmentId: appt.id,
          templateId: tpl.id,
          channel: "INAPP",
          recipient: appt.patientId,
          body,
          scheduledFor,
          status: "QUEUED",
        });
      }
    }
  }

  if (toInsert.length > 0) {
    await runWithTenant({ kind: "SYSTEM" }, () =>
      prisma.notificationSend.createMany({
        data: toInsert as never,
        skipDuplicates: true,
      }),
    );
  }
  return { created: toInsert.length, skipped };
}

/**
 * Pick QUEUED rows whose `scheduledFor` has elapsed and hand them to the
 * send worker. Cheap, indexed query — safe to run on a tight interval. The
 * send worker's `status !== "QUEUED"` guard makes a re-dispatch idempotent
 * (a row flips to SENT well within one dispatch interval).
 */
async function dispatchDue(): Promise<number> {
  const now = new Date();
  const due = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.notificationSend.findMany({
      where: { status: "QUEUED", scheduledFor: { lte: now } },
      select: { id: true },
      take: 500,
    }),
  )) as Array<{ id: string }>;
  for (const s of due) {
    await enqueue(SEND_QUEUE, SEND_JOB, { sendId: s.id });
  }
  return due.length;
}

async function dispatchTick(): Promise<void> {
  const n = await dispatchDue();
  if (n > 0) console.info(`[scheduler] fast-dispatch ${n}`);
}

async function tick(): Promise<void> {
  const triggered = await runScheduledTriggers();
  const dynamic = await runDynamicReminders();
  const dispatched = await dispatchDue();

  console.info(
    `[scheduler] tick ok triggered=${JSON.stringify(triggered)} dynamic=${JSON.stringify(dynamic)} dispatched=${dispatched}`,
  );
}

export function startNotificationsSchedulerWorker(
  intervalMs = 60_000,
  dispatchIntervalMs = 5_000,
): { stop: () => void } {
  const q = getQueue();
  q.registerWorker(QUEUE_NAME, JOB_NAME, tick);
  const handle = q.repeat(QUEUE_NAME, JOB_NAME, {}, intervalMs);

  // Fast dispatch loop — drains just-queued sends within seconds.
  q.registerWorker(QUEUE_NAME, DISPATCH_JOB, dispatchTick);
  const dispatchHandle = q.repeat(QUEUE_NAME, DISPATCH_JOB, {}, dispatchIntervalMs);

  console.info(
    `[worker] notifications-scheduler registered every ${intervalMs}ms (dispatch every ${dispatchIntervalMs}ms)`,
  );
  return {
    stop: () => {
      handle.stop();
      dispatchHandle.stop();
    },
  };
}

export { tick as _tickForTests };
