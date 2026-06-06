/**
 * GET /api/miniapp/documents/<id>/file?clinicSlug=…&initData=… — stream the
 * patient's document bytes.
 *
 * Why this exists: presigned MinIO URLs can't survive the `/files/` proxy
 * (nginx strips the prefix, so the path the signer canonicalised and the
 * path MinIO sees diverge → `SignatureDoesNotMatch`). Instead of fighting
 * nginx, we proxy bytes through the app, using the docker-internal MinIO
 * endpoint where no rewriting happens.
 *
 * Auth: `<a href="...">` opens in a fresh tab without our custom headers,
 * so we fall back to the `?initData=…` URL parameter that
 * `resolveMiniAppContext` already supports (same path the SSE endpoint uses).
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { err } from "@/server/http";
import { resolveMiniAppContext } from "@/server/miniapp/handler";
import { fetchObject } from "@/server/storage/minio";

/**
 * Stored fileUrls vary by historical encoding —
 *   - `https://neurofax.uz/files/medbook/clinics/<...>/documents/<file>`
 *   - `file:///tmp/medbook-uploads/medbook/clinics/<...>` (stub mode)
 * but the canonical S3 key always begins at `clinics/`. Slice from there
 * so we recover the same key the bucket uses regardless of how the URL
 * was assembled at write time.
 */
function extractKey(fileUrl: string): string | null {
  const idx = fileUrl.indexOf("/clinics/");
  if (idx < 0) return null;
  return fileUrl.slice(idx + 1);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const resolved = await resolveMiniAppContext(request);
  if (!resolved.ok) return resolved.response;
  const { ctx } = resolved;

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    const doc = await prisma.document.findFirst({
      where: { id, clinicId: ctx.clinicId, patientId: ctx.patientId },
      select: { id: true, fileUrl: true, mimeType: true, title: true },
    });
    if (!doc) return err("NotFound", 404);
    const key = extractKey(doc.fileUrl);
    if (!key) return err("BadFileUrl", 422);

    let fetched: Awaited<ReturnType<typeof fetchObject>>;
    try {
      fetched = await fetchObject(undefined, key);
    } catch {
      return err("StorageUnavailable", 502);
    }
    if (!fetched.body) return err("EmptyBody", 502);

    const contentType =
      doc.mimeType || fetched.contentType || "application/octet-stream";
    // HTTP header values are byte strings, so a Cyrillic title like
    // "Фото от пациента" (the patient-upload default) crashes the Response
    // constructor with a TypeError. Per RFC 6266 §5, use `filename*=UTF-8''…`
    // for non-ASCII names, with an ASCII-safe `filename=` fallback for ancient
    // clients.
    const rawTitle = doc.title || "document";
    const asciiName = rawTitle.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
    const utf8Name = encodeURIComponent(rawTitle);
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Disposition": `inline; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
      "Cache-Control": "private, max-age=60",
    };
    if (fetched.contentLength != null) {
      headers["Content-Length"] = String(fetched.contentLength);
    }
    return new Response(fetched.body, { status: 200, headers });
  });
}
