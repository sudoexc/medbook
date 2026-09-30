/**
 * GET /api/crm/doctors/me/conversations/[id]/scope → { inScope: boolean }
 *
 * Is this thread one of the doctor's, by the same rule as his inbox
 * (`doctorConversationScope`)? Asked by the cabinet's Telegram alert before
 * it rings (audit DC-04): the realtime bus delivers every `tg.message.new`
 * of the clinic, and the alert used to play the sound and show the preview
 * of any of them, another doctor's patient included, in the middle of a
 * visit.
 *
 * Answers false rather than 404 for a thread outside the scope, so the
 * alert has one shape to read; it learns nothing it could not see before
 * (the event itself carried the preview).
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { err, ok } from "@/server/http";
import { doctorConversationScope } from "@/server/conversations/doctor-scope";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  // .../conversations/[id]/scope
  return parts[parts.length - 2] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["DOCTOR"] },
  async ({ request, ctx }) => {
    if (ctx.kind !== "TENANT") return err("Forbidden", 403);
    const id = idFromUrl(request);
    if (!id) return ok({ inScope: false });

    const doctor = await prisma.doctor.findFirst({
      where: { userId: ctx.userId },
      select: { id: true },
    });
    if (!doctor) return ok({ inScope: false });

    const row = await prisma.conversation.findFirst({
      where: {
        id,
        AND: [{ OR: doctorConversationScope(doctor.id, ctx.userId) }],
      },
      select: { id: true },
    });
    return ok({ inScope: row != null });
  },
);
