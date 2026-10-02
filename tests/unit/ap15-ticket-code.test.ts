/**
 * Audit AP-15: the short ticket code is the only key to the public
 * /t/<code> resolver, and it came from `Math.random` in 6 characters. It is
 * now 8 characters from `crypto.randomInt`, and the uniqueness check looks
 * across all clinics: `ticketCode` is unique globally, but a clinic's
 * request pinned the lookup to that clinic, so another clinic's code read
 * as free and the insert died on P2002.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  taken: new Set<string>(),
  unscopedReasons: [] as string[],
  insideUnscoped: false,
  lookupsUnscoped: [] as boolean[],
}));

vi.mock("@/lib/tenant-context", () => ({
  runUnscoped: async <T,>(reason: string, fn: () => Promise<T>) => {
    h.unscopedReasons.push(reason);
    h.insideUnscoped = true;
    try {
      return await fn();
    } finally {
      h.insideUnscoped = false;
    }
  },
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(async ({ where }: { where: { ticketCode: string } }) => {
        h.lookupsUnscoped.push(h.insideUnscoped);
        return h.taken.has(where.ticketCode) ? { id: "ap_other_clinic" } : null;
      }),
    },
  },
}));

import { generateTicketCode, randomTicketCode } from "@/server/appointments/ticket-code";

beforeEach(() => {
  h.taken = new Set();
  h.unscopedReasons = [];
  h.lookupsUnscoped = [];
});

describe("ticket codes", () => {
  it("are 8 characters of the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      expect(randomTicketCode()).toMatch(/^[23456789ABCDEFGHJKMNPQRSTVWXYZ]{8}$/);
    }
  });

  it("still fit the /t resolver's pattern", () => {
    expect(randomTicketCode()).toMatch(/^[2-9A-HJ-NP-TV-Z]{4,12}$/);
  });

  it("come from the crypto RNG, not Math.random", () => {
    const spy = vi.spyOn(Math, "random");
    randomTicketCode();
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("are checked for uniqueness across every clinic", async () => {
    const code = await generateTicketCode();
    expect(code).toHaveLength(8);
    expect(h.lookupsUnscoped).toEqual([true]);
    expect(h.unscopedReasons).toHaveLength(1);
  });
});
