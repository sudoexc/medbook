/**
 * Audit TG-24: every notification and broadcast goes to Telegram with
 * `parse_mode: HTML`, and a stray «<» or «&» in staff-typed text made the
 * Bot API refuse the message («can't parse entities»): «Детям <14 лет» or
 * «МРТ & ЭЭГ» ended FAILED for every recipient. The clinic adapter now makes
 * the text safe; supported formatting stays, values `render()` escaped stay
 * escaped once.
 */
import { describe, expect, it, vi } from "vitest";

import { render } from "@/server/notifications/template";
import { toTelegramHtml } from "@/server/notifications/telegram-html";

describe("toTelegramHtml", () => {
  it("escapes the punctuation that broke broadcasts", () => {
    expect(toTelegramHtml("Детям <14 лет консультация бесплатно")).toBe(
      "Детям &lt;14 лет консультация бесплатно",
    );
    expect(toTelegramHtml("Скидка на МРТ & ЭЭГ")).toBe("Скидка на МРТ &amp; ЭЭГ");
    expect(toTelegramHtml("стрелка -> сюда")).toBe("стрелка -&gt; сюда");
  });

  it("keeps entities already in the body (values render() escaped)", () => {
    const body = render("{{patient.firstName}}, A & B", { patient: { firstName: "G'ulom <b>" } });
    expect(body).toBe("G&#39;ulom &lt;b&gt;, A & B");
    expect(toTelegramHtml(body)).toBe("G&#39;ulom &lt;b&gt;, A &amp; B");
  });

  it("keeps Telegram's formatting tags, normalised", () => {
    expect(toTelegramHtml("<b>Важно</b>: <i>завтра</i> <B>в 10:00</B>")).toBe(
      "<b>Важно</b>: <i>завтра</i> <b>в 10:00</b>",
    );
    expect(toTelegramHtml('<a href="https://neurofax.uz/?a=1&b=2">сайт</a>')).toBe(
      '<a href="https://neurofax.uz/?a=1&amp;b=2">сайт</a>',
    );
    expect(toTelegramHtml("<pre><code>x</code></pre>")).toBe("<pre><code>x</code></pre>");
  });

  it("shows every tag as typed once one is unclosed or misnested", () => {
    expect(toTelegramHtml("Скидка <b>20%")).toBe("Скидка &lt;b&gt;20%");
    expect(toTelegramHtml("<b><i>x</b></i>")).toBe("&lt;b&gt;&lt;i&gt;x&lt;/b&gt;&lt;/i&gt;");
    expect(toTelegramHtml("<code><b>x</b></code>")).toBe(
      "&lt;code&gt;&lt;b&gt;x&lt;/b&gt;&lt;/code&gt;",
    );
  });

  it("never lets an unsupported tag, attribute or script URL through", () => {
    expect(toTelegramHtml("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
    expect(toTelegramHtml('<b onclick="x">y</b>')).toBe('&lt;b onclick="x"&gt;y&lt;/b&gt;');
    expect(toTelegramHtml('<a href="javascript:alert(1)">x</a>')).toBe(
      '&lt;a href="javascript:alert(1)"&gt;x&lt;/a&gt;',
    );
  });

  it("is idempotent", () => {
    for (const s of ["<14 & <b>ok</b>", "Скидка <b>20%", "A &amp; B", ""]) {
      expect(toTelegramHtml(toTelegramHtml(s))).toBe(toTelegramHtml(s));
    }
  });
});

const sent = vi.hoisted(() => [] as Array<{ text: string; opts: Record<string, unknown> }>);
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    clinic: {
      findUnique: vi.fn(async () => ({ id: "c1", slug: "nf", tgBotToken: "t", tgBotUsername: "b" })),
    },
  },
}));
vi.mock("@/server/telegram/send", () => ({
  sendMessage: vi.fn(async (_c: unknown, _chat: string, text: string, opts: Record<string, unknown>) => {
    sent.push({ text, opts });
    return { message_id: 7 };
  }),
}));

describe("TelegramClinicAdapter", () => {
  it("sends template and broadcast text Telegram can parse", async () => {
    const { TelegramClinicAdapter } = await import("@/server/notifications/adapters/tg-clinic");
    await new TelegramClinicAdapter("c1").send("chat", "Детям <14 лет & их родителям");
    expect(sent[0]).toEqual({
      text: "Детям &lt;14 лет &amp; их родителям",
      opts: { parse_mode: "HTML" },
    });
  });
});
