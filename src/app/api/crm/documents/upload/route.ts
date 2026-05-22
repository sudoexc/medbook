/**
 * POST /api/crm/documents/upload — multipart byte upload for documents.
 *
 * Receives `multipart/form-data` with a single `file` field (and optional
 * `patientId`). The bytes are streamed through `uploadObject` so the same
 * code path works in stub mode (writes to `/tmp/medbook-uploads/...`) and in
 * MinIO/S3 mode (PUT to the configured bucket).
 *
 * Returns a `fileUrl` the client can persist directly on the Document row:
 *   - MinIO mode → full public S3 URL (download button hits MinIO directly)
 *   - Stub mode → server-relative `/api/crm/documents/file?key=<key>` so the
 *     download button can stream bytes back through Next.js
 *
 * This endpoint exists to kill the `pending://` orphan: previously the
 * client wrote a fake URL into the Document row when the presign endpoint
 * couldn't issue a real one, leaving the bytes nowhere and the row
 * undownloadable. Now bytes always land in storage before the metadata row
 * is created.
 */
import { randomUUID } from "node:crypto";

import { createApiHandler } from "@/lib/api-handler";
import { ok, err } from "@/server/http";
import { uploadObject, isStubMode } from "@/server/storage/minio";

const MAX_BYTES = 25 * 1024 * 1024; // 25MB cap matches what the presign flow allowed.

function sanitise(name: string): string {
  return name.replace(/[^\w.\-]/g, "_").slice(0, 128);
}

export const POST = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : "shared";

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return err("InvalidFormData", 400);
    }
    const file = form.get("file");
    if (!(file instanceof File)) {
      return err("MissingFile", 400);
    }
    if (file.size <= 0) return err("EmptyFile", 400);
    if (file.size > MAX_BYTES) {
      return err("FileTooLarge", 413, { maxBytes: MAX_BYTES });
    }

    const id = randomUUID();
    const safeName = sanitise(file.name || `upload-${id}`);
    const key = `clinics/${clinicId}/documents/${id}-${safeName}`;
    const contentType = file.type || "application/octet-stream";
    const buffer = Buffer.from(await file.arrayBuffer());

    const stored = await uploadObject(undefined, key, buffer, contentType);

    let fileUrl: string;
    if (isStubMode()) {
      // Stub mode returns a `file://` URL from the storage adapter — useless
      // to the browser. Serve the bytes back through this app instead, using
      // the current origin so the URL is absolute (the metadata schema and
      // the Doctor.signatureUrl validator both require `.url()`).
      const origin = new URL(request.url).origin;
      fileUrl = `${origin}/api/crm/documents/file?key=${encodeURIComponent(key)}`;
    } else {
      fileUrl = stored.url;
    }

    return ok({
      key,
      fileUrl,
      mimeType: contentType,
      sizeBytes: file.size,
    });
  },
);
