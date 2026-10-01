/**
 * Phase 16 Wave 3 — Medication-reminder worker.
 *
 * Hourly tick. For every ACTIVE prescription with `remindersEnabled: true`,
 * not on a closed medical case, whose schedule.times[] contains the current
 * local hour:
 *
 *   1. Compute the canonical UTC anchor (`scheduledFor`) of every dose in
 *      the tick via `dosesDueInWindow` (pure helper): 08:00 and 08:30 are
 *      two reminders.
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
 */
import { prisma } from "@/lib/prisma";
import {
  dosesDueInWindow,
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
  if (channel === "EMAIL") return patient.phone;
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
    //
    // A course of a closed case is never reminded (audit PT-10): closing
    // the case ends its courses, and this filter also covers a course left
    // ACTIVE on a case closed before that, or added to it afterwards.
    // Courses bridged from a signed visit have no case and are unaffected.
    const rows = (await prisma.prescription.findMany({
      where: {
        status: "ACTIVE",
        remindersEnabled: true,
        clinic: { medicationRemindersEnabled: true },
        patient: { deletedAt: null },
        OR: [{ caseId: null }, { case: { status: "OPEN" } }],
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
      take: 500,
    })) as ActivePrescription[];

    if (rows.length === 0) return { scanned: 0, created: 0 };

    // The clinic's `medication.reminder` template, created from the default
    // on first use (audit TG-15). An admin's edits and off switch are kept.
    const clinicIds = Array.from(new Set(rows.map((r) => r.clinicId)));
    const tplByClinic = new Map<string, EnsuredTemplate | null>();
    for (const clinicId of clinicIds) {
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
      const tpl = tplByClinic.get(rx.clinicId) ?? null;
      for (const dueAt of dosesDueInWindow(sched, now, tz)) {
        if (await materializeDose(rx, tpl, dueAt, tz, now)) created += 1;
      }
    }

    return { scanned: rows.length, created };
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
