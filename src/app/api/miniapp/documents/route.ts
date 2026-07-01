/**
 * GET  /api/miniapp/documents?clinicSlug=…  → list the patient's documents
 * POST /api/miniapp/documents?clinicSlug=…  → patient uploads a document
 *                                             (multipart/form-data: `file`,
 *                                             optional `title`, optional
 *                                             `type` ∈ DocumentType — defaults
 *                                             to OTHER).
 *
 * Patient uploads land with `uploadedById = null`; the CRM uses that null as
 * the proxy for "this came from the patient" (staff uploads always carry a
 * User id), so we avoid a schema migration for the patient-upload flag.
 */
import { randomUUID } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { AUDIT_ACTION } from "@/lib/audit-actions";
import { runWithTenant } from "@/lib/tenant-context";
import {
  newCorrelationId,
  publishViaOutbox,
} from "@/server/realtime/outbox";
import { err, ok } from "@/server/http";
import {
  createMiniAppListHandler,
  resolveMiniAppContext,
} from "@/server/miniapp/handler";
import { uploadObject } from "@/server/storage/minio";

// 10 MB cap — covers a high-res phone photo (typical 3-5 MB) with room for
// PDFs the patient might forward from an external clinic. Anything larger is
// almost always an accidental upload of a video/full document we don't want
// crowding our storage.
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ALLOWED_MIME_PREFIXES = ["image/"];
const ALLOWED_MIME_EXACT = new Set([
  "application/pdf",
  "application/x-pdf",
]);

const ALLOWED_DOCUMENT_TYPES = [
  "REFERRAL",
  "PRESCRIPTION",
  "RESULT",
  "CONSENT",
  "CONTRACT",
  "RECEIPT",
  "OTHER",
] as const;
type PatientDocumentType = (typeof ALLOWED_DOCUMENT_TYPES)[number];
function isPatientDocumentType(v: string): v is PatientDocumentType {
  return (ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(v);
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

export const GET = createMiniAppListHandler({}, async ({ ctx }) => {
  const docs = await prisma.document.findMany({
    where: { clinicId: ctx.clinicId, patientId: ctx.patientId },
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
  // route — auth-checked + served with the right Content-Type.
  const proxied = docs.map((d, i) => ({
    ...d,
    seq: total - i,
    fileUrl: `/api/miniapp/documents/${d.id}/file?clinicSlug=${encodeURIComponent(ctx.clinicSlug)}`,
  }));
  return ok({ documents: proxied });
});

export async function POST(request: Request): Promise<Response> {
  const resolved = await resolveMiniAppContext(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

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

  const mime = file.type || "application/octet-stream";
  const mimeOk =
    ALLOWED_MIME_EXACT.has(mime) ||
    ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p));
  if (!mimeOk) {
    return err("UnsupportedMime", 415, {
      reason: "mime_not_allowed",
      mime,
    });
  }

  const rawTitle = (form.get("title") ?? "").toString().trim().slice(0, 200);
  const rawType = (form.get("type") ?? "").toString().trim();
  const type: PatientDocumentType = isPatientDocumentType(rawType)
    ? rawType
    : "OTHER";

  const ext = extFromMime(mime, extFromName(file.name || null));
  const objectKey = `clinics/${ctx.clinicId}/documents/${randomUUID()}.${ext}`;
  const buffer = Buffer.from(await file.arrayBuffer());

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
          patientId: ctx.patientId,
          type,
          title,
          fileUrl: uploaded.url,
          mimeType: mime,
          sizeBytes: file.size,
          uploadedById: null,
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
          onBehalfOfPatientId: null,
          label: `patient:${ctx.patientId}`,
        },
        surface: "MINIAPP",
        tenantScope: { clinicId: ctx.clinicId, patientId: ctx.patientId },
        type: "document.created",
        payload: {
          documentId: row.id,
          patientId: ctx.patientId,
          documentType: row.type,
        },
      });
      return row;
    });
    await audit(request, {
      action: AUDIT_ACTION.MINIAPP_DOCUMENT_UPLOADED,
      entityType: "Document",
      entityId: created.id,
      meta: {
        clinicId: ctx.clinicId,
        patientId: ctx.patientId,
        sizeBytes: file.size,
        mimeType: mime,
        type,
      },
    });
    return ok({ document: created }, 201);
  });
}
