/**
 * GET /api/crm/conversations/[id]/attachments/file?key=<key>&name=<displayName>
 *
 * Streams a chat attachment's bytes from MinIO through the docker-internal S3
 * client. This is what the CRM bubble, the patient Mini-App bubble AND
 * Telegram all point at.
 *
 * Why this route exists / why it is intentionally UNauthenticated:
 *   • The MinIO bucket is private, so the bare `${MINIO_PUBLIC_URL}/...` URL
 *     returns 403 (AccessDenied) — Telegram's sendPhoto/sendDocument-by-URL
 *     fetch fails with "failed to get HTTP URL content".
 *   • Presigned URLs don't survive nginx's `/files/` prefix rewrite (the
 *     signature canonical path diverges → SignatureDoesNotMatch). See
 *     `api/crm/documents/file/route.ts`.
 *   • Telegram fetches the URL from the public internet with no session, and
 *     the same URL is rendered for the operator and the patient. A single
 *     shared, session-gated URL can't serve all three, so this is a
 *     capability URL: the unguessable object key (clinic cuid + conversation
 *     cuid + random uuid filename) IS the access token — the same trust model
 *     as delivering the file into the patient's Telegram chat.
 *
 * The key is pinned to THIS conversation's chat prefix, so the route can only
 * ever read `clinics/<clinic>/chat/<thisConversation>/<file>` — never patient
 * documents, DSAR exports, or another conversation's files.
 */
import { fetchObject } from "@/server/storage/minio";

export const dynamic = "force-dynamic";

function conversationIdFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../conversations/[id]/attachments/file
  return parts[parts.length - 3] ?? "";
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const name = url.searchParams.get("name") ?? "";
  const conversationId = conversationIdFromUrl(request);

  if (
    !conversationId ||
    !/^[A-Za-z0-9_-]+$/.test(conversationId) ||
    !key ||
    key.includes("..")
  ) {
    return new Response("Bad Request", { status: 400 });
  }

  // Capability scope: only this conversation's chat objects.
  const prefix = `clinics/`;
  const chatSegment = `/chat/${conversationId}/`;
  if (
    !key.startsWith(prefix) ||
    !key.includes(chatSegment) ||
    key.endsWith("/")
  ) {
    return new Response("Forbidden", { status: 403 });
  }

  let obj;
  try {
    obj = await fetchObject(undefined, key);
  } catch {
    return new Response("Not Found", { status: 404 });
  }
  if (!obj.body) return new Response("Not Found", { status: 404 });

  const headers = new Headers();
  headers.set("Content-Type", obj.contentType ?? "application/octet-stream");
  if (obj.contentLength != null) {
    headers.set("Content-Length", String(obj.contentLength));
  }
  const safeName = name.replace(/[\r\n"\\]/g, "").slice(0, 200);
  if (safeName) {
    headers.set(
      "Content-Disposition",
      `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`,
    );
  }
  headers.set("Cache-Control", "private, max-age=3600");
  return new Response(obj.body, { status: 200, headers });
}
