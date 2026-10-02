/**
 * Document files in storage that nothing points at (audit G1-13).
 *
 * A document is uploaded in two steps: the bytes first (POST
 * /api/crm/documents/upload stores them under `clinics/<clinic>/documents/`),
 * then the row that names them. When the second step never lands (the
 * session expired, the tab was closed, the network dropped, or the save was
 * refused and so was the clean-up call) the bytes stay in the bucket: a
 * patient's scan that no list shows, no DSAR erasure finds and no access log
 * covers. The dialogs take such an upload back when they still can (CM-05);
 * this is the backstop for when they cannot.
 *
 * The operator's report (scripts/fix-g1-13-orphan-document-files.ts) lists,
 * and with APPLY=1 deletes, every object in a documents folder that
 *   - is older than a day, far past the hour an upload receipt stays valid,
 *     so an upload whose dialog is still open is never touched; and
 *   - is named by no stored URL in any column a documents-folder file can
 *     end up in.
 *
 * A doctor's signature is uploaded the same way. A replaced one is not
 * deleted on the spot, because issued e-prescriptions and sick leaves keep a
 * snapshot of the URL; once none of them does, it is an orphan like any
 * other and this report finds it.
 */
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import { storageKeyFromUrl } from "@/lib/storage-ref";
import type { StoredObjectInfo } from "@/server/storage/minio";

/** Where the report lists from: every clinic's folders. */
export const DOCUMENT_OBJECTS_PREFIX = "clinics/";

/** Younger objects may still be attached: the receipt lives an hour. */
export const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

/** `clinics/<clinic>/documents/<name>`, the upload routes' folder. */
export function isDocumentObjectKey(key: string): boolean {
  return /^clinics\/[^/]+\/documents\/[^/]/.test(key);
}

// The plain client: the operator script reads every clinic, outside any
// tenant scope.
type ReferenceDb = Pick<
  PrismaClient,
  | "document"
  | "doctor"
  | "ePrescription"
  | "sickLeave"
  | "user"
  | "patient"
  | "labResult"
  | "payment"
  | "invoice"
  | "clinic"
  | "message"
>;

/**
 * Every stored value that may name a documents-folder object: the URL
 * columns, and chat attachments as their JSON text. Deliberately wider than
 * where uploads go today (photos, receipts, letterheads take free URLs), so
 * an object something still shows is never reported.
 */
export async function loadDocumentFileReferences(
  db: ReferenceDb,
): Promise<string[]> {
  const [
    documents,
    doctors,
    prescriptions,
    sickLeaves,
    users,
    patients,
    labs,
    payments,
    invoices,
    clinics,
    messages,
  ] = await Promise.all([
    db.document.findMany({ select: { fileUrl: true } }),
    db.doctor.findMany({
      where: { OR: [{ signatureUrl: { not: null } }, { photoUrl: { not: null } }] },
      select: { signatureUrl: true, photoUrl: true },
    }),
    db.ePrescription.findMany({
      where: { signatureUrl: { not: null } },
      select: { signatureUrl: true },
    }),
    db.sickLeave.findMany({
      where: { signatureUrl: { not: null } },
      select: { signatureUrl: true },
    }),
    db.user.findMany({
      where: { photoUrl: { not: null } },
      select: { photoUrl: true },
    }),
    db.patient.findMany({
      where: { photoUrl: { not: null } },
      select: { photoUrl: true },
    }),
    db.labResult.findMany({
      where: { attachmentUrl: { not: null } },
      select: { attachmentUrl: true },
    }),
    db.payment.findMany({
      where: { receiptUrl: { not: null } },
      select: { receiptUrl: true },
    }),
    db.invoice.findMany({
      where: { pdfUrl: { not: null } },
      select: { pdfUrl: true },
    }),
    db.clinic.findMany({ select: { logoUrl: true, letterheadUrl: true } }),
    db.message.findMany({
      where: { attachments: { not: Prisma.AnyNull } },
      select: { attachments: true },
    }),
  ]);

  const out: string[] = [];
  const add = (v: string | null | undefined) => {
    if (v) out.push(v);
  };
  for (const d of documents) add(d.fileUrl);
  for (const d of doctors) {
    add(d.signatureUrl);
    add(d.photoUrl);
  }
  for (const r of prescriptions) add(r.signatureUrl);
  for (const s of sickLeaves) add(s.signatureUrl);
  for (const u of users) add(u.photoUrl);
  for (const p of patients) add(p.photoUrl);
  for (const l of labs) add(l.attachmentUrl);
  for (const p of payments) add(p.receiptUrl);
  for (const i of invoices) add(i.pdfUrl);
  for (const c of clinics) {
    add(c.logoUrl);
    add(c.letterheadUrl);
  }
  for (const m of messages) add(JSON.stringify(m.attachments));
  return out;
}

/**
 * The documents-folder objects old enough and named by no reference.
 *
 * A reference counts when it parses to the object's key (any URL shape we
 * have persisted: MinIO, stub, our proxy) or merely contains the key, raw or
 * encoded, the same rule `storageKeyInUse` applies. Erring towards «still
 * used» only ever keeps a file.
 */
export function findOrphanDocumentObjects(input: {
  objects: readonly StoredObjectInfo[];
  references: readonly string[];
  now: Date;
  minAgeMs?: number;
}): StoredObjectInfo[] {
  const minAgeMs = input.minAgeMs ?? ORPHAN_MIN_AGE_MS;
  const parsed = new Set<string>();
  for (const ref of input.references) {
    const key = storageKeyFromUrl(ref);
    if (key) parsed.add(key);
  }
  const cutoff = input.now.getTime() - minAgeMs;
  return input.objects.filter((o) => {
    if (!isDocumentObjectKey(o.key)) return false;
    // No timestamp, no proof it is old: keep it.
    if (!o.lastModified || o.lastModified.getTime() > cutoff) return false;
    if (parsed.has(o.key)) return false;
    const encoded = encodeURIComponent(o.key);
    return !input.references.some(
      (ref) => ref.includes(o.key) || ref.includes(encoded),
    );
  });
}
