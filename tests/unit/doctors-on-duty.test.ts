/**
 * Audit Q-08: the kiosk and the waiting-room TV list the doctors who really
 * work today.
 *
 * Both used to take every active doctor with a schedule row for today's
 * weekday: a neurologist on leave (DoctorTimeOff) stayed on the kiosk and
 * patients took tickets for him; a doctor who came in on Saturday outside
 * his schedule had walk-ins registered by reception and no column on the
 * TV.
 *
 * Acceptance: a doctor with time off today is not on the kiosk and the
 * kiosk walk-in for him is refused (409 doctor_off_duty); a doctor with
 * WAITING patients today and no schedule for the day is on /tv.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { isDoctorOnDuty, LIVE_QUEUE_STATUSES } from "@/server/doctors/on-duty";

// Wednesday 30.09.2026, 11:00 in Tashkent (UTC+5).
const WED_11 = new Date("2026-09-30T06:00:00.000Z");
const WED = "2026-09-30";
// Saturday 03.10.2026, 11:00 in Tashkent.
const SAT_11 = new Date("2026-10-03T06:00:00.000Z");
const SAT = "2026-10-03";

/** Mon–Fri 09:00–17:00. */
const MON_FRI = [1, 2, 3, 4, 5].map((weekday) => ({
  weekday,
  startTime: "09:00",
  endTime: "17:00",
}));

describe("isDoctorOnDuty", () => {
  it("a working day by the schedule, nothing else going on: on duty", () => {
    expect(
      isDoctorOnDuty({ schedule: MON_FRI, timeOffs: [], todayDate: WED, now: WED_11, hasLiveQueue: false }),
    ).toBe(true);
  });

  it("Saturday for a Mon–Fri doctor: off, unless reception runs a queue for him", () => {
    const base = { schedule: MON_FRI, timeOffs: [], todayDate: SAT, now: SAT_11 };
    expect(isDoctorOnDuty({ ...base, hasLiveQueue: false })).toBe(false);
    expect(isDoctorOnDuty({ ...base, hasLiveQueue: true })).toBe(true);
  });

  it("a schedule that ended last month is no working day", () => {
    const expired = MON_FRI.map((r) => ({
      ...r,
      validTo: new Date("2026-08-31T18:59:59.000Z"),
    }));
    expect(
      isDoctorOnDuty({ schedule: expired, timeOffs: [], todayDate: WED, now: WED_11, hasLiveQueue: false }),
    ).toBe(false);
  });

  it("leave covering the day takes him off", () => {
    const leave = [
      {
        startAt: new Date("2026-09-28T00:00:00.000Z"),
        endAt: new Date("2026-10-05T00:00:00.000Z"),
      },
    ];
    expect(
      isDoctorOnDuty({ schedule: MON_FRI, timeOffs: leave, todayDate: WED, now: WED_11, hasLiveQueue: false }),
    ).toBe(false);
  });

  it("a few hours away: off during them, on duty after", () => {
    // 10:00–12:00 Tashkent.
    const away = [
      {
        startAt: new Date("2026-09-30T05:00:00.000Z"),
        endAt: new Date("2026-09-30T07:00:00.000Z"),
      },
    ];
    const base = { schedule: MON_FRI, timeOffs: away, todayDate: WED, hasLiveQueue: false };
    expect(isDoctorOnDuty({ ...base, now: WED_11 })).toBe(false);
    expect(isDoctorOnDuty({ ...base, now: new Date("2026-09-30T08:00:00.000Z") })).toBe(true);
  });

  it("no schedule at all and no queue: not on duty (the booking fallback is no presence)", () => {
    expect(
      isDoctorOnDuty({ schedule: [], timeOffs: [], todayDate: WED, now: WED_11, hasLiveQueue: false }),
    ).toBe(false);
  });

  it("the live queue is waiting, on the table or skipped", () => {
    expect([...LIVE_QUEUE_STATUSES].sort()).toEqual(["IN_PROGRESS", "SKIPPED", "WAITING"]);
  });
});

// ----- the screens ----------------------------------------------------------

type Doc = { id: string; nameRu: string; clinicId: string; isActive: boolean };

const h = vi.hoisted(() => ({
  doctors: [] as Doc[],
  schedules: [] as Array<Record<string, unknown>>,
  timeOffs: [] as Array<Record<string, unknown>>,
  appts: [] as Array<{ doctorId: string; queueStatus: string; date: Date }>,
  projection: new Map<string, unknown>(),
  doctorFindFirst: vi.fn(),
  patientFindFirst: vi.fn(),
}));

function inDay(d: Date, gte: Date, lt: Date): boolean {
  return d >= gte && d < lt;
}

function mountMocks() {
  vi.resetModules();
  vi.doMock("@/lib/prisma", () => ({
    prisma: {
      doctor: {
        findMany: vi.fn(async () =>
          h.doctors.map((d) => ({ ...d, cabinet: null, nameUz: d.nameRu })),
        ),
        findFirst: h.doctorFindFirst,
      },
      patient: { findFirst: h.patientFindFirst },
      doctorSchedule: {
        findMany: vi.fn(async ({ where }: { where: { doctorId: { in: string[] } } }) =>
          h.schedules.filter((r) => where.doctorId.in.includes(r.doctorId as string)),
        ),
      },
      doctorTimeOff: {
        findMany: vi.fn(async ({ where }: { where: { doctorId: { in: string[] } } }) =>
          h.timeOffs.filter((r) => where.doctorId.in.includes(r.doctorId as string)),
        ),
      },
      appointment: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: {
              doctorId: { in: string[] };
              date: { gte: Date; lt: Date };
              queueStatus: { in: string[] };
            };
          }) =>
            h.appts
              .filter(
                (a) =>
                  where.doctorId.in.includes(a.doctorId) &&
                  inDay(a.date, where.date.gte, where.date.lt) &&
                  where.queueStatus.in.includes(a.queueStatus),
              )
              .map((a) => ({ doctorId: a.doctorId })),
        ),
      },
    },
  }));
  vi.doMock("@/server/clinic-public/resolve", () => ({
    createPublicClinicHandler:
      (handler: (a: { request: Request; ctx: Record<string, unknown> }) => Promise<Response>) =>
      (request: Request) =>
        handler({
          request,
          ctx: {
            clinicId: "c1",
            clinicSlug: "neurofax",
            clinicNameRu: "NeuroFax",
            clinicNameUz: "NeuroFax",
            clinicPhone: null,
            clinicAddressRu: null,
            clinicAddressUz: null,
          },
        }),
  }));
  vi.doMock("@/server/appointments/queue-projection", () => ({
    getQueueProjection: vi.fn(async () => h.projection),
  }));
}

function schedule(doctorId: string) {
  return MON_FRI.map((r) => ({
    ...r,
    doctorId,
    validFrom: null,
    validTo: null,
  }));
}

describe("Q-08: the TV and the kiosk list doctors by the real day", () => {
  beforeEach(() => {
    mountMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    h.doctors = [
      { id: "doc_leave", nameRu: "Алиева", clinicId: "c1", isActive: true },
      { id: "doc_aziz", nameRu: "Султанов", clinicId: "c1", isActive: true },
    ];
    h.schedules = [...schedule("doc_leave"), ...schedule("doc_aziz")];
    h.timeOffs = [
      {
        doctorId: "doc_leave",
        startAt: new Date("2026-09-28T00:00:00.000Z"),
        endAt: new Date("2026-10-10T00:00:00.000Z"),
      },
    ];
    h.appts = [];
    h.projection = new Map();
    h.doctorFindFirst.mockReset();
    h.patientFindFirst.mockReset();
  });

  it("kiosk list on a Wednesday: the doctor on leave is gone", async () => {
    vi.setSystemTime(WED_11);
    const { GET } = await import("@/app/api/c/[slug]/queue/doctors/route");
    const res = await GET(new Request("https://x/api/c/neurofax/queue/doctors"));
    const body = (await res.json()) as { doctors: Array<{ id: string }> };
    expect(body.doctors.map((d) => d.id)).toEqual(["doc_aziz"]);
    vi.useRealTimers();
  });

  it("TV on a Saturday: only the doctor with WAITING patients today has a column", async () => {
    vi.setSystemTime(SAT_11);
    h.appts = [
      { doctorId: "doc_aziz", queueStatus: "WAITING", date: new Date("2026-10-03T05:30:00.000Z") },
      // Yesterday's leftovers do not count.
      { doctorId: "doc_leave", queueStatus: "WAITING", date: new Date("2026-10-02T05:30:00.000Z") },
    ];
    const { GET } = await import("@/app/api/c/[slug]/queue/board/route");
    const res = await GET(new Request("https://x/api/c/neurofax/queue/board"));
    const body = (await res.json()) as { doctors: Array<{ id: string }> };
    expect(body.doctors.map((d) => d.id)).toEqual(["doc_aziz"]);
    vi.useRealTimers();
  });

  it("kiosk walk-in for the doctor on leave: refused before any patient is touched", async () => {
    vi.setSystemTime(WED_11);
    h.doctorFindFirst.mockResolvedValue({
      id: "doc_leave",
      nameRu: "Алиева",
      nameUz: "Alieva",
      color: null,
      pricePerVisit: null,
      cabinetId: null,
      ticketPrefix: null,
      cabinet: null,
    });
    const { registerWalkin } = await import("@/server/appointments/walkin");
    const out = await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_leave",
      patient: { fullName: "Каримов Азиз", phone: "+998901234567" },
      requireOnDuty: true,
    });
    expect(out).toEqual({ ok: false, reason: "doctor_off_duty" });
    expect(h.patientFindFirst).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
