/**
 * Inbox order and its keyset cursor (audit G6-22).
 *
 * Threads someone wrote in come first, newest first. A thread opened from
 * the patient card or the Mini App «Чат» before anyone wrote has no
 * `lastMessageAt`, and Postgres sorts NULL first under DESC, so every such
 * empty thread sat above the live conversations. They go last now, and `id`
 * breaks ties so the order is total.
 *
 * The cursor is the last row the client has. Prisma's own `cursor` + `skip`
 * compares the cursor row's sort values, which a NULL `lastMessageAt` never
 * matches, so the page after it is built by hand here.
 */

export const CONVERSATION_LIST_ORDER = [
  { lastMessageAt: { sort: "desc", nulls: "last" } },
  { id: "desc" },
] as const;

/** Rows strictly after `cursor` in `CONVERSATION_LIST_ORDER`. */
export function afterConversationCursor(cursor: {
  id: string;
  lastMessageAt: Date | null;
}): Record<string, unknown> {
  if (cursor.lastMessageAt === null) {
    return { lastMessageAt: null, id: { lt: cursor.id } };
  }
  return {
    OR: [
      { lastMessageAt: { lt: cursor.lastMessageAt } },
      { lastMessageAt: cursor.lastMessageAt, id: { lt: cursor.id } },
      { lastMessageAt: null },
    ],
  };
}
