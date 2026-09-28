/**
 * /api/crm/conversations/[id] — get + patch (status/mode/assignee/tags/patient).
 * See docs/TZ.md §6.4.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/audit";
import { ok, err, notFound, diff } from "@/server/http";
import { UpdateConversationSchema } from "@/server/schemas/conversation";
import { publishEventSafe } from "@/server/realtime/publish";
import {
  bindThreadTelegramToCard,
  threadTelegramId,
  type ThreadTelegramLink,
} from "@/server/conversations/link-patient";
import { threadProfileName } from "@/lib/patients/telegram-card";

/**
 * Who may confirm that a chat's Telegram account is a card's own: the roles
 * that can hand a patient the card's invite link (the same access to the
 * card in the Mini App).
 */
const TELEGRAM_CONFIRM_ROLES = new Set(["ADMIN", "RECEPTIONIST", "DOCTOR"]);

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
    const { markRead, linkTelegram, ...rest } = body;
    if (linkTelegram) {
      if (ctx.kind !== "TENANT" || !TELEGRAM_CONFIRM_ROLES.has(ctx.role)) {
        return err("forbidden", 403, { reason: "telegram_link_role" });
      }
      if (!threadTelegramId(before)) {
        return err("ValidationError", 400, { reason: "no_telegram_account" });
      }
      const target = rest.patientId === undefined ? before.patientId : rest.patientId;
      if (!target) {
        return err("ValidationError", 400, { reason: "no_patient" });
      }
    }
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
    // A bare Telegram confirmation changes nothing on the thread itself.
    if (Object.keys(data).length > 0) {
      await prisma.conversation.updateMany({
        where: { id, clinicId },
        data: data as never,
      });
    }
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
    // message reach it, within the one-card-per-account rules. On its own
    // only onto an empty card the profile's name fits; a card with history
    // or another name waits for staff to confirm (`linkTelegram`, the
    // rail's «Привязать Telegram»), because the account then opens the card
    // in the Mini App. The outcome travels back so the rail can say what
    // happened. The thread link above is already saved; a failure here must
    // not report the whole link as failed.
    const bindPatientId =
      linkingPatientId ?? (linkTelegram ? after.patientId : null);
    const tgId = bindPatientId ? threadTelegramId(before) : null;
    let telegramLink: ThreadTelegramLink | null = null;
    if (bindPatientId && tgId) {
      try {
        telegramLink = await bindThreadTelegramToCard({
          clinicId,
          patientId: bindPatientId,
          telegramId: tgId,
          telegramUsername: before.contactUsername,
          telegramName: threadProfileName(before),
          confirmed: linkTelegram === true,
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
