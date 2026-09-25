/**
 * GET /api/crm/visit-notes/[id]/revisions — the version history of a signed
 * conclusion (audit G1-01): each signature and each in-window correction,
 * with its author, time, the fields it changed, the full content, and the
 * PDF rendered from exactly that content.
 *
 * Read-only by design: revisions are written by finalize, PATCH and the
 * visit revert, inside the same transaction as the change they record, and
 * are never edited.
 *
 * The PDF link goes through the staff file proxy, never the bare storage URL
 * (the bucket is private, audit CD-02).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, forbidden, notFound } from "@/server/http";
import { staffKeyHref } from "@/lib/storage-ref";

function idFromUrl(request: Request): string {
  // .../visit-notes/[id]/revisions — id is segment[-2].
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "DOCTOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    const note = await prisma.visitNote.findUnique({
      where: { id },
      select: { id: true, doctorId: true },
    });
    if (!note) return notFound();

    // Same visibility rule as GET /visit-notes/[id]: a doctor sees only their
    // own notes, an admin sees any note in the active clinic.
    if (ctx.kind === "TENANT" && ctx.role === "DOCTOR") {
      const doctor = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (!doctor || doctor.id !== note.doctorId) return forbidden();
    }

    const rows = await prisma.visitNoteRevision.findMany({
      where: { visitNoteId: id },
      orderBy: { revision: "asc" },
      select: {
        id: true,
        revision: true,
        kind: true,
        changedFields: true,
        content: true,
        pdfObjectKey: true,
        authorName: true,
        createdAt: true,
      },
    });

    return ok({
      items: rows.map(({ pdfObjectKey, ...row }) => ({
        ...row,
        pdfHref: pdfObjectKey ? staffKeyHref(pdfObjectKey) : null,
      })),
    });
  },
);
