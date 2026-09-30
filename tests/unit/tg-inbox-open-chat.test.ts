import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The open chat in the Telegram inbox.
 *
 * Audit G6-05: the chat was marked read once per opening, so new messages
 * arriving while the operator looked at it piled up as «unread» (badge,
 * header counter, a second receptionist answering in parallel). Every
 * arrival is read while the chat is open and the page is in front.
 *
 * Audit G6-06: a chat opened at its oldest loaded message (or kept the
 * previous chat's position). It opens on the newest one and follows new
 * messages while the operator stays at the bottom.
 *
 * Audit G6-07: the reception widget linked `?c=`, which the inbox did not
 * read; it opened the freshest thread instead (and marked it read).
 */

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns}.${key}${values ? JSON.stringify(values) : ""}`,
  useLocale: () => "ru",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) =>
    React.createElement("a", { href, ...rest }, children),
}));

import {
  createStickToBottom,
  isNearBottom,
  readMarkKey,
  type ScrollBox,
} from "@/app/[locale]/crm/telegram/_lib/open-chat";
import { selectedIdFromParams } from "@/app/[locale]/crm/telegram/_hooks/use-conversations";
import { TgPreviewWidget } from "@/app/[locale]/crm/reception/_components/tg-preview-widget";

describe("new messages in the open chat are read as they arrive (audit G6-05)", () => {
  /**
   * Replays what the chat pane's effect sees, returns the marks it made.
   * `at` is the conversation's lastMessageAt (the newest message).
   */
  function replay(
    steps: Array<{
      conversationId: string | null;
      unread: number;
      at?: string | null;
      visible?: boolean;
    }>,
  ): string[] {
    let lastMarked: string | null = null;
    const marks: string[] = [];
    for (const s of steps) {
      const next = readMarkKey({
        conversationId: s.conversationId,
        unread: s.unread,
        lastMessageAt: s.at ?? null,
        visible: s.visible ?? true,
        lastMarked,
      });
      lastMarked = next.key;
      if (next.mark) marks.push(`${s.conversationId}:${s.unread}`);
    }
    return marks;
  }

  it("marks on opening and again for each message arriving while open", () => {
    expect(
      replay([
        { conversationId: "c1", unread: 2, at: "t1" }, // opened with two unread
        { conversationId: "c1", unread: 0, at: "t1" }, // marked
        { conversationId: "c1", unread: 1, at: "t2" }, // the patient writes again
        { conversationId: "c1", unread: 0, at: "t2" },
        { conversationId: "c1", unread: 1, at: "t3" }, // and again
      ]),
    ).toEqual(["c1:2", "c1:1", "c1:1"]);
  });

  it("does not loop on a count the server has not zeroed yet", () => {
    expect(
      replay([
        { conversationId: "c1", unread: 1, at: "t1" },
        { conversationId: "c1", unread: 1, at: "t1" },
        { conversationId: "c1", unread: 1, at: "t1" },
      ]),
    ).toEqual(["c1:1"]);
  });

  it("review: a refused mark does not re-arm on its own optimistic zero", () => {
    // VIEW_ONLY impersonation or a 500: the PATCH is refused, the cache was
    // patched to 0 meanwhile, the refetch brings the same two unread back.
    expect(
      replay([
        { conversationId: "c1", unread: 2, at: "t1" }, // marks
        { conversationId: "c1", unread: 0, at: "t1" }, // optimistic zero
        { conversationId: "c1", unread: 2, at: "t1" }, // refetch: still 2
        { conversationId: "c1", unread: 0, at: "t1" },
        { conversationId: "c1", unread: 2, at: "t1" },
      ]),
    ).toEqual(["c1:2"]);
    // A message that really arrives afterwards is still read, once.
    expect(
      replay([
        { conversationId: "c1", unread: 2, at: "t1" },
        { conversationId: "c1", unread: 0, at: "t1" },
        { conversationId: "c1", unread: 2, at: "t1" },
        { conversationId: "c1", unread: 3, at: "t2" },
        { conversationId: "c1", unread: 0, at: "t2" },
        { conversationId: "c1", unread: 3, at: "t2" },
      ]),
    ).toEqual(["c1:2", "c1:3"]);
  });

  it("reopening a thread tries once more, switching away does not mark", () => {
    expect(
      replay([
        { conversationId: "c1", unread: 2, at: "t1" }, // marks, refused
        { conversationId: "c1", unread: 0, at: "t1" },
        { conversationId: "c1", unread: 2, at: "t1" },
        { conversationId: "c2", unread: 0, at: "t9" }, // another thread
        { conversationId: "c1", unread: 2, at: "t1" }, // back: one more try
        { conversationId: "c1", unread: 2, at: "t1" },
      ]),
    ).toEqual(["c1:2", "c1:2"]);
  });

  it("a hidden tab reads nothing, and reads on coming back", () => {
    expect(
      replay([
        { conversationId: "c1", unread: 0, at: "t1" },
        { conversationId: "c1", unread: 1, at: "t2", visible: false },
        { conversationId: "c1", unread: 2, at: "t3", visible: false },
        { conversationId: "c1", unread: 2, at: "t3", visible: true },
      ]),
    ).toEqual(["c1:2"]);
  });

  it("nothing selected, nothing read (entering the section reads no thread)", () => {
    expect(replay([{ conversationId: null, unread: 0 }])).toEqual([]);
  });
});

describe("the chat opens on its newest message (audit G6-06)", () => {
  function box(scrollHeight: number, clientHeight = 500, scrollTop = 0): ScrollBox {
    return { scrollHeight, clientHeight, scrollTop };
  }

  it("a long thread opens at the bottom, not on its oldest message", () => {
    const stick = createStickToBottom();
    const el = box(4000);
    stick.reset();
    stick.onContentChange(el);
    expect(el.scrollTop).toBe(4000);
    expect(isNearBottom(el)).toBe(true);
  });

  it("switching to another cached thread does not keep the previous position", () => {
    const stick = createStickToBottom();
    const el = box(4000, 500, 1200);
    // The operator had scrolled up in thread A.
    stick.onScroll(el);
    expect(stick.sticking).toBe(false);
    // Thread B opens, same message count.
    stick.reset();
    stick.onContentChange(el);
    expect(el.scrollTop).toBe(4000);
  });

  it("follows new messages at the bottom, leaves history he scrolled up to alone", () => {
    const stick = createStickToBottom();
    const el = box(4000);
    stick.onContentChange(el);
    el.scrollHeight = 4100; // a new message
    stick.onContentChange(el);
    expect(el.scrollTop).toBe(4100);

    el.scrollTop = 300; // reading history
    stick.onScroll(el);
    el.scrollHeight = 4200;
    stick.onContentChange(el);
    expect(el.scrollTop).toBe(300);
  });
});

describe("links open the dialog they name (audit G6-07)", () => {
  it("the inbox reads `conv`, and the old `c` links too", () => {
    expect(selectedIdFromParams(new URLSearchParams("conv=abc"))).toBe("abc");
    expect(selectedIdFromParams(new URLSearchParams("c=abc"))).toBe("abc");
    expect(selectedIdFromParams(new URLSearchParams("unanswered=1"))).toBeNull();
    expect(selectedIdFromParams(null)).toBeNull();
  });

  it("the reception widget links a dialog with ?conv=", () => {
    const html = renderToStaticMarkup(
      React.createElement(TgPreviewWidget, {
        isLoading: false,
        rows: [
          {
            id: "conv_saidova",
            channel: "TG",
            status: "OPEN",
            unreadCount: 1,
            lastMessageText: "Можно перенести?",
            lastMessageAt: "2026-09-30T05:00:00.000Z",
            patient: { id: "p1", fullName: "Саидова М.", phone: "+998", photoUrl: null },
            assignedTo: null,
          },
        ],
      }),
    );
    expect(html).toContain('href="/ru/crm/telegram?conv=conv_saidova"');
    expect(html).not.toContain("?c=");
  });
});
