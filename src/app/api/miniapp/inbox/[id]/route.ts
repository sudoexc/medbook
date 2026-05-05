/**
 * POST /api/miniapp/inbox/[id]?clinicSlug=… — mark INAPP item as read.
 *
 * Sets `readAt = now()` and flips status to READ. Idempotent — re-marking a
 * row that's already READ is a no-op write.
 *
 * The `id` must belong to the authenticated patient inside the resolved
 * clinic; otherwise we return 404 (not 403, to avoid leaking row existence).
 */
import { err, ok } from "@/server/http";
import { prisma } from "@/lib/prisma";
import { createMiniAppHandler } from "@/server/miniapp/handler";

export const POST = createMiniAppHandler({}, async ({ request, ctx }) => {
  const url = new URL(request.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const id = parts[parts.length - 1] ?? "";
  if (!id) return err("bad_id", 400);

  const row = await prisma.notificationSend.findFirst({
    where: {
      id,
      patientId: ctx.patientId,
      clinicId: ctx.clinicId,
      channel: "INAPP",
    },
    select: { id: true, readAt: true },
  });
  if (!row) return err("not_found", 404);
  if (row.readAt) return ok({ id: row.id, readAt: row.readAt.toISOString() });

  const now = new Date();
  const updated = await prisma.notificationSend.update({
    where: { id: row.id },
    data: { readAt: now, status: "READ" },
    select: { id: true, readAt: true },
  });
  return ok({
    id: updated.id,
    readAt: updated.readAt ? updated.readAt.toISOString() : null,
  });
});
