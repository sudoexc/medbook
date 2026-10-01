/**
 * Which stored object a Document may point at, and which one it may delete
 * (audit CD-08).
 *
 * `Document.fileUrl` used to be any string the client sent. The documents
 * list shows every row's URL, so staff could copy a colleague's file (or,
 * knowing the key, another clinic's) onto a new document, then:
 *   - delete «their» document, and DELETE removed the shared object: the
 *     colleague's row stayed and its file was a 404 forever;
 *   - press «send to Telegram», and the patient received someone else's
 *     medical file (send-telegram also read any bucket named in the URL).
 *
 * The rules now:
 *   - A stored object can be attached only with the receipt the upload route
 *     issued for it (`uploadToken`, an HMAC over clinic + key + expiry), and
 *     only under this clinic's `clinics/<id>/documents/` folder. Anything
 *     else pointing into our storage is refused.
 *   - Anything that is not our storage is an external link: `https:` only,
 *     never fetched, never deleted. The signature pad uploads its PNG like
 *     any other file (audit CD-05), so no data: value is accepted.
 *   - An object is deleted only from this clinic's documents folder, and
 *     only when no other document (or doctor signature) still uses it.
 */
import type { prisma } from "@/lib/prisma";
import { appHmac, appHmacMatches } from "@/server/crypto/app-hmac";
import { isClinicOwnedKey, storageKeyFromUrl } from "@/lib/storage-ref";

const UPLOAD_PURPOSE = "document-upload-v1";
/** How long an upload receipt stays valid: the dialog is filled in minutes. */
export const UPLOAD_TOKEN_TTL_MS = 60 * 60 * 1000;

/** This clinic's folder for uploaded document bytes. */
export function clinicDocumentsPrefix(clinicId: string): string {
  return `clinics/${clinicId}/documents/`;
}

function uploadMessage(clinicId: string, key: string, expiresAt: number): string {
  return `${clinicId}\n${key}\n${expiresAt}`;
}

/** Receipt for bytes the upload route just stored under `key`. */
export function signDocumentUpload(
  clinicId: string,
  key: string,
  now: number = Date.now(),
): string {
  const expiresAt = now + UPLOAD_TOKEN_TTL_MS;
  return `${expiresAt}.${appHmac(UPLOAD_PURPOSE, uploadMessage(clinicId, key, expiresAt))}`;
}

export function verifyDocumentUpload(
  clinicId: string,
  key: string,
  token: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!token) return false;
  const dot = token.indexOf(".");
  if (dot <= 0) return false;
  const expiresAt = Number(token.slice(0, dot));
  if (!Number.isSafeInteger(expiresAt) || expiresAt < now) return false;
  return appHmacMatches(
    UPLOAD_PURPOSE,
    uploadMessage(clinicId, key, expiresAt),
    token.slice(dot + 1),
  );
}

export type DocumentFileCheck =
  /** `key` is the stored object, or null for an external https link. */
  | { ok: true; key: string | null }
  | {
      ok: false;
      reason: "file_not_issued" | "external_url_not_https";
    };

/**
 * May a new or replaced `fileUrl` be written onto a document of `clinicId`?
 * Pure: the «is the object already used by another document» half is
 * `storageKeyInUse`, which needs the database.
 */
export function checkDocumentFileUrl(input: {
  clinicId: string;
  fileUrl: string;
  uploadToken?: string | null;
  now?: number;
}): DocumentFileCheck {
  const key = storageKeyFromUrl(input.fileUrl);
  if (key) {
    if (
      !key.startsWith(clinicDocumentsPrefix(input.clinicId)) ||
      !verifyDocumentUpload(input.clinicId, key, input.uploadToken, input.now)
    ) {
      return { ok: false, reason: "file_not_issued" };
    }
    return { ok: true, key };
  }
  let parsed: URL;
  try {
    parsed = new URL(input.fileUrl.trim());
  } catch {
    return { ok: false, reason: "external_url_not_https" };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "external_url_not_https" };
  }
  return { ok: true, key: null };
}

type DocumentFileDb = Pick<typeof prisma, "document" | "doctor">;

/**
 * Does any document other than `exceptDocumentId`, or any doctor signature,
 * still point at `key`? Stored URLs carry the key raw (MinIO URL) or
 * encoded (our proxy URL, stub mode), so both spellings are searched.
 */
export async function storageKeyInUse(
  db: DocumentFileDb,
  key: string,
  exceptDocumentId?: string,
): Promise<boolean> {
  const spellings = [
    { contains: key },
    { contains: encodeURIComponent(key) },
  ];
  const doc = await db.document.findFirst({
    where: {
      OR: spellings.map((fileUrl) => ({ fileUrl })),
      ...(exceptDocumentId ? { id: { not: exceptDocumentId } } : {}),
    },
    select: { id: true },
  });
  if (doc) return true;
  const signer = await db.doctor.findFirst({
    where: { OR: spellings.map((signatureUrl) => ({ signatureUrl })) },
    select: { id: true },
  });
  return signer !== null;
}

/**
 * The object behind `fileUrl` that a document of `clinicId` may delete: in
 * this clinic's documents folder and used by no other document or
 * signature. Null means «leave storage alone».
 */
export async function deletableDocumentKey(
  db: DocumentFileDb,
  clinicId: string,
  fileUrl: string,
  exceptDocumentId?: string,
): Promise<string | null> {
  const key = storageKeyFromUrl(fileUrl);
  if (!key || !key.startsWith(clinicDocumentsPrefix(clinicId))) return null;
  if (await storageKeyInUse(db, key, exceptDocumentId)) return null;
  return key;
}

/**
 * The object behind a stored URL that may be READ on behalf of `clinicId`
 * and sent out (to the patient's Telegram): a document of this clinic lives
 * under `clinics/<id>/`, a pack shot under `drugs/<id>/`, both in the main
 * bucket. The bucket named in the URL is never trusted. Null for anything
 * else, which the caller skips.
 */
export function clinicReadableKey(
  fileUrl: string | null | undefined,
  clinicId: string,
  kind: "document" | "packShot",
): string | null {
  const key = storageKeyFromUrl(fileUrl);
  if (!key || !isClinicOwnedKey(key, clinicId)) return null;
  const root = kind === "document" ? "clinics" : "drugs";
  return key.startsWith(`${root}/${clinicId}/`) ? key : null;
}
