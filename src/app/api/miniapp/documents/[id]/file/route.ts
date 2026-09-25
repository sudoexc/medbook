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
import { safeFileHeaders } from "@/server/storage/safe-file";
import { resolveMiniAppContext } from "@/server/miniapp/handler";
import { fetchObject } from "@/server/storage/minio";
import { isClinicOwnedKey, storageKeyFromUrl } from "@/lib/storage-ref";

/**
 * Stored fileUrls vary by historical encoding —
 *   - `https://neurofax.uz/files/medbook/clinics/<...>/documents/<file>`
 *   - `file:///tmp/medbook-uploads/medbook/clinics/<...>` (stub mode)
 *   - `/api/crm/documents/file?key=clinics%2F…` (our proxy)
 * One parser for all of them, shared with the staff side (audit CD-02), and
 * only a key in this clinic's own folder is ever read.
 */
function extractKey(fileUrl: string, clinicId: string): string | null {
  const key = storageKeyFromUrl(fileUrl);
  return key && isClinicOwnedKey(key, clinicId) ? key : null;
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
    const key = extractKey(doc.fileUrl, ctx.clinicId);
    if (!key) return err("BadFileUrl", 422);

    let fetched: Awaited<ReturnType<typeof fetchObject>>;
    try {
      fetched = await fetchObject(undefined, key);
    } catch {
      return err("StorageUnavailable", 502);
    }
    if (!fetched.body) return err("EmptyBody", 502);

    // Only inert types (PDF, photos) preview inline; anything else — an old
    // upload stored as SVG or HTML included — is a download with nosniff and
    // a sandbox CSP, so it can never run script on our origin (audit CD-01).
    // `?download=1` forces a Save-As dialog.
    const wantsDownload = new URL(request.url).searchParams.get("download") === "1";
    const headers: Record<string, string> = {
      ...safeFileHeaders(
        doc.mimeType || fetched.contentType || "application/octet-stream",
        { download: wantsDownload, filename: doc.title || "document" },
      ),
      "Cache-Control": "private, max-age=60",
    };
    if (fetched.contentLength != null) {
      headers["Content-Length"] = String(fetched.contentLength);
    }
    return new Response(fetched.body, { status: 200, headers });
  });
}
