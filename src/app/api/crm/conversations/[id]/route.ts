/**
 * /api/crm/conversations/[id] — get + patch (status/mode/assignee/tags/patient).
 * See docs/TZ.md §6.4.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, notFound, diff } from "@/server/http";
import { UpdateConversationSchema } from "@/server/schemas/conversation";
import { publishEventSafe } from "@/server/realtime/publish";
import {
  bindThreadTelegramToCard,
  threadTelegramId,
  type ThreadTelegramLink,
} from "@/server/conversations/link-patient";

function idFromUrl(request: Request): string {
  const parts = new URL(request.url).pathname.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? "";
}

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const id = idFromUrl(request);
    // Explicit (id + clinicId) scope. The tenant Prisma extension also
    // injects clinicId, but `findUnique` semantics around composite uniques
    // are easy to bypass with a future refactor — keeping the guard here
    // makes the security boundary visible in the handler itself.
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    if (!clinicId) return notFound();
    const row = await prisma.conversation.findFirst({
      where: { id, clinicId },
      include: {
        patient: { select: { id: true, fullName: true, phone: true, photoUrl: true } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
    if (!row) return notFound();
    return ok(row);
  }
);

export const PATCH = createApiHandler(
  {
    roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"],
    bodySchema: UpdateConversationSchema,
  },
  async ({ request, body, ctx }) => {
    const id = idFromUrl(request);
    const clinicId = ctx.kind === "TENANT" ? ctx.clinicId : null;
    if (!clinicId) return notFound();
    const before = await prisma.conversation.findFirst({
      where: { id, clinicId },
    });
    if (!before) return notFound();
    const { markRead, ...rest } = body;
    // A patient being linked must be one of this clinic's live cards.
    const linkingPatientId =
      typeof rest.patientId === "string" && rest.patientId !== before.patientId
        ? rest.patientId
        : null;
    if (linkingPatientId) {
      const card = await prisma.patient.findFirst({
        where: { id: linkingPatientId, clinicId, deletedAt: null },
        select: { id: true },
      });
      if (!card) return notFound();
    }
    const data: Record<string, unknown> = { ...rest };
    if (markRead) data.unreadCount = 0;
    // updateMany so an unscoped `update({ where: { id }})` can never write
    // across tenants; we already verified the row exists in this clinic.
    await prisma.conversation.updateMany({
      where: { id, clinicId },
      data: data as never,
    });
    const after = (await prisma.conversation.findFirst({
      where: { id, clinicId },
    }))!;
    const d = diff(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>
    );
    await audit(request, {
      action: "conversation.update",
      entityType: "Conversation",
      entityId: id,
      meta: d,
    });

    // Linking the thread identifies the patient's Telegram too (audit
    // TG-11): the card learns the account so reminders and the next
    // message reach it, within the one-card-per-account rules. The outcome
    // travels back so the rail can say when the card kept another account
    // or the account sits on another card. The thread link above is already
    // saved; a failure here must not report the whole link as failed.
    const tgId = linkingPatientId ? threadTelegramId(before) : null;
    let telegramLink: ThreadTelegramLink | null = null;
    if (linkingPatientId && tgId) {
      try {
        telegramLink = await bindThreadTelegramToCard({
          clinicId,
          patientId: linkingPatientId,
          telegramId: tgId,
          telegramUsername: before.contactUsername,
          actorId: ctx.kind === "TENANT" ? ctx.userId : null,
        });
      } catch (e) {
        console.error(`[conversation.update] telegram link failed conv=${id}`, e);
      }
    }

    publishEventSafe(clinicId, {
      type: "tg.conversation.updated",
      payload: {
        conversationId: id,
        mode: after.mode,
        status: after.status,
        assigneeId: after.assignedToId ?? null,
        unreadCount: after.unreadCount,
        // Route the thread-meta change to the patient's mini-app conversations
        // list via the patient-scoped SSE filter.
        patientId: after.patientId,
      },
    });
    return ok({ ...after, telegramLink });
  }
);
