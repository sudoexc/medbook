/**
 * What a user-supplied file really is, and how it may be served back.
 *
 * Every file a patient or staff member uploads is later served from
 * neurofax.uz itself — the same origin as the CRM and its session cookie.
 * A file the browser renders as a document can run script there: an SVG
 * «фото анализа» from the Mini App, or an .html uploaded as a document,
 * opened by a receptionist «in a new tab», would act with her session
 * (audit CD-01). Two rules close that:
 *
 *   1. On upload, the type is read from the file's own bytes (magic
 *      numbers), never from the browser's `file.type` or the name. Script
 *      carriers (SVG, HTML, XML, JS) are never accepted.
 *   2. On serving, only types a browser renders WITHOUT executing script in
 *      our origin go out inline (PDF, raster images, audio, video); anything
 *      else is `application/octet-stream` + attachment. Every file response
 *      carries `nosniff`, and non-PDF ones a sandbox CSP as a second wall
 *      (not PDFs: Chrome refuses to show a sandboxed PDF).
 */

export const IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/avif",
  "image/bmp",
] as const;

/** Scans from old equipment: kept, served as a download (few browsers show them). */
export const SCAN_TYPES = ["image/tiff"] as const;

export const DOCUMENT_TYPES = ["application/pdf", ...IMAGE_TYPES] as const;

/** Office files and archives: kept, but only ever served as a download. */
export const OFFICE_TYPES = [
  "application/zip",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
] as const;

export const MEDIA_TYPES = [
  "audio/ogg",
  "audio/mpeg",
  "audio/mp4",
  "audio/wav",
  "video/mp4",
  "video/webm",
] as const;

/** Plain-text formats: no magic number (RTF has one), accepted on the declared type. */
export const TEXT_TYPES = ["text/plain", "text/csv", "application/rtf"] as const;

/** Rendered by the browser without running script in our origin. */
const INLINE_SAFE = new Set<string>([
  "application/pdf",
  ...IMAGE_TYPES,
  "image/heif",
  ...MEDIA_TYPES,
]);

/**
 * Served with their real type but ALWAYS as a download: nothing here is
 * rendered as a document, and some consumers need the honest type — Telegram
 * only accepts a document sent by URL when it is a real application/zip.
 * HTML, SVG, XML and anything unknown stay application/octet-stream.
 */
const HONEST_ATTACHMENT = new Set<string>([...OFFICE_TYPES, ...TEXT_TYPES, ...SCAN_TYPES]);

/** Legacy spellings stored by older uploads. */
const TYPE_ALIASES: Record<string, string> = {
  "application/x-pdf": "application/pdf",
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "application/x-zip-compressed": "application/zip",
};

function startsWith(buf: Uint8Array, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function ascii(buf: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...buf.subarray(from, Math.min(to, buf.length)));
}

/**
 * The file's type from its first bytes, or null when it is none of the
 * formats we accept. Deliberately a short allowlist, not a general sniffer:
 * «unknown» is a refusal, never a guess.
 */
export function sniffMime(input: Uint8Array | ArrayBuffer): string | null {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < 4) return null;

  // %PDF- — some generators put a few bytes before it; readers accept that.
  if (ascii(buf, 0, 1024).includes("%PDF-")) return "application/pdf";
  // UTF-16 text starts with a BOM that would otherwise read as an MP3 frame.
  if (startsWith(buf, [0xff, 0xfe]) || startsWith(buf, [0xfe, 0xff])) return null;
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (ascii(buf, 0, 6) === "GIF87a" || ascii(buf, 0, 6) === "GIF89a") return "image/gif";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WEBP") return "image/webp";
  if (ascii(buf, 0, 4) === "RIFF" && ascii(buf, 8, 12) === "WAVE") return "audio/wav";
  if (ascii(buf, 0, 4) === "OggS") return "audio/ogg";
  if (ascii(buf, 0, 5) === "{\\rtf") return "application/rtf";
  if (ascii(buf, 0, 2) === "BM" && buf.length > 26) return "image/bmp";
  if (startsWith(buf, [0x49, 0x49, 0x2a, 0x00]) || startsWith(buf, [0x4d, 0x4d, 0x00, 0x2a])) {
    return "image/tiff";
  }
  if (ascii(buf, 0, 3) === "ID3" || (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)) {
    return "audio/mpeg";
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) return "video/webm";
  if (ascii(buf, 4, 8) === "ftyp") {
    const brand = ascii(buf, 8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (["heic", "heix", "hevc", "heim", "heis", "mif1", "msf1"].includes(brand)) {
      return "image/heic";
    }
    if (brand.startsWith("M4A")) return "audio/mp4";
    return "video/mp4";
  }
  // Office Open XML (docx/xlsx/pptx) and plain zips share the zip header.
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return "application/zip";
  // Legacy MS Office (doc/xls/ppt): OLE2 compound file.
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return "application/msword";
  }
  return null;
}

export type UploadCheck =
  | { ok: true; mime: string }
  | { ok: false; reason: "unsupported_type"; detected: string | null };

/**
 * Accept an upload only when its bytes are one of `allowed`. Returns the
 * type to STORE — the sniffed one, never what the client declared.
 *
 * Zip-based office files sniff as `application/zip`; when the declared type
 * is a specific office format and zips are allowed, the declared office type
 * is kept for the download name — it is served as an attachment either way.
 */
export function checkUpload(
  bytes: Uint8Array | ArrayBuffer,
  declared: string | null | undefined,
  allowed: readonly string[],
  filename?: string | null,
): UploadCheck {
  const detected = sniffMime(bytes);
  const allow = new Set(allowed);
  if (!detected) {
    // Text has no signature. It is taken on the declared type only when the
    // caller allows text, and is always served back as a download — so even
    // an HTML file declared as text/plain never renders. Windows labels a
    // .csv as an Excel file, so the extension settles plain text too.
    const buf = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const binary = buf.subarray(0, 4096).includes(0);
    const ext = (filename ?? "").toLowerCase().split(".").pop() ?? "";
    const textType =
      declared && (TEXT_TYPES as readonly string[]).includes(declared)
        ? declared
        : ext === "csv"
          ? "text/csv"
          : ext === "txt"
            ? "text/plain"
            : null;
    if (textType && allow.has(textType) && !binary) {
      return { ok: true, mime: textType };
    }
    return { ok: false, reason: "unsupported_type", detected: null };
  }
  if (detected === "application/zip" || detected === "application/msword") {
    const office = declared && (OFFICE_TYPES as readonly string[]).includes(declared);
    if (office && allow.has(declared!)) return { ok: true, mime: declared! };
    if (allow.has(detected)) return { ok: true, mime: detected };
    return { ok: false, reason: "unsupported_type", detected };
  }
  if (!allow.has(detected)) return { ok: false, reason: "unsupported_type", detected };
  return { ok: true, mime: detected };
}

/**
 * Headers for serving a stored user file. `storedType` is whatever the
 * object was saved with (old uploads may carry anything, SVG included).
 */
export function safeFileHeaders(
  storedType: string | null | undefined,
  opts: { download?: boolean; filename: string },
): Record<string, string> {
  const raw = (storedType ?? "").split(";")[0]!.trim().toLowerCase();
  const type = TYPE_ALIASES[raw] ?? raw;
  const inline = INLINE_SAFE.has(type) && !opts.download;
  const contentType =
    INLINE_SAFE.has(type) || HONEST_ATTACHMENT.has(type)
      ? type
      : "application/octet-stream";

  const asciiName = opts.filename.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  const utf8Name = encodeURIComponent(opts.filename);
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${utf8Name}`,
    "X-Content-Type-Options": "nosniff",
  };
  if (contentType !== "application/pdf") {
    headers["Content-Security-Policy"] =
      "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'";
  }
  return headers;
}
