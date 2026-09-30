import { describe, expect, it, vi } from "vitest";

/**
 * Pre-deploy review: reminders and broadcasts the bot sent are copied into
 * the patient's dialog as OUT messages with an `origin` (audit G6-08). The
 * platform's `tgMessages` counter counted every OUT message, so each copy
 * counted a second time next to the message it copies.
 */

const state = vi.hoisted(() => ({
  messageWhere: null as null | Record<string, unknown>,
}));

vi.mock("@/server/platform/handler", () => ({
  createPlatformListHandler:
    (fn: (a: { request: Request; body: unknown; userId: string }) => Promise<Response>) =>
    (request: Request) =>
      fn({ request, body: undefined, userId: "su1" }),
}));

vi.mock("@/lib/prisma", () => {
  const none = vi.fn(async () => []);
  return {
    prisma: {
      clinic: {
        findMany: vi.fn(async () => [
          { id: "c1", slug: "alpha", nameRu: "Альфа", nameUz: "Alfa", active: true },
        ]),
      },
      appointment: { groupBy: none },
      notificationSend: { groupBy: none },
      message: {
        groupBy: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          state.messageWhere = where;
          return [{ clinicId: "c1", _count: { _all: 4 } }];
        }),
      },
      call: { groupBy: none },
      patient: { groupBy: none },
    },
  };
});

import { GET } from "@/app/api/platform/usage/route";

describe("platform usage: Telegram messages", () => {
  it("counts the chat's outbound messages, not the dialog copies of reminders", async () => {
    const res = await (GET as unknown as (r: Request) => Promise<Response>)(
      new Request("https://crm.test/api/platform/usage?period=week"),
    );
    expect(res.status).toBe(200);
    expect(state.messageWhere).toMatchObject({ direction: "OUT", origin: null });
    const body = (await res.json()) as { rows: Array<{ tgMessages: number }> };
    expect(body.rows[0]!.tgMessages).toBe(4);
  });
});
