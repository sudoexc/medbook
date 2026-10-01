/**
 * Phase 16 Wave 3 — Medication-reminder worker.
 *
 * Five-minute tick. For every ACTIVE prescription with `remindersEnabled:
 * true`, not on a closed medical case, with a dose whose time fell in the
 * trailing catch-up window (audit INF-12: the hourly tick ran at the minute
 * of the first deploy and saw only the current hour, so doses went out up
 * to 59 minutes late and a tick slipping past the hour lost one):
 *
 *   1. Compute the canonical UTC anchor (`scheduledFor`) of every such dose
 *      via `dosesDueBetween` (pure helper): 08:00 and 08:30 are two
 *      reminders, each sent within one tick of its time.
 *   2. INSERT a `MedicationReminderSend(prescriptionId, scheduledFor)` row
 *      with status PENDING. The unique constraint on
 *      (prescriptionId, scheduledFor) makes the second tick a no-op.
 *   3. Materialise the push via the `medication.reminder` template: an
 *      INAPP banner always, Telegram too while the template is on and the
 *      patient has a chat. SMS was removed in `docs/TZ-sms-removal.md`
 *      Wave 3.
 *
 * Audit TG-15: no seed or onboarding ever created `medication.reminder`, and
 * without it the worker skipped both pushes, so the doctor's «Напоминать
 * пациенту в Telegram» switch did nothing. The template is now created for
 * the clinic on first use, and the banner falls back to the default text.
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
  dosesDueBetween,
  isCourseFinished,
  parseSchedule,
} from "@/lib/patient-experience/medication-schedule";
import { runWithTenant } from "@/lib/tenant-context";

import { isAllowedToReceive } from "@/server/notifications/consent-gate";
import { MEDICATION_REMINDER_TEMPLATE } from "@/server/notifications/default-templates";
import {
  ensureClinicTemplate,
  type EnsuredTemplate,
} from "@/server/notifications/ensure-template";
import { render } from "@/server/notifications/template";
import { getQueue } from "@/server/queue";

export const QUEUE_NAME = "patient-experience:medication";
export const JOB_NAME = "medication-reminder-tick";

/**
 * Tick cadence: a dose goes out at most this long after its time. A BullMQ
 * `every` schedule keeps the offset of its first run, so a short interval,
 * not an hourly one, is what keeps reminders on time.
 */
const TICK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * How far back a tick still reminds a dose it has not reminded yet: a tick
 * or two lost to a deploy or a restart is caught up; a dose from hours ago
 * («пора принять в 08:00» at noon) is not sent.
 */
export const MEDICATION_CATCH_UP_MS = 90 * 60 * 1000;

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
    tgBlockedAt: Date | null;
    preferredChannel: string;
    preferredLang: "RU" | "UZ";
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
  patient: { phone: string; telegramId: string | null; tgBlockedAt?: Date | null },
): string | null {
  // A patient who blocked the bot would only produce a FAILED row.
  if (channel === "TG") return patient.tgBlockedAt ? null : patient.telegramId;
  // EMAIL has no adapter and the card no e-mail: the phone it used to
  // return made a row the send worker could only fail (audit INF-11).
  return null;
}

/**
 * The reminder text: the template in the patient's language (a blank Uzbek
 * text falls back to Russian). A course with no dosage typed leaves no stray
 * space before the punctuation.
 */
export function renderMedicationReminder(
  tpl: { bodyRu: string; bodyUz: string },
  ctx: {
    lang: "RU" | "UZ";
    patientName: string;
    drugName: string;
    dosage: string;
    time: string;
    clinicName: string;
  },
): string {
  const uz = ctx.lang === "UZ" && tpl.bodyUz.trim() !== "";
  return render(uz ? tpl.bodyUz : tpl.bodyRu, {
    patient: { name: ctx.patientName, firstName: firstName(ctx.patientName) },
    drug: { name: ctx.drugName, dosage: ctx.dosage },
    time: ctx.time,
    deeplink: "/my/medications",
    clinic: { name: ctx.clinicName },
  })
    .replace(/[ \t]+([.,!?:;)])/g, "$1")
    .replace(/[ \t]{2,}/g, " ");
}

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

    // The clinic's `medication.reminder` template, created from the default
    // on first use (audit TG-15), once per clinic per tick. An admin's edits
    // and off switch are kept.
    const tplByClinic = new Map<string, EnsuredTemplate | null>();
    const from = new Date(now.getTime() - MEDICATION_CATCH_UP_MS);

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
              tgBlockedAt: true,
              preferredChannel: true,
              preferredLang: true,
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

      for (const clinicId of new Set(rows.map((r) => r.clinicId))) {
        if (tplByClinic.has(clinicId)) continue;
        try {
          tplByClinic.set(
            clinicId,
            await ensureClinicTemplate(clinicId, MEDICATION_REMINDER_TEMPLATE),
          );
        } catch (err) {
          console.error(
            `[medication-reminder] clinic ${clinicId}: could not create the medication.reminder template, in-app reminders only`,
            err,
          );
          tplByClinic.set(clinicId, null);
        }
      }

      const finished: string[] = [];
      for (const rx of rows) {
        const sched = parseSchedule(rx.schedule, rx.createdAt);
        if (!sched) continue;

        // Phase 17 Wave 1 — medication reminders are classified as marketing
        // (the patient may opt out without losing critical care). The
        // prescription itself stays active; we just stop pinging the patient.
        const consent = isAllowedToReceive(rx.patient, "marketing");
        if (consent.allowed) {
          const tz = rx.clinic.timezone || "Asia/Tashkent";
          const tpl = tplByClinic.get(rx.clinicId) ?? null;
          for (const dueAt of dosesDueBetween(sched, from, now, tz)) {
            if (await materializeDose(rx, tpl, dueAt, tz, now)) created += 1;
          }
        }

        // The course has run its days (audit INF-09): it is over, whatever
        // the patient's consent, and leaves the pool the next ticks scan.
        // Its last dose, if still inside the catch-up window, went out above.
        if (isCourseFinished(sched, now)) finished.push(rx.id);
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
 * One dose: the dashboard row, then the push. Returns false when another
 * tick already took this dose.
 */
async function materializeDose(
  rx: ActivePrescription,
  tpl: EnsuredTemplate | null,
  dueAt: Date,
  tz: string,
  now: Date,
): Promise<boolean> {
  // Idempotency gate: (prescriptionId, scheduledFor) is unique. Try the
  // insert; on conflict we move on. The row is the source of truth the
  // patient dashboard reads, push or no push.
  let send;
  try {
    send = await prisma.medicationReminderSend.create({
      data: {
        clinicId: rx.clinicId,
        prescriptionId: rx.id,
        patientId: rx.patientId,
        scheduledFor: dueAt,
        sentAt: null,
        status: "PENDING",
      },
    });
  } catch {
    return false; // unique violation — another tick already inserted
  }

  const lang = rx.patient.preferredLang === "UZ" ? "UZ" : "RU";
  // A switched-off template still leaves the in-app banner (the Mini App
  // dashboard counts on it); only the Telegram push follows the switch. A
  // template that could not be created leaves the banner in default words.
  const text = tpl ?? MEDICATION_REMINDER_TEMPLATE;
  const body = renderMedicationReminder(text, {
    lang,
    patientName: rx.patient.fullName,
    drugName: rx.drugName,
    dosage: rx.dosage,
    time: localHourMinute(dueAt, tz),
    clinicName: lang === "UZ" ? rx.clinic.nameUz || rx.clinic.nameRu : rx.clinic.nameRu,
  });
  const tgChannel = tpl?.isActive ? tpl.channel : null;
  const recipient = tgChannel ? pickRecipient(tgChannel, rx.patient) : null;

  try {
    await prisma.notificationSend.create({
      data: {
        clinicId: rx.clinicId,
        patientId: rx.patientId,
        templateId: tpl?.id ?? null,
        channel: "INAPP",
        recipient: rx.patientId,
        body,
        scheduledFor: dueAt,
        status: "QUEUED",
      } as never,
    });
    if (
      tgChannel &&
      recipient &&
      tgChannel !== "INAPP" &&
      tgChannel !== "VISIT" &&
      tgChannel !== "CALL"
    ) {
      await prisma.notificationSend.create({
        data: {
          clinicId: rx.clinicId,
          patientId: rx.patientId,
          templateId: tpl!.id,
          channel: tgChannel,
          recipient,
          body,
          scheduledFor: dueAt,
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
