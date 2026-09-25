/**
 * Where a stored file really lives, and the only URL a browser may use for it.
 *
 * The bucket is private: the «public» URL `uploadObject` returns
 * (`${MINIO_PUBLIC_URL}/<bucket>/<key>`) answers AccessDenied, and a
 * presigned one breaks on nginx's `/files/` rewrite. Yet that URL is what
 * rows store (Document.fileUrl, Doctor.signatureUrl, Clinic.letterheadUrl
 * and logoUrl, Drug.photoUrl), and pages that rendered it as is showed
 * «AccessDenied» or a broken image (audit CD-02). Every staff-facing file
 * therefore goes through `/api/crm/documents/file?key=…`, which streams the
 * object with the internal client and checks the key belongs to the
 * caller's clinic; print pages embed images as data: URIs instead.
 *
 * Pure and isomorphic: the server maps URLs before they leave an API, the
 * client uses the same function as a last line of defence.
 */

/** Top-level key folders, each followed by the owning clinic's id. */
const KEY_ROOTS = ["clinics", "drugs", "letterhead", "branding"] as const;

const STAFF_FILE_ROUTE = "/api/crm/documents/file";

const ROOTS = KEY_ROOTS.join("|");
/**
 * `${MINIO_PUBLIC_URL}/<bucket>/<key>`: the key right after ONE bucket
 * segment, optionally behind nginx's `/files` prefix. Anchored, so a foreign
 * URL that merely contains `/drugs/` deeper in its path is not taken for ours.
 */
const BUCKET_PATH = new RegExp(`^(?:/files)?/[^/]+/((?:${ROOTS})/.+)$`);
/** Stub mode: `file://<tmp>/medbook-uploads/<bucket>/<key>`. */
const STUB_PATH = new RegExp(`/medbook-uploads/[^/]+/((?:${ROOTS})/.+)$`);

function validKey(key: string | null | undefined): string | null {
  if (!key) return null;
  const k = key.trim();
  if (
    k.startsWith("/") ||
    k.includes("\\") ||
    k.split("/").some((seg) => seg === ".." || seg === ".")
  ) {
    return null;
  }
  // root / clinicId / something
  const [root, owner, ...rest] = k.split("/");
  if (!KEY_ROOTS.includes(root as (typeof KEY_ROOTS)[number])) return null;
  if (!owner || rest.length === 0 || !rest.join("/")) return null;
  return k;
}

/**
 * The storage key behind any URL shape we have ever persisted: the raw
 * MinIO URL, the stub `file://` path, our own proxy URL (relative or
 * absolute). Null for data: URIs, files served from /public (`/uploads/…`
 * in dev) and anything foreign.
 */
export function storageKeyFromUrl(url: string | null | undefined): string | null {
  const raw = url?.trim();
  if (!raw || raw.startsWith("data:")) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw, "http://local.invalid");
  } catch {
    return null;
  }
  if (parsed.pathname.endsWith(STAFF_FILE_ROUTE)) {
    return validKey(parsed.searchParams.get("key"));
  }
  if (parsed.pathname.startsWith("/uploads/")) return null;
  let path: string;
  try {
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return null;
  }
  const match = (parsed.protocol === "file:" ? STUB_PATH : BUCKET_PATH).exec(
    path,
  );
  return validKey(match?.[1]);
}

/** Does `key` sit in a folder owned by `clinicId`? */
export function isClinicOwnedKey(key: string, clinicId: string): boolean {
  if (!validKey(key) || !clinicId) return false;
  return KEY_ROOTS.some((root) => key.startsWith(`${root}/${clinicId}/`));
}

/**
 * The URL a staff page may put in `href`/`src`: our streaming proxy for any
 * stored object, the value unchanged for everything else (data: URIs, dev
 * /uploads files, null). Idempotent: a proxy URL maps to itself.
 */
export function staffFileHref(
  url: string,
  opts?: { download?: boolean },
): string;
export function staffFileHref(
  url: string | null | undefined,
  opts?: { download?: boolean },
): string | null;
export function staffFileHref(
  url: string | null | undefined,
  opts?: { download?: boolean },
): string | null {
  if (url == null) return null;
  const key = storageKeyFromUrl(url);
  return key ? staffKeyHref(key, opts) : url;
}

/** The staff proxy URL for a storage key we already hold. */
export function staffKeyHref(
  key: string,
  opts?: { download?: boolean },
): string {
  return `${STAFF_FILE_ROUTE}?key=${encodeURIComponent(key)}${
    opts?.download ? "&download=1" : ""
  }`;
}

/** A row with a stored `fileUrl`, as a staff page may use it. */
export function withStaffFileUrl<T extends { fileUrl: string }>(row: T): T {
  return { ...row, fileUrl: staffFileHref(row.fileUrl) };
}
