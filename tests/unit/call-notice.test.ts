/**
 * `sendCallNotice` — the shared "Вас вызывают" push used by both the doctor
 * cabinet and the reception queue panel.
 *
 * The contract that matters in prod: it never throws (a Telegram outage must
 * not roll back a committed lifecycle write), it never sends to a patient
 * without a linked account, and it escapes user-controlled text so a doctor
 * name with an angle bracket can't break the HTML parse mode.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sends: Array<{ chatId: string | number; text: string; opts: unknown }> = [];
let sendBehaviour: "ok" | "throw" = "ok";

vi.mock("@/server/telegram/send", () => ({
  sendMessage: vi.fn(
    async (
      _clinic: unknown,
      chatId: string | number,
      text: string,
      opts: unknown,
    ) => {
      sends.push({ chatId, text, opts });
      if (sendBehaviour === "throw") throw new Error("403 bot was blocked");
      return { message_id: 1, chat: { id: 1 }, date: 0 };
    },
  ),
}));

const { sendCallNotice, buildCallNoticeText } = await import(
  "@/server/telegram/call-notice"
);

const clinic = {
  id: "c1",
  slug: "neurofax",
  tgBotToken: "tok",
  tgBotUsername: "bot",
};

beforeEach(() => {
  sends.length = 0;
  sendBehaviour = "ok";
});

describe("buildCallNoticeText", () => {
  it("CN1 — RU copy names the cabinet and the doctor", () => {
    const text = buildCallNoticeText({
      cabinetNumber: "12",
      doctorName: "Петрова А. С.",
      lang: "RU",
    });
    expect(text).toContain("Вас вызывают");
    expect(text).toContain("Кабинет 12");
    expect(text).toContain("Врач: Петрова А. С.");
  });

  it("CN2 — UZ copy for a patient with preferredLang=UZ", () => {
    const text = buildCallNoticeText({
      cabinetNumber: "12",
      doctorName: "Petrova A. S.",
      lang: "UZ",
    });
    expect(text).toContain("Sizni chaqirishmoqda");
    expect(text).toContain("12-xona");
    expect(text).toContain("Shifokor: Petrova A. S.");
  });

  it("CN3 — no cabinet assigned falls back to a walk-to-the-doctor line", () => {
    const text = buildCallNoticeText({ cabinetNumber: null, lang: "RU" });
    expect(text).toContain("Подойдите к врачу");
    expect(text).not.toContain("Кабинет");
  });

  it("CN4 — unknown/absent lang falls back to RU rather than printing a key", () => {
    const text = buildCallNoticeText({ cabinetNumber: "3" });
    expect(text).toContain("Кабинет 3");
  });

  it("CN5 — HTML in the doctor name is escaped (parse_mode safety)", () => {
    const text = buildCallNoticeText({
      cabinetNumber: "<b>7",
      doctorName: "A <script> B",
      lang: "RU",
    });
    expect(text).toContain("&lt;b&gt;7");
    expect(text).toContain("A &lt;script&gt; B");
  });

  it("CN6 — the doctor line is omitted entirely when there is no name", () => {
    const text = buildCallNoticeText({ cabinetNumber: "5", doctorName: null, lang: "RU" });
    expect(text).not.toContain("Врач:");
  });
});

describe("sendCallNotice", () => {
  it("CN7 — sends HTML to the patient's chat and reports success", async () => {
    const sent = await sendCallNotice({
      clinic,
      telegramId: "tg_1",
      cabinetNumber: "12",
      doctorName: "Петрова А. С.",
      lang: "RU",
    });
    expect(sent).toBe(true);
    expect(sends).toHaveLength(1);
    expect(sends[0].chatId).toBe("tg_1");
    expect(sends[0].opts).toEqual({ parse_mode: "HTML" });
  });

  it("CN8 — a patient with no linked Telegram is skipped, not attempted", async () => {
    expect(await sendCallNotice({ clinic, telegramId: null })).toBe(false);
    expect(await sendCallNotice({ clinic, telegramId: undefined })).toBe(false);
    expect(await sendCallNotice({ clinic, telegramId: "" })).toBe(false);
    expect(sends).toHaveLength(0);
  });

  it("CN9 — a Telegram failure resolves false instead of throwing", async () => {
    sendBehaviour = "throw";
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      sendCallNotice({ clinic, telegramId: "tg_1", cabinetNumber: "12" }),
    ).resolves.toBe(false);
    spy.mockRestore();
  });
});
