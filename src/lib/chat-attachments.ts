/**
 * Shared policy for CRM ↔ patient chat attachments.
 *
 * Both the upload route (`/api/crm/conversations/[id]/attachments`) and the
 * composer client import from here so the allowed MIME set, size cap and
 * extension mapping can never drift apart.
 *
 * Size cap is 20 MB: Telegram's `sendDocument`-by-URL ceiling. (Photos by URL
 * are capped lower by Telegram, but phone photos are well under that.)
 */

export const CHAT_MAX_BYTES = 20 * 1024 * 1024;
export const CHAT_MAX_ATTACHMENTS = 10;

export const CHAT_ALLOWED_MIME: ReadonlySet<string> = new Set([
  // Images
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "application/rtf",
  "application/zip",
  "application/x-zip-compressed",
]);

/** Comma-separated value for an `<input accept>` attribute. */
export const CHAT_ACCEPT_ATTR = Array.from(CHAT_ALLOWED_MIME).join(",");

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/rtf": "rtf",
  "application/zip": "zip",
  "application/x-zip-compressed": "zip",
};

/** Best-effort file extension from MIME, falling back to the filename suffix. */
export function chatExtFor(mime: string, fileName?: string): string {
  const fromMime = MIME_TO_EXT[mime];
  if (fromMime) return fromMime;
  const m = fileName?.match(/\.([a-z0-9]{1,8})$/i);
  return m ? m[1].toLowerCase() : "bin";
}

export function isChatImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

export type ChatAttachmentKind = "image" | "file";

export function chatAttachmentKind(mime: string): ChatAttachmentKind {
  return isChatImageMime(mime) ? "image" : "file";
}

/** Human-readable size, e.g. "1.4 MB". Empty string for unknown values. */
export function formatBytes(n: number | undefined | null): string {
  if (n == null || !Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
