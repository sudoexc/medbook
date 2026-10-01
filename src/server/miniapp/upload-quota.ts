/**
 * How much a patient may upload from the Mini App (audit CD-04).
 *
 * POST /api/miniapp/documents took a 10 MB file per request with no other
 * bound: a script holding one patient's initData could push tens of GB an
 * hour into MinIO, on the shared VPS where Postgres and the neighbours'
 * sites live on the same disk, and plant thousands of «Фото от пациента»
 * rows in the chart. The limits, per Telegram account (the owner and the
 * relatives he uploads for count together, see `uploadAccountPatientIds`):
 *
 *   - `MINIAPP_UPLOADS_PER_HOUR` attempts an hour (in-process counter, like
 *     every other limiter here: the app runs as one Node process);
 *   - `MINIAPP_UPLOAD_BYTES_PER_DAY` stored in the last 24 hours and
 *     `MINIAPP_UPLOAD_BYTES_TOTAL` stored altogether, both counted from the
 *     documents themselves, so a restart forgets nothing.
 *
 * A patient's own upload is a Document with no staff uploader and no visit
 * note or referral behind it (the conclusion and referral PDFs the workers
 * render are also `uploadedById = null`, but always carry one of those).
 */
import { AUDIT_ACTION } from "@/lib/audit-actions";
import type { prisma } from "@/lib/prisma";
import { getFamilyAllowedPatientIds } from "@/server/miniapp/active-patient";

type PrismaLike =
  | typeof prisma
  | Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

export const MINIAPP_UPLOADS_PER_HOUR = 20;
export const MINIAPP_UPLOAD_BYTES_PER_DAY = 200 * 1024 * 1024;
export const MINIAPP_UPLOAD_BYTES_TOTAL = 1024 * 1024 * 1024;

const DAY_MS = 24 * 60 * 60 * 1000;

export type UploadUsage = {
  /** Bytes the account stored in the last 24 hours. */
  lastDayBytes: number;
  /** Bytes the account stored altogether. */
  totalBytes: number;
};

export type UploadQuotaRefusal =
  | { reason: "upload_daily_quota"; limitBytes: number; retryAfterSec: number }
  | { reason: "upload_total_quota"; limitBytes: number };

/** Where patient uploads live: no staff uploader, no worker-rendered source. */
export function patientUploadWhere(clinicId: string, patientIds: string[]) {
  return {
    clinicId,
    patientId: { in: patientIds },
    uploadedById: null,
    visitNoteId: null,
    referralId: null,
  };
}

/**
 * The cards whose patient uploads count against this Telegram account: the
 * owner, the relatives linked now, and every card the account has uploaded
 * for. Counting only the family linked now let the quota be laundered: add
 * a relative (a new card), upload 200 MB for her, unlink her, and the day's
 * usage was back at zero for the next one (the add, act, unlink loop MA-14
 * closed for bookings). Her files stay on the account that uploaded them.
 */
export async function uploadAccountPatientIds(
  db: PrismaLike,
  clinicId: string,
  ownerPatientId: string,
): Promise<string[]> {
  const [family, uploadedFor] = await Promise.all([
    getFamilyAllowedPatientIds(clinicId, ownerPatientId, db),
    uploadedForPatientIds(db, clinicId, ownerPatientId),
  ]);
  return [...new Set([...family, ...uploadedFor])];
}

/**
 * Every card this account has uploaded for, read from its upload ledger:
 * the MINIAPP_DOCUMENT_UPLOADED audit rows, which the upload route writes in
 * the same transaction as the document (actor label `patient:<owner>` as
 * `auditMiniApp` writes it, the card in `meta.patientId`). DISTINCT in
 * Postgres, so a long upload history reads as a handful of ids.
 */
export async function uploadedForPatientIds(
  db: PrismaLike,
  clinicId: string,
  ownerPatientId: string,
): Promise<string[]> {
  const rows = await db.$queryRaw<Array<{ patientId: string | null }>>`
    SELECT DISTINCT "meta"->>'patientId' AS "patientId" FROM "AuditLog"
    WHERE "action" = ${AUDIT_ACTION.MINIAPP_DOCUMENT_UPLOADED}
      AND "clinicId" = ${clinicId}
      AND "actorLabel" = ${`patient:${ownerPatientId}`}`;
  return rows
    .map((r) => r.patientId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
}

export async function loadUploadUsage(
  db: PrismaLike,
  clinicId: string,
  patientIds: string[],
  now: Date = new Date(),
): Promise<UploadUsage> {
  const where = patientUploadWhere(clinicId, patientIds);
  const [day, total] = await Promise.all([
    db.document.aggregate({
      where: { ...where, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
      _sum: { sizeBytes: true },
    }),
    db.document.aggregate({ where, _sum: { sizeBytes: true } }),
  ]);
  return {
    lastDayBytes: day._sum.sizeBytes ?? 0,
    totalBytes: total._sum.sizeBytes ?? 0,
  };
}

/**
 * Null when `incomingBytes` more fit; otherwise why not. Pass 1 to ask
 * before the body is read whether the account is already at a limit.
 */
export function uploadQuotaRefusal(
  usage: UploadUsage,
  incomingBytes: number,
): UploadQuotaRefusal | null {
  if (usage.totalBytes + incomingBytes > MINIAPP_UPLOAD_BYTES_TOTAL) {
    return { reason: "upload_total_quota", limitBytes: MINIAPP_UPLOAD_BYTES_TOTAL };
  }
  if (usage.lastDayBytes + incomingBytes > MINIAPP_UPLOAD_BYTES_PER_DAY) {
    return {
      reason: "upload_daily_quota",
      limitBytes: MINIAPP_UPLOAD_BYTES_PER_DAY,
      // The window slides; an hour is an honest «try later» without
      // pretending to know which upload ages out first.
      retryAfterSec: 60 * 60,
    };
  }
  return null;
}
