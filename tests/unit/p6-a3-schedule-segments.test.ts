/**
 * P6 A3, the doctor's day plan and patient list.
 *
 * DC-25 — «Консультация / Повторный» came from the live `Patient.visitsCount`,
 * which closing the visit itself bumps: a second-time patient read
 * «Консультация» until the doctor finished, then «Повторный», and the day
 * summary rewrote itself. The type now counts COMPLETED visits before the
 * day on screen. A SKIPPED patient still sits in the closed «done» bucket,
 * but the row says «Пропущен», not «Уже был».
 *
 * DC-26 — the row badge «Давно не был» used a 90-day cut while the «Давно не
 * были» tab starts after 180, so a patient under «Вернулись» wore it. The
 * donut labels came from the server in Russian only, and the card printed
 * the raw `Patient.segment` enum.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  scheduleStatusOf,
  scheduleVisitTypeOf,
} from "@/lib/doctor-schedule-status";
import {
  DAY_MS,
  DOCTOR_SEGMENT_KEYS,
  RETURNED_MAX_DAYS,
  classifyDoctorSegment,
  daysSinceLastVisit,
  isDoctorDormant,
} from "@/lib/doctor-patient-segments";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  findMany: vi.fn(async (_a: Row): Promise<Row[]> => []),
  groupBy: vi.fn(async (_a: Row): Promise<Row[]> => []),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc_1", role: "DOCTOR", clinicId: "c1", email: "d@t" },
  })),
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_doc_1",
    role: "DOCTOR" as const,
  }),
}));
vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: { findFirst: vi.fn(async () => ({ id: "doc_1" })) },
    appointment: { findMany: db.findMany, groupBy: db.groupBy },
  },
}));

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

function appt(id: string, patientId: string, status: string, time: string): Row {
  return {
    id,
    date: new Date(`2026-10-02T${time}:00+05:00`),
    time,
    durationMin: 30,
    status,
    calledAt: null,
    patientId,
    patient: { fullName: `Пациент ${patientId}` },
  };
}

async function schedule(): Promise<{
  entries: Array<{ id: string; type: string; status: string; appointmentStatus: string }>;
  summary: { consultations: number; repeats: number; completedCount: number };
}> {
  const { GET } = await import("@/app/api/crm/doctors/me/schedule/route");
  const res = await GET(
    new Request("https://x/api/crm/doctors/me/schedule?date=2026-10-02"),
  );
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(() => {
  vi.resetModules();
  db.findMany.mockReset().mockResolvedValue([]);
  db.groupBy.mockReset().mockResolvedValue([]);
});

describe("DC-25 — the visit type is fixed by the history before the day", () => {
  it("one earlier visit is «Повторный», none is «Консультация»", () => {
    expect(scheduleVisitTypeOf(0)).toBe("consultation");
    expect(scheduleVisitTypeOf(1)).toBe("repeat");
    expect(scheduleVisitTypeOf(7)).toBe("repeat");
  });

  it("counts only COMPLETED visits finished before the day, and types rows from it", async () => {
    db.findMany.mockResolvedValue([
      // Second visit, already closed today: still «Повторный», and the
      // closing does not change it (today's own visit is not counted).
      appt("a1", "p_second", "COMPLETED", "09:00"),
      // First ever visit, closed today: stays «Консультация».
      appt("a2", "p_first", "COMPLETED", "10:00"),
      appt("a3", "p_new", "BOOKED", "11:00"),
    ]);
    db.groupBy.mockResolvedValue([
      { patientId: "p_second", _count: { _all: 1 } },
    ]);

    const body = await schedule();

    const byId = Object.fromEntries(body.entries.map((e) => [e.id, e.type]));
    expect(byId).toEqual({ a1: "repeat", a2: "consultation", a3: "consultation" });
    expect(body.summary).toMatchObject({
      consultations: 2,
      repeats: 1,
      completedCount: 2,
    });

    const where = (db.groupBy.mock.calls[0]![0] as { where: Row }).where;
    expect(where.status).toBe("COMPLETED");
    expect(where.patientId).toEqual({
      in: expect.arrayContaining(["p_second", "p_first", "p_new"]),
    });
    // Strictly before 00:00 Tashkent of the requested day; legacy rows
    // without `completedAt` by their slot.
    const dayStart = new Date("2026-10-02T00:00:00+05:00");
    expect(where.OR).toEqual([
      { completedAt: { lt: dayStart } },
      { completedAt: null, date: { lt: dayStart } },
    ]);
  });

  it("a SKIPPED row stays in the closed bucket but carries its raw status", async () => {
    db.findMany.mockResolvedValue([appt("a1", "p1", "SKIPPED", "09:00")]);
    const body = await schedule();
    expect(body.entries[0]).toMatchObject({
      status: "done",
      appointmentStatus: "SKIPPED",
    });
    expect(scheduleStatusOf("SKIPPED")).toBe("done");
  });

  it("the row and the agenda say «Пропущен» for SKIPPED, in both languages", () => {
    expect(ru.doctor.myDay.status.skipped).toBe("Пропущен");
    expect(uz.doctor.myDay.status.skipped).toBeTruthy();
    expect(ru.doctor.schedule.agenda.status.skipped).toBe("Пропущен");
    expect(uz.doctor.schedule.agenda.status.skipped).toBeTruthy();

    const card = read("src/app/[locale]/doctor/my-day/_components/schedule-card.tsx");
    expect(card).toMatch(/appointmentStatus === "SKIPPED"\s*\?\s*t\("status\.skipped"\)/);
    const agenda = read("src/app/[locale]/doctor/schedule/_components/agenda-shell.tsx");
    expect(agenda).toContain('labelKey: "skipped"');
  });
});

describe("DC-26 — one rule for the row badge and the tabs", () => {
  it("«Давно не был» starts exactly where the «Давно не были» tab does", () => {
    expect(isDoctorDormant(RETURNED_MAX_DAYS)).toBe(false);
    expect(isDoctorDormant(RETURNED_MAX_DAYS + 1)).toBe(true);
    // A patient the «Вернулись» tab lists does not read «Давно не был».
    for (const days of [91, 120, 180]) {
      expect(classifyDoctorSegment(3, days)).toBe("returned");
      expect(isDoctorDormant(days)).toBe(false);
    }
    expect(classifyDoctorSegment(3, 181)).toBe("dormant");
  });

  it("days are floored the way the segment endpoints count", () => {
    const now = Date.parse("2026-10-02T12:00:00Z");
    expect(daysSinceLastVisit(new Date(now - 100 * DAY_MS - 1000), now)).toBe(100);
    expect(daysSinceLastVisit(new Date(now - 5 * DAY_MS + 1000).toISOString(), now)).toBe(4);
  });

  it("the table badge asks the shared rule, not a 90-day constant", () => {
    const table = read("src/app/[locale]/doctor/patients/_components/patients-table.tsx");
    expect(table).toContain("isDoctorDormant(daysSinceLastVisit(");
    expect(table).not.toMatch(/90 \* 24 \* 60 \* 60/);
  });

  it("donut buckets are named by the tab keys, present in both languages", () => {
    for (const key of DOCTOR_SEGMENT_KEYS) {
      expect(ru.doctor.patients.tabs[key]).toBeTruthy();
      expect(uz.doctor.patients.tabs[key]).toBeTruthy();
    }
    const donut = read("src/app/[locale]/doctor/patients/_components/segmentation-card.tsx");
    expect(donut).toContain("t(`tabs.${s.key}`)");
    expect(donut).not.toContain("{s.label}");
  });

  it("the card translates every Patient.segment value", () => {
    for (const seg of ["NEW", "ACTIVE", "DORMANT", "VIP", "CHURN"] as const) {
      expect(ru.doctor.patients.selectedCard.segments[seg]).toBeTruthy();
      expect(uz.doctor.patients.selectedCard.segments[seg]).toBeTruthy();
    }
    const card = read("src/app/[locale]/doctor/patients/_components/selected-patient-card.tsx");
    expect(card).toContain("value={segmentLabel(p.segment)}");
  });
});
