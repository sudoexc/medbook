/**
 * GET  /api/miniapp/documents?clinicSlug=…  → list the patient's documents
 * POST /api/miniapp/documents?clinicSlug=…  → patient uploads a document
 *                                             (multipart/form-data: `file`,
 *                                             optional `title`, optional
 *                                             `type` ∈ RESULT | OTHER —
 *                                             defaults to OTHER).
 *
 * Patient uploads land with `source = PATIENT` (audit CD-06): the CRM badges
 * them «От пациента» and keeps them out of the «ожидают подписи» queue. The
 * old proxy, `uploadedById = null`, also matched every conclusion the worker
 * rendered. A patient may file only a result or an «other» paper: a
 * consent, contract, prescription or referral is something the clinic
 * issues, and a patient's scan labelled as one looked like the real thing
 * to the doctor. Any other `type` is stored as OTHER.
 *
 * Both verbs act for the patient chosen in the family switcher
 * (`?onBehalfOf=`, family link checked, audit MA-18): the list used to
 * show the owner's documents under his mother's name, and her conclusion
 * links opened nothing.
 *
 * Uploads are bounded per Telegram account (audit CD-04, see
 * `upload-quota.ts`): 429 `upload_rate_limited` past 20 an hour,
 * `upload_daily_quota` past 200 MB a day, `upload_total_quota` past 1 GB.
 */
import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { miniAppAuditData } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { runWithTenant } from "@/lib/tenant-context";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import { err, ok } from "@/server/http";
import { DOCUMENT_TYPES, checkUpload } from "@/server/storage/safe-file";
import {
  createMiniAppListHandler,
  resolveMiniAppContext,
} from "@/server/miniapp/handler";
import { miniAppDocumentUrl } from "@/server/miniapp/link-token";
import { resolveActivePatient } from "@/server/miniapp/active-patient";
import {
  MINIAPP_UPLOADS_PER_HOUR,
  loadUploadUsage,
  uploadAccountPatientIds,
  uploadQuotaRefusal,
  type UploadQuotaRefusal,
} from "@/server/miniapp/upload-quota";
import { rateLimit } from "@/lib/rate-limit";
import { uploadObject } from "@/server/storage/minio";

// 10 MB cap — covers a high-res phone photo (typical 3-5 MB) with room for
// PDFs the patient might forward from an external clinic. Anything larger is
// almost always an accidental upload of a video/full document we don't want
// crowding our storage.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// Room for the multipart envelope and a title around one maximal file. A
// body declared larger is refused before it is read: `formData()` would
// buffer all of it (nginx lets 25 MB through for staff documents).
const MAX_REQUEST_BYTES = MAX_UPLOAD_BYTES + 512 * 1024;

function quotaRefused(refusal: UploadQuotaRefusal): Response {
  return Response.json(
    { error: "TooManyRequests", ...refusal },
    {
      status: 429,
      headers:
        refusal.reason === "upload_daily_quota"
          ? { "Retry-After": String(refusal.retryAfterSec) }
          : undefined,
    },
  );
}

/** What a patient may call his own upload (CD-06); anything else is OTHER. */
const PATIENT_DOCUMENT_TYPES = ["RESULT", "OTHER"] as const;
type PatientDocumentType = (typeof PATIENT_DOCUMENT_TYPES)[number];
function isPatientDocumentType(v: string): v is PatientDocumentType {
  return (PATIENT_DOCUMENT_TYPES as readonly string[]).includes(v);
}

function extFromMime(mime: string, fallback: string | null): string {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic" || mime === "image/heif") return "heic";
  if (mime === "image/gif") return "gif";
  if (mime === "application/pdf" || mime === "application/x-pdf") return "pdf";
  if (fallback && /^[a-z0-9]{1,5}$/i.test(fallback)) return fallback.toLowerCase();
  return "bin";
}

function extFromName(name: string | null): string | null {
  if (!name) return null;
  const m = /\.([a-z0-9]{1,5})$/i.exec(name);
  return m ? m[1] : null;
}

export const GET = createMiniAppListHandler({}, async ({ request, ctx }) => {
  const acting = await resolveActivePatient({
    ctx: {
      clinicId: ctx.clinicId,
      patientId: ctx.patientId,
      preferredLang: ctx.patient.preferredLang,
    },
    onBehalfOf: new URL(request.url).searchParams.get("onBehalfOf"),
  });
  if (!acting.ok) return err(acting.reason, 403);
  const docs = await prisma.document.findMany({
    where: { clinicId: ctx.clinicId, patientId: acting.patientId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      title: true,
      fileUrl: true,
      mimeType: true,
      sizeBytes: true,
      createdAt: true,
    },
  });
  // The patient only ever sees their own documents, so `seq` here is
  // identical to the staff-side `seq` for the same row. We can derive
  // it directly from the descending list: `seq = total - i` where `i`
  // is the zero-based index in the desc-sorted slice.
  const total = docs.length;
  // The stored fileUrl is the bare `${MINIO_PUBLIC_URL}/${bucket}/${key}` —
  // unsigned, so a direct GET returns MinIO's `AccessDenied` XML (which
  // Telegram/Safari render as plain text, the classic "wtf is this" symptom).
  // Presigning doesn't help because nginx's `/files/` location strips the
  // prefix before forwarding to MinIO, breaking the canonical-path
  // signature. Instead, swap each fileUrl for our own server-side stream
  // route — auth-checked + served with the right Content-Type. The URL is
  // opened as a plain link, so it carries a short-lived link for this one
  // document instead of the patient's initData (audit MA-07).
  const proxied = docs.map((d, i) => ({
    ...d,
    seq: total - i,
    fileUrl: miniAppDocumentUrl({
      clinicId: ctx.clinicId,
      clinicSlug: ctx.clinicSlug,
      patientId: acting.patientId,
      documentId: d.id,
    }),
  }));
  return ok({ documents: proxied });
});

export async function POST(request: Request): Promise<Response> {
  const resolved = await resolveMiniAppContext(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;
  // The card the file lands on: the owner's or his relative's.
  const acting = await runWithTenant({ kind: "SYSTEM" }, () =>
    resolveActivePatient({
      ctx: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        preferredLang: ctx.patient.preferredLang,
      },
      onBehalfOf: new URL(request.url).searchParams.get("onBehalfOf"),
    }),
  );
  if (!acting.ok) return err(acting.reason, 403);
  const patientId = acting.patientId;

  // Limits (audit CD-04), all before the body is read. Per Telegram
  // account: the owner and every relative he uploads for share them, an
  // unlinked one included.
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_REQUEST_BYTES) {
    return err("FileTooLarge", 413, {
      reason: "file_too_large",
      maxBytes: MAX_UPLOAD_BYTES,
    });
  }
  if (
    !rateLimit(
      `miniapp-upload:${ctx.clinicId}:${ctx.patientId}`,
      MINIAPP_UPLOADS_PER_HOUR,
      60 * 60 * 1000,
      "miniapp-upload",
    )
  ) {
    return Response.json(
      { error: "TooManyRequests", reason: "upload_rate_limited" },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }
  const accountIds = await runWithTenant({ kind: "SYSTEM" }, () =>
    uploadAccountPatientIds(prisma, ctx.clinicId, ctx.patientId),
  );
  const usage = await runWithTenant({ kind: "SYSTEM" }, () =>
    loadUploadUsage(prisma, ctx.clinicId, accountIds),
  );
  const atLimit = uploadQuotaRefusal(usage, 1);
  if (atLimit) return quotaRefused(atLimit);

  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    // Surface the parse failure: without it we can't tell whether the
    // Content-Type lost its boundary (iMe-style client), the body
    // truncated, or undici choked on a specific multipart edge case.
    const reason = (e as Error)?.message?.slice(0, 200) ?? "unknown";
    const ct = request.headers.get("content-type")?.slice(0, 200) ?? null;
    const cl = request.headers.get("content-length");
    console.error("[miniapp/documents POST] formData parse failed", {
      reason,
      contentType: ct,
      contentLength: cl,
    });
    return err("InvalidMultipart", 400, {
      reason,
      contentType: ct,
      contentLength: cl,
    });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return err("MissingFile", 400, { reason: "file_required" });
  }
  if (file.size <= 0) {
    return err("EmptyFile", 400, { reason: "file_empty" });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return err("FileTooLarge", 413, {
      reason: "file_too_large",
      maxBytes: MAX_UPLOAD_BYTES,
    });
  }
  const overQuota = uploadQuotaRefusal(usage, file.size);
  if (overQuota) return quotaRefused(overQuota);

  // Typed by its bytes: a patient's «photo» that is really an SVG with a
  // script would otherwise be served back from our origin to the reception
  // (audit CD-01). Photos and PDFs only.
  const buffer = Buffer.from(await file.arrayBuffer());
  const checked = checkUpload(buffer, file.type, DOCUMENT_TYPES, file.name);
  if (!checked.ok) {
    return err("UnsupportedMime", 415, {
      reason: "mime_not_allowed",
      mime: file.type || null,
    });
  }
  const mime = checked.mime;

  const rawTitle = (form.get("title") ?? "").toString().trim().slice(0, 200);
  const rawType = (form.get("type") ?? "").toString().trim();
  const type: PatientDocumentType = isPatientDocumentType(rawType)
    ? rawType
    : "OTHER";

  const ext = extFromMime(mime, extFromName(file.name || null));
  const objectKey = `clinics/${ctx.clinicId}/documents/${randomUUID()}.${ext}`;

  let uploaded: Awaited<ReturnType<typeof uploadObject>>;
  try {
    uploaded = await uploadObject(undefined, objectKey, buffer, mime);
  } catch {
    return err("UploadFailed", 500, { reason: "storage_unavailable" });
  }

  const fallbackTitle =
    mime.startsWith("image/")
      ? "Фото от пациента" // i18n-allow: db-value (display localised in UI)
      : "Документ от пациента"; // i18n-allow: db-value
  const title = rawTitle.length > 0 ? rawTitle : fallbackTitle;

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const created = await prisma.$transaction(async (tx) => {
      const row = await tx.document.create({
        data: {
          clinicId: ctx.clinicId,
          patientId,
          type,
          title,
          fileUrl: uploaded.url,
          mimeType: mime,
          sizeBytes: file.size,
          uploadedById: null,
          source: "PATIENT",
        } satisfies Prisma.DocumentUncheckedCreateInput,
        select: {
          id: true,
          type: true,
          title: true,
          fileUrl: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      });
      // Mirror the upload across the patient's other devices / family link.
      await publishViaOutbox(tx, {
        correlationId: newCorrelationId(),
        actor: {
          role: "PATIENT",
          userId: null,
          patientId: ctx.patientId,
          onBehalfOfPatientId: acting.isOnBehalfOf ? patientId : null,
          label: `patient:${ctx.patientId}`,
        },
        surface: "MINIAPP",
        tenantScope: { clinicId: ctx.clinicId, patientId },
        type: "document.created",
        payload: {
          documentId: row.id,
          patientId,
          documentType: row.type,
        },
      });
      // The account's upload ledger (`uploadAccountPatientIds`): written
      // with the document, so a stored file always counts against the
      // account that sent it, even after the relative is unlinked.
      await tx.auditLog.create({
        data: miniAppAuditData(request, ctx, {
          action: AUDIT_ACTION.MINIAPP_DOCUMENT_UPLOADED,
          entityType: "Document",
          entityId: row.id,
          meta: {
            clinicId: ctx.clinicId,
            patientId,
            actorPatientId: ctx.patientId,
            sizeBytes: file.size,
            mimeType: mime,
            type,
          },
        }),
      });
      return row;
    });
    return ok({ document: created }, 201);
  });
}
