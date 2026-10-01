/**
 * GET /api/miniapp/documents/<id>/file?clinicSlug=…&t=… — stream the
 * patient's document bytes.
 *
 * Why this exists: presigned MinIO URLs can't survive the `/files/` proxy
 * (nginx strips the prefix, so the path the signer canonicalised and the
 * path MinIO sees diverge → `SignatureDoesNotMatch`). Instead of fighting
 * nginx, we proxy bytes through the app, using the docker-internal MinIO
 * endpoint where no rewriting happens.
 *
 * Auth: `<a href="...">` opens in a fresh tab (often the external browser)
 * without our custom headers. The URL carries `t`, a link for THIS document
 * the documents / visits lists mint (audit MA-07: it used to carry the
 * patient's initData, the key to the whole account). A request with the
 * initData header is still served, for the owner or a relative he acts for
 * (`?onBehalfOf=`, family link checked, audit MA-18); a link names the
 * patient it was minted for.
 */
import { prisma } from "@/lib/prisma";
import { runWithTenant } from "@/lib/tenant-context";
import { err } from "@/server/http";
import { safeFileHeaders } from "@/server/storage/safe-file";
import {
  resolveMiniAppContext,
  resolveMiniAppLink,
} from "@/server/miniapp/handler";
import { fetchObject } from "@/server/storage/minio";
import { expiredMiniAppLinkPage } from "@/server/miniapp/link-page";
import { resolveActivePatient } from "@/server/miniapp/active-patient";
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
  let owner: { clinicId: string; patientId: string };
  if (new URL(request.url).searchParams.has("t")) {
    const link = await resolveMiniAppLink(request, { scope: "doc", resourceId: id });
    if (!link.ok) return expiredMiniAppLinkPage(link.response.status);
    owner = { clinicId: link.link.clinicId, patientId: link.link.patientId };
  } else {
    const resolved = await resolveMiniAppContext(request);
    if (!resolved.ok) return resolved.response;
    const { ctx } = resolved;
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
    owner = { clinicId: ctx.clinicId, patientId: acting.patientId };
  }

  return runWithTenant({ kind: "SYSTEM" }, async () => {
    // A voided document (CD-09) has left the patient's list; an old link
    // to it opens nothing either.
    const doc = await prisma.document.findFirst({
      where: {
        id,
        clinicId: owner.clinicId,
        patientId: owner.patientId,
        voidedAt: null,
      },
      select: { id: true, fileUrl: true, mimeType: true, title: true },
    });
    if (!doc) return err("NotFound", 404);
    const key = extractKey(doc.fileUrl, owner.clinicId);
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
