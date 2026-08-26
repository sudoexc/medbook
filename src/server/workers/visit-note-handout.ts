/**
 * P1.1 — Visit-note CONCLUSION delivery worker.
 *
 * When a doctor finalises a visit note, the patient-facing handout must reach
 * the Mini App as a downloadable CONCLUSION document. The TZ phrases this as a
 * consumer of the `visit-note.finalized` event, but the realtime bus
 * (`event-bus.ts`) is best-effort, per-clinic, and swallows handler errors —
 * a fine fit for ephemeral SSE refreshes, a poor one for *guaranteeing* a
 * clinical artifact. A dropped event (worker restart, handler throw) would
 * silently deny the patient their conclusion with no recovery path.
 *
 * So we make it durable: a periodic sweep over FINALIZED notes that still lack
 * a CONCLUSION document. Idempotency is anchored on `Document.visitNoteId`
 * (@unique) — a re-run, a redeploy, or two overlapping ticks all converge on a
 * single upsert. This mirrors the `post-visit-nps` / `appointment-lifecycle`
 * sweep precedent and is adapter-agnostic (the in-memory queue can't carry a
 * cross-process enqueue from the API route anyway).
 *
 * Latency is the sweep interval (30s) instead of the event's ~200ms. For a
 * document the patient reads after leaving the clinic that is imperceptible,
 * and the durability guarantee is worth far more than the saved seconds.
 *
 * Hard rule: only `patientHandoutMarkdown` is ever rendered. The clinical
 * `bodyMarkdown` must never reach the patient.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { formatDate } from "@/lib/format";

import { newVerifyToken } from "@/server/clinical-forms/numbering";
import { getQueue } from "@/server/queue";
import { uploadObject } from "@/server/storage/minio";
import { renderConclusionPdf } from "@/server/visit-notes/conclusion-pdf";
import { serializePrescriptionForWrite } from "@/server/prescription/cipher-fields";
import { upsertAction } from "@/server/actions/repository";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";

export const QUEUE_NAME = "doctor:visit-note-handout";
export const JOB_NAME = "visit-note-handout-tick";

const TICK_INTERVAL_MS = 30 * 1000;
/**
 * Only sweep notes finalized within this window. Bounds the one-time backfill
 * when the feature first ships (so we don't render the clinic's entire history
 * at once) while staying generous enough to catch up after a worker outage.
 */
const BACKFILL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const BATCH = 25;

type SweepAmendment = {
  reason: string;
  text: string;
  createdAt: Date;
  doctor: { nameRu: string; nameUz: string } | null;
};

type SweepNote = {
  id: string;
  clinicId: string;
  patientId: string;
  appointmentId: string | null;
  status: string;
  patientHandoutMarkdown: string | null;
  documentNumber: string | null;
  finalizedAt: Date | null;
  followUpDays: number | null;
  // Re-render anchor as swept — used for the conditional clear (see below).
  handoutStaleAt: Date | null;
  amendments: SweepAmendment[];
  patient: { fullName: string; preferredLang: string };
  doctor: { nameRu: string; nameUz: string } | null;
  appointment: { date: Date; time: string | null } | null;
  visitPrescriptions: Array<{
    displayName: string;
    strength: string | null;
    dose: string;
    timesOfDay: string[];
    mealRelation: string;
    durationDays: number | null;
    instructionRu: string | null;
    instructionUz: string | null;
  }>;
};

/**
 * Pure predicate — does this note carry a handout we can deliver right now?
 * Exported so the unit test can assert the never-bodyMarkdown / skip-empty
 * rules without a database.
 */
export function hasDeliverableHandout(note: {
  status: string;
  patientHandoutMarkdown: string | null;
}): boolean {
  if (note.status !== "FINALIZED") return false;
  return Boolean(note.patientHandoutMarkdown?.trim());
}

/**
 * Map amendment rows to the presentation shape the PDF renderer consumes.
 * Pure (exported for unit tests): the renderer must stay ignorant of Prisma
 * shapes, and the locale pick (nameRu/nameUz) is easy to get subtly wrong.
 */
export function buildPdfAmendments(
  amendments: SweepAmendment[],
  locale: "ru" | "uz",
): Array<{
  dateLabel: string;
  doctorName: string | null;
  reason: string;
  text: string;
}> {
  return amendments.map((a) => ({
    dateLabel: `${formatDate(a.createdAt, locale, "short")} ${formatDate(a.createdAt, locale, "time")}`,
    doctorName: a.doctor
      ? locale === "uz"
        ? a.doctor.nameUz
        : a.doctor.nameRu
      : null,
    reason: a.reason,
    text: a.text,
  }));
}

async function generateConclusion(note: SweepNote, now: Date): Promise<void> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: note.clinicId },
    select: {
      nameRu: true,
      nameUz: true,
      addressRu: true,
      addressUz: true,
      phone: true,
      brandColor: true,
    },
  });

  const locale: "ru" | "uz" = note.patient.preferredLang === "UZ" ? "uz" : "ru";
  const clinicName = clinic
    ? locale === "uz"
      ? clinic.nameUz
      : clinic.nameRu
    : "—";
  const clinicAddress = clinic
    ? locale === "uz"
      ? clinic.addressUz
      : clinic.addressRu
    : null;
  const doctorName = note.doctor
    ? locale === "uz"
      ? note.doctor.nameUz
      : note.doctor.nameRu
    : null;

  const visitDate = note.appointment?.date ?? note.finalizedAt ?? now;
  const visitDateLabel =
    formatDate(visitDate, locale, "short") +
    (note.appointment?.time ? ` · ${note.appointment.time}` : "");

  // Ф5 — QR verification. Preserve an already-issued token (a printed QR
  // must survive re-renders); mint one only when the document has none yet.
  const existing = await prisma.document.findUnique({
    where: { visitNoteId: note.id },
    select: { verifyToken: true },
  });
  const verifyToken = existing?.verifyToken ?? newVerifyToken();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  const verifyUrl = baseUrl ? `${baseUrl}/v/${verifyToken}` : null;

  // Ф6 — control-visit line, anchored on finalizedAt (same as the bridge).
  const followUpLine =
    note.followUpDays != null && note.followUpDays > 0
      ? (() => {
          const due = new Date(
            (note.finalizedAt ?? now).getTime() +
              note.followUpDays * 24 * 60 * 60 * 1000,
          );
          const dateStr = formatDate(due, locale, "short");
          return locale === "uz"
            ? `${note.followUpDays} kundan keyin · ≈ ${dateStr}`
            : `через ${note.followUpDays} дн. · ≈ ${dateStr}`;
        })()
      : null;

  const pdf = await renderConclusionPdf({
    clinicName,
    clinicAddress,
    clinicPhone: clinic?.phone ?? null,
    doctorName,
    patientName: note.patient.fullName,
    visitDateLabel,
    documentNumber: note.documentNumber,
    handoutMarkdown: note.patientHandoutMarkdown ?? "",
    prescriptions: note.visitPrescriptions,
    verifyUrl,
    followUpLine,
    // Post-window corrections ride along as an appended block — the original
    // handout text above stays exactly as issued.
    amendments: buildPdfAmendments(note.amendments, locale),
    locale,
    generatedAt: now,
    brandColor: clinic?.brandColor ?? null,
  });

  // Stable key (per note) so a re-render overwrites in place rather than
  // littering MinIO with orphans.
  const objectKey = `clinics/${note.clinicId}/conclusions/${note.id}.pdf`;
  const uploaded = await uploadObject(undefined, objectKey, pdf, "application/pdf");

  const title =
    locale === "uz"
      ? `Xulosa — ${formatDate(visitDate, "uz", "short")}`
      : `Заключение от ${formatDate(visitDate, "ru", "short")}`;

  // Upsert on the @unique visitNoteId — the idempotency anchor. verifyToken
  // is either the preserved existing one or the freshly-minted one embedded
  // in this very PDF, so update never invalidates a printed QR.
  await prisma.$transaction(async (tx) => {
    const doc = await tx.document.upsert({
      where: { visitNoteId: note.id },
      create: {
        clinicId: note.clinicId,
        patientId: note.patientId,
        appointmentId: note.appointmentId,
        visitNoteId: note.id,
        type: "CONCLUSION",
        title,
        number: note.documentNumber,
        verifyToken,
        fileUrl: uploaded.url,
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
        uploadedById: null,
      },
      update: {
        fileUrl: uploaded.url,
        title,
        number: note.documentNumber,
        verifyToken,
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
      },
      select: { id: true },
    });
    // Refresh the patient's Mini App /documents list once the PDF exists.
    await publishViaOutbox(tx, {
      correlationId: newCorrelationId(),
      actor: {
        role: "SYSTEM",
        userId: null,
        patientId: null,
        onBehalfOfPatientId: null,
        label: "system:visit-note-handout",
      },
      surface: "WORKER",
      tenantScope: { clinicId: note.clinicId, patientId: note.patientId },
      type: "document.created",
      payload: {
        documentId: doc.id,
        patientId: note.patientId,
        documentType: "CONCLUSION",
      },
    });
    // Convergence: clear the stale anchor ONLY when it still holds the value
    // we swept. An edit landing mid-render bumps the stamp, this UPDATE then
    // matches zero rows, and the next tick re-renders with the newer text.
    // Raw SQL on purpose: prisma.update would also bump `updatedAt`, which
    // the editor's optimistic lock compares against — a background render
    // must never make the doctor's open window 409 with "changed elsewhere".
    if (note.handoutStaleAt != null) {
      await tx.$executeRaw`
        UPDATE "VisitNote"
        SET "handoutStaleAt" = NULL
        WHERE "id" = ${note.id} AND "handoutStaleAt" = ${note.handoutStaleAt}
      `;
    }
  });
}

export async function runVisitNoteHandoutTick(
  now: Date = new Date(),
): Promise<{ scanned: number; generated: number }> {
  const since = new Date(now.getTime() - BACKFILL_WINDOW_MS);

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const notes = (await prisma.visitNote.findMany({
      where: {
        status: "FINALIZED",
        patientHandoutMarkdown: { not: null },
        patient: { deletedAt: null },
        // Two roads into the sweep, each with its own convergence anchor:
        //  - first render: no CONCLUSION document yet. Bounded by the
        //    backfill window so the feature's first deploy doesn't render the
        //    clinic's whole history at once.
        //  - re-render: `handoutStaleAt` set (in-window edit or amendment).
        //    Deliberately NOT window-bounded — an amendment can arrive months
        //    after the visit and must still reach the patient's PDF.
        OR: [
          { conclusionDocument: { is: null }, finalizedAt: { gte: since } },
          { handoutStaleAt: { not: null } },
        ],
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        appointmentId: true,
        status: true,
        patientHandoutMarkdown: true,
        documentNumber: true,
        finalizedAt: true,
        followUpDays: true,
        handoutStaleAt: true,
        amendments: {
          orderBy: { createdAt: "asc" },
          select: {
            reason: true,
            text: true,
            createdAt: true,
            doctor: { select: { nameRu: true, nameUz: true } },
          },
        },
        patient: { select: { fullName: true, preferredLang: true } },
        doctor: { select: { nameRu: true, nameUz: true } },
        appointment: { select: { date: true, time: true } },
        visitPrescriptions: {
          orderBy: { sortOrder: "asc" },
          select: {
            displayName: true,
            strength: true,
            dose: true,
            timesOfDay: true,
            mealRelation: true,
            durationDays: true,
            instructionRu: true,
            instructionUz: true,
          },
        },
      },
      orderBy: { finalizedAt: "asc" },
      take: BATCH,
    })) as SweepNote[];

    let generated = 0;
    for (const note of notes) {
      // Defence in depth: the query filters non-null, but an all-whitespace
      // handout still must be skipped — and bodyMarkdown is never even loaded.
      if (!hasDeliverableHandout(note)) {
        // A stale mark on a note whose handout is now blank can never render.
        // Clear it (same conditional raw-SQL clear as after a successful
        // render) so the sweep converges instead of re-scanning the row every
        // tick — 25 such rows would otherwise starve the whole batch. The
        // already-issued PDF, if any, stays untouched.
        if (note.handoutStaleAt != null) {
          try {
            await prisma.$executeRaw`
              UPDATE "VisitNote"
              SET "handoutStaleAt" = NULL
              WHERE "id" = ${note.id} AND "handoutStaleAt" = ${note.handoutStaleAt}
            `;
          } catch (err) {
            console.error(
              `[visit-note-handout] stale clear for ${note.id} failed`,
              err,
            );
          }
        }
        continue;
      }
      try {
        await generateConclusion(note, now);
        generated += 1;
      } catch (err) {
        console.error(`[visit-note-handout] note ${note.id} failed`, err);
      }
    }

    return { scanned: notes.length, generated };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Ф6 (TZ-smart-constructor) — мост finalize → Mini App.
//
// Mirrors VisitPrescription rows with `remindPatient=true` into the existing
// `Prescription` model so the Mini App medication dashboard + reminder worker
// pick them up with zero reception effort. Same durable-sweep rationale as
// the handout above, but with its own convergence anchor
// (`VisitNote.medicationsBridgedAt IS NULL`) because the handout anchor
// requires a non-empty handout — a note can carry prescriptions without one.
//
// Row idempotency is the `@@unique([visitNoteId, visitNoteSortOrder])` upsert;
// the follow-up Action dedupes on `visitNoteId`; so a partial failure simply
// re-runs to convergence on the next tick.
//
// The sweep is a RECONCILER, not a one-shot: PATCH clears
// `medicationsBridgedAt` whenever an in-window correction actually changed the
// prescriptions, which puts the note back here. Each pass makes the patient's
// live courses match the note exactly — surviving rows are updated in place,
// withdrawn ones are CANCELLED (never deleted: that would cascade away the
// patient's reminder-response history).
// ─────────────────────────────────────────────────────────────────────────────

/** Clinic-overridable slot → clock mapping (TZ Ф6 defaults). */
export const DEFAULT_SLOT_TIMES: Readonly<Record<string, string>> = {
  MORNING: "08:00",
  NOON: "13:00",
  EVENING: "19:00",
  NIGHT: "22:00",
};

const SLOT_ORDER = ["MORNING", "NOON", "EVENING", "NIGHT"] as const;

/**
 * Merge `Clinic.medicationSlotTimes` (Json, may be partial/garbage) over the
 * defaults. Pure — unit-tested without a database.
 */
export function resolveSlotTimes(raw: unknown): Record<string, string> {
  const out: Record<string, string> = { ...DEFAULT_SLOT_TIMES };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const slot of SLOT_ORDER) {
    const v = (raw as Record<string, unknown>)[slot];
    if (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) {
      out[slot] = v;
    }
  }
  return out;
}

/**
 * Translate a VisitPrescription's slots into the reminder-worker schedule
 * shape `{times, days, startsAt}`. Slot order is canonical (morning→night)
 * regardless of the input array order. Pure — unit-tested.
 */
export function buildBridgeSchedule(
  vp: { timesOfDay: string[]; durationDays: number | null },
  slotTimes: Record<string, string>,
  startsAt: Date,
): { times: string[]; days: number | null; startsAt: string } {
  const times = SLOT_ORDER.filter((s) => vp.timesOfDay.includes(s)).map(
    (s) => slotTimes[s],
  );
  return {
    times,
    days: vp.durationDays ?? null,
    startsAt: startsAt.toISOString(),
  };
}

/** Clinic-local YYYY-MM-DD for the follow-up due date. */
function localDateKey(d: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

type BridgeNote = {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  finalizedAt: Date | null;
  followUpDays: number | null;
  followUpNote: string | null;
  patient: { fullName: string; preferredLang: string };
  doctor: { nameRu: string } | null;
  visitPrescriptions: Array<{
    displayName: string;
    strength: string | null;
    dose: string;
    timesOfDay: string[];
    durationDays: number | null;
    instructionRu: string | null;
    instructionUz: string | null;
    remindPatient: boolean;
    sortOrder: number;
  }>;
};

async function bridgeNote(note: BridgeNote, now: Date): Promise<void> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: note.clinicId },
    select: {
      medicationRemindersEnabled: true,
      medicationSlotTimes: true,
      timezone: true,
    },
  });
  const slotTimes = resolveSlotTimes(clinic?.medicationSlotTimes);
  const locale = note.patient.preferredLang === "UZ" ? "uz" : "ru";
  const startsAt = note.finalizedAt ?? now;
  const rows = note.visitPrescriptions.filter((vp) => vp.remindPatient);

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    // Rows the doctor kept, by their bridge key. Anything already bridged for
    // this note and NOT in this set was deleted (or had its reminder switched
    // off) during an in-window correction, and must stop reminding — see the
    // cancellation pass after the upserts.
    const keptSortOrders = new Set(rows.map((vp) => vp.sortOrder));

    for (const vp of rows) {
      const schedule = buildBridgeSchedule(vp, slotTimes, startsAt);
      const dosage = vp.strength ? `${vp.dose} (${vp.strength})` : vp.dose;
      const instruction =
        locale === "uz"
          ? (vp.instructionUz ?? vp.instructionRu)
          : (vp.instructionRu ?? vp.instructionUz);
      // Same encryption boundary as the CRM prescribe kernel — notes are
      // PII-adjacent free text and must be ciphered at rest.
      const { notes } = serializePrescriptionForWrite({
        notes: instruction ?? null,
      });
      const remindersEnabled =
        Boolean(clinic?.medicationRemindersEnabled) && schedule.times.length > 0;

      const where = {
        visitNoteId_visitNoteSortOrder: {
          visitNoteId: note.id,
          visitNoteSortOrder: vp.sortOrder,
        },
      };
      const existingRow = await tx.prescription.findUnique({
        where,
        select: { id: true, status: true },
      });
      const existing = existingRow;
      const row = await tx.prescription.upsert({
        where,
        create: {
          clinicId: note.clinicId,
          caseId: null,
          visitNoteId: note.id,
          visitNoteSortOrder: vp.sortOrder,
          patientId: note.patientId,
          doctorId: note.doctorId,
          drugName: vp.displayName,
          dosage,
          schedule,
          notes,
          status: "ACTIVE",
          remindersEnabled,
        },
        update: {
          drugName: vp.displayName,
          dosage,
          schedule,
          notes,
          remindersEnabled,
          // Re-activate on re-bridge: a course cancelled by an earlier
          // correction and then restored by the doctor must come back to the
          // patient's dashboard instead of staying invisibly CANCELLED.
          // COMPLETED/PAUSED are the patient's or reception's business and are
          // left alone — only our own cancellation is reversed.
          ...(existingRow?.status === "CANCELLED"
            ? { status: "ACTIVE" }
            : {}),
        },
      });

      // Only freshly-created rows announce themselves — re-runs after a
      // partial failure shouldn't re-spam the Mini App invalidation.
      if (!existing) {
        const envelope: EventEnvelopeInput = {
          type: "prescription.created",
          correlationId,
          actor: {
            role: "SYSTEM",
            userId: null,
            patientId: null,
            onBehalfOfPatientId: null,
            label: "system:medication-bridge",
          },
          surface: "WORKER",
          tenantScope: {
            clinicId: note.clinicId,
            doctorId: note.doctorId,
            patientId: note.patientId,
          },
          payload: {
            prescriptionId: row.id,
            patientId: note.patientId,
            doctorId: note.doctorId,
            caseId: null,
            drugName: row.drugName,
            dosage: row.dosage,
            remindersEnabled: row.remindersEnabled,
            status: row.status,
          },
        };
        await publishViaOutbox(tx, envelope);
      }
    }

    // ── Withdrawal pass ──────────────────────────────────────────────────
    // Courses previously bridged from this note that the doctor has since
    // deleted, or whose «напоминать» flag they switched off. Leaving them
    // ACTIVE is the dangerous outcome: the patient would keep being reminded
    // to take a drug that is no longer prescribed.
    //
    // CANCELLED, never deleted. Two reasons, both load-bearing:
    //   1. `MedicationReminderSend` cascades on Prescription delete — deleting
    //      would erase the patient's own «принял / пропустил» answers, which
    //      are clinical history and not ours to rewrite.
    //   2. The Mini App lists only ACTIVE/PAUSED, so CANCELLED disappears from
    //      the patient's dashboard exactly as intended, and the reminder
    //      worker (status: "ACTIVE") stops scheduling new ticks.
    // Already-sent reminders are therefore untouched: they stay as the record
    // of what the patient was actually told at the time.
    const staleWhere = {
      visitNoteId: note.id,
      status: { in: ["ACTIVE", "PAUSED"] },
      ...(keptSortOrders.size > 0
        ? { visitNoteSortOrder: { notIn: Array.from(keptSortOrders) } }
        : {}),
    };
    await tx.prescription.updateMany({
      where: staleWhere as never,
      data: { status: "CANCELLED", remindersEnabled: false },
    });
  });

  // Follow-up reception task — idempotent via the Action dedupeKey, so it
  // lives outside the row transaction (a retry converges either way).
  if (note.followUpDays != null && note.followUpDays > 0) {
    const due = new Date(
      startsAt.getTime() + note.followUpDays * 24 * 60 * 60 * 1000,
    );
    const dueDate = localDateKey(due, clinic?.timezone || "Asia/Tashkent");
    await upsertAction(
      prisma,
      note.clinicId,
      {
        type: "VISIT_FOLLOW_UP_DUE",
        visitNoteId: note.id,
        patientId: note.patientId,
        patientName: note.patient.fullName,
        doctorId: note.doctorId,
        doctorName: note.doctor?.nameRu ?? "—",
        dueDate,
        followUpNote: note.followUpNote?.trim() ?? "",
      },
      {
        deeplinkPath: `/crm/patients/${note.patientId}`,
        // Keep the card around for a week past due, then auto-expire.
        expiresAt: new Date(due.getTime() + 7 * 24 * 60 * 60 * 1000),
      },
    );
  }

  // Stamp LAST — anything above failing leaves the note in the sweep.
  await prisma.visitNote.update({
    where: { id: note.id },
    data: { medicationsBridgedAt: now },
  });
}

export async function runMedicationBridgeTick(
  now: Date = new Date(),
): Promise<{ scanned: number; bridged: number }> {
  const since = new Date(now.getTime() - BACKFILL_WINDOW_MS);

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const notes = (await prisma.visitNote.findMany({
      where: {
        status: "FINALIZED",
        // Safe to keep the backfill bound on the re-bridge path too: the only
        // way `medicationsBridgedAt` goes back to null is an in-window PATCH,
        // and that window is 24h — orders of magnitude inside this 14d bound.
        finalizedAt: { gte: since },
        medicationsBridgedAt: null,
        patient: { deletedAt: null },
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        doctorId: true,
        finalizedAt: true,
        followUpDays: true,
        followUpNote: true,
        patient: { select: { fullName: true, preferredLang: true } },
        doctor: { select: { nameRu: true } },
        visitPrescriptions: {
          orderBy: { sortOrder: "asc" },
          select: {
            displayName: true,
            strength: true,
            dose: true,
            timesOfDay: true,
            durationDays: true,
            instructionRu: true,
            instructionUz: true,
            remindPatient: true,
            sortOrder: true,
          },
        },
      },
      orderBy: { finalizedAt: "asc" },
      take: BATCH,
    })) as BridgeNote[];

    let bridged = 0;
    for (const note of notes) {
      try {
        await bridgeNote(note, now);
        bridged += 1;
      } catch (err) {
        console.error(`[medication-bridge] note ${note.id} failed`, err);
      }
    }

    return { scanned: notes.length, bridged };
  });
}

/** Start the worker (idempotent). */
export function startVisitNoteHandoutWorker(
  intervalMs: number = TICK_INTERVAL_MS,
): { stop: () => void } {
  const queue = getQueue();
  queue.registerWorker<Record<string, never>>(
    QUEUE_NAME,
    JOB_NAME,
    async () => {
      try {
        await runVisitNoteHandoutTick();
      } catch (err) {
        console.error("[visit-note-handout] tick failed", err);
      }
      try {
        await runMedicationBridgeTick();
      } catch (err) {
        console.error("[medication-bridge] tick failed", err);
      }
    },
  );
  const handle = queue.repeat(QUEUE_NAME, JOB_NAME, {} as never, intervalMs);
  console.info("[worker] visit-note-handout registered");
  return handle;
}

export { runVisitNoteHandoutTick as _runForTests };
