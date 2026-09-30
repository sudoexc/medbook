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
 * open and the page is in front of the operator. `lastMarked` is the
 * `conversationId:unread` pair marked last; the same pair is not marked
 * twice, so a count the server has not zeroed yet cannot loop.
 */
export function readMarkKey(input: {
  conversationId: string | null;
  unread: number;
  visible: boolean;
  lastMarked: string | null;
}): { mark: boolean; key: string | null } {
  const { conversationId, unread, visible, lastMarked } = input;
  // Nothing unread: forget the last pair, so the next arrival (0 → 1) marks.
  if (!conversationId || unread <= 0) return { mark: false, key: null };
  const key = `${conversationId}:${unread}`;
  // A hidden tab reads nothing; the pair is marked once the page is back.
  if (!visible) return { mark: false, key: lastMarked };
  if (key === lastMarked) return { mark: false, key };
  return { mark: true, key };
}
