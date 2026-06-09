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

import { getQueue } from "@/server/queue";
import { uploadObject } from "@/server/storage/minio";
import { renderConclusionPdf } from "@/server/visit-notes/conclusion-pdf";

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

type SweepNote = {
  id: string;
  clinicId: string;
  patientId: string;
  appointmentId: string | null;
  status: string;
  patientHandoutMarkdown: string | null;
  finalizedAt: Date | null;
  patient: { fullName: string; preferredLang: string };
  doctor: { nameRu: string; nameUz: string } | null;
  appointment: { date: Date; time: string | null } | null;
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

  const pdf = await renderConclusionPdf({
    clinicName,
    clinicAddress,
    clinicPhone: clinic?.phone ?? null,
    doctorName,
    patientName: note.patient.fullName,
    visitDateLabel,
    handoutMarkdown: note.patientHandoutMarkdown ?? "",
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

  // Upsert on the @unique visitNoteId — the idempotency anchor.
  await prisma.document.upsert({
    where: { visitNoteId: note.id },
    create: {
      clinicId: note.clinicId,
      patientId: note.patientId,
      appointmentId: note.appointmentId,
      visitNoteId: note.id,
      type: "CONCLUSION",
      title,
      fileUrl: uploaded.url,
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
      uploadedById: null,
    },
    update: {
      fileUrl: uploaded.url,
      title,
      mimeType: "application/pdf",
      sizeBytes: pdf.length,
    },
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
        finalizedAt: { gte: since },
        // No conclusion document yet — this is what makes the sweep converge.
        conclusionDocument: { is: null },
        patientHandoutMarkdown: { not: null },
        patient: { deletedAt: null },
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        appointmentId: true,
        status: true,
        patientHandoutMarkdown: true,
        finalizedAt: true,
        patient: { select: { fullName: true, preferredLang: true } },
        doctor: { select: { nameRu: true, nameUz: true } },
        appointment: { select: { date: true, time: true } },
      },
      orderBy: { finalizedAt: "asc" },
      take: BATCH,
    })) as SweepNote[];

    let generated = 0;
    for (const note of notes) {
      // Defence in depth: the query filters non-null, but an all-whitespace
      // handout still must be skipped — and bodyMarkdown is never even loaded.
      if (!hasDeliverableHandout(note)) continue;
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
    },
  );
  const handle = queue.repeat(QUEUE_NAME, JOB_NAME, {} as never, intervalMs);
  console.info("[worker] visit-note-handout registered");
  return handle;
}

export { runVisitNoteHandoutTick as _runForTests };
