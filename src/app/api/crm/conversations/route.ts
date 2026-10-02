/**
 * /api/crm/conversations — list threads for inbox.
 * See docs/TZ.md §6.4 inbox.
 */
import { createApiListHandler } from "@/lib/api-handler";
import { prisma } from "@/lib/prisma";
import { ok, parseQuery } from "@/server/http";
import { normalizePhone } from "@/lib/phone";
import { doctorConversationScope } from "@/server/conversations/doctor-scope";
import { doctorUnreadByConversation } from "@/server/conversations/doctor-unread";
import { QueryConversationSchema } from "@/server/schemas/conversation";
import { unansweredWhere } from "@/server/conversations/reply-state";
import {
  CONVERSATION_LIST_ORDER,
  afterConversationCursor,
} from "@/server/conversations/list-order";

export const GET = createApiListHandler(
  { roles: ["ADMIN", "RECEPTIONIST", "DOCTOR", "NURSE", "CALL_OPERATOR"] },
  async ({ request, ctx }) => {
    const parsed = parseQuery(request, QueryConversationSchema);
    if (!parsed.ok) return parsed.response;
    const q = parsed.value;

    const where: Record<string, unknown> = {};
    const andClauses: Array<Record<string, unknown>> = [];
    if (q.channel) where.channel = q.channel;
    if (q.status) where.status = q.status;
    if (q.mode) where.mode = q.mode;
    // `assignedToId=me` is the "Мои" inbox filter — resolve it to the caller's
    // user id server-side (the client has no session id to pass).
    if (q.assignedToId === "me") {
      where.assignedToId = ctx.kind === "TENANT" ? ctx.userId : "__none__";
    } else if (q.assignedToId) {
      where.assignedToId = q.assignedToId;
    }
    if (q.patientId) where.patientId = q.patientId;
    if (q.unread) where.unreadCount = { gt: 0 };
    if (q.unanswered) Object.assign(where, unansweredWhere());

    // Doctor scope: `doctorId=me` (or explicit id) restricts to conversations
    // either assigned to that doctor's User or tied to one of their
    // appointments. A DOCTOR caller always gets his own caseload: a
    // colleague's `doctorId` from him is read as `me` (audit TG-32), or the
    // list showed him the other doctor's patients.
    const callerIsDoctor = ctx.kind === "TENANT" && ctx.role === "DOCTOR";
    let doctorScopeId: string | null = null;
    if ((q.doctorId === "me" || callerIsDoctor) && ctx.kind === "TENANT") {
      const doc = await prisma.doctor.findFirst({
        where: { userId: ctx.userId },
        select: { id: true },
      });
      if (doc) doctorScopeId = doc.id;
    } else if (q.doctorId) {
      doctorScopeId = q.doctorId;
    }
    // DC-10 — a doctor's unread is his own (`doctor-unread.ts`): the shared
    // counter is the desk's, and his reading no longer zeroes it. His scope
    // is always his own row (resolved from his user above).
    const ownUnread =
      ctx.kind === "TENANT" && callerIsDoctor && doctorScopeId
        ? { doctorId: doctorScopeId, userId: ctx.userId }
        : null;
    let ownUnreadMap: Map<string, number> | null = null;
    if (ownUnread && q.unread) {
      ownUnreadMap = await doctorUnreadByConversation(ownUnread);
      delete where.unreadCount;
      andClauses.push({ id: { in: [...ownUnreadMap.keys()] } });
    }
    if (doctorScopeId) {
      const callerUserId = ctx.kind === "TENANT" ? ctx.userId : null;
      // His caseload is patients, not appointment rows (an appointment-only
      // scope left a live doctor with «0 диалогов»). Unlinked threads are
      // the desk's since DC-10, unless assigned to him: see doctor-scope.
      andClauses.push({
        OR: doctorConversationScope(doctorScopeId, callerUserId),
      });
    }
    if (q.q) {
      const term = q.q;
      const phoneDigits = term.replace(/\D/g, "");
      const phoneNorm = normalizePhone(term);
      const or: Array<Record<string, unknown>> = [
        { lastMessageText: { contains: term, mode: "insensitive" } },
        { patient: { fullName: { contains: term, mode: "insensitive" } } },
        { patient: { phone: { contains: term } } },
        { contactFirstName: { contains: term, mode: "insensitive" } },
        { contactLastName: { contains: term, mode: "insensitive" } },
        { contactUsername: { contains: term, mode: "insensitive" } },
        { externalId: { contains: term } },
      ];
      if (phoneDigits.length >= 3) {
        or.push({ patient: { phoneNormalized: { contains: phoneDigits } } });
        if (phoneNorm) {
          or.push({ patient: { phoneNormalized: { contains: phoneNorm } } });
        }
      }
      andClauses.push({ OR: or });
    }
    if (andClauses.length > 0) where.AND = andClauses;

    // Keyset paging in the inbox order (empty threads last, G6-22): the next
    // page starts strictly after the cursor row the client last got.
    let pageWhere: Record<string, unknown> = where;
    if (q.cursor) {
      const at = await prisma.conversation.findFirst({
        where: { id: q.cursor },
        select: { id: true, lastMessageAt: true },
      });
      // The cursor row is gone: no page can follow it.
      if (!at) return ok({ rows: [], nextCursor: null });
      pageWhere = { AND: [where, afterConversationCursor(at)] };
    }

    const take = q.limit + 1;
    const [rows, total] = await Promise.all([
      prisma.conversation.findMany({
        where: pageWhere,
        orderBy: [...CONVERSATION_LIST_ORDER],
        take,
        include: {
          patient: {
            select: {
              id: true,
              fullName: true,
              phone: true,
              photoUrl: true,
              tgBlockedAt: true,
              // Quick replies open in his language (audit G6-15).
              preferredLang: true,
            },
          },
          assignedTo: { select: { id: true, name: true } },
        },
      }),
      // «Все N» is the number of threads the tab holds, not the rows on the
      // loaded page (audit G6-22). Counted once, with the first page.
      q.cursor ? Promise.resolve(undefined) : prisma.conversation.count({ where }),
    ]);
    let nextCursor: string | null = null;
    if (rows.length > q.limit) {
      rows.pop();
      // The last row shown, not the extra one: the page after it starts
      // right after (the extra row used to be skipped and never shown).
      nextCursor = rows[rows.length - 1]?.id ?? null;
    }
    if (ownUnread) {
      const own =
        ownUnreadMap ??
        (await doctorUnreadByConversation({
          ...ownUnread,
          conversationIds: rows.map((r) => r.id),
        }));
      return ok({
        rows: rows.map((r) => ({ ...r, unreadCount: own.get(r.id) ?? 0 })),
        nextCursor,
        ...(total !== undefined ? { total } : {}),
      });
    }
    return ok({ rows, nextCursor, ...(total !== undefined ? { total } : {}) });
  }
);
