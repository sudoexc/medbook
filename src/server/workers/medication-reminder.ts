/**
 * Phase 16 Wave 3 — Medication-reminder worker.
 *
 * Hourly tick. For every ACTIVE prescription with `remindersEnabled: true`,
 * not on a closed medical case, whose schedule.times[] contains the current
 * local hour:
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
 *
 * Audit INF-09: the tick read `take: 500` rows with no order and no paging,
 * and a course never left ACTIVE when its days ran out. Every signed visit
 * adds courses, so once 500 finished ones piled up a new prescription could
 * fall outside the batch and never be reminded, silently. The tick now walks
 * every eligible row by id, page by page, and completes a course whose days
 * have passed (COMPLETED, the status a resolved case gives it), so the pool
 * it scans stays the courses actually running.
 */
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import {
  isCourseFinished,
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

/** Rows per page of the tick's walk over the eligible prescriptions. */
export const PAGE_SIZE = 500;

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

type ReminderTemplate = {
  id: string;
  clinicId: string;
  bodyRu: string;
  bodyUz: string;
  channel: Channel;
};

/**
 * Run a single tick. Returns counts so callers (tests, health checks) can
 * observe progress: rows scanned, reminders created, courses completed.
 */
export async function runMedicationReminderTick(
  now: Date = new Date(),
): Promise<{ scanned: number; created: number; completed: number }> {
  return runWithTenant({ kind: "SYSTEM" }, async () => {
    // Every active prescription with reminders enabled, joined with the bits
    // of patient + clinic we need for routing, walked page by page in id
    // order (audit INF-09): a fixed `take` without order skipped whatever
    // lay past it, the newest courses first.
    //
    // Phase 17 Wave 1 — exclude soft-deleted patients here so we never
    // even consider them. The marketing opt-out gate is enforced inline
    // below per-row (not in the WHERE) so the unit tests can observe the
    // skip path explicitly via mocks.
    //
    // A course of a closed case is never reminded (audit PT-10): closing
    // the case ends its courses, and this filter also covers a course left
    // ACTIVE on a case closed before that, or added to it afterwards.
    // Courses bridged from a signed visit have no case and are unaffected.
    const eligible: Prisma.PrescriptionWhereInput = {
      status: "ACTIVE",
      remindersEnabled: true,
      clinic: { medicationRemindersEnabled: true },
      patient: { deletedAt: null },
      OR: [{ caseId: null }, { case: { status: "OPEN" } }],
    };

    // The `medication.reminder` template per clinic (slug match, no
    // dedicated NotificationTrigger enum), loaded once per clinic per tick.
    const tplByClinic = new Map<string, ReminderTemplate>();
    const loadedClinics = new Set<string>();

    let scanned = 0;
    let created = 0;
    let completed = 0;
    let cursor: string | null = null;

    for (;;) {
      const rows = (await prisma.prescription.findMany({
        where: cursor ? { ...eligible, id: { gt: cursor } } : eligible,
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
        orderBy: { id: "asc" },
        take: PAGE_SIZE,
      })) as ActivePrescription[];
      if (rows.length === 0) break;
      scanned += rows.length;
      cursor = rows[rows.length - 1]!.id;

      const newClinics = Array.from(
        new Set(rows.map((r) => r.clinicId).filter((id) => !loadedClinics.has(id))),
      );
      if (newClinics.length > 0) {
        const templates = (await prisma.notificationTemplate.findMany({
          where: {
            clinicId: { in: newClinics },
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
        })) as ReminderTemplate[];
        for (const id of newClinics) loadedClinics.add(id);
        for (const t of templates) tplByClinic.set(t.clinicId, t);
      }

      const finished: string[] = [];
      for (const rx of rows) {
        const sched = parseSchedule(rx.schedule, rx.createdAt);
        if (!sched) continue;

        // The course has run its days (audit INF-09): it is over, whatever
        // the patient's consent, and leaves the pool the next ticks scan.
        if (isCourseFinished(sched, now)) {
          finished.push(rx.id);
          continue;
        }

        if (await remindOne(rx, sched, tplByClinic.get(rx.clinicId), now)) {
          created += 1;
        }
      }

      if (finished.length > 0) {
        // Guarded on ACTIVE: a course paused or ended by staff meanwhile keeps
        // the status they gave it.
        const res = await prisma.prescription.updateMany({
          where: { id: { in: finished }, status: "ACTIVE" },
          data: { status: "COMPLETED" },
        });
        completed += res.count;
      }

      if (rows.length < PAGE_SIZE) break;
    }

    if (scanned > 0) {
      console.info(
        `[medication-reminder] scanned ${scanned}, reminders ${created}, courses completed ${completed}`,
      );
    }
    return { scanned, created, completed };
  });
}

/**
 * Remind one running course if a dose is due in this tick. Returns whether
 * a `MedicationReminderSend` was created.
 */
async function remindOne(
  rx: ActivePrescription,
  sched: NonNullable<ReturnType<typeof parseSchedule>>,
  tpl: ReminderTemplate | undefined,
  now: Date,
): Promise<boolean> {
  // Phase 17 Wave 1 — medication reminders are classified as marketing
  // (the patient may opt out without losing critical care). The
  // prescription itself stays active; we just stop pinging the patient.
  const consent = isAllowedToReceive(rx.patient, "marketing");
  if (!consent.allowed) return false;

  const tz = rx.clinic.timezone || "Asia/Tashkent";
  const due = isPrescriptionDueInWindow(sched, now, tz);
  if (!due) return false;

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
    return false; // unique violation — another tick already inserted
  }

  if (!tpl) return true;

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
  return true;
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
