/**
 * What the reception tablet shows per doctor and per booking
 * (src/lib/reception-tablet/doctor-day.ts).
 */
import { describe, expect, it } from "vitest";

import {
  arrivalsFor,
  dayStrip,
  estimateWaitMinutes,
  groupSlots,
  lateMinutes,
  liveWaitingCount,
  orderTabletDoctors,
  queuePlace,
  splitMinutes,
  summarizeDoctorDay,
  tashkentNoonIso,
  type DoctorDaySummary,
  type TabletApptRow,
  type TabletDoctorLike,
} from "@/lib/reception-tablet/doctor-day";

const NOW = new Date("2026-10-03T11:00:00+05:00");

let seq = 0;
function row(over: Partial<TabletApptRow> & { doctorId?: string } = {}): TabletApptRow {
  seq += 1;
  const { doctorId = "d1", ...rest } = over;
  return {
    id: `a${seq}`,
    date: "2026-10-03T10:00:00+05:00",
    time: "10:00",
    durationMin: 20,
    status: "BOOKED",
    queueStatus: "BOOKED",
    channel: "PHONE",
    queuePriority: 0,
    queuedAt: null,
    ticketSeq: null,
    queueOrder: null,
    startedAt: null,
    patient: { id: `p${seq}`, fullName: `Пациент ${seq}` },
    doctor: { id: doctorId },
    ...rest,
  };
}

function walkin(at: string, over: Partial<TabletApptRow> & { doctorId?: string } = {}) {
  return row({
    channel: "WALKIN",
    status: "WAITING",
    queueStatus: "WAITING",
    date: at,
    queuedAt: at,
    ...over,
  });
}

describe("estimateWaitMinutes", () => {
  it("what is left of the visit on the table plus everyone waiting", () => {
    const current = { durationMin: 30, startedAt: "2026-10-03T10:50:00+05:00" };
    expect(
      estimateWaitMinutes({
        current,
        waiting: [{ durationMin: 20 }, { durationMin: 0 }],
        now: NOW,
      }),
    ).toBe(20 + 20 + 20);
  });

  it("an overrun visit counts as about to end, not negative", () => {
    const current = { durationMin: 20, startedAt: "2026-10-03T09:00:00+05:00" };
    expect(estimateWaitMinutes({ current, waiting: [], now: NOW })).toBe(0);
  });

  it("nobody inside and nobody waiting: no wait", () => {
    expect(estimateWaitMinutes({ current: null, waiting: [], now: NOW })).toBe(0);
  });

  it("splits into hours and minutes for «≈ 1 ч 10 мин»", () => {
    expect(splitMinutes(70)).toEqual({ hours: 1, minutes: 10 });
    expect(splitMinutes(-5)).toEqual({ hours: 0, minutes: 0 });
  });
});

describe("summarizeDoctorDay", () => {
  const today = { doctorId: "d1", workingMinutes: 480, status: "free" as const, nextFree: "11:20" };

  it("counts walk-ins and arrived bookings as waiting, names who is inside", () => {
    const rows = [
      row({ status: "IN_PROGRESS", queueStatus: "IN_PROGRESS", startedAt: "2026-10-03T10:55:00+05:00", durationMin: 20, patient: { id: "x", fullName: "Каримов А." } }),
      walkin("2026-10-03T10:30:00+05:00"),
      row({ status: "WAITING", queueStatus: "WAITING" }),
      row({ date: "2026-10-03T12:00:00+05:00", status: "CONFIRMED", queueStatus: "CONFIRMED" }),
      row({ status: "COMPLETED", queueStatus: "COMPLETED" }),
      walkin("2026-10-03T10:40:00+05:00", { doctorId: "d2" }),
    ];
    const s = summarizeDoctorDay({ doctorId: "d1", rows, today, now: NOW });
    expect(s).toMatchObject({
      waiting: 2,
      inside: { patientName: "Каримов А." },
      bookedAhead: 1,
      scheduled: true,
      onDuty: true,
      status: "busy",
      nextFree: "11:20",
    });
    expect(s.waitMin).toBe(15 + 20 + 20);
  });

  it("an unscheduled doctor with a patient waiting is on duty", () => {
    const s = summarizeDoctorDay({
      doctorId: "d1",
      rows: [walkin("2026-10-03T10:30:00+05:00")],
      today: { doctorId: "d1", workingMinutes: 0, status: "off", nextFree: null },
      now: NOW,
    });
    expect(s).toMatchObject({ scheduled: false, onDuty: true, status: "off" });
  });

  it("a doctor on leave with nothing today is off duty", () => {
    const s = summarizeDoctorDay({
      doctorId: "d1",
      rows: [],
      today: { doctorId: "d1", workingMinutes: 0, status: "off", nextFree: null },
      now: NOW,
    });
    expect(s).toMatchObject({ onDuty: false, waiting: 0, waitMin: 0, inside: null });
  });

  it("a doctor without any schedule still takes bookings (the slot finder's fallback)", () => {
    const s = summarizeDoctorDay({
      doctorId: "d1",
      rows: [],
      today: { doctorId: "d1", workingMinutes: 0, status: "off", nextFree: "09:00" },
      now: NOW,
    });
    expect(s.onDuty).toBe(true);
  });

  it("without the schedule summary nobody vanishes from the screen", () => {
    const s = summarizeDoctorDay({
      doctorId: "d1",
      rows: [],
      today: undefined,
      scheduleUnknown: true,
      now: NOW,
    });
    expect(s).toMatchObject({ onDuty: true, scheduled: false, status: "off" });
  });

  it("yesterday's leftovers do not count", () => {
    const s = summarizeDoctorDay({
      doctorId: "d1",
      rows: [walkin("2026-10-02T17:00:00+05:00")],
      today,
      now: NOW,
    });
    expect(s.waiting).toBe(0);
  });
});

describe("orderTabletDoctors", () => {
  const doc = (id: string, cabinet: string | null, nameRu: string): TabletDoctorLike => ({
    id,
    nameRu,
    nameUz: nameRu,
    ticketPrefix: null,
    cabinet: cabinet ? { number: cabinet } : null,
  });
  const summary = (onDuty: boolean, waiting = 0) =>
    ({ onDuty, waiting }) as unknown as DoctorDaySummary;

  it("keeps a fixed order by cabinet number, never by load", () => {
    const doctors = [doc("a", "12", "Б"), doc("b", "2", "А"), doc("c", null, "В"), doc("d", "101", "Г")];
    const busy = new Map([
      ["a", summary(true, 9)],
      ["b", summary(true, 0)],
      ["c", summary(true, 1)],
      ["d", summary(true, 3)],
    ]);
    expect(orderTabletDoctors(doctors, busy, { showAll: false }).map((d) => d.id)).toEqual([
      "b",
      "a",
      "d",
      "c",
    ]);
  });

  it("off-duty doctors only when asked, and after the working ones", () => {
    const doctors = [doc("a", "1", "А"), doc("b", "2", "Б")];
    const s = new Map([
      ["a", summary(false)],
      ["b", summary(true)],
    ]);
    expect(orderTabletDoctors(doctors, s, { showAll: false }).map((d) => d.id)).toEqual(["b"]);
    expect(orderTabletDoctors(doctors, s, { showAll: true }).map((d) => d.id)).toEqual(["b", "a"]);
  });
});

describe("arrivalsFor («Пришли по записи»)", () => {
  it("today's bookings the desk can check in, by slot time", () => {
    const late = row({ date: "2026-10-03T10:30:00+05:00", status: "CONFIRMED", queueStatus: "CONFIRMED" });
    const later = row({ date: "2026-10-03T15:00:00+05:00" });
    const rows = [
      later,
      late,
      row({ status: "WAITING", queueStatus: "WAITING" }),
      walkin("2026-10-03T10:00:00+05:00"),
      row({ date: "2026-10-04T10:00:00+05:00" }),
      row({ status: "CANCELLED", queueStatus: "CANCELLED" }),
    ];
    expect(arrivalsFor(rows, "RECEPTIONIST", NOW).map((r) => r.id)).toEqual([late.id, later.id]);
  });

  it("a no-show the sweep set stays for a patient who came late; one a person set does not", () => {
    const swept = row({ status: "NO_SHOW", queueStatus: "NO_SHOW", autoNoShow: true });
    const marked = row({ status: "NO_SHOW", queueStatus: "NO_SHOW" });
    expect(arrivalsFor([swept, marked], "RECEPTIONIST", NOW).map((r) => r.id)).toEqual([swept.id]);
  });

  it("nothing for a role that does not check patients in", () => {
    expect(arrivalsFor([row()], "NURSE", NOW)).toEqual([]);
    expect(arrivalsFor([row()], "ADMIN", NOW)).toHaveLength(1);
  });

  it("lateness in minutes once the slot has started", () => {
    expect(lateMinutes({ date: "2026-10-03T10:45:00+05:00" }, NOW)).toBe(15);
    expect(lateMinutes({ date: "2026-10-03T11:30:00+05:00" }, NOW)).toBe(0);
  });
});

describe("queuePlace", () => {
  it("the walk-in's place in his doctor's live queue, urgency first", () => {
    const first = walkin("2026-10-03T10:00:00+05:00");
    const second = walkin("2026-10-03T10:10:00+05:00");
    const mine = walkin("2026-10-03T10:20:00+05:00");
    const urgent = walkin("2026-10-03T10:30:00+05:00", { queuePriority: 1 });
    const otherDoctor = walkin("2026-10-03T09:00:00+05:00", { doctorId: "d2" });
    const rows = [mine, second, first, urgent, otherDoctor];
    expect(queuePlace(rows, mine.id, "d1")).toBe(4);
    expect(queuePlace(rows, urgent.id, "d1")).toBe(1);
    expect(liveWaitingCount(rows, "d1")).toBe(4);
  });

  it("null once the walk-in is no longer waiting", () => {
    const gone = walkin("2026-10-03T10:00:00+05:00", { status: "IN_PROGRESS", queueStatus: "IN_PROGRESS" });
    expect(queuePlace([gone], gone.id, "d1")).toBeNull();
  });
});

describe("booking helpers", () => {
  it("the day strip: today and the next fourteen days", () => {
    const days = dayStrip("2026-10-03");
    expect(days).toHaveLength(15);
    expect(days[0]).toBe("2026-10-03");
    expect(days[1]).toBe("2026-10-04");
    expect(days[14]).toBe("2026-10-17");
    expect(dayStrip("2026-12-30", 4)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02"]);
  });

  it("slots grouped into morning, afternoon and evening", () => {
    expect(groupSlots(["09:00", "11:40", "12:00", "16:40", "17:00", "18:20"])).toEqual({
      morning: ["09:00", "11:40"],
      afternoon: ["12:00", "16:40"],
      evening: ["17:00", "18:20"],
    });
  });

  it("a Tashkent day goes to the slots and booking APIs as its noon", () => {
    expect(tashkentNoonIso("2026-10-03")).toBe("2026-10-03T07:00:00.000Z");
  });
});
