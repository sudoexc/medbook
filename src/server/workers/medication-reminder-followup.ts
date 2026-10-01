/**
 * Medication reminders after the first push (audit MA-13).
 *
 * The hourly `medication-reminder` tick creates one PENDING
 * `MedicationReminderSend` per dose and pushes it. Nothing touched the row
 * afterwards, although the respond route and the list endpoint both relied
 * on a worker that would:
 *
 *   - expire unanswered doses: a row still PENDING (or SNOOZED) past the
 *     open window (`MEDICATION_REMINDER_OPEN_HOURS`) becomes EXPIRED. They
 *     used to pile up forever, and the Mini App home offered a week-old dose
 *     as «Пора принять».
 *   - bring a snoozed dose back: once `snoozeUntil` has passed, the row
 *     returns to PENDING and the push goes out again, on the same row.
 *     «Отложить на 30 минут» used to never remind again.
 *
 * A 5-minute cadence, not the hourly tick, so a 30-minute snooze comes back
 * after 30 to 35 minutes rather than up to an hour and a half later.
 *
 * The re-sent push follows the first one exactly: the clinic's
 * `medication.reminder` template, an INAPP row always, a TG row when the
 * patient has a chat, and the same marketing-consent gate (reminders are
 * opt-out-able). With no template the row still returns to PENDING, so the
 * Mini App shows it, like the first send does.
 *
 * Every write is conditional on the row's state (`updateMany` on the status
 * it was read in), so two worker replicas, or a patient answering at the
 * same moment, cannot double-send or overwrite an answer.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { medicationReminderOpenSince } from "@/lib/patient-experience/medication-reminders";

import { isAllowedToReceive } from "@/server/notifications/consent-gate";
import { render } from "@/server/notifications/template";
import { getQueue } from "@/server/queue";

export const QUEUE_NAME = "patient-experience:medication-followup";
export const JOB_NAME = "medication-reminder-followup-tick";

const TICK_INTERVAL_MS = 5 * 60 * 1000;

type Channel = "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";

type SnoozedRow = {
  id: string;
  clinicId: string;
  patientId: string;
  scheduledFor: Date;
  prescription: {
    drugName: string;
    dosage: string;
    status: string;
    remindersEnabled: boolean;
    case: { status: string } | null;
  };
  patient: {
    fullName: string;
    phone: string;
    telegramId: string | null;
    marketingOptOut: boolean | null;
    deletedAt: Date | null;
  };
  clinic: {
    nameRu: string;
    timezone: string;
    medicationRemindersEnabled: boolean;
  };
};

function firstName(full: string): string {
  const trimmed = full.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? trimmed;
}

function localHourMinute(date: Date, tz: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(date);
  } catch {
    return date.toISOString().slice(11, 16);
  }
}

/** Would the hourly tick still remind about this course at all? */
function courseStillReminds(row: SnoozedRow): boolean {
  return (
    row.prescription.status === "ACTIVE" &&
    row.prescription.remindersEnabled &&
    row.clinic.medicationRemindersEnabled &&
    row.patient.deletedAt === null &&
    (row.prescription.case === null || row.prescription.case.status === "OPEN")
  );
}

export async function runMedicationReminderFollowUp(
  now: Date = new Date(),
): Promise<{ expired: number; resurfaced: number; pushed: number }> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const openSince = medicationReminderOpenSince(now);

    // 1. Unanswered past the window: history, not «пора принять».
    const expired = await prisma.medicationReminderSend.updateMany({
      where: {
        status: { in: ["PENDING", "SNOOZED"] },
        scheduledFor: { lt: openSince },
      },
      data: { status: "EXPIRED" },
    });

    // 2. Snoozes that ran out, on doses still inside the window.
    const rows = (await prisma.medicationReminderSend.findMany({
      where: {
        status: "SNOOZED",
        snoozeUntil: { lte: now },
        scheduledFor: { gte: openSince },
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        scheduledFor: true,
        prescription: {
          select: {
            drugName: true,
            dosage: true,
            status: true,
            remindersEnabled: true,
            case: { select: { status: true } },
          },
        },
        patient: {
          select: {
            fullName: true,
            phone: true,
            telegramId: true,
            marketingOptOut: true,
            deletedAt: true,
          },
        },
        clinic: {
          select: { nameRu: true, timezone: true, medicationRemindersEnabled: true },
        },
      },
      orderBy: { snoozeUntil: "asc" },
      take: 500,
    })) as SnoozedRow[];

    let resurfaced = 0;
    let pushed = 0;
    let expiredStopped = 0;
    if (rows.length === 0) return { expired: expired.count, resurfaced, pushed };

    const clinicIds = Array.from(new Set(rows.map((r) => r.clinicId)));
    const templates = (await prisma.notificationTemplate.findMany({
      where: { clinicId: { in: clinicIds }, key: "medication.reminder", isActive: true },
      select: { id: true, clinicId: true, bodyRu: true, channel: true },
    })) as Array<{ id: string; clinicId: string; bodyRu: string; channel: Channel }>;
    const tplByClinic = new Map(templates.map((t) => [t.clinicId, t]));

    for (const row of rows) {
      // A course stopped (or a case closed) while the dose was snoozed: the
      // dose is not coming back, close it instead of reminding.
      if (!courseStillReminds(row)) {
        const closed = await prisma.medicationReminderSend.updateMany({
          where: { id: row.id, status: "SNOOZED" },
          data: { status: "EXPIRED" },
        });
        expiredStopped += closed.count;
        continue;
      }

      // Claim: only the run that flips SNOOZED → PENDING sends the push.
      const claimed = await prisma.medicationReminderSend.updateMany({
        where: { id: row.id, status: "SNOOZED" },
        data: { status: "PENDING", snoozeUntil: null, sentAt: now },
      });
      if (claimed.count === 0) continue;
      resurfaced += 1;

      const tpl = tplByClinic.get(row.clinicId);
      if (!tpl) continue;
      if (!isAllowedToReceive(row.patient, "marketing").allowed) continue;

      const tz = row.clinic.timezone || "Asia/Tashkent";
      const body = render(tpl.bodyRu, {
        patient: { name: row.patient.fullName, firstName: firstName(row.patient.fullName) },
        drug: { name: row.prescription.drugName, dosage: row.prescription.dosage },
        time: localHourMinute(row.scheduledFor, tz),
        deeplink: "/my/medications",
        clinic: { name: row.clinic.nameRu },
      });
      const recipient =
        tpl.channel === "TG"
          ? row.patient.telegramId
          : tpl.channel === "EMAIL"
            ? row.patient.phone
            : null;

      try {
        await prisma.notificationSend.create({
          data: {
            clinicId: row.clinicId,
            patientId: row.patientId,
            templateId: tpl.id,
            channel: "INAPP",
            recipient: row.patientId,
            body,
            scheduledFor: now,
            status: "QUEUED",
          } as never,
        });
        if (recipient && tpl.channel !== "INAPP" && tpl.channel !== "VISIT" && tpl.channel !== "CALL") {
          await prisma.notificationSend.create({
            data: {
              clinicId: row.clinicId,
              patientId: row.patientId,
              templateId: tpl.id,
              channel: tpl.channel,
              recipient,
              body,
              scheduledFor: now,
              status: "QUEUED",
            } as never,
          });
        }
        pushed += 1;
      } catch (err) {
        console.error(`[medication-reminder-followup] push failed for reminder ${row.id}`, err);
      }
    }

    return { expired: expired.count + expiredStopped, resurfaced, pushed };
  });
}

/** Start the worker (idempotent). */
export function startMedicationReminderFollowUpWorker(
  intervalMs: number = TICK_INTERVAL_MS,
): { stop: () => void } {
  const queue = getQueue();
  queue.registerWorker<Record<string, never>>(QUEUE_NAME, JOB_NAME, async () => {
    try {
      await runMedicationReminderFollowUp();
    } catch (err) {
      console.error("[medication-reminder-followup] tick failed", err);
    }
  });
  const handle = queue.repeat(QUEUE_NAME, JOB_NAME, {} as never, intervalMs);
  console.info("[worker] medication-reminder-followup registered");
  return handle;
}
