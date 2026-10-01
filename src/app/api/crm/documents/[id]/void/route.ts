/**
 * POST /api/crm/documents/[id]/void — ADMIN voids a signed consent or
 * contract that was filed by mistake (audit CD-09, review of CD-05).
 *
 * A signed record is never deleted, not even by ADMIN, so before this a
 * signature saved on the wrong patient's card, or «Отметить подписанным»
 * pressed on the wrong paper, stayed «Подписан» in that chart for good.
 * Voiding keeps the row and its file (the audit trail points at them),
 * records who and why, and takes it out of the patient's Mini App. The CRM
 * still lists it, marked voided, and nothing treats it as signed any more.
 *
 * Body: `{ reason }` (required). 409 `not_voidable` for anything but a
 * signed record: an ordinary upload is simply deleted, a conclusion or a
 * referral PDF is corrected through its source record. Voiding twice
 * returns the row as it is.
 */
import { createApiHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound } from "@/server/http";
import { VoidDocumentSchema } from "@/server/schemas/document";
import { withStaffFileUrl } from "@/lib/storage-ref";
import { canVoidDocument, isVoidedDocument } from "@/lib/document-guards";
import { publishDocumentChange } from "@/server/documents/change-events";

function docIdFromUrl(request: Request): string {
  // /api/crm/documents/<id>/void — id is the segment before "void".
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("void");
  return idx > 0 ? (parts[idx - 1] ?? "") : "";
}

export const POST = createApiHandler(
  { roles: ["ADMIN"], bodySchema: VoidDocumentSchema },
  async ({ request, body, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = docIdFromUrl(request);
    const before = await prisma.document.findUnique({ where: { id } });
    if (!before) return notFound();
    if (isVoidedDocument(before)) return ok(withStaffFileUrl(before));
    if (!canVoidDocument(before)) {
      return err("NotVoidable", 409, { reason: "not_voidable" });
    }

    const voidedAt = new Date();
    const reason = body.reason.trim();
    const after = await prisma.$transaction(async (tx) => {
      // Conditional: a colleague who voided it a moment ago keeps his reason.
      const res = await tx.document.updateMany({
        where: { id, voidedAt: null },
        data: { voidedAt, voidedById: ctx.userId, voidReason: reason },
      });
      const row = await tx.document.findUnique({ where: { id } });
      if (res.count > 0 && row) {
        // The patient's Mini App drops it from his list.
        await publishDocumentChange(tx, ctx, "document.updated", row);
      }
      return { row, changed: res.count > 0 };
    });
    if (!after.row) return notFound();

    if (after.changed) {
      await audit(request, {
        action: "document.void",
        entityType: "Document",
        entityId: id,
        meta: {
          reason,
          voidedAt,
          before: {
            type: before.type,
            title: before.title,
            fileUrl: before.fileUrl,
            signedAt: before.signedAt,
            patientId: before.patientId,
          },
        },
      });
    }
    return ok(withStaffFileUrl(after.row));
  },
);
