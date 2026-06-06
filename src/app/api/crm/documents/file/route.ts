/**
 * GET /api/crm/documents/file?key=<key> — serve document bytes.
 *
 * Stream the bytes through the app using the docker-internal MinIO endpoint.
 * We can't redirect to a presigned URL: nginx's `/files/` location strips the
 * prefix before forwarding to MinIO, so the canonical path the SDK signed
 * doesn't match the path MinIO sees → `SignatureDoesNotMatch`. The miniapp
 * proxy made the same call (see `/api/miniapp/documents/[id]/file/route.ts`).
 *
 * Tenant scoping: the key must begin with `clinics/<ctx.clinicId>/` so a
 * caller can only read their own clinic's documents. SUPER_ADMIN without
 * impersonation does not see any tenant data — they have to enter a clinic
 * first (matches the rest of /api/crm).
 */
import path from "node:path";

import { createApiListHandler } from "@/lib/api-handler";
import { err } from "@/server/http";
import { fetchObject } from "@/server/storage/minio";

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

    let fetched: Awaited<ReturnType<typeof fetchObject>>;
    try {
      fetched = await fetchObject(undefined, key);
    } catch (e: unknown) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") return err("NotFound", 404);
      return err("StorageUnavailable", 502);
    }
    if (!fetched.body) return err("EmptyBody", 502);

    // Per RFC 6266: bare `filename=` must be ASCII; non-ASCII (e.g. Cyrillic
    // titles) need `filename*=UTF-8''…` or the Response constructor throws
    // with a ByteString error. The basename here is the storage key suffix
    // (always ASCII), so a plain filename is safe — but we keep the fallback
    // pattern explicit so future changes don't regress silently.
    const downloadName = path.basename(key);
    const asciiName = downloadName
      .replace(/[^\x20-\x7E]/g, "_")
      .replace(/"/g, "");
    const utf8Name = encodeURIComponent(downloadName);
    // `?download=1` forces a Save-As dialog (attachment); default `inline`
    // lets PDFs/images render in a new tab for quick preview. Matches the
    // Mini App route's behaviour so the two surfaces stay consistent.
    const wantsDownload = url.searchParams.get("download") === "1";
    const disposition = wantsDownload ? "attachment" : "inline";
    return new Response(fetched.body, {
      status: 200,
      headers: {
        "Content-Type":
          fetched.contentType ?? "application/octet-stream",
        "Content-Disposition": `${disposition}; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
        "Cache-Control": "private, max-age=60",
        ...(fetched.contentLength != null
          ? { "Content-Length": String(fetched.contentLength) }
          : {}),
      },
    });
  },
);
