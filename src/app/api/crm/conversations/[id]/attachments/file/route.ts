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
import { fetchObject, parseSingleByteRange } from "@/server/storage/minio";
import { safeFileHeaders } from "@/server/storage/safe-file";

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

  // Byte ranges let the bubble's <audio>/<video> seek, and Safari refuses to
  // play media from a server that ignores them (audit TG-01).
  const range = parseSingleByteRange(request.headers.get("range"));
  let obj;
  try {
    obj = await fetchObject(undefined, key, { range });
  } catch {
    // An unsatisfiable range (416 from storage) falls back to the whole file.
    try {
      if (!range) throw new Error("not found");
      obj = await fetchObject(undefined, key);
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }
  if (!obj.body) return new Response("Not Found", { status: 404 });

  // Only inert types (photos, PDF, voice/video) preview inline; an SVG or
  // HTML a patient sent through the bot is a download with nosniff and a
  // sandbox CSP, never a page on our origin (audit CD-01).
  const safeName = name.replace(/[\r\n"\\]/g, "").slice(0, 200) || "file";
  const headers = new Headers(
    safeFileHeaders(obj.contentType, { filename: safeName }),
  );
  if (obj.contentLength != null) {
    headers.set("Content-Length", String(obj.contentLength));
  }
  headers.set("Accept-Ranges", "bytes");
  headers.set("Cache-Control", "private, max-age=3600");
  if (obj.contentRange) {
    headers.set("Content-Range", obj.contentRange);
    return new Response(obj.body, { status: 206, headers });
  }
  return new Response(obj.body, { status: 200, headers });
}
