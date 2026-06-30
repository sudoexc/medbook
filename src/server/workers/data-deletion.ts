/**
 * Phase 17 Wave 3 — DSAR data-deletion executor + cron.
 *
 * The cron runs hourly under runWithTenant({ kind: "SYSTEM" }):
 *
 *   1. Find every DataDeletionJob with status=APPROVED and
 *      scheduledFor <= now. Order oldest-first to bound batch size.
 *   2. For each job:
 *        - HARD_DELETE — `prisma.patient.delete({ where: { id } })`. The
 *          schema FKs cascade Appointment/Payment/PatientReview/etc;
 *          PatientFamily rows are also cascaded. Audit
 *          PATIENT_HARD_DELETED with the full pre-delete snapshot.
 *        - ANONYMIZE — apply `buildAnonymizationPayload(jobId, now)`
 *          via Prisma update, then `scrubPatientPhiCarriers` to erase the
 *          free-text PHI that lives off-row (medical-case SOAP drafts,
 *          appointment notes, chat message bodies, review comments). Audit
 *          PATIENT_ANONYMIZED with forensic snapshot in `meta.before`.
 *      Then mark the job EXECUTED (HARD) / ANONYMIZED (soft).
 *   3. Errors are logged + the job is left at APPROVED so a future tick
 *      retries it; the cron is therefore self-healing for transient
 *      failures.
 *
 * The cron also expires READY/DELIVERED export jobs whose `expiresAt`
 * has passed: status flips to EXPIRED and (best-effort) the MinIO
 * object is deleted. Bundled here so we don't need a second scheduler.
 */

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { AUDIT_ACTION } from "@/lib/audit-actions";

import { getQueue } from "@/server/queue";
import { deleteObject } from "@/server/storage/minio";

import {
  buildAnonymizationPayload,
  snapshotForensicFields,
} from "@/server/dsar/anonymize";
import { hydratePatientForRead } from "@/server/patient/cipher-fields";

const EXPORTS_BUCKET = process.env.MINIO_EXPORTS_BUCKET || "exports";

async function logAudit(
  clinicId: string,
  action: string,
  entityType: string,
  entityId: string,
  meta: unknown,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        clinicId,
        action,
        entityType,
        entityId,
        meta: meta as never,
        actorId: null,
        actorRole: null,
        actorLabel: "system",
      },
    });
  } catch (err) {
    console.error("[dsar:deletion] audit insert failed", err);
  }
}

/**
 * D-6 — scrub free-text PHI that lives outside the Patient row. The
 * Patient-row payload (`buildAnonymizationPayload`) covers identity columns;
 * these carriers hold clinical / conversational free text that names or
 * describes the patient and so must be erased on anonymization too. The
 * HARD_DELETE path doesn't need this — its FK cascade removes the rows.
 *
 * Idempotent: every write just nulls a field, so a retried tick (patient
 * update succeeded but a later step threw, job left APPROVED) re-runs
 * harmlessly.
 */
async function scrubPatientPhiCarriers(patientId: string): Promise<void> {
  await prisma.medicalCase.updateMany({
    where: { patientId },
    data: { soapDraft: null },
  });
  await prisma.appointment.updateMany({
    where: { patientId },
    data: { notes: null },
  });
  await prisma.patientReview.updateMany({
    where: { patientId },
    data: { comment: null },
  });
  // Chat lives in Conversation/Message; Message has no patientId, so resolve
  // the patient's threads first, then null every message body. Also clear the
  // denormalized last-message text + Telegram contact identifiers on the
  // conversation so the scrubbed body can't re-leak through the inbox preview.
  const convs = await prisma.conversation.findMany({
    where: { patientId },
    select: { id: true },
  });
  if (convs.length > 0) {
    await prisma.message.updateMany({
      where: { conversationId: { in: convs.map((c) => c.id) } },
      data: { body: null },
    });
  }
  await prisma.conversation.updateMany({
    where: { patientId },
    data: {
      lastMessageText: null,
      contactFirstName: null,
      contactLastName: null,
      contactUsername: null,
    },
  });
}

/**
 * Execute a single deletion job. Exported for tests.
 */
export async function executeDeletionJob(jobId: string): Promise<void> {
  const job = await prisma.dataDeletionJob.findUnique({
    where: { id: jobId },
  });
  if (!job) return;
  if (job.status !== "APPROVED") return;
  const now = new Date();
  if (job.scheduledFor.getTime() > now.getTime()) return;

  const patient = await prisma.patient.findUnique({
    where: { id: job.patientId },
    select: {
      id: true,
      fullName: true,
      phone: true,
      phoneNormalized: true,
      telegramId: true,
      telegramUsername: true,
      passport: true,
    },
  });
  if (!patient) {
    // Patient already gone — close the job out anyway.
    await prisma.dataDeletionJob.update({
      where: { id: job.id },
      data: { status: "EXECUTED", executedAt: now },
    });
    return;
  }

  // Hydrate before snapshotting so forensic audit carries plaintext —
  // otherwise PATIENT_HARD_DELETED / _ANONYMIZED rows would store ciphertext
  // that becomes useless after key rotation.
  const hydrated = hydratePatientForRead({ passport: patient.passport });
  const patientForSnapshot = { ...patient, passport: hydrated.passport ?? null };

  if (job.mode === "HARD_DELETE") {
    const snapshot = snapshotForensicFields(patientForSnapshot);
    await prisma.patient.delete({ where: { id: job.patientId } });
    await prisma.dataDeletionJob.update({
      where: { id: job.id },
      data: { status: "EXECUTED", executedAt: now },
    });
    await logAudit(
      job.clinicId,
      AUDIT_ACTION.PATIENT_HARD_DELETED,
      "Patient",
      job.patientId,
      { jobId: job.id, before: snapshot },
    );
    return;
  }

  // ANONYMIZE.
  const snapshot = snapshotForensicFields(patientForSnapshot);
  const payload = buildAnonymizationPayload(job.id, now);
  await prisma.patient.update({
    where: { id: job.patientId },
    data: payload,
  });
  await scrubPatientPhiCarriers(job.patientId);
  await prisma.dataDeletionJob.update({
    where: { id: job.id },
    data: { status: "ANONYMIZED", executedAt: now },
  });
  await logAudit(
    job.clinicId,
    AUDIT_ACTION.PATIENT_ANONYMIZED,
    "Patient",
    job.patientId,
    { jobId: job.id, before: snapshot },
  );
}

/**
 * Expire stale export bundles. Best-effort delete from MinIO; storage
 * failures don't block the status flip.
 */
export async function expireStaleExports(now: Date): Promise<number> {
  const stale = await prisma.dataExportJob.findMany({
    where: {
      expiresAt: { lte: now },
      status: { in: ["READY", "DELIVERED"] },
    },
    select: { id: true, storageKey: true },
    take: 100,
  });
  for (const row of stale) {
    if (row.storageKey) {
      try {
        await deleteObject(EXPORTS_BUCKET, row.storageKey);
      } catch (err) {
        console.warn(
          `[dsar:deletion] minio delete failed for ${row.storageKey}`,
          err,
        );
      }
    }
    await prisma.dataExportJob.update({
      where: { id: row.id },
      data: { status: "EXPIRED" },
    });
  }
  return stale.length;
}

/**
 * One tick: drain due deletion jobs + expire stale exports.
 */
export async function runDsarTick(): Promise<void> {
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const now = new Date();

    const due = await prisma.dataDeletionJob.findMany({
      where: { status: "APPROVED", scheduledFor: { lte: now } },
      orderBy: { scheduledFor: "asc" },
      select: { id: true },
      take: 50,
    });

    for (const row of due) {
      try {
        await executeDeletionJob(row.id);
      } catch (err) {
        console.error(
          `[dsar:deletion] job ${row.id} failed; will retry next tick`,
          err,
        );
      }
    }

    try {
      await expireStaleExports(now);
    } catch (err) {
      console.error("[dsar:deletion] export expiry sweep failed", err);
    }
  });
}

/**
 * Register the hourly cron. Returns a stop handle.
 */
export function registerDsarScheduler(intervalMs = 60 * 60 * 1000): {
  stop: () => void;
} {
  const handle = getQueue().repeat<{ tick: true }>(
    "dsar:scheduler",
    "tick",
    { tick: true },
    intervalMs,
  );
  getQueue().registerWorker<{ tick: true }>(
    "dsar:scheduler",
    "tick",
    async () => {
      await runDsarTick();
    },
  );
  console.info("[worker] dsar:scheduler registered");
  return handle;
}
