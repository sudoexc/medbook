/**
 * /api/crm/documents/[id] — get, delete document record.
 * See docs/TZ.md §6.5.
 *
 * DELETE also tries to remove the underlying storage object so the bucket
 * doesn't leak. Storage failures are swallowed — losing a row over a missing
 * blob would block legitimate deletes. Only an object in this clinic's
 * documents folder that no other document still uses is ever removed
 * (audit CD-08, see `@/server/documents/file-ref`).
 *
 * Legal records are never deleted and never get a new file (audit CD-09,
 * see `@/lib/document-guards`): a rendered conclusion or referral answers
 * 409 `rendered_document`, a signed consent or contract 409
 * `signed_document` (ADMIN voids a misfiled one instead, see `./void`).
 * Every edit and deletion is published to the patient's Mini App
 * (`document.updated` / `document.deleted`).
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { notePatientView } from "@/server/audit/patient-view";
import { audit } from "@/lib/audit";
import { ok, err, notFound, diff } from "@/server/http";
import { deleteObject } from "@/server/storage/minio";
import { UpdateDocumentSchema } from "@/server/schemas/document";
import { withStaffFileUrl } from "@/lib/storage-ref";
import {
  checkDocumentFileUrl,
  deletableDocumentKey,
  storageKeyInUse,
} from "@/server/documents/file-ref";
import {
  documentDeleteLock,
  documentReplaceLock,
  isVoidedDocument,
  type DocumentLock,
} from "@/lib/document-guards";
import { publishDocumentChange } from "@/server/documents/change-events";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

function lockedResponse(lock: DocumentLock): Response {
  return lock === "rendered_document"
    ? err("ReadOnlyRenderedDocument", 409, {
        reason: lock,
        message:
          "This document is rendered from its source record (visit note / referral) and cannot be edited or deleted directly.",
      })
    : err("SignedDocumentLocked", 409, {
        reason: lock,
        message:
          "A signed consent or contract is a legal record: it cannot be deleted and its file cannot be replaced.",
      });
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const row = await prisma.document.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, fullName: true } },
        appointment: { select: { id: true, date: true } },
        uploadedBy: { select: { id: true, name: true } },
      },
    });
    if (!row) return notFound();
    // A patient's document opened: a chart read (audit G1-06).
    notePatientView(prisma, request, ctx, row.patientId, "document.file", row.id);
    return ok(withStaffFileUrl(row));
  }
);

/**
 * PATCH — edit an *uploaded* document: rename, change type, or replace the
 * underlying file (bytes are uploaded via POST /api/crm/documents/upload
 * first; we only persist the resulting fileUrl/mimeType/sizeBytes here).
 *
 * Deliberately NOT editable:
 *   - CONCLUSION documents and anything linked to a VisitNote/Referral —
 *     those PDFs are rendered by workers from their source entity; editing
 *     the Document row directly would silently detach the legal record from
 *     what the source says. They must be edited through their source.
 *   - the file and the type of a signed consent/contract (CD-09): its title
 *     may be corrected, the signed paper itself stays as signed. Nothing on
 *     a voided one, not even the title.
 *   - number / verifyToken / signedAt / source — system-managed fields.
 */
export const PATCH = createApiHandler(
  { roles: ["ADMIN", "DOCTOR"], bodySchema: UpdateDocumentSchema },
  async ({ request, body, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.document.findUnique({ where: { id } });
    if (!before) return notFound();

    // Same ownership rule as DELETE: a DOCTOR may only edit documents they
    // uploaded themselves; ADMIN may edit any clinic document.
    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      if (before.uploadedById !== ctx.userId) {
        return err("Forbidden", 403);
      }
    }

    // Rendered-document guard: nothing on a conclusion or a referral PDF is
    // edited here, not even the title (see `isRenderedDocument`).
    const lock = documentReplaceLock(before);
    if (lock === "rendered_document") return lockedResponse(lock);
    // A voided record is the trail of a correction: it stays as it was.
    if (isVoidedDocument(before)) {
      return err("VoidedDocumentLocked", 409, { reason: "voided_document" });
    }

    // A replaced file must be bytes this clinic just uploaded (receipt) and
    // nobody else's object, or an https link (CD-08). Resending the current
    // URL unchanged is not a replacement.
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    const replacesFile =
      body.fileUrl !== undefined && body.fileUrl !== before.fileUrl;
    const retypes = body.type !== undefined && body.type !== before.type;
    // CD-09: a signed consent keeps its file and its type. Checked before
    // the file itself, so a refused swap never reaches storage.
    if (lock && (replacesFile || retypes)) return lockedResponse(lock);
    if (replacesFile) {
      if (!clinicId) return err("Forbidden", 403);
      const file = checkDocumentFileUrl({
        clinicId,
        fileUrl: body.fileUrl!,
        uploadToken: body.uploadToken,
      });
      if (!file.ok) return err("InvalidFileUrl", 400, { reason: file.reason });
      if (file.key && (await storageKeyInUse(prisma, file.key, id))) {
        return err("InvalidFileUrl", 400, { reason: "file_in_use" });
      }
    }

    // Copy only the fields the caller actually sent — PATCH semantics.
    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title.trim();
    if (body.type !== undefined) data.type = body.type;
    if (body.fileUrl !== undefined) data.fileUrl = body.fileUrl;
    if (body.mimeType !== undefined) data.mimeType = body.mimeType;
    if (body.sizeBytes !== undefined) data.sizeBytes = body.sizeBytes;

    const after = await prisma.$transaction(async (tx) => {
      const row = await tx.document.update({ where: { id }, data });
      await publishDocumentChange(tx, ctx, "document.updated", row);
      return row;
    });

    // File replaced → clean up the old blob so the bucket doesn't leak.
    // Runs after the DB update so a storage failure can't lose the new row;
    // failures are swallowed for the same reason DELETE swallows them. The
    // row no longer points at the old object, so «still in use» now means
    // some OTHER document or signature, whose file must survive.
    if (replacesFile && clinicId) {
      const oldKey = await deletableDocumentKey(prisma, clinicId, before.fileUrl);
      if (oldKey) {
        try {
          await deleteObject(undefined, oldKey);
        } catch (e) {
          console.warn("[documents] old blob cleanup failed", { id, oldKey, e });
        }
      }
    }

    // Medical data — every edit must be traceable. Store only the changed
    // fields (before/after) rather than full row snapshots.
    const changed = diff(
      before as unknown as Record<string, unknown>,
      data,
    );
    await audit(request, {
      action: "document.update",
      entityType: "Document",
      entityId: id,
      meta: changed,
    });
    return ok(withStaffFileUrl(after));
  }
);

export const DELETE = createApiHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const before = await prisma.document.findUnique({ where: { id } });
    if (!before) return notFound();

    // DOCTOR may only delete documents they uploaded themselves.
    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      if (before.uploadedById !== ctx.userId) {
        return err("Forbidden", 403);
      }
    }

    // CD-09: conclusions, referral PDFs and signed consents are legal
    // records, for ADMIN too. A deleted conclusion also came back from the
    // worker with a new QR token, so the printed one stopped verifying.
    const lock = documentDeleteLock(before);
    if (lock) return lockedResponse(lock);

    await prisma.$transaction(async (tx) => {
      await tx.document.delete({ where: { id } });
      await publishDocumentChange(tx, ctx, "document.deleted", before);
    });

    // Only this clinic's own upload, and only when no other document or
    // signature points at the same object (a copied fileUrl used to take the
    // original's file with it).
    const key =
      ctx.kind === "TENANT"
        ? await deletableDocumentKey(prisma, ctx.clinicId, before.fileUrl, id)
        : null;
    if (key) {
      try {
        await deleteObject(undefined, key);
      } catch (e) {
        console.warn("[documents] storage cleanup failed", { id, key, e });
      }
    }

    await audit(request, {
      action: "document.delete",
      entityType: "Document",
      entityId: id,
      meta: { before },
    });
    return ok({ id, deleted: true });
  }
);
