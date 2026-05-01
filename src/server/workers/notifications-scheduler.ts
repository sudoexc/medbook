/**
 * notifications-scheduler — cron-style poller.
 *
 * Every minute:
 *   1. Run trigger materialisation (birthday, 24h/2h reminders, payment.due)
 *      via the legacy `runScheduledTriggers()` pass — this honors the seeded
 *      offsetMin values (-1440, -120) and is idempotent.
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

import {
  isTriggerEnabled,
  resolveChannels,
  resolveOffsetMin,
} from "@/server/notifications/rules";
import { render } from "@/server/notifications/template";
import { runScheduledTriggers } from "@/server/notifications/triggers";
import { enqueue, getQueue } from "@/server/queue";

import {
  JOB_NAME as SEND_JOB,
  QUEUE_NAME as SEND_QUEUE,
} from "./notifications-send";

export const QUEUE_NAME = "notifications:scheduler";
export const JOB_NAME = "tick";

export type TickResult = {
  triggered: Awaited<ReturnType<typeof runScheduledTriggers>>;
  dispatched: number;
};

/**
 * Dynamic-rules pass: schedule reminders for templates whose
 * `triggerConfig.offsetMin` was customised by an admin (i.e. not the seeded
 * -1440 or -120). The legacy pass owns those two canonical values via
 * Prisma JSON-path WHERE clauses.
 */
async function runDynamicReminders(): Promise<{ created: number; skipped: number }> {
  const now = new Date();
  // 72-hour horizon matches the editor's max offset.
  const horizon = new Date(now.getTime() + 72 * 60 * 60 * 1000);

  // Fetch every active APPOINTMENT_BEFORE template across all clinics. The
  // tenant-scope extension is bypassed by SYSTEM context — we filter by
  // clinicId per appointment downstream.
  type TplRow = {
    id: string;
    clinicId: string;
    channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT";
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
    // Legacy hardcoded values are owned by the existing pass.
    return off !== null && off !== -1440 && off !== -120;
  });

  if (dynamicTemplates.length === 0) {
    return { created: 0, skipped: 0 };
  }

  const clinicIds = Array.from(
    new Set(dynamicTemplates.map((t: TplRow) => t.clinicId)),
  );

  // Pull upcoming appointments per clinic in one shot.
  type ApptRow = {
    id: string;
    clinicId: string;
    patientId: string;
    date: Date;
    patient: {
      fullName: string;
      phone: string;
      telegramId: string | null;
      preferredChannel: string;
    };
  };
  const appts = (await runWithTenant({ kind: "SYSTEM" }, () =>
    prisma.appointment.findMany({
      where: {
        clinicId: { in: clinicIds },
        date: { gte: now, lte: horizon },
        status: { in: ["BOOKED", "WAITING"] },
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        date: true,
        patient: {
          select: {
            fullName: true,
            phone: true,
            telegramId: true,
            preferredChannel: true,
          },
        },
      },
      take: 2000,
    }),
  )) as ApptRow[];

  // Index existing queued/sent rows for idempotency.
  const tplIds = dynamicTemplates.map((t: TplRow) => t.id);
  const apptIds = appts.map((a: ApptRow) => a.id);
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
    channel: "SMS" | "TG" | "EMAIL" | "CALL" | "VISIT";
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
      if (scheduledFor.getTime() < now.getTime() - 5 * 60 * 1000) {
        skipped += 1;
        continue;
      }
      // Channels: if triggerConfig.channels has values, use the first one;
      // otherwise fall back to template.channel + patient preference.
      const channels = resolveChannels(tpl.channel, tpl.triggerConfig, {
        telegramId: appt.patient.telegramId,
      });
      const channel = channels[0] as Insert["channel"] | undefined;
      if (!channel) {
        skipped += 1;
        continue;
      }
      const recipient =
        channel === "TG" ? appt.patient.telegramId : appt.patient.phone;
      if (!recipient) {
        skipped += 1;
        continue;
      }
      const body = render(tpl.bodyRu, {
        patient: {
          name: appt.patient.fullName,
          firstName: appt.patient.fullName.split(/\s+/)[0] ?? "",
          phone: appt.patient.phone,
        },
        appointment: { date: appt.date.toISOString().slice(0, 10) },
        clinic: { name: "", phone: "", address: "" },
      });
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

async function tick(): Promise<void> {
  const triggered = await runScheduledTriggers();
  const dynamic = await runDynamicReminders();

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

  console.info(
    `[scheduler] tick ok triggered=${JSON.stringify(triggered)} dynamic=${JSON.stringify(dynamic)} dispatched=${due.length}`,
  );
}

export function startNotificationsSchedulerWorker(
  intervalMs = 60_000,
): { stop: () => void } {
  const q = getQueue();
  q.registerWorker(QUEUE_NAME, JOB_NAME, tick);
  const handle = q.repeat(QUEUE_NAME, JOB_NAME, {}, intervalMs);
  console.info(`[worker] notifications-scheduler registered every ${intervalMs}ms`);
  return handle;
}

export { tick as _tickForTests };
