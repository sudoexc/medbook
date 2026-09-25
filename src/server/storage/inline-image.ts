/**
 * A stored image as a data: URI, for pages that are printed or saved to PDF.
 *
 * Print pages put the clinic letterhead and logo, the doctor's signature and
 * the drug pack photos in `<img src>`. With the stored bare MinIO URL they
 * printed as broken images (private bucket, audit CD-02), and even our own
 * proxy URL fails once the page is opened from a PDF viewer with no session.
 * Embedding the bytes makes the printout self-contained.
 *
 * Only raster images of the caller's own clinic are embedded; anything else
 * (another clinic's key, an SVG, a file too big to inline) yields null and
 * the page falls back to its text-only layout. URLs that are not in our
 * storage (a dev `/uploads/…` file, an existing data: URI) pass through.
 */
import { isClinicOwnedKey, storageKeyFromUrl } from "@/lib/storage-ref";
import { fetchObject } from "@/server/storage/minio";
import { IMAGE_TYPES, sniffMime } from "@/server/storage/safe-file";

/** A letterhead scan is the biggest thing we inline; more is a mistake. */
const MAX_INLINE_BYTES = 4 * 1024 * 1024;

export async function inlineStorageImage(
  url: string | null | undefined,
  clinicId: string,
): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith("data:")) return url;
  const key = storageKeyFromUrl(url);
  if (!key) return url;
  if (!isClinicOwnedKey(key, clinicId)) return null;
  try {
    const object = await fetchObject(undefined, key);
    if (!object.body) return null;
    if (object.contentLength != null && object.contentLength > MAX_INLINE_BYTES) {
      return null;
    }
    const bytes = new Uint8Array(await new Response(object.body).arrayBuffer());
    if (bytes.byteLength > MAX_INLINE_BYTES) return null;
    // Typed by the bytes, like every upload: an SVG must never be inlined.
    const mime = sniffMime(bytes);
    if (!mime || !(IMAGE_TYPES as readonly string[]).includes(mime)) return null;
    return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
  } catch (e) {
    console.warn("[print] image not embedded", { key, e });
    return null;
  }
}
