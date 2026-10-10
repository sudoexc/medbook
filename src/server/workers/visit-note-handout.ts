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
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { formatDate } from "@/lib/format";
import { followUpDue, formatFollowUpLine } from "@/lib/visit-follow-up";

import { newVerifyToken } from "@/server/clinical-forms/numbering";
import { getQueue } from "@/server/queue";
import { uploadObject } from "@/server/storage/minio";
import { renderConclusionPdf } from "@/server/visit-notes/conclusion-pdf";
import { serializePrescriptionForWrite } from "@/server/prescription/cipher-fields";
import { syncFollowUpAction } from "@/server/visit-notes/follow-up-action";
import {
  STOPPED_BY_NOTE_KEY,
  SUPERSEDED_BY_NOTE_KEY,
  courseMark,
  ownCourseState,
  planCourseSupersede,
  type DrugIdentity,
  type SupersedeCandidate,
} from "@/server/visit-notes/course-supersede";
import { resolveLineDrugIds } from "@/server/visit-notes/legacy-line-drugs";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";
import type { EventEnvelopeInput } from "@/server/realtime/envelope";
import {
  CONCLUSION_BACKFILL_WINDOW_MS,
  hasDeliverableHandout,
} from "@/server/visit-notes/conclusion-delivery";
import { SweepBackoff, logSweepFailure } from "@/server/workers/sweep-backoff";

// Re-exported: the unit tests and older imports reach it through here.
export { hasDeliverableHandout };

export const QUEUE_NAME = "doctor:visit-note-handout";
export const JOB_NAME = "visit-note-handout-tick";

const TICK_INTERVAL_MS = 30 * 1000;
/**
 * Only sweep notes finalized within this window (shared with «Отправить в
 * Telegram», which must know whether a missing PDF is still coming, VW-06).
 */
const BACKFILL_WINDOW_MS = CONCLUSION_BACKFILL_WINDOW_MS;
const BATCH = 25;

// Failed notes wait out a growing delay outside the sweep query, so broken
// rows cannot fill the batch and starve every new note (audit INF-16).
const handoutBackoff = new SweepBackoff();
const bridgeBackoff = new SweepBackoff();

/** Test seam: forget every remembered failure. */
export function __resetSweepBackoffForTests(): void {
  handoutBackoff.clear();
  bridgeBackoff.clear();
}

/** An edit or amendment changes these, and earns the note a fresh start. */
function noteVersion(note: { updatedAt?: Date; handoutStaleAt?: Date | null }): string {
  return `${note.updatedAt?.getTime() ?? ""}:${note.handoutStaleAt?.getTime() ?? ""}`;
}

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
  followUpDate: Date | null;
  // Re-render anchor as swept — used for the conditional clear (see below).
  handoutStaleAt: Date | null;
  // The note's version as read: the PDF is linked to the latest revision
  // only if the note has not moved on since (G1-01).
  updatedAt?: Date;
  // Latest revision (0 or 1 element), the one this render shows.
  revisions?: Array<{
    id: string;
    revision: number;
    pdfObjectKey: string | null;
  }>;
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
    ongoing: boolean;
    instructionRu: string | null;
    instructionUz: string | null;
  }>;
};

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

/**
 * Storage key of one rendered CONCLUSION PDF. Unique per render (audit
 * G1-01): the key used to be one per note and every re-render overwrote the
 * file the patient had already been issued, so the clinic could not produce
 * the signed original. The revision number keeps the bucket readable.
 */
export function conclusionPdfKey(
  clinicId: string,
  noteId: string,
  revision: number | null,
  now: Date,
): string {
  return `clinics/${clinicId}/conclusions/${noteId}/r${revision ?? 0}-${now.getTime()}.pdf`;
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

  // Ф6 — control-visit line: the day the doctor named, or «через N дней»
  // counted from finalizedAt (same rule as the bridge and the print).
  const followUpDueDay = followUpDue(note, note.finalizedAt ?? now, now);
  const followUpLine = followUpDueDay
    ? formatFollowUpLine(followUpDueDay, locale)
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
    verifyUrl,
    followUpLine,
    // Post-window corrections ride along as an appended block — the original
    // handout text above stays exactly as issued.
    amendments: buildPdfAmendments(note.amendments, locale),
    locale,
    generatedAt: now,
    brandColor: clinic?.brandColor ?? null,
  });

  // A new key per render, never an overwrite: the PDF issued before this
  // one (possibly the signed original) must stay readable (G1-01).
  const latest = note.revisions?.[0] ?? null;
  const objectKey = conclusionPdfKey(
    note.clinicId,
    note.id,
    latest?.revision ?? null,
    now,
  );
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
        // Rendered here, not uploaded by anyone: no «От пациента» badge (CD-06).
        source: "SYSTEM",
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
    // G1-01 — link this file to the revision it shows, once. Only when the
    // note is still at the version this render read: an edit that landed
    // mid-render has its own newer revision, which this PDF does not show.
    // Raw SQL for the same reason as the anchor clear below.
    if (latest && !latest.pdfObjectKey && note.updatedAt) {
      await tx.$executeRaw`
        UPDATE "VisitNoteRevision"
        SET "pdfObjectKey" = ${objectKey}
        WHERE "id" = ${latest.id}
          AND "pdfObjectKey" IS NULL
          AND EXISTS (
            SELECT 1 FROM "VisitNote"
            WHERE "id" = ${note.id} AND "updatedAt" = ${note.updatedAt}
          )
      `;
    }
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
    const waiting = handoutBackoff.waiting(now.getTime());
    const notes = (await prisma.visitNote.findMany({
      where: {
        status: "FINALIZED",
        patientHandoutMarkdown: { not: null },
        patient: { deletedAt: null },
        ...(waiting.length > 0 ? { id: { notIn: waiting } } : {}),
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
        followUpDate: true,
        handoutStaleAt: true,
        updatedAt: true,
        revisions: {
          orderBy: { revision: "desc" },
          take: 1,
          select: { id: true, revision: true, pdfObjectKey: true },
        },
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
            ongoing: true,
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
        // A blank first render still matches the query (whitespace passes
        // the not-null filter) and would hold a batch slot on every tick
        // for the whole backfill window. Set it aside; an edit that adds
        // text comes back in at the latest after the longest delay.
        handoutBackoff.park(note.id, noteVersion(note), now.getTime());
        continue;
      }
      try {
        await generateConclusion(note, now);
        generated += 1;
        handoutBackoff.succeed(note.id);
      } catch (err) {
        const attempts = handoutBackoff.fail(note.id, noteVersion(note), now.getTime());
        logSweepFailure("visit-note-handout", `note ${note.id}`, attempts, err);
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
 * regardless of the input array order. A lifelong («постоянно») row has no
 * day count and carries `ongoing: true`, written only then, so every other
 * schedule keeps its exact shape. Pure — unit-tested.
 */
export function buildBridgeSchedule(
  vp: { timesOfDay: string[]; durationDays: number | null; ongoing?: boolean | null },
  slotTimes: Record<string, string>,
  startsAt: Date,
): { times: string[]; days: number | null; startsAt: string; ongoing?: true } {
  const times = SLOT_ORDER.filter((s) => vp.timesOfDay.includes(s)).map(
    (s) => slotTimes[s],
  );
  return {
    times,
    days: vp.ongoing ? null : (vp.durationDays ?? null),
    startsAt: startsAt.toISOString(),
    ...(vp.ongoing ? { ongoing: true as const } : {}),
  };
}

type BridgeNote = {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  finalizedAt: Date | null;
  /**
   * The first signature, never moved by a revert and re-sign: the visit's
   * place among the patient's visits for the supersede pass.
   */
  firstFinalizedAt?: Date | null;
  /** The visit's text prescription lines: they name drugs too. */
  prescriptions?: string[];
  /** The version this pass read; the stamp lands only on it (see below). */
  updatedAt: Date;
  followUpDays: number | null;
  followUpDate: Date | null;
  followUpNote: string | null;
  patient: { fullName: string; preferredLang: string };
  doctor: { nameRu: string } | null;
  visitPrescriptions: Array<{
    /** Catalog drug: a later visit's course of it supersedes this one's. */
    drugId?: string | null;
    displayName: string;
    /** TAB, GEL…: another form of the substance is another course. */
    form?: string | null;
    strength: string | null;
    dose: string;
    timesOfDay: string[];
    durationDays: number | null;
    /** «Постоянно»: the course has no end. */
    ongoing?: boolean;
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
    },
  });
  const slotTimes = resolveSlotTimes(clinic?.medicationSlotTimes);
  const locale = note.patient.preferredLang === "UZ" ? "uz" : "ru";
  const startsAt = note.finalizedAt ?? now;
  // Which visit is newer: the first signature. `finalizedAt` is cleared by a
  // revert and set to «now» by the re-signature, which would make a visit of
  // last Monday newer than Thursday's and complete Thursday's current dose.
  const signedAt = note.firstFinalizedAt ?? note.finalizedAt ?? now;
  const rows = note.visitPrescriptions.filter((vp) => vp.remindPatient);
  // The text lines' catalog drugs, by the print's own matcher: a lifelong
  // course continued as a line «Нормодипин 5 мг» is not stopped.
  const textLines = note.prescriptions ?? [];
  const lineDrugIds =
    textLines.length > 0
      ? await resolveLineDrugIds(textLines, { clinicId: note.clinicId })
      : [];

  const correlationId = newCorrelationId();
  await prisma.$transaction(async (tx) => {
    // Rows the doctor kept, by their bridge key. Anything already bridged for
    // this note and NOT in this set was deleted (or had its reminder switched
    // off) during an in-window correction, and must stop reminding — see the
    // cancellation pass after the upserts.
    const keptSortOrders = new Set(rows.map((vp) => vp.sortOrder));

    // Courses of this patient's OTHER visits, for the supersede pass below
    // and for this note's own rows: every ACTIVE one (a newer visit's too),
    // and the COMPLETED ones this note marked. Read before the upserts,
    // which only touch this note's courses.
    const candidateRows = await tx.prescription.findMany({
      where: {
        clinicId: note.clinicId,
        patientId: note.patientId,
        caseId: null,
        AND: [{ visitNoteId: { not: null } }, { visitNoteId: { not: note.id } }],
        OR: [
          { status: "ACTIVE" },
          {
            status: "COMPLETED",
            schedule: { path: [SUPERSEDED_BY_NOTE_KEY], equals: note.id },
          },
          {
            status: "COMPLETED",
            schedule: { path: [STOPPED_BY_NOTE_KEY], equals: note.id },
          },
        ],
      },
      select: {
        id: true,
        status: true,
        schedule: true,
        drugName: true,
        visitNoteId: true,
        visitNoteSortOrder: true,
        visitNote: {
          select: { firstFinalizedAt: true, finalizedAt: true, doctorId: true },
        },
      },
    });
    let candidates: SupersedeCandidate[] = [];
    if (candidateRows.length > 0) {
      const noteIds = Array.from(
        new Set(candidateRows.map((c) => c.visitNoteId).filter((v): v is string => !!v)),
      );
      const sources = await tx.visitPrescription.findMany({
        where: { visitNoteId: { in: noteIds } },
        select: {
          visitNoteId: true,
          sortOrder: true,
          drugId: true,
          displayName: true,
          form: true,
        },
      });
      const sourceOf = new Map<string, (typeof sources)[number]>(
        sources.map((s) => [`${s.visitNoteId}:${s.sortOrder}`, s]),
      );
      candidates = candidateRows.map((c) => ({
        id: c.id,
        status: c.status,
        schedule: c.schedule,
        drugName: c.drugName,
        noteId: c.visitNoteId ?? "",
        noteDoctorId: c.visitNote?.doctorId ?? null,
        noteSignedAt: c.visitNote
          ? (c.visitNote.firstFinalizedAt ?? c.visitNote.finalizedAt ?? null)
          : null,
        source: sourceOf.get(`${c.visitNoteId}:${c.visitNoteSortOrder}`) ?? null,
      }));
    }

    // Rows whose own course reminds: only they replace an older course of
    // the drug. A row with no time of day (a parsed line «Амлодипин —
    // постоянно») gets a course that never reminds; completing the older
    // reminding one for it would silently end a lifelong drug's reminders.
    const replacing: DrugIdentity[] = [];

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
      if (schedule.times.length > 0) replacing.push(vp);

      const where = {
        visitNoteId_visitNoteSortOrder: {
          visitNoteId: note.id,
          visitNoteSortOrder: vp.sortOrder,
        },
      };
      const existingRow = await tx.prescription.findUnique({
        where,
        select: { id: true, status: true, schedule: true, drugName: true },
      });
      const existing = existingRow;
      // Status and supersede mark of this note's own course: see
      // ownCourseState. The schedule is rewritten on every pass, so a mark
      // another note set must be carried into it, or that note could never
      // bring the course back.
      const own = ownCourseState({
        row: vp,
        existing: existingRow,
        signedAt,
        candidates,
      });
      const storedSchedule = { ...schedule, ...own.mark } as Prisma.InputJsonValue;
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
          schedule: storedSchedule,
          notes,
          status: own.status ?? "ACTIVE",
          remindersEnabled,
        },
        update: {
          drugName: vp.displayName,
          dosage,
          schedule: storedSchedule,
          notes,
          remindersEnabled,
          // Re-activate on re-bridge: a course cancelled by an earlier
          // correction and then restored by the doctor must come back to the
          // patient's dashboard instead of staying invisibly CANCELLED (and
          // a key whose row is now another drug starts that drug over).
          // PAUSED and COMPLETED without our mark are the patient's or
          // reception's business and are left alone.
          ...(own.status ? { status: own.status } : {}),
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
    // A course of this note that a newer note completed (marked) and whose
    // row is now gone: cancelled too. Left COMPLETED with the mark, the
    // newer note would bring it back to ACTIVE once it drops the drug, and
    // the patient would be reminded of a drug neither visit prescribes.
    const markedGone = (
      await tx.prescription.findMany({
        where: {
          visitNoteId: note.id,
          status: "COMPLETED",
          ...(keptSortOrders.size > 0
            ? { visitNoteSortOrder: { notIn: Array.from(keptSortOrders) } }
            : {}),
        },
        select: { id: true, schedule: true },
      })
    ).filter((p) => courseMark(p.schedule) != null);
    if (markedGone.length > 0) {
      await tx.prescription.updateMany({
        where: { id: { in: markedGone.map((p) => p.id) } },
        data: { status: "CANCELLED", remindersEnabled: false },
      });
    }

    // ── Supersede pass (10.10.2026) ──────────────────────────────────────
    // The same drug written again at a later visit replaces the earlier
    // visit's course: a lifelong («постоянно») course re-prescribed at every
    // control visit must not pile up one never-ending reminder per visit,
    // and an old dose must stop reminding once a new one is written. A
    // lifelong course this doctor no longer names stops, as the print says.
    // See course-supersede.ts. Reconciled like the rest of the bridge: a
    // course this note marked comes back if a correction removed the reason.
    if (candidates.length > 0) {
      const plan = planCourseSupersede({
        noteId: note.id,
        signedAt,
        doctorId: note.doctorId,
        replacing,
        rows: note.visitPrescriptions,
        lines: textLines.map((text, i) => ({ text, drugId: lineDrugIds[i] ?? null })),
        candidates,
      });
      for (const c of plan.complete) {
        await tx.prescription.update({
          where: { id: c.id },
          data: { status: "COMPLETED", schedule: c.schedule as Prisma.InputJsonValue },
        });
      }
      for (const c of plan.restore) {
        await tx.prescription.update({
          where: { id: c.id },
          data: { status: "ACTIVE", schedule: c.schedule as Prisma.InputJsonValue },
        });
      }
    }
  });

  // Follow-up reception task, outside the row transaction: it is idempotent
  // via the Action dedupeKey, so a retry converges either way. The same
  // function serves an in-window correction of the plan (the visit-notes
  // PATCH), so the two writers cannot disagree; a plan the doctor cleared
  // before a re-signature retires the task left from the first one.
  await syncFollowUpAction(prisma, note, now);

  // Stamp LAST — anything above failing leaves the note in the sweep.
  //
  // Raw SQL, like the handout anchor above (audit VW-08): `visitNote.update`
  // bumps `updatedAt`, which the conclusion screen's optimistic lock
  // compares. Every in-window prescription fix clears this anchor, the
  // bridge stamped it ~30 s later, and the doctor's NEXT fix of the same
  // conclusion was refused as «изменено в другом окне» and rolled back.
  //
  // Only on the version this pass read: a correction that landed while it
  // ran moved `updatedAt` (and cleared the anchor again), so the stamp
  // matches nothing and the next tick reconciles the newer prescriptions.
  await prisma.$executeRaw`
    UPDATE "VisitNote"
    SET "medicationsBridgedAt" = ${now}
    WHERE "id" = ${note.id} AND "updatedAt" = ${note.updatedAt}
  `;
}

export async function runMedicationBridgeTick(
  now: Date = new Date(),
): Promise<{ scanned: number; bridged: number }> {
  const since = new Date(now.getTime() - BACKFILL_WINDOW_MS);

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const waiting = bridgeBackoff.waiting(now.getTime());
    const notes = (await prisma.visitNote.findMany({
      where: {
        status: "FINALIZED",
        // Safe to keep the backfill bound on the re-bridge path too: the only
        // way `medicationsBridgedAt` goes back to null is an in-window PATCH,
        // and that window is 24h — orders of magnitude inside this 14d bound.
        finalizedAt: { gte: since },
        medicationsBridgedAt: null,
        patient: { deletedAt: null },
        ...(waiting.length > 0 ? { id: { notIn: waiting } } : {}),
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        doctorId: true,
        finalizedAt: true,
        firstFinalizedAt: true,
        updatedAt: true,
        followUpDays: true,
        followUpDate: true,
        followUpNote: true,
        prescriptions: true,
        patient: { select: { fullName: true, preferredLang: true } },
        doctor: { select: { nameRu: true } },
        visitPrescriptions: {
          orderBy: { sortOrder: "asc" },
          select: {
            drugId: true,
            displayName: true,
            form: true,
            strength: true,
            dose: true,
            timesOfDay: true,
            durationDays: true,
            ongoing: true,
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
        bridgeBackoff.succeed(note.id);
      } catch (err) {
        const attempts = bridgeBackoff.fail(note.id, noteVersion(note), now.getTime());
        logSweepFailure("medication-bridge", `note ${note.id}`, attempts, err);
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
