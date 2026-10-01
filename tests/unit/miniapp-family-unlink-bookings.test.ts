/**
 * Review of audit MA-14 — unlinking a relative cannot launder the account's
 * booking count.
 *
 * The account cap counts the owner and his linked relatives. DELETE
 * /api/miniapp/family/[id] dropped only the link and kept the relative's
 * bookings, so a script could add five relatives, book for each, unlink
 * them (bookings kept, no longer counted), add five fresh ones and book
 * again. The unlink is now refused while the relative holds Mini App
 * bookings ahead, inside a Serializable transaction.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  link: { id: "lnk_1", relationship: "parent", linkedPatientId: "p_mama" } as Record<
    string,
    unknown
  > | null,
  onlineAhead: 0,
  countWhere: null as Record<string, unknown> | null,
  deleted: [] as string[],
  published: [] as Array<Record<string, unknown>>,
  serializable: 0,
}));

vi.mock("@/server/miniapp/handler", () => {
  const wrap =
    (_opts: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({
        request,
        ctx: {
          clinicId: "c1",
          clinicSlug: "neurofax",
          patientId: "p_owner",
          patient: { id: "p_owner", fullName: "Karimova Dilnoza", preferredLang: "RU" },
        },
      });
  return { createMiniAppHandler: wrap, createMiniAppListHandler: wrap };
});

const tx = {
  appointment: {
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      state.countWhere = where;
      return state.onlineAhead;
    }),
  },
  patientFamily: {
    delete: vi.fn(async ({ where }: { where: { id: string } }) => {
      state.deleted.push(where.id);
      return {};
    }),
  },
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patientFamily: { findFirst: vi.fn(async () => state.link) },
  },
}));
vi.mock("@/server/appointments/queue-order", () => ({
  runQueueTx: vi.fn(async (fn: (t: typeof tx) => Promise<unknown>) => {
    state.serializable += 1;
    return fn(tx);
  }),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_1",
  publishViaOutbox: vi.fn(async (_tx: unknown, envelope: Record<string, unknown>) => {
    state.published.push(envelope);
  }),
}));

import { DELETE } from "@/app/api/miniapp/family/[linkedPatientId]/route";
import { miniAppActionErrorText } from "@/app/c/[slug]/my/_lib/action-errors";
import { ruDict } from "@/app/c/[slug]/my/_messages/ru";
import { uzDict } from "@/app/c/[slug]/my/_messages/uz";

function unlink() {
  return DELETE(new Request("https://x/api/miniapp/family/p_mama?clinicSlug=neurofax", {
    method: "DELETE",
  }));
}

beforeEach(() => {
  state.link = { id: "lnk_1", relationship: "parent", linkedPatientId: "p_mama" };
  state.onlineAhead = 0;
  state.countWhere = null;
  state.deleted = [];
  state.published = [];
  state.serializable = 0;
});

describe("DELETE /api/miniapp/family/[linkedPatientId]", () => {
  it("a relative with Mini App bookings ahead stays linked (409)", async () => {
    state.onlineAhead = 2;
    const res = await unlink();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "conflict", reason: "has_upcoming_bookings" });
    expect(state.deleted).toEqual([]);
    expect(state.published).toEqual([]);
    // Her own Mini App bookings, counted in the unlink's transaction.
    expect(state.countWhere).toMatchObject({
      clinicId: "c1",
      patientId: "p_mama",
      channel: "TELEGRAM",
    });
    expect(state.serializable).toBe(1);
  });

  it("a relative with none is unlinked, as before", async () => {
    const res = await unlink();
    expect(res.status).toBe(200);
    expect(state.deleted).toEqual(["lnk_1"]);
    expect(state.published.map((e) => e.type)).toEqual(["patient.familyUnlinked"]);
  });

  it("someone else's relative is still a 404", async () => {
    state.link = null;
    expect((await unlink()).status).toBe(404);
    expect(state.serializable).toBe(0);
  });
});

describe("what the patient reads", () => {
  const refusal = { data: { error: "conflict", reason: "has_upcoming_bookings" } };

  it("the refused unlink and the account limit read as text, with no dash", () => {
    const account = { data: { error: "conflict", reason: "booking_limit", limit: "account_total" } };
    for (const dict of [ruDict, uzDict]) {
      const unlinkText = miniAppActionErrorText(refusal, dict);
      expect(unlinkText).toBe(dict.family.unlinkHasBookings);
      const limitText = miniAppActionErrorText(account, dict);
      expect(limitText).toContain("6");
      expect(limitText).not.toContain("{count}");
      for (const text of [unlinkText, limitText]) expect(text).not.toMatch(/[—–]/);
    }
  });
});
