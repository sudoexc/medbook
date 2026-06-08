/**
 * Phase 16 Wave 3 — Medication-reminder worker.
 *
 * Hourly tick. For every ACTIVE prescription with `remindersEnabled: true`
 * whose schedule.times[] contains the current local hour:
 *
 *   1. Compute the canonical UTC anchor (`scheduledFor`) for the tick via
 *      `isPrescriptionDueInWindow` (pure helper).
 *   2. INSERT a `MedicationReminderSend(prescriptionId, scheduledFor)` row
 *      with status PENDING. The unique constraint on
 *      (prescriptionId, scheduledFor) makes the second tick a no-op.
 *   3. Materialise a TG notification via the `medication.reminder`
 *      template, mirrored to INAPP for TG-eligible patients (same
 *      "free secondary touch" logic as appointment reminders). SMS was
 *      removed in `docs/TZ-sms-removal.md` Wave 3.
 *
 * The `MedicationReminderSend` row is the source of truth the patient
 * dashboard reads — they tap "Принял / Пропустил / Отложить" on it. The
 * template is just the push side of the pair.
 *
 * Eligibility logic + schedule parsing is centralised in
 * `src/lib/patient-experience/medication-schedule.ts` so the unit tests can
 * cover the hour-boundary cases without booting Prisma.
 */
import { prisma } from "@/lib/prisma";
import {
  isPrescriptionDueInWindow,
  parseSchedule,
} from "@/lib/patient-experience/medication-schedule";
import { runWithTenant } from "@/lib/tenant-context";

import { isAllowedToReceive } from "@/server/notifications/consent-gate";
import { render } from "@/server/notifications/template";
import { getQueue } from "@/server/queue";

export const QUEUE_NAME = "patient-experience:medication";
export const JOB_NAME = "medication-reminder-tick";

/** Hourly cadence — schedules are anchored to HH:00 in clinic TZ. */
const TICK_INTERVAL_MS = 60 * 60 * 1000;

type Channel = "TG" | "EMAIL" | "CALL" | "VISIT" | "INAPP";

type ActivePrescription = {
  id: string;
  clinicId: string;
  patientId: string;
  drugName: string;
  dosage: string;
  schedule: unknown;
  createdAt: Date;
  patient: {
    fullName: string;
    phone: string;
    telegramId: string | null;
    preferredChannel: string;
    marketingOptOut: boolean | null;
    deletedAt: Date | null;
  };
  clinic: {
    id: string;
    nameRu: string;
    nameUz: string;
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

function pickRecipient(
  channel: Channel,
  patient: { phone: string; telegramId: string | null },
): string | null {
  if (channel === "TG") return patient.telegramId;
  if (channel === "EMAIL") return patient.phone;
  return null;
}

/**
 * Run a single tick. Returns counts so callers (tests, health checks) can
 * observe progress.
 */
export async function runMedicationReminderTick(
  now: Date = new Date(),
): Promise<{ scanned: number; created: number }> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    // Pull every active prescription with reminders enabled, joined with the
    // bits of patient + clinic we need for routing. `take: 500` per tick
    // covers a clinic running 100+ active scripts comfortably.
    //
    // Phase 17 Wave 1 — exclude soft-deleted patients here so we never
    // even consider them. The marketing opt-out gate is enforced inline
    // below per-row (not in the WHERE) so the unit tests can observe the
    // skip path explicitly via mocks.
    const rows = (await prisma.prescription.findMany({
      where: {
        status: "ACTIVE",
        remindersEnabled: true,
        clinic: { medicationRemindersEnabled: true },
        patient: { deletedAt: null },
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        drugName: true,
        dosage: true,
        schedule: true,
        createdAt: true,
        patient: {
          select: {
            fullName: true,
            phone: true,
            telegramId: true,
            preferredChannel: true,
            marketingOptOut: true,
            deletedAt: true,
          },
        },
        clinic: {
          select: {
            id: true,
            nameRu: true,
            nameUz: true,
            timezone: true,
            medicationRemindersEnabled: true,
          },
        },
      },
      take: 500,
    })) as ActivePrescription[];

    if (rows.length === 0) return { scanned: 0, created: 0 };

    // Pull the `medication.reminder` template per clinic in one query (slug
    // match — no dedicated NotificationTrigger enum).
    const clinicIds = Array.from(new Set(rows.map((r) => r.clinicId)));
    const templates = (await prisma.notificationTemplate.findMany({
      where: {
        clinicId: { in: clinicIds },
        key: "medication.reminder",
        isActive: true,
      },
      select: {
        id: true,
        clinicId: true,
        bodyRu: true,
        bodyUz: true,
        channel: true,
      },
    })) as Array<{
      id: string;
      clinicId: string;
      bodyRu: string;
      bodyUz: string;
      channel: Channel;
    }>;
    const tplByClinic = new Map(templates.map((t) => [t.clinicId, t]));

    let created = 0;

    for (const rx of rows) {
      const sched = parseSchedule(rx.schedule, rx.createdAt);
      if (!sched) continue;

      // Phase 17 Wave 1 — medication reminders are classified as marketing
      // (the patient may opt out without losing critical care). The
      // prescription itself stays active; we just stop pinging the patient.
      const consent = isAllowedToReceive(rx.patient, "marketing");
      if (!consent.allowed) continue;

      const tz = rx.clinic.timezone || "Asia/Tashkent";
      const due = isPrescriptionDueInWindow(sched, now, tz);
      if (!due) continue;

      // Idempotency gate: (prescriptionId, scheduledFor) is unique. Try the
      // insert; on conflict we move on. We still create the row even if the
      // template is missing — the in-app dashboard works without a push.
      let send;
      try {
        send = await prisma.medicationReminderSend.create({
          data: {
            clinicId: rx.clinicId,
            prescriptionId: rx.id,
            patientId: rx.patientId,
            scheduledFor: due.dueAt,
            sentAt: null,
            status: "PENDING",
          },
        });
      } catch {
        continue; // unique violation — another tick already inserted
      }

      const tpl = tplByClinic.get(rx.clinicId);
      if (!tpl) {
        created += 1;
        continue;
      }

      const recipient = pickRecipient(tpl.channel, rx.patient);
      const localTime = localHourMinute(due.dueAt, tz);
      const body = render(tpl.bodyRu, {
        patient: {
          name: rx.patient.fullName,
          firstName: firstName(rx.patient.fullName),
        },
        drug: { name: rx.drugName, dosage: rx.dosage },
        time: localTime,
        deeplink: "/my/medications",
        clinic: { name: rx.clinic.nameRu },
      });

      // Push side. INAPP always — the dashboard relies on it for the banner
      // count. TG only if we have a recipient.
      try {
        await prisma.notificationSend.create({
          data: {
            clinicId: rx.clinicId,
            patientId: rx.patientId,
            templateId: tpl.id,
            channel: "INAPP",
            recipient: rx.patientId,
            body,
            scheduledFor: due.dueAt,
            status: "QUEUED",
          } as never,
        });
        if (
          recipient &&
          tpl.channel !== "INAPP" &&
          tpl.channel !== "VISIT" &&
          tpl.channel !== "CALL"
        ) {
          await prisma.notificationSend.create({
            data: {
              clinicId: rx.clinicId,
              patientId: rx.patientId,
              templateId: tpl.id,
              channel: tpl.channel,
              recipient,
              body,
              scheduledFor: due.dueAt,
              status: "QUEUED",
            } as never,
          });
        }
        // Mark the reminder as "sent" — the patient still has to respond.
        await prisma.medicationReminderSend.update({
          where: { id: send.id },
          data: { sentAt: now },
        });
      } catch (err) {
        console.error(
          `[medication-reminder] push failed for prescription ${rx.id}`,
          err,
        );
      }

      created += 1;
    }

    return { scanned: rows.length, created };
  });
}

/** Start the worker (idempotent). */
export function startMedicationReminderWorker(
  intervalMs: number = TICK_INTERVAL_MS,
): { stop: () => void } {
  const queue = getQueue();
  queue.registerWorker<Record<string, never>>(
    QUEUE_NAME,
    JOB_NAME,
    async () => {
      try {
        await runMedicationReminderTick();
      } catch (err) {
        console.error("[medication-reminder] tick failed", err);
      }
    },
  );
  const handle = queue.repeat(QUEUE_NAME, JOB_NAME, {} as never, intervalMs);
  console.info("[worker] medication-reminder registered");
  return handle;
}

// Test-only export.
export { runMedicationReminderTick as _runForTests };
