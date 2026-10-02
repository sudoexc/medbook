/**
 * P6 group A2: low-severity doctor-cabinet findings (audit 2026-09-25).
 *
 * VW-28 — the reception screen read one page of 50 rows for the day and
 *         looked for the IN_PROGRESS visit only there.
 * DC-13 — «Написать» selected a thread the inbox could not show when it was
 *         not on the first page of the list.
 * DC-14 — «Отменить приём» ended a running visit with no question asked.
 * DC-15 — the doctor analytics took any date range and built a bucket per day.
 * DC-16 — two analytics tiles counted things nothing records (always 0).
 * DC-17 — dead buttons and a card number that matched nothing in the CRM.
 * DC-18 — Russian-only topbar date, a hard `?lang=ru` print, frozen «today».
 * DC-20 — five allergies at most, behind a «Показать ещё» that did nothing.
 * DC-23 — the topbar search listed the whole clinic, results opened 404.
 * DC-24 — sidebar stats refetched on every appointment event in the clinic.
 */
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchDoctorQueue } from "@/app/[locale]/doctor/reception/_hooks/use-doctor-queue";
import {
  pickSelectedConversation,
  type ConversationRow,
} from "@/app/[locale]/doctor/messages/_hooks/use-conversations";
import {
  DOCTOR_ANALYTICS_MAX_DAYS,
  resolveDoctorAnalyticsRange,
} from "@/lib/doctor-analytics-range";
import { formatDate } from "@/lib/format";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  appointmentFindMany: vi.fn(async (_args: Row): Promise<Row[]> => []),
  visitNoteFindMany: vi.fn(async (_args: Row): Promise<Row[]> => []),
  cdsOverrideCount: vi.fn(async (_args: Row): Promise<number> => 0),
  cdsOverrideFindMany: vi.fn(async (_args: Row): Promise<Row[]> => []),
  labResultCount: vi.fn(async (_args: Row): Promise<number> => 0),
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
vi.mock("@/server/conversations/doctor-unread", () => ({
  doctorUnreadTotal: vi.fn(async () => 0),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findFirst: vi.fn(async () => ({ id: "doc_1", userId: "u_doc_1" })),
    },
    appointment: { findMany: db.appointmentFindMany },
    visitNote: { findMany: db.visitNoteFindMany },
    cdsOverride: { count: db.cdsOverrideCount, findMany: db.cdsOverrideFindMany },
    labResult: { count: db.labResultCount },
    doctorSchedule: { findMany: vi.fn(async () => []) },
  },
}));

function get(url: string): Request {
  return new Request(`https://x${url}`, { method: "GET" });
}

function source(path: string): string {
  return readFileSync(path, "utf8");
}

beforeEach(() => {
  vi.resetModules();
  db.appointmentFindMany.mockReset().mockResolvedValue([]);
  db.visitNoteFindMany.mockReset().mockResolvedValue([]);
  db.cdsOverrideCount.mockReset().mockResolvedValue(0);
  db.cdsOverrideFindMany.mockReset().mockResolvedValue([]);
  db.labResultCount.mockReset().mockResolvedValue(0);
});

describe("VW-28: the reception queue reads the whole day", () => {
  it("pages through the day, so an IN_PROGRESS visit on page two is found", async () => {
    const urls: URL[] = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://x");
      urls.push(url);
      const page = url.searchParams.get("cursor")
        ? { rows: [{ id: "a3", status: "IN_PROGRESS" }], nextCursor: null }
        : {
            rows: [
              { id: "a1", status: "COMPLETED" },
              { id: "a2", status: "CANCELLED" },
            ],
            nextCursor: "a2",
          };
      return new Response(JSON.stringify(page), { status: 200 });
    }) as unknown as typeof fetch;

    const rows = await fetchDoctorQueue({ fetchImpl, today: "2026-10-02" });

    expect(rows.map((r) => r.id)).toEqual(["a1", "a2", "a3"]);
    expect(rows.find((r) => r.status === "IN_PROGRESS")?.id).toBe("a3");
    expect(urls).toHaveLength(2);
    expect(urls[1].searchParams.get("cursor")).toBe("a2");
    // The clinic's day, at the list endpoint's largest page.
    expect(urls[0].searchParams.get("from")).toBe("2026-10-01T19:00:00.000Z");
    expect(urls[0].searchParams.get("to")).toBe("2026-10-02T18:59:59.999Z");
    expect(urls[0].searchParams.get("limit")).toBe("200");
    expect(urls[0].searchParams.get("doctorId")).toBeNull();
  });
});

describe("DC-13: the selected thread shows even off the first page", () => {
  const row = (id: string) => ({ id }) as ConversationRow;

  it("prefers the list row, falls back to the thread fetched by id", () => {
    const listed = row("c1");
    expect(
      pickSelectedConversation({ selectedId: "c1", rows: [listed], fetched: row("c1") }),
    ).toBe(listed);
    const fetched = row("c_old");
    expect(
      pickSelectedConversation({ selectedId: "c_old", rows: [listed], fetched }),
    ).toBe(fetched);
  });

  it("never shows another thread, nothing without a selection", () => {
    expect(
      pickSelectedConversation({ selectedId: "c2", rows: [row("c1")], fetched: row("c3") }),
    ).toBeNull();
    expect(
      pickSelectedConversation({ selectedId: null, rows: [row("c1")], fetched: row("c1") }),
    ).toBeNull();
    expect(
      pickSelectedConversation({ selectedId: "c2", rows: [], fetched: null }),
    ).toBeNull();
  });

  it("both inbox panes resolve the selection through the fallback", () => {
    for (const path of [
      "src/app/[locale]/doctor/messages/_components/chat-panel.tsx",
      "src/app/[locale]/doctor/messages/_components/patient-context-panel.tsx",
    ]) {
      expect(source(path)).toContain("useSelectedDoctorConversation(filters, selectedId)");
    }
  });
});

describe("DC-14: cancelling the current visit asks first", () => {
  it("the menu item goes through a confirmation", () => {
    const src = source("src/app/[locale]/doctor/my-day/_components/current-patient-card.tsx");
    expect(src).toContain('window.confirm(t("current.cancelConfirm"');
    expect(src).not.toContain('onSelect={() => fire("CANCELLED")}');
  });
});

describe("DC-15: the doctor analytics window is capped", () => {
  const NOW = new Date("2026-10-02T07:00:00Z");

  it("defaults to 30 Tashkent days ending today", () => {
    const r = resolveDoctorAnalyticsRange({}, NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dayCount).toBe(30);
    expect(r.toEnd.toISOString()).toBe("2026-10-02T19:00:00.000Z");
  });

  it("accepts a year and a day, refuses one more", () => {
    const ok = resolveDoctorAnalyticsRange({ from: "2025-10-02", to: "2026-10-02" }, NOW);
    expect(ok.ok && ok.dayCount).toBe(DOCTOR_ANALYTICS_MAX_DAYS);
    expect(resolveDoctorAnalyticsRange({ from: "2025-10-01", to: "2026-10-02" }, NOW)).toEqual({
      ok: false,
      reason: "range_too_long",
    });
    expect(resolveDoctorAnalyticsRange({ from: "1900-01-01", to: "9999-12-31" }, NOW)).toEqual({
      ok: false,
      reason: "range_too_long",
    });
    // The audit's own example is refused too (year 1 does not round-trip).
    expect(resolveDoctorAnalyticsRange({ from: "0001-01-01", to: "9999-12-31" }, NOW).ok).toBe(
      false,
    );
  });

  it("refuses impossible dates and a reversed range", () => {
    expect(resolveDoctorAnalyticsRange({ from: "2026-02-30" }, NOW)).toEqual({
      ok: false,
      reason: "invalid_date",
    });
    expect(resolveDoctorAnalyticsRange({ from: "2026-10-02", to: "2026-10-01" }, NOW)).toEqual({
      ok: false,
      reason: "to_before_from",
    });
  });

  it("the route answers 400 before touching the database", async () => {
    const { GET } = await import("@/app/api/crm/doctors/me/analytics/route");
    const res = await GET(get("/api/crm/doctors/me/analytics?from=1900-01-01&to=9999-12-31"));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ reason: "range_too_long" });
    expect(db.appointmentFindMany).not.toHaveBeenCalled();
    expect(db.visitNoteFindMany).not.toHaveBeenCalled();
  });
});

describe("DC-16: no tiles for what nothing records", () => {
  it("reads note dates only, no lab results, no dead KPIs", async () => {
    db.visitNoteFindMany.mockResolvedValue([
      { finalizedAt: new Date("2026-09-30T06:00:00Z") },
    ]);
    const { GET } = await import("@/app/api/crm/doctors/me/analytics/route");
    const res = await GET(
      get("/api/crm/doctors/me/analytics?from=2026-09-28&to=2026-10-02"),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kpis: Record<string, number>;
      daily: { date: string; notes: number }[];
    };
    expect(Object.keys(body.kpis).sort()).toEqual([
      "cdsOverrides",
      "completedAppointments",
      "finalizedNotes",
    ]);
    expect(body.kpis.finalizedNotes).toBe(1);
    expect(body.daily).toHaveLength(5);
    expect(body.daily.find((d) => d.date === "2026-09-30")?.notes).toBe(1);
    const noteArgs = db.visitNoteFindMany.mock.calls[0]?.[0] as { select: Row };
    expect(noteArgs.select).toEqual({ finalizedAt: true });
    expect(db.labResultCount).not.toHaveBeenCalled();
  });
});

describe("DC-17: no dead controls, the real card number", () => {
  it("the visit history header shows the clinic's P-number", () => {
    const src = source("src/app/[locale]/doctor/visits/[patientId]/page.tsx");
    expect(src).toContain("formatPatientNumber(data.patient.patientNumber)");
    expect(src).not.toContain("id.slice(-6)");
  });

  it("«Настроить вид», «Свернуть» and «Тип приёма» are gone", () => {
    expect(
      source("src/app/[locale]/doctor/patients/_components/patients-header.tsx"),
    ).not.toContain("configureView");
    expect(
      source("src/app/[locale]/doctor/patients/_components/ai-assistant-panel.tsx"),
    ).not.toContain("aiAssistant.collapse");
    expect(
      source("src/app/[locale]/doctor/visits/[patientId]/_components/patient-header-live.tsx"),
    ).not.toContain("header.appointmentType");
  });
});

describe("DC-18: the cabinet's dates follow the language and the clinic", () => {
  const ORIGINAL_TZ = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "UTC";
  });
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
  });

  it("the topbar date is the clinic's day in the UI language", () => {
    // 01:30 on Thursday 24.09 in Tashkent, still Wednesday in UTC.
    const at = new Date("2026-09-23T20:30:00Z");
    expect(formatDate(at, "ru", "dayMonthWeekday")).toBe("24 сентября, чт");
    expect(formatDate(at, "uz", "dayMonthWeekday")).not.toMatch(/[а-яё]/i);
    expect(formatDate(at, "ru", "time")).toBe("01:30");
  });

  it("printing from the visit page follows the patient's language", () => {
    const src = source(
      "src/app/[locale]/doctor/visits/[patientId]/[visitId]/_components/print-visit-button.tsx",
    );
    expect(src).not.toContain("lang=ru");
  });

  it("the agenda's today moves at midnight", () => {
    const src = source("src/app/[locale]/doctor/schedule/_components/agenda-shell.tsx");
    expect(src).toContain("useTashkentToday()");
    expect(src).not.toContain("useMemo(() => startOfDay(new Date()), [])");
  });
});

describe("DC-20: every allergy reaches the visit history screen", () => {
  it("no five-row cap and no dead «Показать ещё»", () => {
    const page = source("src/app/[locale]/doctor/visits/[patientId]/page.tsx");
    expect(page).not.toMatch(/take:\s*5/);
    expect(
      source("src/app/[locale]/doctor/visits/[patientId]/_components/patient-meta-row-live.tsx"),
    ).not.toContain("meta.showMore");
  });
});

describe("DC-23: the topbar search stays in the doctor's caseload", () => {
  it("asks /doctors/me/patients, whose cards the doctor can open", () => {
    const src = source("src/app/[locale]/doctor/_components/doctor-search.tsx");
    expect(src).toContain("/api/crm/doctors/me/patients?q=");
    expect(src).not.toContain("/api/crm/patients?q=");
  });
});

describe("DC-24: sidebar stats ignore other doctors' events", () => {
  it("the stats carry the doctor id the client filters on", async () => {
    const { GET } = await import("@/app/api/crm/doctors/me/sidebar-stats/route");
    const res = await GET(get("/api/crm/doctors/me/sidebar-stats"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ doctorId: "doc_1" });
  });

  it("the hook filters live events by that id", async () => {
    const { eventTargetsDoctor } = await import(
      "@/app/[locale]/doctor/my-day/_hooks/use-doctor-today"
    );
    const ev = (payload: Row) =>
      ({ type: "appointment.statusChanged", payload }) as unknown as Parameters<
        typeof eventTargetsDoctor
      >[0];
    expect(eventTargetsDoctor(ev({ doctorId: "doc_2" }), "doc_1")).toBe(false);
    expect(eventTargetsDoctor(ev({ doctorId: "doc_1" }), "doc_1")).toBe(true);
    const src = source("src/app/[locale]/doctor/_hooks/use-doctor-sidebar-stats.ts");
    expect(src).toContain("shouldInvalidate");
    expect(src).toContain("eventTargetsDoctor(");
  });
});
