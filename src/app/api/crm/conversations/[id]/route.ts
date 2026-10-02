/**
 * /api/crm/conversations/[id] — get + patch (status/mode/assignee/tags/patient).
 * See docs/TZ.md §6.4.
 */
import { createApiHandler, createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { notePatientView } from "@/server/audit/patient-view";
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
import { conversationAccess } from "@/server/conversations/access";
import {
  doctorReadClearsSharedUnread,
  doctorUnreadByConversation,
} from "@/server/conversations/doctor-unread";

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
    // The inbox opens a thread by id when it is not on the loaded page of
    // the list (audit G6-07: a link from the reception widget, the search
    // or a toast). A doctor reads by id only what his list would show him.
    const access = await conversationAccess(ctx);
    if (!access) return notFound();
    const doctorId = access.doctorId;
    const row = await prisma.conversation.findFirst({
      where: { id, ...access.where },
      // Same shape as a row of the list, so the inbox renders either.
      include: {
        patient: {
          select: {
            id: true,
            fullName: true,
            phone: true,
            photoUrl: true,
            tgBlockedAt: true,
          },
        },
        assignedTo: { select: { id: true, name: true } },
      },
    });
    if (!row) return notFound();
    // A patient's correspondence opened: a chart read (audit G1-06).
    notePatientView(prisma, request, ctx, row.patientId, "conversation", row.id);
    // DC-10 — the same per-doctor unread as his list shows.
    if (doctorId && ctx.kind === "TENANT") {
      const own = await doctorUnreadByConversation({
        doctorId,
        userId: ctx.userId,
        conversationIds: [row.id],
      });
      return ok({ ...row, unreadCount: own.get(row.id) ?? 0 });
    }
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
    // A doctor changes only a thread he may open (audit TG-32).
    const access = await conversationAccess(ctx);
    if (!access) return notFound();
    const before = await prisma.conversation.findFirst({
      where: { id, ...access.where },
    });
    if (!before) return notFound();
    const { markRead, markAnswered, linkTelegram, ...rest } = body;
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
    // An assignee is an active member of this clinic's staff (audit TG-32):
    // the id was written as given, and the GET then joined whoever it named.
    if (
      typeof rest.assignedToId === "string" &&
      rest.assignedToId !== before.assignedToId
    ) {
      const assignee = await prisma.user.findFirst({
        where: { id: rest.assignedToId, clinicId, active: true },
        select: { id: true },
      });
      if (!assignee) {
        return err("ValidationError", 400, { reason: "assignee_not_in_clinic" });
      }
    }
    const data: Record<string, unknown> = { ...rest };
    // DC-10 — `unreadCount` is the desk's counter. A doctor's read goes into
    // his own mark, and moves the shared counter only on a thread assigned to
    // him (there he is the desk). Opening his patient's thread used to wipe
    // reception's unread mark and the question went unanswered.
    const doctorReader =
      markRead === true && ctx.kind === "TENANT" && ctx.role === "DOCTOR"
        ? ctx.userId
        : null;
    if (
      markRead &&
      (doctorReader === null ||
        doctorReadClearsSharedUnread(before, doctorReader))
    ) {
      data.unreadCount = 0;
    }
    if (doctorReader !== null) {
      const readAt = new Date();
      await prisma.conversationRead.upsert({
        where: {
          conversationId_userId: { conversationId: id, userId: doctorReader },
        },
        create: { clinicId, conversationId: id, userId: doctorReader, readAt },
        update: { readAt },
      });
    }
    if (markAnswered) data.awaitingReplySince = null;
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
        awaitingReplySince: after.awaitingReplySince?.toISOString() ?? null,
        // Route the thread-meta change to the patient's mini-app conversations
        // list via the patient-scoped SSE filter.
        patientId: after.patientId,
      },
    });
    return ok({ ...after, telegramLink });
  }
);
