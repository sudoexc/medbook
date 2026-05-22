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
import { ok, err, notFound } from "@/server/http";
import { deleteObject } from "@/server/storage/minio";

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
