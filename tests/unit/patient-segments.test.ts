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
 *
 * Review of 1b62941: a patient with a visit booked ahead is never DORMANT
 * or CHURN. Reception called patients whose control visit was already
 * booked (the «Остывают» page is the call list), a DORMANT broadcast asked
 * them to come back, and a first-timer rebooked for today walked in as
 * «Потерянный».
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  SEGMENT_ACTIVE_DAYS,
  SEGMENT_DORMANT_MAX_DAYS,
  SEGMENT_NEW_DAYS,
  classifyPatientSegment,
  segmentChanges,
  upcomingVisitWhere,
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

  it("a visit booked ahead: never DORMANT or CHURN, counted as a recent contact", () => {
    const booked = { hasUpcomingVisit: true };
    // Aziz saw him 100 days ago, the control visit is booked for next week.
    expect(
      classifyPatientSegment(
        input({ ...booked, current: "ACTIVE", visitsCount: 4, lastVisitAt: daysAgo(100) }),
        NOW,
      ),
    ).toBe("ACTIVE");
    // Back after more than a year, booked again.
    expect(
      classifyPatientSegment(
        input({ ...booked, visitsCount: 3, lastVisitAt: daysAgo(SEGMENT_DORMANT_MAX_DAYS + 30) }),
        NOW,
      ),
    ).toBe("ACTIVE");
    // One visit long ago and the second one booked: still a first-timer.
    expect(
      classifyPatientSegment(input({ ...booked, visitsCount: 1, lastVisitAt: daysAgo(200) }), NOW),
    ).toBe("NEW");
    // Registered long ago, never seen, rebooked for today: NEW, not CHURN.
    expect(
      classifyPatientSegment(input({ ...booked, createdAt: daysAgo(SEGMENT_NEW_DAYS + 50) }), NOW),
    ).toBe("NEW");
    // VIP stays VIP either way.
    expect(classifyPatientSegment(input({ ...booked, current: "VIP" }), NOW)).toBe("VIP");
    // Without the booking the same histories cool down as before.
    expect(
      classifyPatientSegment(input({ visitsCount: 4, lastVisitAt: daysAgo(100) }), NOW),
    ).toBe("DORMANT");
    expect(
      classifyPatientSegment(input({ createdAt: daysAgo(SEGMENT_NEW_DAYS + 50) }), NOW),
    ).toBe("CHURN");
  });

  it("upcomingVisitWhere: still expected or on the table, from the start of today in Tashkent", () => {
    // NOW is 11:00 in Tashkent on 30.09; the day starts at 19:00 UTC on 29.09.
    expect(upcomingVisitWhere(["p1", "p2"], NOW)).toEqual({
      patientId: { in: ["p1", "p2"] },
      status: { in: ["BOOKED", "CONFIRMED", "WAITING", "IN_PROGRESS"] },
      date: { gte: new Date("2026-09-29T19:00:00.000Z") },
    });
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

type A = { patientId: string; status: string; date: Date };

const h = vi.hoisted(() => ({
  patients: [] as P[],
  appointments: [] as A[],
  appointmentQueries: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>,
  pageSizes: [] as number[],
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    // The `where` of `upcomingVisitWhere`, evaluated in memory.
    appointment: {
      findMany: vi.fn(
        async (args: {
          where: {
            patientId: { in: string[] };
            status: { in: string[] };
            date: { gte: Date };
          };
          distinct?: string[];
        }) => {
          h.appointmentQueries.push(args);
          const hit = h.appointments.filter(
            (a) =>
              args.where.patientId.in.includes(a.patientId) &&
              args.where.status.in.includes(a.status) &&
              a.date.getTime() >= args.where.date.gte.getTime(),
          );
          const ids = [...new Set(hit.map((a) => a.patientId))];
          return ids.map((patientId) => ({ patientId }));
        },
      ),
    },
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

const inDays = (n: number) => new Date(NOW.getTime() + n * DAY);

beforeEach(() => {
  h.patients = [];
  h.appointments = [];
  h.appointmentQueries = [];
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

  it("a booking takes a cooling patient off «Остывают» at once", async () => {
    h.patients = [
      patient("p1", { segment: "DORMANT", visitsCount: 4, lastVisitAt: daysAgo(100) }),
    ];
    h.appointments = [{ patientId: "p1", status: "CONFIRMED", date: inDays(7) }];
    await refreshPatientSegment("p1", NOW);
    expect(h.patients[0]!.segment).toBe("ACTIVE");
    // Only this patient's bookings are read.
    expect(h.appointmentQueries[0]).toMatchObject({
      where: { patientId: { in: ["p1"] } },
    });
  });

  it("a walk-in in today's queue since the morning is not «Потерянный»", async () => {
    h.patients = [patient("p1", { segment: "CHURN", createdAt: daysAgo(200) })];
    // Registered at 09:00 Tashkent, still waiting at 11:00.
    h.appointments = [
      { patientId: "p1", status: "WAITING", date: new Date("2026-09-30T04:00:00.000Z") },
    ];
    await refreshPatientSegment("p1", NOW);
    expect(h.patients[0]!.segment).toBe("NEW");
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

  it("a booked patient stays; a cancelled, missed or stale booking holds no one", async () => {
    const cooling = { segment: "ACTIVE" as const, visitsCount: 4, lastVisitAt: daysAgo(100) };
    h.patients = [
      patient("a_booked", cooling),
      patient("b_cancelled", cooling),
      patient("c_no_show", cooling),
      patient("d_stale", cooling),
      patient("e_lost_booked", { segment: "DORMANT", visitsCount: 2, lastVisitAt: daysAgo(500) }),
    ];
    h.appointments = [
      { patientId: "a_booked", status: "BOOKED", date: inDays(5) },
      { patientId: "b_cancelled", status: "CANCELLED", date: inDays(5) },
      { patientId: "c_no_show", status: "NO_SHOW", date: inDays(0) },
      // Left BOOKED on an earlier day: not a visit ahead.
      { patientId: "d_stale", status: "BOOKED", date: daysAgo(2) },
      { patientId: "e_lost_booked", status: "CONFIRMED", date: inDays(30) },
    ];
    await recomputePatientSegments(NOW);
    const seg = Object.fromEntries(h.patients.map((p) => [p.id, p.segment]));
    expect(seg).toEqual({
      a_booked: "ACTIVE",
      b_cancelled: "DORMANT",
      c_no_show: "DORMANT",
      d_stale: "DORMANT",
      e_lost_booked: "ACTIVE",
    });
    // One bookings query per page, not per patient.
    expect(h.appointmentQueries).toHaveLength(1);
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
