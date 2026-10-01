/**
 * A doctor's own «непрочитано» (audit DC-10).
 *
 * `Conversation.unreadCount` belongs to the clinic's front desk: one counter
 * per thread, zeroed by whoever opens it. When a doctor opened his patient's
 * thread, the counter went to zero for reception as well, and the question
 * stayed unanswered with nothing left to point at it. So:
 *
 *   - A doctor's read is recorded per user (`ConversationRead`). The shared
 *     counter moves only on a thread assigned to him: there he IS the desk.
 *   - His badge and his inbox count what HE has not read: the inbound
 *     messages after his own mark. A thread he never opened shows the shared
 *     counter, which is what nobody at the clinic has read yet; without that
 *     baseline every old thread of every patient would flood the badge on
 *     the first day.
 *
 * Which threads are his is `doctorConversationScope`'s question, not this
 * module's; the callers pass it in.
 */
import { prisma } from "@/lib/prisma";

import { doctorConversationScope } from "./doctor-scope";

/** One thread as the computation needs it. Pure input, for the tests. */
export type DoctorUnreadRow = {
  id: string;
  unreadCount: number;
  lastMessageAt: Date | null;
  /** This doctor's read mark, if he ever opened the thread. */
  readAt: Date | null;
};

/**
 * The part that needs no database: a thread never opened by him carries the
 * shared counter, a thread with nothing after his mark carries zero, and the
 * rest need their inbound messages counted (`needsCount`).
 */
export function splitDoctorUnread(rows: ReadonlyArray<DoctorUnreadRow>): {
  known: Map<string, number>;
  needsCount: Array<{ id: string; after: Date }>;
} {
  const known = new Map<string, number>();
  const needsCount: Array<{ id: string; after: Date }> = [];
  for (const r of rows) {
    if (!r.readAt) {
      if (r.unreadCount > 0) known.set(r.id, r.unreadCount);
      continue;
    }
    if (!r.lastMessageAt || r.lastMessageAt <= r.readAt) continue;
    needsCount.push({ id: r.id, after: r.readAt });
  }
  return { known, needsCount };
}

type Db = Pick<typeof prisma, "conversation" | "message">;

/**
 * Unread per thread for this doctor, only the threads with something unread.
 * `conversationIds` narrows it to the rows of one list page; left out, every
 * thread of his scope is considered (the sidebar badge, the «Непрочитанные»
 * filter).
 */
export async function doctorUnreadByConversation(
  args: {
    doctorId: string;
    userId: string;
    conversationIds?: readonly string[];
  },
  db: Db = prisma,
): Promise<Map<string, number>> {
  if (args.conversationIds && args.conversationIds.length === 0) {
    return new Map();
  }
  const rows = await db.conversation.findMany({
    where: {
      AND: [
        { OR: doctorConversationScope(args.doctorId, args.userId) },
        ...(args.conversationIds ? [{ id: { in: [...args.conversationIds] } }] : []),
        {
          // Candidates only: unread for the desk and never opened by him,
          // or opened by him (whatever came after is counted below).
          OR: [
            { unreadCount: { gt: 0 }, reads: { none: { userId: args.userId } } },
            { reads: { some: { userId: args.userId } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      unreadCount: true,
      lastMessageAt: true,
      reads: { where: { userId: args.userId }, select: { readAt: true } },
    },
  });
  const { known, needsCount } = splitDoctorUnread(
    rows.map((r) => ({
      id: r.id,
      unreadCount: r.unreadCount,
      lastMessageAt: r.lastMessageAt,
      readAt: r.reads[0]?.readAt ?? null,
    })),
  );
  if (needsCount.length > 0) {
    const counted = await db.message.groupBy({
      by: ["conversationId"],
      where: {
        direction: "IN",
        OR: needsCount.map((c) => ({
          conversationId: c.id,
          createdAt: { gt: c.after },
        })),
      },
      _count: { _all: true },
    });
    for (const g of counted) {
      const n = g._count?._all ?? 0;
      if (n > 0) known.set(g.conversationId, n);
    }
  }
  return known;
}

/** The doctor's «Сообщения» badge: everything unread for him, summed. */
export async function doctorUnreadTotal(
  args: { doctorId: string; userId: string },
  db: Db = prisma,
): Promise<number> {
  const map = await doctorUnreadByConversation(args, db);
  let total = 0;
  for (const n of map.values()) total += n;
  return total;
}

/**
 * Whether a doctor's «прочитано» also clears the desk's counter: only on a
 * thread assigned to him, where he is the one who answers. Pure.
 */
export function doctorReadClearsSharedUnread(
  thread: { assignedToId: string | null },
  userId: string,
): boolean {
  return thread.assignedToId === userId;
}
