/**
 * POST /api/crm/documents/upload-url — issue a presigned upload URL.
 *
 * Body: { fileName, contentType, patientId? }
 *
 * Returns: { key, uploadUrl, publicUrl }
 *
 * Flow:
 *   1. Client calls this endpoint with the intended filename + mime.
 *   2. Server issues a presigned PUT URL via the MinIO adapter.
 *   3. Client PUTs the bytes directly to storage.
 *   4. Client calls `POST /api/crm/documents` with `fileUrl=publicUrl` to
 *      persist the Document metadata row.
 *
 * In stub mode (MINIO_ENDPOINT unset) we return a `file://` URL — the UI
 * should just POST to /api/crm/documents with the bytes in metadata form.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";

import { createApiHandler } from "@/lib/api-handler";
import { ok } from "@/server/http";
import { getSignedUrl, isStubMode } from "@/server/storage/minio";

const BodySchema = z.object({
  fileName: z.string().min(1).max(256),
  contentType: z.string().min(1).max(128).default("application/octet-stream"),
  patientId: z.string().optional(),
});

function sanitise(name: string): string {
  return name.replace(/[^\w.\-]/g, "_").slice(0, 128);
}

export const POST = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"],
    bodySchema: BodySchema,
  },
  async ({ body, ctx }) => {
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : "shared";
    const id = randomUUID();
    const safeName = sanitise(body.fileName);
    const key = `clinics/${clinicId}/documents/${id}-${safeName}`;

    if (isStubMode()) {
      return ok({
        key,
        uploadUrl: null,
        publicUrl: null,
        stub: true,
        hint:
          "MINIO_ENDPOINT is not configured — fall back to posting metadata via /api/crm/documents.",
      });
    }

    const uploadUrl = await getSignedUrl(undefined, key, 900);
    const pub = process.env.MINIO_PUBLIC_URL || process.env.MINIO_ENDPOINT!;
    const bucket = process.env.MINIO_BUCKET || "medbook";
    const publicUrl = `${pub.replace(/\/$/, "")}/${bucket}/${key}`;

    return ok({ key, uploadUrl, publicUrl, stub: false });
  },
);
