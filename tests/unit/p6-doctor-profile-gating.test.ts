/**
 * Doctor profile and list surfaces for roles without the right (audit
 * DR-15), and the dead «Настроить вид» button (audit DR-17).
 *
 *   - the cases card shows a refused or failed load as an error with «—»,
 *     not as «0 случаев»;
 *   - the schedule editor and the time-off list are read-only when the role
 *     cannot save them (the API answers 403);
 *   - the KPI tabs render «Настроить вид» only when a handler is wired.
 *
 * Static renders with stubbed hooks and translations (key echo).
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  caseStats: {
    isLoading: false,
    isError: false,
    data: undefined as undefined | Record<string, number>,
  },
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns}.${key}${values ? JSON.stringify(values) : ""}`,
  useLocale: () => "ru",
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
vi.mock("@/components/ui/alert-dialog", () => {
  const none = () => null;
  return {
    AlertDialog: none,
    AlertDialogAction: none,
    AlertDialogCancel: none,
    AlertDialogContent: none,
    AlertDialogDescription: none,
    AlertDialogFooter: none,
    AlertDialogHeader: none,
    AlertDialogTitle: none,
  };
});
vi.mock("@/app/[locale]/crm/doctors/[id]/_hooks/use-doctor-case-stats", () => ({
  useDoctorCaseStats: () => h.caseStats,
}));
vi.mock("@/app/[locale]/crm/doctors/[id]/_hooks/use-doctor-schedule", async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    ...mod,
    useReplaceDoctorSchedule: mutation,
    useCreateTimeOff: mutation,
    useDeleteTimeOff: mutation,
  };
});

import { DoctorCases } from "@/app/[locale]/crm/doctors/[id]/_components/doctor-cases";
import { ScheduleEditor } from "@/app/[locale]/crm/doctors/[id]/_components/schedule-editor";
import { DoctorTimeOff } from "@/app/[locale]/crm/doctors/[id]/_components/doctor-time-off";
import { DoctorsKpiTabs } from "@/app/[locale]/crm/doctors/_components/doctors-kpi-tabs";
import type { DoctorDetail } from "@/app/[locale]/crm/doctors/[id]/_hooks/use-doctor";

const doctor = {
  id: "d1",
  schedules: [
    {
      id: "s1",
      doctorId: "d1",
      weekday: 1,
      startTime: "09:00",
      endTime: "13:00",
      validFrom: null,
      validTo: null,
      isActive: true,
    },
  ],
  timeOffs: [
    {
      id: "t1",
      doctorId: "d1",
      startAt: "2026-10-10T04:00:00.000Z",
      endAt: "2026-10-12T13:00:00.000Z",
      reason: null,
    },
  ],
} as unknown as DoctorDetail;

beforeEach(() => {
  h.caseStats = { isLoading: false, isError: false, data: undefined };
});

describe("DR-15: the cases card never shows a refused load as zeros", () => {
  it("an error reads as an error with dashes", () => {
    h.caseStats = { isLoading: false, isError: true, data: undefined };
    const html = renderToStaticMarkup(React.createElement(DoctorCases, { doctorId: "d1" }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("crmDoctors.cases.loadError");
    expect(html).not.toContain("{&quot;value&quot;:0}");
    expect(html.match(/—/g)?.length).toBe(4);
  });

  it("loaded data still shows", () => {
    h.caseStats = {
      isLoading: false,
      isError: false,
      data: { openCases: 3, resolvedLast30d: 2, repeatRatePct: 40, avgDurationDays: 12 },
    };
    const html = renderToStaticMarkup(React.createElement(DoctorCases, { doctorId: "d1" }));
    expect(html).not.toContain("loadError");
    expect(html).toContain("crmDoctors.cases.pct{&quot;value&quot;:40}");
  });
});

describe("DR-15: schedule and time off are read-only without the right", () => {
  it("the schedule editor offers no save, add or remove", () => {
    const html = renderToStaticMarkup(
      React.createElement(ScheduleEditor, { doctor, canEdit: false }),
    );
    expect(html).toContain('value="09:00"');
    expect(html).toMatch(/readonly=""/i);
    expect(html).not.toContain("crmDoctors.schedule.save");
    expect(html).not.toContain("crmDoctors.schedule.addSlot");
    expect(html).not.toContain("crmDoctors.schedule.removeSlot");
  });

  it("…and the admin keeps them", () => {
    const html = renderToStaticMarkup(
      React.createElement(ScheduleEditor, { doctor, canEdit: true }),
    );
    expect(html).toContain("crmDoctors.schedule.save");
    expect(html).toContain("crmDoctors.schedule.addSlot");
    expect(html).toContain("crmDoctors.schedule.removeSlot");
  });

  it("the time-off list offers no add or delete", () => {
    const off = renderToStaticMarkup(React.createElement(DoctorTimeOff, { doctor, canEdit: false }));
    expect(off).not.toContain("crmDoctors.timeOff.add");
    expect(off).not.toContain("crmDoctors.timeOff.delete");
    const on = renderToStaticMarkup(React.createElement(DoctorTimeOff, { doctor, canEdit: true }));
    expect(on).toContain("crmDoctors.timeOff.add");
    expect(on).toContain("crmDoctors.timeOff.delete");
  });
});

describe("DR-17: «Настроить вид» only with something behind it", () => {
  const counts = { all: 3, idle: 1, optimal: 1, overloaded: 1, "has-slots": 2 };

  it("no handler, no button", () => {
    const html = renderToStaticMarkup(
      React.createElement(DoctorsKpiTabs, { counts, active: "all", onChange: () => {} }),
    );
    expect(html).not.toContain("configureView");
  });

  it("a wired handler shows it", () => {
    const html = renderToStaticMarkup(
      React.createElement(DoctorsKpiTabs, {
        counts,
        active: "all",
        onChange: () => {},
        onConfigureView: () => {},
      }),
    );
    expect(html).toContain("crmDoctors.tabs.configureView");
  });
});
