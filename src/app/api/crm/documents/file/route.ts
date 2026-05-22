/**
 * GET /api/crm/documents/file?key=<key> — serve document bytes.
 *
 * Two modes mirror the storage adapter:
 *   - Stub mode → read the file from the local stub root and stream it back.
 *   - MinIO/S3 mode → 302 to a short-lived presigned download URL.
 *
 * Tenant scoping: the key must begin with `clinics/<ctx.clinicId>/` so a
 * caller can only read their own clinic's documents. SUPER_ADMIN without
 * impersonation does not see any tenant data — they have to enter a clinic
 * first (matches the rest of /api/crm).
 */
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApiListHandler } from "@/lib/api-handler";
import { err } from "@/server/http";
import { getSignedUrl, isStubMode } from "@/server/storage/minio";

function stubBucketRoot(): string {
  const bucket = process.env.MINIO_BUCKET || "medbook";
  return path.join(tmpdir(), "medbook-uploads", bucket);
}

function safeJoin(root: string, key: string): string | null {
  const cleaned = key.replace(/\\/g, "/").replace(/\.\.(?:\/|$)/g, "");
  const resolved = path.resolve(root, cleaned);
  const normRoot = path.resolve(root) + path.sep;
  if (!resolved.startsWith(normRoot)) return null;
  return resolved;
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    const url = new URL(request.url);
    const key = url.searchParams.get("key");
    if (!key) return err("MissingKey", 400);

    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    if (!clinicId) return err("ClinicNotSelected", 400);

    const expectedPrefix = `clinics/${clinicId}/`;
    if (!key.startsWith(expectedPrefix)) return err("Forbidden", 403);

    if (isStubMode()) {
      const filePath = safeJoin(stubBucketRoot(), key);
      if (!filePath) return err("BadKey", 400);
      let bytes: Buffer;
      try {
        bytes = await fs.readFile(filePath);
      } catch (e: unknown) {
        const code = (e as NodeJS.ErrnoException)?.code;
        if (code === "ENOENT") return err("NotFound", 404);
        throw e;
      }
      const downloadName = path.basename(key);
      return new Response(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `inline; filename="${downloadName.replace(/"/g, "")}"`,
          "Cache-Control": "private, max-age=60",
        },
      });
    }

    const signed = await getSignedUrl(undefined, key, 300);
    return Response.redirect(signed, 302);
  },
);
