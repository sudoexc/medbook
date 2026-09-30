import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Audit TG-17: `tgCallWithBackoff` repeated every network failure, timeouts
 * included, up to 12 times. A timeout can mean Telegram already delivered
 * the message, so a staff message could reach the patient two or three
 * times. With `delivery: { retryUncertain: false }` (the staff send worker)
 * only failures where the request never left are retried; anything else is
 * reported as «outcome unknown» (`tg_timeout`: «могло дойти»).
 */

import {
  TgUncertainSendError,
  isConnectFailure,
  sendMessage,
} from "@/server/telegram/send";
import { tgFailReason } from "@/server/telegram/send-errors";

const CLINIC = {
  id: "c1",
  slug: "alpha",
  // Legacy plaintext token: readTgBotToken passes it through.
  tgBotToken: "123456:AA-legacy-plaintext",
  tgBotUsername: "bot",
};

function timeoutError(): Error {
  const e = new Error("The operation was aborted due to timeout");
  e.name = "TimeoutError";
  return e;
}

function connectRefused(): Error {
  return Object.assign(new TypeError("fetch failed"), {
    cause: Object.assign(new Error("connect ECONNREFUSED 149.154.167.220:443"), {
      code: "ECONNREFUSED",
    }),
  });
}

function okResponse(): Response {
  return new Response(
    JSON.stringify({ ok: true, result: { message_id: 77, chat: { id: 1 }, date: 0 } }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("staff sends never repeat a request Telegram may have taken (audit TG-17)", () => {
  it("a timeout is reported as outcome unknown after ONE request", async () => {
    const fetchMock = vi.fn(async () => {
      throw timeoutError();
    });
    vi.stubGlobal("fetch", fetchMock);
    const err = await sendMessage(CLINIC, "555", "Ждём вас в 15:00", {
      delivery: { retryUncertain: false },
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TgUncertainSendError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(tgFailReason((err as Error).message)).toBe("tg_timeout");
  });

  it("a refused connection (the request never left) is still retried", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(connectRefused())
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendMessage(CLINIC, "555", "Ждём вас в 15:00", {
      delivery: { retryUncertain: false },
    });
    expect(res.message_id).toBe(77);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("the delivery policy never reaches the Telegram payload", async () => {
    const fetchMock = vi.fn(async () => okResponse());
    vi.stubGlobal("fetch", fetchMock);
    await sendMessage(CLINIC, "555", "Здравствуйте", {
      delivery: { retryUncertain: false, attemptTimeoutMs: 30_000 },
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, { body: string }])[1].body,
    );
    expect(body).toEqual({ chat_id: "555", text: "Здравствуйте" });
  });

  it("other callers keep retrying timeouts (bot replies, reminders)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(timeoutError())
      .mockResolvedValueOnce(okResponse());
    vi.stubGlobal("fetch", fetchMock);
    const res = await sendMessage(CLINIC, "555", "Меню");
    expect(res.message_id).toBe(77);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("tells a connection failure from a request that may have arrived", () => {
    expect(isConnectFailure(connectRefused())).toBe(true);
    expect(
      isConnectFailure(
        Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } }),
      ),
    ).toBe(true);
    expect(isConnectFailure(timeoutError())).toBe(false);
    expect(
      isConnectFailure(
        Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }),
      ),
    ).toBe(false);
    expect(isConnectFailure(null)).toBe(false);
  });
});
