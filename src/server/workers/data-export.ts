/**
 * Phase 17 Wave 3 — DSAR data-export worker.
 *
 * Job shape: `{ jobId }`. Everything else (clinicId, patientId,
 * passphrase, telegramChatId) is read from the DataExportJob row.
 *
 * Pipeline:
 *   1. Mark job PROCESSING.
 *   2. Load patient + appointments + payments + reviews + prescriptions
 *      + messages + medicalCases (everything tenant-scoped via
 *      runWithTenant).
 *   3. Generate one-time passphrase, persist its bcryptjs hash.
 *   4. Build the canonical bundle JSON via `buildDsarBundle`.
 *   5. Encrypt + ZIP via `packDsarBundle`.
 *   6. Upload to MinIO at `exports/<clinicId>/<jobId>.zip`.
 *   7. Mark job READY (storageKey + fileSizeBytes).
 *   8. Send the ZIP via the per-clinic TG bot to `telegramChatId`.
 *      Caption includes the passphrase (one-shot).
 *   9. Mark job DELIVERED.
 *  10. Audit at every milestone (REQUESTED was emitted by the API
 *      handler before the worker started; the worker fires GENERATED,
 *      DELIVERED, FAILED).
 *
 * Failure handling: any thrown error → status FAILED, errorMessage set,
 * audit row PATIENT_DATA_EXPORT_FAILED with the stage. The job is NOT
 * automatically retried (the in-memory queue has no retry semantics);
 * the admin can re-trigger from the queue UI.
 *
 * Pure helpers (`bundle`, `anonymize`, `zip`, `expiry`) handle all the
 * deterministic logic. This worker is the only place that touches
 * Prisma / MinIO / Telegram.
 */

import bcrypt from "bcryptjs";

import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import {
  buildDsarBundle,
  bundleToJson,
  type DsarAppointmentInput,
  type DsarMedicalCaseInput,
  type DsarMessageInput,
  type DsarPatientInput,
  type DsarPaymentInput,
  type DsarPrescriptionInput,
  type DsarReviewInput,
} from "@/server/dsar/bundle";
import { generatePassphrase, packDsarBundle } from "@/server/dsar/zip";
import { hydrateMedicalCaseForRead } from "@/server/medical-case/cipher-fields";
import { hydratePatientForRead } from "@/server/patient/cipher-fields";
import { hydratePrescriptionForRead } from "@/server/prescription/cipher-fields";
import { getQueue, enqueue } from "@/server/queue";
import { uploadObject } from "@/server/storage/minio";
import { sendDocument, sendMessage } from "@/server/telegram/send";

import { AUDIT_ACTION } from "@/lib/audit-actions";

export const QUEUE_NAME = "dsar:export";
export const JOB_NAME = "run";

export type ExportRunJob = { jobId: string };

const BCRYPT_ROUNDS = 10;
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
    console.error("[dsar:export] audit insert failed", err);
  }
}

/**
 * Inner handler — exported for tests so the lifecycle can be exercised
 * without the queue plumbing.
 */
export async function runExportJob(job: ExportRunJob): Promise<void> {
  const row = await prisma.dataExportJob.findUnique({
    where: { id: job.jobId },
    select: { id: true, clinicId: true, patientId: true, status: true },
  });
  if (!row) {
    console.warn(`[dsar:export] job ${job.jobId} not found`);
    return;
  }
  if (row.status !== "PENDING") {
    console.info(
      `[dsar:export] job ${job.jobId} already in status=${row.status}; skipping`,
    );
    return;
  }
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    await prisma.dataExportJob.update({
      where: { id: row.id },
      data: { status: "PROCESSING" },
    });

    let stage: "load" | "generate" | "upload" | "deliver" = "load";
    try {
      // 1. Load all PII rows for the patient.
      const [
        clinicRow,
        patientRow,
        appointments,
        payments,
        patientReviews,
        prescriptions,
        messages,
        medicalCases,
      ] = await Promise.all([
        prisma.clinic.findUnique({
          where: { id: row.clinicId },
          select: { id: true, slug: true, nameRu: true, nameUz: true },
        }),
        prisma.patient.findUnique({
          where: { id: row.patientId },
          select: {
            id: true,
            clinicId: true,
            fullName: true,
            phone: true,
            phoneNormalized: true,
            birthDate: true,
            gender: true,
            passport: true,
            address: true,
            telegramId: true,
            telegramUsername: true,
            preferredChannel: true,
            preferredLang: true,
            segment: true,
            tags: true,
            notes: true,
            ltv: true,
            visitsCount: true,
            balance: true,
            consentMarketing: true,
            marketingOptOut: true,
            marketingOptOutAt: true,
            marketingOptOutSource: true,
            summaryCache: true,
            summaryCacheUpdatedAt: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
        prisma.appointment.findMany({
          where: { patientId: row.patientId },
          select: {
            id: true,
            date: true,
            endDate: true,
            status: true,
            doctor: { select: { nameRu: true } },
            primaryService: { select: { nameRu: true } },
            priceFinal: true,
            notes: true,
          },
        }),
        prisma.payment.findMany({
          where: { patientId: row.patientId },
          select: {
            id: true,
            amount: true,
            currency: true,
            status: true,
            paidAt: true,
            method: true,
            appointmentId: true,
          },
        }),
        prisma.patientReview.findMany({
          where: { patientId: row.patientId },
          select: {
            id: true,
            score: true,
            comment: true,
            createdAt: true,
            appointmentId: true,
          },
        }),
        prisma.prescription.findMany({
          where: { patientId: row.patientId },
          select: {
            id: true,
            drugName: true,
            dosage: true,
            schedule: true,
            status: true,
            createdAt: true,
          },
        }),
        prisma.message.findMany({
          where: { conversation: { patientId: row.patientId } },
          select: {
            id: true,
            conversation: { select: { channel: true } },
            direction: true,
            body: true,
            createdAt: true,
          },
        }),
        prisma.medicalCase.findMany({
          where: { patientId: row.patientId },
          select: {
            id: true,
            title: true,
            status: true,
            soapDraft: true,
            createdAt: true,
            updatedAt: true,
          },
        }),
      ]);

      if (!patientRow || !clinicRow) {
        throw new Error("patient or clinic missing");
      }

      stage = "generate";

      // Wave 4 — `passport` and `notes` are encrypted at rest. The DSAR
      // bundle is the patient's own data — they're entitled to plaintext.
      const patientHydrated = hydratePatientForRead({
        passport: patientRow.passport,
        notes: patientRow.notes,
      });

      const patientInput: DsarPatientInput = {
        id: patientRow.id,
        clinicId: patientRow.clinicId,
        fullName: patientRow.fullName,
        phone: patientRow.phone,
        phoneNormalized: patientRow.phoneNormalized,
        birthDate: patientRow.birthDate,
        gender: patientRow.gender as string | null,
        passport: patientHydrated.passport ?? null,
        address: patientRow.address,
        telegramId: patientRow.telegramId,
        telegramUsername: patientRow.telegramUsername,
        preferredChannel: String(patientRow.preferredChannel),
        preferredLang: String(patientRow.preferredLang),
        segment: String(patientRow.segment),
        tags: patientRow.tags,
        notes: patientHydrated.notes ?? null,
        ltv: patientRow.ltv,
        visitsCount: patientRow.visitsCount,
        balance: patientRow.balance,
        consentMarketing: patientRow.consentMarketing,
        marketingOptOut: patientRow.marketingOptOut,
        marketingOptOutAt: patientRow.marketingOptOutAt,
        marketingOptOutSource: patientRow.marketingOptOutSource,
        summaryCache: patientRow.summaryCache,
        summaryCacheUpdatedAt: patientRow.summaryCacheUpdatedAt,
        createdAt: patientRow.createdAt,
        updatedAt: patientRow.updatedAt,
      };

      const appointmentsInput: DsarAppointmentInput[] = appointments.map(
        (a) => ({
          id: a.id,
          startAt: a.date,
          endAt: a.endDate,
          status: String(a.status),
          doctorName: a.doctor?.nameRu ?? null,
          serviceName: a.primaryService?.nameRu ?? null,
          price: a.priceFinal ?? null,
          notes: a.notes ?? null,
        }),
      );

      const paymentsInput: DsarPaymentInput[] = payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        currency: String(p.currency),
        status: String(p.status),
        paidAt: p.paidAt,
        method: p.method ? String(p.method) : null,
        appointmentId: p.appointmentId,
      }));

      const reviewsInput: DsarReviewInput[] = patientReviews.map((r) => ({
        id: r.id,
        score: r.score,
        comment: r.comment,
        createdAt: r.createdAt,
        appointmentId: r.appointmentId,
      }));

      const prescriptionsInput: DsarPrescriptionInput[] = prescriptions.map(
        (p) => {
          const sched = (p.schedule ?? null) as
            | { times?: string[]; days?: number }
            | null;
          // Even though `notes` isn't currently included in the DSAR
          // prescription type, hydrate the row defensively so any future
          // additions don't accidentally ship ciphertext.
          hydratePrescriptionForRead(p as { notes?: string | null });
          return {
            id: p.id,
            drugName: p.drugName,
            dosage: p.dosage,
            scheduleTimes:
              sched && Array.isArray(sched.times)
                ? sched.times
                : [],
            days: sched?.days ?? 0,
            status: String(p.status),
            createdAt: p.createdAt,
          };
        },
      );

      const messagesInput: DsarMessageInput[] = messages.map((m) => ({
        id: m.id,
        channel: String(m.conversation?.channel ?? ""),
        direction: String(m.direction),
        body: m.body ?? "",
        createdAt: m.createdAt,
      }));

      const medicalCasesInput: DsarMedicalCaseInput[] = medicalCases.map(
        (m) => {
          // `soapDraft` is encrypted at rest — DSAR ships the plaintext
          // (the patient owns this content).
          const hydrated = hydrateMedicalCaseForRead({ soapDraft: m.soapDraft });
          return {
            id: m.id,
            title: m.title,
            status: String(m.status),
            soapDraft: hydrated.soapDraft ?? null,
            createdAt: m.createdAt,
            updatedAt: m.updatedAt,
          };
        },
      );

      const bundle = buildDsarBundle({
        generatedAt: new Date(),
        jobId: row.id,
        clinic: clinicRow,
        patient: patientInput,
        appointments: appointmentsInput,
        payments: paymentsInput,
        reviews: reviewsInput,
        prescriptions: prescriptionsInput,
        messages: messagesInput,
        medicalCases: medicalCasesInput,
      });

      const json = bundleToJson(bundle);

      // 2. Generate passphrase + persist hash.
      const passphrase = generatePassphrase();
      const passphraseHash = await bcrypt.hash(passphrase, BCRYPT_ROUNDS);

      // 3. Encrypt + zip.
      const zipBuffer = packDsarBundle(
        json,
        passphrase,
        clinicRow.nameRu,
        clinicRow.nameUz,
      );

      stage = "upload";

      // 4. Upload to MinIO.
      const storageKey = `exports/${clinicRow.id}/${row.id}.zip`;
      await uploadObject(
        EXPORTS_BUCKET,
        storageKey,
        zipBuffer,
        "application/zip",
      );

      await prisma.dataExportJob.update({
        where: { id: row.id },
        data: {
          status: "READY",
          passphraseHash,
          storageKey,
          fileSizeBytes: zipBuffer.length,
        },
      });

      await logAudit(
        clinicRow.id,
        AUDIT_ACTION.PATIENT_DATA_EXPORT_GENERATED,
        "DataExportJob",
        row.id,
        {
          patientId: row.patientId,
          fileSizeBytes: zipBuffer.length,
          storageKey,
        },
      );

      // 5. Deliver via Telegram, if a chat is set.
      stage = "deliver";

      const fresh = await prisma.dataExportJob.findUnique({
        where: { id: row.id },
        select: { telegramChatId: true },
      });
      const chatId = fresh?.telegramChatId ?? null;
      if (chatId) {
        const clinicForTg = await prisma.clinic.findUnique({
          where: { id: clinicRow.id },
          select: {
            id: true,
            slug: true,
            tgBotToken: true,
            tgBotUsername: true,
          },
        });
        if (clinicForTg) {
          // Send the file first, then a separate message with the
          // passphrase. Two messages so the patient can copy the password
          // from chat history without it being baked into the file caption.
          const tgMsg = await sendDocument(clinicForTg, chatId, zipBuffer, {
            filename: `medbook-data-${row.id}.zip`,
            contentType: "application/zip",
            caption:
              "Архив с вашими данными. Пароль придёт следующим сообщением.",
          });
          await sendMessage(
            clinicForTg,
            chatId,
            `Пароль для расшифровки: <code>${passphrase}</code>\n\nИспользуйте decrypt.sh из архива (или свой openssl).`,
            { parse_mode: "HTML" },
          );

          await prisma.dataExportJob.update({
            where: { id: row.id },
            data: { status: "DELIVERED" },
          });

          await logAudit(
            clinicRow.id,
            AUDIT_ACTION.PATIENT_DATA_EXPORT_DELIVERED,
            "DataExportJob",
            row.id,
            {
              patientId: row.patientId,
              telegramChatId: chatId,
              telegramMessageId: tgMsg.message_id,
            },
          );
        }
      }
      // If no chatId: leave at READY; the admin will download via signed URL.
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[dsar:export] job ${row.id} failed at ${stage}`, err);
      await prisma.dataExportJob.update({
        where: { id: row.id },
        data: { status: "FAILED", errorMessage: msg },
      });
      await logAudit(
        row.clinicId,
        AUDIT_ACTION.PATIENT_DATA_EXPORT_FAILED,
        "DataExportJob",
        row.id,
        { patientId: row.patientId, stage, errorMessage: msg },
      );
    }
  });
}

/** Enqueue an export job from a request handler. */
export function enqueueExportJob(jobId: string): Promise<void> {
  return enqueue<ExportRunJob>(QUEUE_NAME, JOB_NAME, { jobId });
}

/** Idempotent worker registration. */
export function startDataExportWorker(): void {
  getQueue().registerWorker<ExportRunJob>(QUEUE_NAME, JOB_NAME, runExportJob);
  console.info("[worker] dsar:export registered");
}

// Test-only re-export.
export { runExportJob as _runExportJobForTests };
