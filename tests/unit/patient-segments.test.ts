/**
 * Audit PT-15: patient segments follow the visit history.
 *
 * `Patient.segment` was written once, NEW at registration, and never again:
 * «Новые» was the whole base, «Активные» and «Остывают» were empty, and a
 * broadcast to «Активные» reached nobody.
 *
 * Acceptance: after the second completed visit the patient is ACTIVE; N
 * days without a visit make him DORMANT; the classifier and the periodic
 * pass are tested; VIP is a manual label nobody overwrites.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SEGMENT_ACTIVE_DAYS,
  SEGMENT_DORMANT_MAX_DAYS,
  SEGMENT_NEW_DAYS,
  classifyPatientSegment,
  segmentChanges,
  type PatientSegmentValue,
} from "@/lib/patients/segment-rules";

const NOW = new Date("2026-09-30T06:00:00.000Z");
const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

function input(over: Partial<Parameters<typeof classifyPatientSegment>[0]> = {}) {
  return {
    current: "NEW" as PatientSegmentValue,
    visitsCount: 0,
    lastVisitAt: null as Date | null,
    createdAt: daysAgo(3),
    ...over,
  };
}

describe("classifyPatientSegment", () => {
  it("registered, not seen yet: NEW while recent, CHURN once the window is gone", () => {
    expect(classifyPatientSegment(input(), NOW)).toBe("NEW");
    expect(
      classifyPatientSegment(input({ createdAt: daysAgo(SEGMENT_NEW_DAYS + 1) }), NOW),
    ).toBe("CHURN");
  });

  it("one recent visit: still NEW; the second visit makes the patient ACTIVE", () => {
    expect(
      classifyPatientSegment(input({ visitsCount: 1, lastVisitAt: daysAgo(10) }), NOW),
    ).toBe("NEW");
    expect(
      classifyPatientSegment(input({ visitsCount: 2, lastVisitAt: daysAgo(0) }), NOW),
    ).toBe("ACTIVE");
  });

  it(`${SEGMENT_ACTIVE_DAYS} days is the line: active up to it, cooling after`, () => {
    const base = { visitsCount: 5, createdAt: daysAgo(400) };
    expect(
      classifyPatientSegment(input({ ...base, lastVisitAt: daysAgo(SEGMENT_ACTIVE_DAYS) }), NOW),
    ).toBe("ACTIVE");
    expect(
      classifyPatientSegment(
        input({ ...base, lastVisitAt: daysAgo(SEGMENT_ACTIVE_DAYS + 1) }),
        NOW,
      ),
    ).toBe("DORMANT");
    // A one-time patient who never came back cools the same way.
    expect(
      classifyPatientSegment(input({ visitsCount: 1, lastVisitAt: daysAgo(120) }), NOW),
    ).toBe("DORMANT");
  });

  it("over a year without a visit: CHURN", () => {
    expect(
      classifyPatientSegment(
        input({ visitsCount: 7, lastVisitAt: daysAgo(SEGMENT_DORMANT_MAX_DAYS + 1) }),
        NOW,
      ),
    ).toBe("CHURN");
  });

  it("VIP is manual and stays, whatever the history", () => {
    expect(classifyPatientSegment(input({ current: "VIP" }), NOW)).toBe("VIP");
    expect(
      classifyPatientSegment(
        input({ current: "VIP", visitsCount: 1, lastVisitAt: daysAgo(900) }),
        NOW,
      ),
    ).toBe("VIP");
  });

  it("segmentChanges groups only the rows that move", () => {
    const rows = [
      { id: "p_same", ...input({ current: "NEW" }) },
      { id: "p_active", ...input({ current: "NEW", visitsCount: 3, lastVisitAt: daysAgo(5) }) },
      { id: "p_cool", ...input({ current: "ACTIVE", visitsCount: 3, lastVisitAt: daysAgo(200) }) },
      { id: "p_vip", ...input({ current: "VIP", visitsCount: 3, lastVisitAt: daysAgo(200) }) },
    ];
    const changes = segmentChanges(rows, NOW);
    expect(Object.fromEntries(changes)).toEqual({
      ACTIVE: ["p_active"],
      DORMANT: ["p_cool"],
    });
  });
});

// ----- the writers ------------------------------------------------------------

type P = {
  id: string;
  segment: PatientSegmentValue;
  visitsCount: number;
  lastVisitAt: Date | null;
  createdAt: Date;
  deletedAt: Date | null;
};

const h = vi.hoisted(() => ({
  patients: [] as P[],
  updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  pageSizes: [] as number[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patient: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        h.patients.find((p) => p.id === where.id) ?? null,
      ),
      findMany: vi.fn(
        async (args: {
          where: { deletedAt: null };
          take: number;
          cursor?: { id: string };
          skip?: number;
        }) => {
          const live = h.patients
            .filter((p) => p.deletedAt === null)
            .sort((a, b) => a.id.localeCompare(b.id));
          const start = args.cursor
            ? live.findIndex((p) => p.id === args.cursor!.id) + (args.skip ?? 0)
            : 0;
          const page = live.slice(start, start + args.take);
          h.pageSizes.push(page.length);
          return page;
        },
      ),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string | { in: string[] }; segment: { not: string } };
          data: { segment: PatientSegmentValue };
        }) => {
          h.updates.push({ where, data });
          const ids = typeof where.id === "string" ? [where.id] : where.id.in;
          let count = 0;
          for (const p of h.patients) {
            if (ids.includes(p.id) && p.segment !== where.segment.not) {
              p.segment = data.segment;
              count += 1;
            }
          }
          return { count };
        },
      ),
    },
  },
}));

import {
  recomputePatientSegments,
  refreshPatientSegment,
} from "@/server/patient/segments";

function patient(id: string, over: Partial<P> = {}): P {
  return {
    id,
    segment: "NEW",
    visitsCount: 0,
    lastVisitAt: null,
    createdAt: daysAgo(2),
    deletedAt: null,
    ...over,
  };
}

beforeEach(() => {
  h.patients = [];
  h.updates = [];
  h.pageSizes = [];
});

describe("refreshPatientSegment (on a completed visit)", () => {
  it("the second visit moves the patient to ACTIVE", async () => {
    h.patients = [patient("p1", { visitsCount: 2, lastVisitAt: daysAgo(0) })];
    await refreshPatientSegment("p1", NOW);
    expect(h.patients[0]!.segment).toBe("ACTIVE");
    // The write never lands on a VIP set in between.
    expect(h.updates[0]!.where).toMatchObject({ id: "p1", segment: { not: "VIP" } });
  });

  it("nothing to write when the segment is already right", async () => {
    h.patients = [patient("p1", { visitsCount: 1, lastVisitAt: daysAgo(0) })];
    await refreshPatientSegment("p1", NOW);
    expect(h.updates).toEqual([]);
  });

  it("a VIP stays VIP", async () => {
    h.patients = [patient("p1", { segment: "VIP", visitsCount: 2, lastVisitAt: daysAgo(0) })];
    await refreshPatientSegment("p1", NOW);
    expect(h.patients[0]!.segment).toBe("VIP");
    expect(h.updates).toEqual([]);
  });

  it("never throws: a failure is logged, the visit stays closed", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { prisma } = await import("@/lib/prisma");
    vi.mocked(prisma.patient.findUnique).mockRejectedValueOnce(new Error("db down"));
    await expect(refreshPatientSegment("p1", NOW)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("recomputePatientSegments (the periodic pass)", () => {
  it("time alone moves segments; deleted patients and VIPs are left alone", async () => {
    h.patients = [
      patient("a_cool", { segment: "ACTIVE", visitsCount: 4, lastVisitAt: daysAgo(100) }),
      patient("b_lost", { segment: "DORMANT", visitsCount: 4, lastVisitAt: daysAgo(400) }),
      patient("c_new", { segment: "NEW" }),
      patient("d_vip", { segment: "VIP", visitsCount: 1, lastVisitAt: daysAgo(900) }),
      patient("e_deleted", {
        segment: "NEW",
        createdAt: daysAgo(500),
        deletedAt: daysAgo(1),
      }),
    ];
    const out = await recomputePatientSegments(NOW);
    expect(out).toEqual({ scanned: 4, changed: 2 });
    const seg = Object.fromEntries(h.patients.map((p) => [p.id, p.segment]));
    expect(seg).toEqual({
      a_cool: "DORMANT",
      b_lost: "CHURN",
      c_new: "NEW",
      d_vip: "VIP",
      e_deleted: "NEW",
    });
  });

  it("a second pass changes nothing (idempotent)", async () => {
    h.patients = [patient("a", { segment: "NEW", visitsCount: 2, lastVisitAt: daysAgo(1) })];
    await recomputePatientSegments(NOW);
    h.updates = [];
    const again = await recomputePatientSegments(NOW);
    expect(again.changed).toBe(0);
    expect(h.updates).toEqual([]);
  });

  it("pages through a base larger than one page", async () => {
    h.patients = Array.from({ length: 1001 }, (_, i) =>
      patient(`p${String(i).padStart(5, "0")}`, {
        segment: "NEW",
        visitsCount: 2,
        lastVisitAt: daysAgo(1),
      }),
    );
    const out = await recomputePatientSegments(NOW);
    expect(out).toEqual({ scanned: 1001, changed: 1001 });
    expect(h.pageSizes).toEqual([1000, 1]);
  });
});
