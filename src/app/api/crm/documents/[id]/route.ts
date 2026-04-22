/**
 * /api/crm/documents/[id] — get, delete document record.
 * See docs/TZ.md §6.5.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
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
  { roles: ["ADMIN"] },
  async ({ request }) => {
    const id = idFromUrl(request);
    const before = await prisma.document.findUnique({ where: { id } });
    if (!before) return notFound();
    await prisma.document.delete({ where: { id } });
    await audit(request, {
      action: "document.delete",
      entityType: "Document",
      entityId: id,
      meta: { before },
    });
    return ok({ id, deleted: true });
  }
);
