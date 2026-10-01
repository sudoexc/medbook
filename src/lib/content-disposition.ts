/**
 * `Content-Disposition` with a name in any script (audit AN-26).
 *
 * Header values must be ByteStrings: `new Response(body, { headers })`
 * throws «Cannot convert argument to a ByteString» on any character above
 * U+00FF. The report exports put the report's own name in
 * `filename="…"`, so «Выручка по врачам» or «Oʻrtacha chek» turned every
 * CSV / PDF export into a 500. RFC 6266 / RFC 5987 carry the real name in
 * `filename*=UTF-8''<percent-encoded>`, next to a plain ASCII `filename`
 * for clients that ignore the extended form.
 *
 * Client-safe (no server imports): the export buttons parse the header
 * with `filenameFromContentDisposition` to name the saved file.
 */

/**
 * RFC 5987 `attr-char` is narrower than what `encodeURIComponent` leaves
 * alone: `'`, `(`, `)` and `*` must be escaped too, or a name like
 * «O'rtacha» would end the `UTF-8''` prefix early in strict parsers.
 */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * ASCII stand-in for the quoted `filename`: every character outside
 * printable ASCII becomes `_`, and the quote and backslash (which would
 * break the quoted-string) are dropped. Keeps the extension readable.
 */
export function asciiFilenameFallback(filename: string): string {
  const ascii = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "")
    .trim();
  return ascii || "download";
}

/**
 * `attachment; filename="<ascii>"; filename*=UTF-8''<utf-8>` (or `inline`).
 * Always a valid ByteString, whatever the name.
 */
export function contentDisposition(
  filename: string,
  opts: { inline?: boolean } = {},
): string {
  const kind = opts.inline ? "inline" : "attachment";
  return `${kind}; filename="${asciiFilenameFallback(filename)}"; filename*=UTF-8''${encodeRfc5987(filename)}`;
}

/**
 * The file name a download should be saved under: the UTF-8 `filename*`
 * when present (decoded), else the plain `filename`, else `fallback`.
 */
export function filenameFromContentDisposition(
  header: string | null | undefined,
  fallback: string,
): string {
  if (!header) return fallback;
  const ext = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i.exec(header);
  if (ext) {
    try {
      const decoded = decodeURIComponent(ext[2]!.trim().replace(/^"|"$/g, ""));
      if (decoded) return decoded;
    } catch {
      // Malformed percent-encoding: fall through to the plain name.
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  const name = plain?.[1]?.trim();
  return name ? name : fallback;
}
