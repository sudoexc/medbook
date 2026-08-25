/**
 * /api/crm/documents/[id] — get, delete document record.
 * See docs/TZ.md §6.5.
 *
 * DELETE also tries to remove the underlying storage object so the bucket
 * doesn't leak. Storage failures are swallowed — losing a row over a missing
 * blob would block legitimate deletes.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, diff } from "@/server/http";
import { deleteObject } from "@/server/storage/minio";
import { UpdateDocumentSchema } from "@/server/schemas/document";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

/**
 * Recover the storage key from a Document.fileUrl. Matches:
 *   - Stub URLs:   /api/crm/documents/file?key=clinics/<id>/documents/...
 *   - MinIO URLs:  https://host/<bucket>/clinics/<id>/documents/...
 * Returns null when no `clinics/<id>/...` segment is present (e.g. external
 * URLs the operator pasted in URL mode, base64 data: blobs, or legacy
 * `pending://` / `stub://` orphans).
 */
function extractStorageKey(fileUrl: string): string | null {
  if (!fileUrl) return null;
  try {
    if (fileUrl.startsWith("/")) {
      const u = new URL(fileUrl, "http://localhost");
      const k = u.searchParams.get("key");
      return k && k.startsWith("clinics/") ? k : null;
    }
    const u = new URL(fileUrl);
    if (u.pathname.includes("/api/crm/documents/file")) {
      const k = u.searchParams.get("key");
      return k && k.startsWith("clinics/") ? k : null;
    }
    const match = u.pathname.match(/clinics\/[^/]+\/documents\/[^?#]+/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] },
  async ({ request }) => {
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
    return ok(row);
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
 *   - number / verifyToken / signedAt — system-managed fields.
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

    // Rendered-document guard. `visitNoteId`/`referralId` are checked in
    // addition to the type so a legacy/odd row (e.g. a conclusion whose type
    // was migrated) can never slip through either way.
    if (before.type === "CONCLUSION" || before.visitNoteId || before.referralId) {
      return err("ReadOnlyRenderedDocument", 409, {
        reason: "edit_via_source",
        message:
          "This document is rendered from its source record (visit note / referral) and cannot be edited directly.",
      });
    }

    // Copy only the fields the caller actually sent — PATCH semantics.
    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title.trim();
    if (body.type !== undefined) data.type = body.type;
    if (body.fileUrl !== undefined) data.fileUrl = body.fileUrl;
    if (body.mimeType !== undefined) data.mimeType = body.mimeType;
    if (body.sizeBytes !== undefined) data.sizeBytes = body.sizeBytes;

    const after = await prisma.document.update({ where: { id }, data });

    // File replaced → clean up the old blob so the bucket doesn't leak.
    // Runs after the DB update so a storage failure can't lose the new row;
    // failures are swallowed for the same reason DELETE swallows them.
    if (body.fileUrl !== undefined && body.fileUrl !== before.fileUrl) {
      const oldKey = extractStorageKey(before.fileUrl);
      const newKey = extractStorageKey(body.fileUrl);
      if (oldKey && oldKey !== newKey) {
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
    return ok(after);
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

    await prisma.document.delete({ where: { id } });

    const key = extractStorageKey(before.fileUrl);
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
