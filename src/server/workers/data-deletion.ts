/**
 * Phase 17 Wave 3 — DSAR data-deletion executor + cron.
 *
 * The cron runs hourly under runWithTenant({ kind: "SYSTEM" }):
 *
 *   1. Find APPROVED DataDeletionJobs with scheduledFor <= now, the ones
 *      that failed least first, then oldest first, 50 a tick.
 *   2. For each job (both modes, see below):
 *        - redact the person from the clinic's audit log
 *          (`scrubPatientFromAuditLog`, audit SEC-09), while the card still
 *          says who they are;
 *        - erase everything about the person outside the card
 *          (`scrubPatientPhiCarriers`, audit PT-07): leads and site
 *          requests, notification texts, communication bodies, calls, chat
 *          and its attachments, reviews, the clinical note, reminders, the
 *          Mini App family links, every stored file;
 *        - anonymize the card (`buildAnonymizationPayload`);
 *        - mark the job ANONYMIZED and audit PATIENT_ANONYMIZED naming the
 *          erased identity fields.
 *      What is kept, and why, is in `src/server/dsar/anonymize.ts`.
 *      HARD_DELETE is carried out the same way (audit PT-07): deleting the
 *      card failed on the RESTRICT keys of its visits, documents and
 *      broadcasts, and would otherwise cascade medical records the clinic
 *      must keep. The audit row says `requestedMode: "HARD_DELETE"`.
 *   3. A job that throws is retried on the next ticks; after
 *      MAX_DELETION_ATTEMPTS it becomes FAILED with the reason, so a broken
 *      job neither retries forever nor, fifty of them, blocks the batch.
 *      Every step is idempotent, so a retry after a partial run is safe.
 *
 * The cron also expires READY/DELIVERED export jobs whose `expiresAt`
 * has passed: status flips to EXPIRED and (best-effort) the MinIO
 * object is deleted. Bundled here so we don't need a second scheduler.
 */

import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";

import { AUDIT_ACTION } from "@/lib/audit-actions";

import { getQueue } from "@/server/queue";
import { deleteObject } from "@/server/storage/minio";

import {
  ANONYMIZED_FULL_NAME,
  buildAnonymizationPayload,
  erasedIdentityFields,
} from "@/server/dsar/anonymize";
import { scrubPatientFromAuditLog } from "@/server/dsar/audit-scrub";
import { DSAR_EXPORTS_BUCKET } from "@/server/dsar/expiry";
import { hydratePatientForRead } from "@/server/patient/cipher-fields";
import { isRealPhone } from "@/server/patient/phone-identity";
import { chatAttachmentKey, storageKeyFromUrl } from "@/lib/storage-ref";

/** Failed executions before a job is given up on as FAILED. */
export const MAX_DELETION_ATTEMPTS = 3;

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

/** The URLs of a Message's `attachments` JSON (`[{ kind, url, … }]`). */
function attachmentUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((a) =>
    a && typeof a === "object" && typeof (a as { url?: unknown }).url === "string"
      ? [(a as { url: string }).url]
      : [],
  );
}

/**
 * D-6 / audit PT-07 — erase what identifies or describes the patient
 * outside the Patient row. The Patient-row payload
 * (`buildAnonymizationPayload`) covers identity columns; these carriers
 * hold the name, the phone or free text about the person.
 *
 * Runs BEFORE the card is anonymized: leads and site requests are found by
 * the card's phone too, and the bot chat by its Telegram id, both of which
 * the anonymization clears.
 *
 * Idempotent: every write nulls or blanks a field or deletes a row, so a
 * retried tick (a step threw, job left APPROVED) re-runs harmlessly. Rows
 * found by phone are pinned to the job's clinic: the SYSTEM context adds no
 * tenant filter.
 */
async function scrubPatientPhiCarriers(
  clinicId: string,
  patientId: string,
  identity: { telegramId: string | null; phone: string | null; phoneNormalized: string | null },
): Promise<void> {
  const { telegramId } = identity;
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
  // His bot chat counts even when nobody linked it to the card: a private
  // chat's id is his Telegram id (audit TG-11). The id is read before the
  // anonymization clears it from the card.
  const threadsOfPatient = {
    OR: [
      { patientId },
      ...(telegramId
        ? [{ clinicId, channel: "TG" as const, externalId: telegramId }]
        : []),
    ],
  };
  const convs = await prisma.conversation.findMany({
    where: threadsOfPatient,
    select: { id: true },
  });
  if (convs.length > 0) {
    const conversationIds = convs.map((c) => c.id);
    // What he sent the bot (a passport photo, an MRI) and what staff sent
    // him are objects in storage, reachable by the capability URL kept in
    // `attachments` (audit PT-07 review). The object goes first and a
    // storage failure throws, like the documents below: the job retries and
    // still finds the link, instead of losing the key to a file that stays.
    const withFiles = await prisma.message.findMany({
      where: {
        conversationId: { in: conversationIds },
        attachments: { not: Prisma.AnyNull },
      },
      select: { conversationId: true, attachments: true },
    });
    for (const msg of withFiles) {
      for (const url of attachmentUrls(msg.attachments)) {
        const key = chatAttachmentKey(url, {
          clinicId,
          conversationId: msg.conversationId,
        });
        if (key) await deleteObject(undefined, key);
      }
    }
    await prisma.message.updateMany({
      where: { conversationId: { in: conversationIds } },
      data: { body: null, attachments: Prisma.DbNull },
    });
  }
  await prisma.conversation.updateMany({
    where: threadsOfPatient,
    data: {
      lastMessageText: null,
      contactFirstName: null,
      contactLastName: null,
      contactUsername: null,
    },
  });
  // Realtime events about him (audit INF-04): an envelope carries his full
  // name («пришёл», a booking), and delivered rows stay up to a week for
  // the SSE replay. Undelivered ones go too; an event about an erased
  // patient has nobody left to inform.
  await prisma.eventOutbox.deleteMany({
    where: {
      clinicId,
      OR: [
        { envelope: { path: ["tenantScope", "patientId"], equals: patientId } },
        { envelope: { path: ["actor", "patientId"], equals: patientId } },
        { envelope: { path: ["actor", "onBehalfOfPatientId"], equals: patientId } },
      ],
    },
  });
  // The doctor's clinical note (audit PT-11) is free text about the person.
  await prisma.patientClinicalNote.deleteMany({ where: { patientId } });
  // So is a doctor's reminder about him («Позвонить Иванову по МРТ»): the
  // title and body are the whole reminder, nothing is left to keep.
  await prisma.reminder.deleteMany({ where: { patientId } });
  // Her family links in the Mini App «Семья», both ways (final review of
  // P5). A son who managed his mother kept the link after her erasure: she
  // stayed in his switcher, and with `onBehalfOf` he still opened her kept
  // medical record (visit summary, labs, medications, the plan) and booked
  // new visits onto the erased card. The relationship itself is about her
  // too. Her own links as owner go as well: nobody can sign in as her any
  // more, and a relative's card is not hers to keep tied to.
  await prisma.patientFamily.deleteMany({
    where: {
      clinicId,
      OR: [{ linkedPatientId: patientId }, { ownerPatientId: patientId }],
    },
  });

  // Site requests and leads (audit PT-07): linked to the card, or left with
  // the card's number before anyone linked them. A family shares one number
  // (a son's card keeps his mother's in `phone`, with a `contact:` stub as
  // its identity), so by number only rows no card owns are taken: a lead
  // already linked is that card's, the mother's or the son's (PT-07
  // review). A card whose number is not its own identity (a `contact:`
  // sharer, a `family:` or `tg:` stub, an already erased card) is matched
  // by link only: the number in its `phone` is somebody else's.
  const phones = isRealPhone(identity.phoneNormalized)
    ? [identity.phone, identity.phoneNormalized].filter(
        (p): p is string => !!p && !p.startsWith("deleted:") && !p.startsWith("contact:"),
      )
    : [];
  const byCardOrPhone = {
    OR: [
      { patientId },
      ...(phones.length > 0
        ? [{ clinicId, patientId: null, phone: { in: phones } }]
        : []),
    ],
  };
  const erasedContact = {
    name: ANONYMIZED_FULL_NAME,
    phone: "",
    comment: null,
    utm: Prisma.DbNull,
  };
  await prisma.lead.updateMany({ where: byCardOrPhone, data: erasedContact });
  await prisma.onlineRequest.updateMany({ where: byCardOrPhone, data: erasedContact });
  // «Здравствуйте, Иванов Иван…»: the texts of every notification sent to
  // the patient, and where they went.
  await prisma.notificationSend.updateMany({
    where: { patientId },
    data: { body: "", recipient: "" },
  });
  await prisma.communication.updateMany({
    where: { patientId },
    data: { body: null, subject: null, meta: Prisma.DbNull },
  });
  // Calls: what was said, the recording, and the patient's side of the
  // line (the caller on incoming and missed calls, the callee on outgoing).
  await prisma.call.updateMany({
    where: { patientId },
    data: { summary: null, recordingUrl: null, tags: [] },
  });
  await prisma.call.updateMany({
    where: { patientId, direction: { in: ["IN", "MISSED"] } },
    data: { fromNumber: "" },
  });
  await prisma.call.updateMany({
    where: { patientId, direction: "OUT" },
    data: { toNumber: "" },
  });
  // Public reviews imported from maps stay public; only the link to the
  // card goes.
  await prisma.review.updateMany({
    where: { patientId },
    data: { patientId: null },
  });

  // Files carry the name on their pages: every document (row and object)
  // and every issued conclusion PDF. The object goes first; a storage
  // failure throws, so the job retries instead of leaving a file behind a
  // deleted row.
  const docs = await prisma.document.findMany({
    where: { patientId },
    select: { id: true, fileUrl: true },
  });
  for (const doc of docs) {
    const key = storageKeyFromUrl(doc.fileUrl);
    if (key) await deleteObject(undefined, key);
    await prisma.document.delete({ where: { id: doc.id } });
  }
  const issued = await prisma.visitNoteRevision.findMany({
    where: { visitNote: { patientId }, pdfObjectKey: { not: null } },
    select: { id: true, pdfObjectKey: true },
  });
  for (const rev of issued) {
    if (rev.pdfObjectKey) await deleteObject(undefined, rev.pdfObjectKey);
    await prisma.visitNoteRevision.update({
      where: { id: rev.id },
      data: { pdfObjectKey: null },
    });
  }
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

  // The decrypted passport is only a search term for the audit-log scrub
  // below; it is never written anywhere (audit SEC-09).
  const identity = {
    ...patient,
    passport: hydratePatientForRead({ passport: patient.passport }).passport ?? null,
  };
  const erased = erasedIdentityFields(identity);

  // First, while the row still says who the person is: a retried tick after
  // the row was scrubbed would have nothing left to search the log for (and
  // is skipped: its «identity» is the anonymization sentinel). Idempotent,
  // so a retry after a later failure just finds nothing to do.
  if (!patient.phoneNormalized.startsWith("deleted:")) {
    await scrubPatientFromAuditLog(prisma, job.clinicId, identity);
  }

  // Both modes (audit PT-07): the files and free text first, while the card
  // still has the phone and Telegram id they are found by, then the card.
  await scrubPatientPhiCarriers(job.clinicId, job.patientId, {
    telegramId: patient.telegramId,
    phone: patient.phone,
    phoneNormalized: patient.phoneNormalized,
  });
  const payload = buildAnonymizationPayload(job.id, now);
  await prisma.patient.update({
    where: { id: job.patientId },
    data: payload,
  });
  await prisma.dataDeletionJob.update({
    where: { id: job.id },
    data: { status: "ANONYMIZED", executedAt: now, errorMessage: null },
  });
  await logAudit(
    job.clinicId,
    AUDIT_ACTION.PATIENT_ANONYMIZED,
    "Patient",
    job.patientId,
    {
      jobId: job.id,
      erased,
      ...(job.mode === "HARD_DELETE"
        ? { requestedMode: "HARD_DELETE", executedAs: "ANONYMIZE" }
        : {}),
    },
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
        await deleteObject(DSAR_EXPORTS_BUCKET, row.storageKey);
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
 * Count a failed execution; at MAX_DELETION_ATTEMPTS the job is FAILED with
 * the reason (audit PT-07). Exported for tests.
 */
export async function recordDeletionFailure(
  row: { id: string; attempts: number; clinicId: string; patientId: string },
  err: unknown,
): Promise<void> {
  const attempts = row.attempts + 1;
  const failed = attempts >= MAX_DELETION_ATTEMPTS;
  // The message names a table or a storage error, never patient data.
  const errorMessage = (err instanceof Error ? err.message : String(err)).slice(0, 300);
  console.error(
    `[dsar:deletion] job ${row.id} failed (attempt ${attempts}/${MAX_DELETION_ATTEMPTS})`,
    err,
  );
  try {
    await prisma.dataDeletionJob.update({
      where: { id: row.id },
      data: { attempts, errorMessage, ...(failed ? { status: "FAILED" as const } : {}) },
    });
  } catch (e) {
    console.error(`[dsar:deletion] could not record the failure of ${row.id}`, e);
    return;
  }
  if (failed) {
    await logAudit(
      row.clinicId,
      AUDIT_ACTION.PATIENT_DELETION_FAILED,
      "DataDeletionJob",
      row.id,
      { patientId: row.patientId, attempts, errorMessage },
    );
  }
}

/**
 * One tick: drain due deletion jobs + expire stale exports.
 */
export async function runDsarTick(): Promise<void> {
  await runWithTenant({ kind: "SYSTEM" }, async () => {
    const now = new Date();

    // The least-failed first: a job that keeps failing goes to the back of
    // the line instead of taking a batch slot ahead of the healthy ones.
    const due = await prisma.dataDeletionJob.findMany({
      where: { status: "APPROVED", scheduledFor: { lte: now } },
      orderBy: [{ attempts: "asc" }, { scheduledFor: "asc" }],
      select: { id: true, attempts: true, clinicId: true, patientId: true },
      take: 50,
    });

    for (const row of due) {
      try {
        await executeDeletionJob(row.id);
      } catch (err) {
        await recordDeletionFailure(row, err);
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
