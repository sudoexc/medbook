/**
 * Phase 16 Wave 3 — Mini App medication-reminder dashboard (list).
 *
 * GET /api/miniapp/medications
 *   Returns:
 *     - `prescriptions`: every ACTIVE prescription on the active patient
 *       (or family-context patient via `?onBehalfOf=`), with the next
 *       expected dose time (computed locally in the patient's clinic TZ).
 *     - `reminders`: the open `MedicationReminderSend` rows (PENDING +
 *       past-due) plus any SNOOZED rows whose snooze has expired. The
 *       dashboard renders them as actionable cards.
 *
 * The split lets the UI show a "Schedule" tab (every active drug + its
 * cadence) alongside an "Open reminders" tab (specific ticks the patient
 * hasn't confirmed yet).
 *
 * Ownership: the active context (self or family link) MUST own the
 * prescriptions. We scope every find by `clinicId + effectivePatientId`.
 */
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import {
  daysRemaining,
  nextTickAt,
  parseSchedule,
} from "@/lib/patient-experience/medication-schedule";
import { forbidden, ok } from "@/server/http";
import {
  createMiniAppListHandler,
  type MiniAppContext,
} from "@/server/miniapp/handler";
import { hydratePrescriptionForRead } from "@/server/prescription/cipher-fields";

const QuerySchema = z.object({
  onBehalfOf: z.string().optional(),
});

function parseOnBehalfOf(request: Request): string | null {
  const url = new URL(request.url);
  const raw = url.searchParams.get("onBehalfOf");
  const parsed = QuerySchema.safeParse({ onBehalfOf: raw ?? undefined });
  if (!parsed.success) return null;
  return parsed.data.onBehalfOf ?? null;
}

async function resolveEffectivePatient(
  ctx: MiniAppContext,
  onBehalfOf: string | null,
): Promise<string | null> {
  if (!onBehalfOf || onBehalfOf === ctx.patientId) return ctx.patientId;
  const link = await prisma.patientFamily.findFirst({
    where: {
      clinicId: ctx.clinicId,
      ownerPatientId: ctx.patientId,
      linkedPatientId: onBehalfOf,
    },
    select: { id: true },
  });
  return link ? onBehalfOf : null;
}

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const onBehalfOf = parseOnBehalfOf(request);
  const effectivePatientId = await resolveEffectivePatient(ctx, onBehalfOf);
  if (!effectivePatientId) return forbidden();

  const clinic = await prisma.clinic.findUnique({
    where: { id: ctx.clinicId },
    select: { timezone: true, medicationRemindersEnabled: true },
  });
  const tz = clinic?.timezone || "Asia/Tashkent";

  const prescriptions = await prisma.prescription.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId: effectivePatientId,
      status: { in: ["ACTIVE", "PAUSED"] },
    },
    select: {
      id: true,
      drugName: true,
      dosage: true,
      schedule: true,
      notes: true,
      status: true,
      remindersEnabled: true,
      createdAt: true,
      doctor: { select: { id: true, nameRu: true, nameUz: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const now = new Date();

  const prescriptionsWithMeta = prescriptions.map((rx) => {
    const sched = parseSchedule(rx.schedule, rx.createdAt);
    const next = sched ? nextTickAt(sched, now, tz) : null;
    const remaining = sched ? daysRemaining(sched, now) : null;
    const hydrated = hydratePrescriptionForRead({ notes: rx.notes });
    return {
      id: rx.id,
      drugName: rx.drugName,
      dosage: rx.dosage,
      schedule: {
        times: sched?.times ?? [],
        days: sched?.days ?? null,
        startsAt: sched?.startsAt.toISOString() ?? null,
      },
      notes: hydrated.notes ?? null,
      status: rx.status,
      remindersEnabled: rx.remindersEnabled,
      doctor: rx.doctor,
      nextDoseAt: next?.toISOString() ?? null,
      daysRemaining: remaining,
    };
  });

  // Open reminders = PENDING (sent, awaiting response) and SNOOZED whose
  // `snoozeUntil` has lapsed. EXPIRED rows are skipped — the worker will
  // already have stamped them with status EXPIRED if the patient didn't
  // respond within ~24h (Wave 4 housekeeping).
  const reminders = await prisma.medicationReminderSend.findMany({
    where: {
      clinicId: ctx.clinicId,
      patientId: effectivePatientId,
      OR: [
        { status: "PENDING" },
        { status: "SNOOZED", snoozeUntil: { lte: now } },
      ],
    },
    select: {
      id: true,
      prescriptionId: true,
      scheduledFor: true,
      sentAt: true,
      status: true,
      snoozeUntil: true,
      respondedAt: true,
      prescription: {
        select: { id: true, drugName: true, dosage: true },
      },
    },
    orderBy: { scheduledFor: "asc" },
    take: 30,
  });

  return ok({
    medicationRemindersEnabled: clinic?.medicationRemindersEnabled ?? false,
    timezone: tz,
    prescriptions: prescriptionsWithMeta,
    reminders: reminders.map((r) => ({
      id: r.id,
      prescriptionId: r.prescriptionId,
      drugName: r.prescription.drugName,
      dosage: r.prescription.dosage,
      scheduledFor: r.scheduledFor.toISOString(),
      sentAt: r.sentAt?.toISOString() ?? null,
      status: r.status,
      snoozeUntil: r.snoozeUntil?.toISOString() ?? null,
      respondedAt: r.respondedAt?.toISOString() ?? null,
    })),
  });
});
