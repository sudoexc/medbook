/**
 * The open chat: where it is scrolled (audit G6-06) and when it reads its
 * messages (audit G6-05).
 *
 * Scrolling (G6-06).
 *
 * The chat only scrolled down when a message arrived AND the view already
 * sat within 120px of the bottom. A freshly opened chat starts at the top,
 * so a long thread opened on the oldest of its 50 messages, and switching
 * between two cached threads of 50 kept the previous chat's position
 * (the message count did not change, nothing ran). The operator answered
 * last week's question and missed «Можно сегодня в 15:00?».
 *
 * The rule now: a thread opens on its newest message and keeps following
 * new ones (and images that finish loading) while the operator is at the
 * bottom; once he scrolls up to read history, nothing moves under him.
 */

/** The part of a scroll container the rule reads and writes. */
export type ScrollBox = {
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
};

/** Closer than this to the bottom counts as «at the bottom». */
export const STICK_THRESHOLD_PX = 120;

export function isNearBottom(
  el: ScrollBox,
  threshold: number = STICK_THRESHOLD_PX,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

export type StickToBottom = {
  /** Another thread opened: follow its newest message. */
  reset(): void;
  /** The operator scrolled: follow only while he stays at the bottom. */
  onScroll(el: ScrollBox): void;
  /** Messages loaded or arrived, an image decoded: keep the bottom in view. */
  onContentChange(el: ScrollBox): void;
  readonly sticking: boolean;
};

export function createStickToBottom(): StickToBottom {
  let stick = true;
  return {
    reset() {
      stick = true;
    },
    onScroll(el) {
      stick = isNearBottom(el);
    },
    onContentChange(el) {
      if (stick) el.scrollTop = el.scrollHeight;
    },
    get sticking() {
      return stick;
    },
  };
}

/**
 * When the open chat marks its messages read (audit G6-05): the chat is
 * marked on opening, and again for every message arriving while it stays
 * open and the page is in front of the operator.
 *
 * `lastMarked` is the `conversationId:lastMessageAt` pair marked last, i.e.
 * the newest message the mark covered; the same pair is never marked twice.
 * Keyed on the count, the mark re-armed on its own optimistic zero: a PATCH
 * the server refused (VIEW_ONLY impersonation, a 500) brought the same count
 * back on refetch, which read as a new pair, and the chat marked again
 * several times a second, forever. Every patient message moves
 * `lastMessageAt` together with the count (webhook, Mini App chat), so a
 * real arrival still marks, and a refetch of the same state never does.
 */
export function readMarkKey(input: {
  conversationId: string | null;
  unread: number;
  lastMessageAt: string | null;
  visible: boolean;
  lastMarked: string | null;
}): { mark: boolean; key: string | null } {
  const { conversationId, unread, lastMessageAt, visible, lastMarked } = input;
  // Nothing open: the next opening marks afresh.
  if (!conversationId) return { mark: false, key: null };
  // The pair marked last in THIS thread; another thread's pair is forgotten,
  // so reopening a thread tries once more.
  const mine = lastMarked?.startsWith(`${conversationId}:`) ? lastMarked : null;
  // Nothing unread, the optimistic zero included: keep the pair, so the
  // count coming back from a refused mark does not mark it again.
  if (unread <= 0) return { mark: false, key: mine };
  const key = `${conversationId}:${lastMessageAt ?? ""}`;
  // A hidden tab reads nothing; the pair is marked once the page is back.
  if (!visible) return { mark: false, key: mine };
  if (key === mine) return { mark: false, key };
  return { mark: true, key };
}
