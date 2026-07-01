/**
 * P2.1 — Referral (направление) → REFERRAL Document delivery worker.
 *
 * Same durability rationale as the P1.1 visit-note handout worker: the
 * `referral.created` SSE event is best-effort, but the patient's referral PDF
 * is a clinical artifact that must not be lost to a worker restart or a dropped
 * event. So we make it durable — a periodic sweep over referrals that still
 * lack their REFERRAL Document, anchored on `Document.referralId` (@unique) so
 * a re-run / redeploy / two overlapping ticks all converge on a single upsert.
 *
 * Latency is the sweep interval (30s); for a document the patient carries to
 * the next clinic that is imperceptible against the durability guarantee.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { formatDate } from "@/lib/format";

import { newVerifyToken } from "@/server/clinical-forms/numbering";
import { getQueue } from "@/server/queue";
import { uploadObject } from "@/server/storage/minio";
import { renderReferralPdf } from "@/server/referrals/referral-pdf";
import { newCorrelationId, publishViaOutbox } from "@/server/realtime/outbox";

export const QUEUE_NAME = "doctor:referral-document";
export const JOB_NAME = "referral-document-tick";

const TICK_INTERVAL_MS = 30 * 1000;
/**
 * Bounds the one-time backfill when the feature ships (don't render the
 * clinic's whole referral history at once) while staying generous enough to
 * catch up after a worker outage.
 */
const BACKFILL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const BATCH = 25;

type DoctorName = { name: string; doctor: { nameRu: string; nameUz: string } | null };

type SweepReferral = {
  id: string;
  clinicId: string;
  patientId: string;
  toDoctorId: string | null;
  externalTo: string | null;
  reason: string;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  createdAt: Date;
  patient: { fullName: string; preferredLang: string };
  fromDoctor: DoctorName;
  toDoctor: DoctorName | null;
};

function localizedDoctorName(d: DoctorName | null, locale: "ru" | "uz"): string | null {
  if (!d) return null;
  if (d.doctor) return locale === "uz" ? d.doctor.nameUz : d.doctor.nameRu;
  return d.name;
}

async function generateReferralDocument(
  ref: SweepReferral,
  now: Date,
): Promise<void> {
  const clinic = await prisma.clinic.findUnique({
    where: { id: ref.clinicId },
    select: {
      nameRu: true,
      nameUz: true,
      addressRu: true,
      addressUz: true,
      phone: true,
      brandColor: true,
    },
  });

  const locale: "ru" | "uz" = ref.patient.preferredLang === "UZ" ? "uz" : "ru";
  const clinicName = clinic ? (locale === "uz" ? clinic.nameUz : clinic.nameRu) : "—";
  const clinicAddress = clinic
    ? locale === "uz"
      ? clinic.addressUz
      : clinic.addressRu
    : null;
  const fromDoctorName = localizedDoctorName(ref.fromDoctor, locale);
  // Internal hand-off → colleague's localized name; external → free text.
  const toLabel =
    localizedDoctorName(ref.toDoctor, locale) ?? ref.externalTo ?? "—";

  const dateLabel = formatDate(ref.createdAt, locale, "short");

  // Ф5 — QR verification. Preserve an already-issued token (a printed QR
  // must survive re-renders); mint one only when the document has none yet.
  const existing = await prisma.document.findUnique({
    where: { referralId: ref.id },
    select: { verifyToken: true },
  });
  const verifyToken = existing?.verifyToken ?? newVerifyToken();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  const verifyUrl = baseUrl ? `${baseUrl}/v/${verifyToken}` : null;

  const pdf = await renderReferralPdf({
    clinicName,
    clinicAddress,
    clinicPhone: clinic?.phone ?? null,
    fromDoctorName,
    toLabel,
    patientName: ref.patient.fullName,
    dateLabel,
    diagnosisCode: ref.diagnosisCode,
    diagnosisName: ref.diagnosisName,
    reason: ref.reason,
    verifyUrl,
    locale,
    generatedAt: now,
    brandColor: clinic?.brandColor ?? null,
  });

  // Stable per-referral key so a re-render overwrites in place.
  const objectKey = `clinics/${ref.clinicId}/referrals/${ref.id}.pdf`;
  const uploaded = await uploadObject(undefined, objectKey, pdf, "application/pdf");

  const title =
    locale === "uz"
      ? `Yo‘llanma — ${dateLabel}`
      : `Направление от ${dateLabel}`;

  // Upsert on the @unique referralId — the idempotency anchor. verifyToken
  // is either the preserved existing one or the freshly-minted one embedded
  // in this very PDF, so update never invalidates a printed QR.
  await prisma.$transaction(async (tx) => {
    const doc = await tx.document.upsert({
      where: { referralId: ref.id },
      create: {
        clinicId: ref.clinicId,
        patientId: ref.patientId,
        referralId: ref.id,
        type: "REFERRAL",
        title,
        verifyToken,
        fileUrl: uploaded.url,
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
        uploadedById: null,
      },
      update: {
        fileUrl: uploaded.url,
        title,
        verifyToken,
        mimeType: "application/pdf",
        sizeBytes: pdf.length,
      },
      select: { id: true },
    });
    // Refresh the patient's Mini App /documents list once the PDF exists —
    // `referral.created` fires earlier (at referral POST), before the render.
    await publishViaOutbox(tx, {
      correlationId: newCorrelationId(),
      actor: {
        role: "SYSTEM",
        userId: null,
        patientId: null,
        onBehalfOfPatientId: null,
        label: "system:referral-document",
      },
      surface: "WORKER",
      tenantScope: { clinicId: ref.clinicId, patientId: ref.patientId },
      type: "document.created",
      payload: {
        documentId: doc.id,
        patientId: ref.patientId,
        documentType: "REFERRAL",
      },
    });
  });
}

export async function runReferralDocumentTick(
  now: Date = new Date(),
): Promise<{ scanned: number; generated: number }> {
  const since = new Date(now.getTime() - BACKFILL_WINDOW_MS);

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const referrals = (await prisma.referral.findMany({
      where: {
        createdAt: { gte: since },
        // No referral document yet — what makes the sweep converge.
        document: { is: null },
        patient: { deletedAt: null },
      },
      select: {
        id: true,
        clinicId: true,
        patientId: true,
        toDoctorId: true,
        externalTo: true,
        reason: true,
        diagnosisCode: true,
        diagnosisName: true,
        createdAt: true,
        patient: { select: { fullName: true, preferredLang: true } },
        fromDoctor: {
          select: { name: true, doctor: { select: { nameRu: true, nameUz: true } } },
        },
        toDoctor: {
          select: { name: true, doctor: { select: { nameRu: true, nameUz: true } } },
        },
      },
      orderBy: { createdAt: "asc" },
      take: BATCH,
    })) as SweepReferral[];

    let generated = 0;
    for (const ref of referrals) {
      try {
        await generateReferralDocument(ref, now);
        generated += 1;
      } catch (err) {
        console.error(`[referral-document] referral ${ref.id} failed`, err);
      }
    }

    return { scanned: referrals.length, generated };
  });
}

/** Start the worker (idempotent). */
export function startReferralDocumentWorker(
  intervalMs: number = TICK_INTERVAL_MS,
): { stop: () => void } {
  const queue = getQueue();
  queue.registerWorker<Record<string, never>>(QUEUE_NAME, JOB_NAME, async () => {
    try {
      await runReferralDocumentTick();
    } catch (err) {
      console.error("[referral-document] tick failed", err);
    }
  });
  const handle = queue.repeat(QUEUE_NAME, JOB_NAME, {} as never, intervalMs);
  console.info("[worker] referral-document registered");
  return handle;
}

export { runReferralDocumentTick as _runForTests };
