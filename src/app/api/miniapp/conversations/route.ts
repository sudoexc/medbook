/**
 * GET /api/miniapp/conversations?clinicSlug=…
 *
 * List the patient's conversations with this clinic. Usually a single thread,
 * but family/dependent scenarios + closed/reopened threads can return more.
 * Returns light projections suitable for the inbox list — full message
 * history is fetched separately per thread.
 */
import { prisma } from "@/lib/prisma";
import { ok } from "@/server/http";
import { createMiniAppListHandler } from "@/server/miniapp/handler";

export const GET = createMiniAppListHandler({}, async ({ ctx }) => {
  const conversations = await prisma.conversation.findMany({
    where: { clinicId: ctx.clinicId, patientId: ctx.patientId },
    orderBy: { lastMessageAt: "desc" },
    select: {
      id: true,
      channel: true,
      mode: true,
      status: true,
      lastMessageAt: true,
      lastMessageText: true,
      assignedTo: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  });
  return ok({ conversations });
});
