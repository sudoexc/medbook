import { describe, expect, it } from "vitest";

import ru from "@/messages/ru.json" with { type: "json" };
import uz from "@/messages/uz.json" with { type: "json" };
import { failedReasonText } from "@/app/[locale]/crm/telegram/_lib/failed-reason";

/**
 * Every reason the send route stores on a FAILED staff message reads as its
 * own text in both languages; a disconnected clinic bot is named as such
 * instead of the generic «ошибка отправки».
 */
const SERVER_CODES = [
  "tg_blocked",
  "tg_not_started",
  "no_telegram",
  "tg_error",
  "channel_unavailable",
  "bot_not_connected",
  "not_sent",
];

function tFor(dict: typeof ru) {
  const failed = dict.tgInbox.message.failed as Record<string, string>;
  return (key: string) => {
    const leaf = key.replace(/^message\.failed\./, "");
    const text = failed[leaf];
    if (typeof text !== "string") throw new Error(`missing ${key}`);
    return text;
  };
}

describe("failedReasonText", () => {
  it("names a disconnected clinic bot in RU and UZ", () => {
    expect(failedReasonText(tFor(ru), "bot_not_connected")).toBe(
      "бот клиники не подключён к Telegram",
    );
    expect(failedReasonText(tFor(uz), "bot_not_connected")).toBe(
      "klinika boti Telegramga ulanmagan",
    );
  });

  it("has its own text for every stored code, and a fallback for others", () => {
    for (const dict of [ru, uz]) {
      const t = tFor(dict);
      const fallback = t("message.failed.unknown");
      for (const code of SERVER_CODES) {
        expect(failedReasonText(t, code)).not.toBe(fallback);
      }
      expect(failedReasonText(t, null)).toBe(fallback);
      expect(failedReasonText(t, "something_new")).toBe(fallback);
    }
  });
});
