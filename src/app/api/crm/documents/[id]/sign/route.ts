/**
 * POST /api/crm/documents/[id]/sign — mark a CONSENT/CONTRACT document as
 * physically signed. Stamps `signedAt` so the "ожидают подписи" filter drops
 * it. Idempotent: re-signing an already-signed doc is a no-op that returns the
 * current row. See docs/TZ-finishing-punch-list.md §A2.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound } from "@/server/http";

function docIdFromUrl(request: Request): string {
  // /api/crm/documents/<id>/sign — id is the segment before "sign".
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const signIdx = parts.lastIndexOf("sign");
  return signIdx > 0 ? (parts[signIdx - 1] ?? "") : "";
}

export const POST = createApiHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE"] },
  async ({ request }) => {
    const id = docIdFromUrl(request);
    const before = await prisma.document.findUnique({ where: { id } });
    if (!before) return notFound();
    if (before.signedAt) return ok(before);

    const updated = await prisma.document.update({
      where: { id },
      data: { signedAt: new Date() },
    });
    await audit(request, {
      action: "document.sign",
      entityType: "Document",
      entityId: id,
      meta: { before, after: updated },
    });
    return ok(updated);
  }
);
