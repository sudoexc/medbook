/**
 * Audit Q-12: queue tickets of different doctors must not collide.
 *
 * The letter used to be `doctorId.charAt(0)`. Doctor ids are cuid, and cuid
 * always starts with "c", so both neurologists handed out C-001, C-002… at
 * the same time: the board calling «C-005» stood up two patients and «у кого
 * C-005?» at the desk had two answers. The letter is now stored per doctor
 * (`Doctor.ticketPrefix`, unique in the clinic) and every surface goes
 * through `ticketNumberFor`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  TICKET_PREFIX_ALPHABET,
  nextTicketPrefix,
  normalizeTicketPrefix,
  ticketNumberFor,
} from "@/server/services/ticket-number";
import { isTicketPrefixConflict } from "@/server/doctors/ticket-prefix";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(async () => state.rows),
    },
  },
}));

vi.mock("@/server/ai/per-visit-eta", () => ({
  predictPerVisitMinutes: vi.fn(
    async (ids: string[]) =>
      new Map(
        ids.map((id) => [id, { etaMin: 20, confidence: "high", source: "history" }]),
      ),
  ),
}));

describe("ticketNumberFor", () => {
  it("prints the doctor's stored letter and a padded sequence", () => {
    expect(ticketNumberFor({ ticketPrefix: "A" }, 5)).toBe("A-005");
    expect(ticketNumberFor({ ticketPrefix: "AB" }, 42)).toBe("AB-042");
    expect(ticketNumberFor({ ticketPrefix: "B" }, 1234)).toBe("B-1234");
  });

  it("two doctors whose cuid ids both start with «c» get different tickets", () => {
    const aziz = { id: "cmf8x1aziz0001", ticketPrefix: "A" };
    const bakhtiyor = { id: "cmf8x2bakh0002", ticketPrefix: "B" };
    expect(ticketNumberFor(aziz, 5)).not.toBe(ticketNumberFor(bakhtiyor, 5));
    expect(ticketNumberFor(aziz, 5)?.startsWith("C")).toBe(false);
  });

  it("returns null when nothing was ever allocated (no fake X-000)", () => {
    expect(ticketNumberFor({ ticketPrefix: "A" }, null)).toBeNull();
    expect(ticketNumberFor({ ticketPrefix: "A" }, undefined)).toBeNull();
  });

  it("a doctor without a letter yet prints the bare number, not someone else's letter", () => {
    expect(ticketNumberFor({ ticketPrefix: null }, 7)).toBe("007");
  });
});

describe("nextTicketPrefix: the default letter for a new doctor", () => {
  it("takes the first free letter in order", () => {
    expect(nextTicketPrefix([])).toBe("A");
    expect(nextTicketPrefix(["A"])).toBe("B");
    expect(nextTicketPrefix(["A", "C"])).toBe("B");
    expect(nextTicketPrefix(["B", null])).toBe("A");
  });

  it("skips I and O, which read as digits on a thermal slip", () => {
    expect(TICKET_PREFIX_ALPHABET).not.toContain("I");
    expect(TICKET_PREFIX_ALPHABET).not.toContain("O");
    expect(nextTicketPrefix(["A", "B", "C", "D", "E", "F", "G", "H"])).toBe("J");
  });

  it("moves on to two letters once every single letter is taken", () => {
    expect(nextTicketPrefix([...TICKET_PREFIX_ALPHABET])).toBe("AA");
    expect(nextTicketPrefix([...TICKET_PREFIX_ALPHABET, "AA"])).toBe("AB");
  });
});

describe("normalizeTicketPrefix: admin input", () => {
  it("upper-cases and trims one or two Latin letters", () => {
    expect(normalizeTicketPrefix(" a ")).toBe("A");
    expect(normalizeTicketPrefix("kb")).toBe("KB");
  });

  it("refuses anything else", () => {
    for (const bad of ["", "1", "A1", "ABC", "А" /* Cyrillic */, "-", "A-"]) {
      expect(normalizeTicketPrefix(bad)).toBeNull();
    }
  });
});

describe("isTicketPrefixConflict", () => {
  it("recognises the unique-index violation on the letter", () => {
    expect(
      isTicketPrefixConflict({
        code: "P2002",
        message: "Unique constraint failed on the fields: (`clinicId`,`ticketPrefix`)",
      }),
    ).toBe(true);
    expect(
      isTicketPrefixConflict({
        code: "P2002",
        message: "Unique constraint failed",
        meta: { target: "Doctor_clinicId_ticketPrefix_key" },
      }),
    ).toBe(true);
  });

  it("does not claim other unique violations", () => {
    expect(
      isTicketPrefixConflict({
        code: "P2002",
        message: "Unique constraint failed on the fields: (`cabinetId`)",
      }),
    ).toBe(false);
    expect(isTicketPrefixConflict(new Error("ticketPrefix"))).toBe(false);
  });
});

describe("queue projection: the board, kiosk and QR page all read the stored letter", () => {
  beforeEach(() => {
    state.rows = [];
  });

  function row(over: Record<string, unknown>) {
    return {
      queueStatus: "WAITING",
      queueOrder: 1,
      queuePriority: 0,
      ticketSeq: 1,
      channel: "WALKIN",
      date: new Date("2026-09-23T04:00:00Z"),
      queuedAt: new Date("2026-09-23T04:00:00Z"),
      startedAt: null,
      durationMin: 20,
      patient: { fullName: "Пациент Тест" },
      ...over,
    };
  }

  it("the same sequence number reads differently for two doctors", async () => {
    state.rows = [
      row({ id: "a1", doctorId: "cdoc1", ticketSeq: 5, doctor: { ticketPrefix: "A" } }),
      row({ id: "b1", doctorId: "cdoc2", ticketSeq: 5, doctor: { ticketPrefix: "B" } }),
      row({
        id: "a0",
        doctorId: "cdoc1",
        ticketSeq: 4,
        queueStatus: "IN_PROGRESS",
        startedAt: new Date("2026-09-23T04:30:00Z"),
        doctor: { ticketPrefix: "A" },
      }),
    ];
    const { getQueueProjection } = await import(
      "@/server/appointments/queue-projection"
    );
    const q = await getQueueProjection({
      clinicId: "c1",
      doctorIds: ["cdoc1", "cdoc2"],
      at: new Date("2026-09-23T06:00:00Z"),
    });
    expect(q.get("cdoc1")?.waiting[0].ticketNumber).toBe("A-005");
    expect(q.get("cdoc2")?.waiting[0].ticketNumber).toBe("B-005");
    expect(q.get("cdoc1")?.current?.ticketNumber).toBe("A-004");
  });
});
