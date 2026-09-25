import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * The CRM bubble for a patient's media (audit TG-01) and for a staff message
 * that never reached Telegram (audit TG-04), rendered to markup: a voice note
 * plays in an <audio> player instead of reading «Без текста», a video note is
 * a round <video>, and a FAILED message says why instead of showing ticks.
 */

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns}.${key}${values ? JSON.stringify(values) : ""}`,
}));
vi.mock("@/components/atoms/date-text", () => ({
  DateText: () => null,
}));

import { MessageBubble } from "@/app/[locale]/crm/telegram/_components/message-bubble";
import type { InboxMessage } from "@/app/[locale]/crm/telegram/_hooks/types";

function message(overrides: Partial<InboxMessage>): InboxMessage {
  return {
    id: "m1",
    conversationId: "c1",
    direction: "IN",
    body: null,
    attachments: null,
    buttons: null,
    senderId: null,
    sender: null,
    status: "DELIVERED",
    externalId: "77",
    replyToId: null,
    createdAt: "2026-09-25T06:00:00.000Z",
    ...overrides,
  };
}

const html = (m: InboxMessage) =>
  renderToStaticMarkup(React.createElement(MessageBubble, { message: m }));

const VOICE_URL =
  "/api/crm/conversations/c1/attachments/file?key=clinics%2Fk%2Fchat%2Fc1%2Fa.ogg";

describe("MessageBubble — patient media", () => {
  it("plays a voice note and names it, instead of «Без текста»", () => {
    const out = html(
      message({
        attachments: [
          {
            kind: "file",
            url: VOICE_URL,
            mimeType: "audio/ogg",
            name: "voice.ogg",
            tgType: "voice",
            durationSec: 75,
          },
        ],
      }),
    );
    expect(out).toContain("<audio");
    expect(out).toContain(`src="${VOICE_URL.replace(/&/g, "&amp;")}"`);
    expect(out).toContain("tgInbox.message.voice");
    expect(out).toContain("1:15");
    expect(out).not.toContain("message.noText");
  });

  it("shows a video note as a round video", () => {
    const out = html(
      message({
        attachments: [
          { kind: "file", url: "/v.mp4", mimeType: "video/mp4", tgType: "video_note" },
        ],
      }),
    );
    expect(out).toMatch(/<video[^>]*rounded-full/);
    expect(out).toContain("tgInbox.message.videoNote");
  });

  it("keeps an unknown file a download", () => {
    const out = html(
      message({
        attachments: [
          { kind: "file", url: "/f", mimeType: "application/octet-stream", name: "sticker.tgs" },
        ],
      }),
    );
    expect(out).not.toContain("<audio");
    expect(out).not.toContain("<video");
    expect(out).toContain("download=");
  });
});

describe("MessageBubble — staff message that did not reach Telegram", () => {
  it("says it was not delivered, and why", () => {
    const out = html(
      message({
        direction: "OUT",
        body: "Ваши анализы готовы",
        senderId: "u1",
        sender: { id: "u1", name: "Регистратура" },
        status: "FAILED",
        failedReason: "tg_blocked",
        externalId: null,
      }),
    );
    expect(out).toContain("tgInbox.message.failed.title");
    expect(out).toContain("tgInbox.message.failed.tg_blocked");
  });
});
