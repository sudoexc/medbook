/**
 * The pure rules behind the A4 audit items (AP-16, AP-18, AP-20, AP-21,
 * AP-23), and the «Записи» tiles rendered from the server's tally.
 */
import * as React from "react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns}.${key}${values ? JSON.stringify(values) : ""}`,
  useLocale: () => "ru",
}));
vi.mock("@/components/atoms/count-up", () => ({
  CountUp: ({ to }: { to: number }) => String(to),
}));

import { arrivalResetOnMove } from "@/lib/appointments/self-check-in";
import { atNoShowRisk, isOverdue } from "@/lib/appointments/overdue";
import {
  SOON_WINDOW_MIN,
  tilesFromTally,
  timedTileWheres,
} from "@/lib/appointments/list-tiles";
import {
  conflictMessageValues,
  conflictReasonText,
  type ConflictTranslator,
} from "@/lib/appointments/conflict-message";
import { appointmentServiceWhere } from "@/server/appointments/list-where";
import { appointmentExportWhere } from "@/server/exports/tables";
import { appointmentExportFilters } from "@/app/[locale]/crm/appointments/_hooks/use-appointments-filters";
import { AppointmentsTiles } from "@/app/[locale]/crm/appointments/_components/appointments-tiles";

const MIN = 60_000;

describe("AP-16: an arrival belongs to its day", () => {
  // 2026-10-02 10:00 Tashkent.
  const at = new Date("2026-10-02T05:00:00.000Z");

  it("a WAITING visit moved to another clinic day goes back to CONFIRMED", () => {
    expect(arrivalResetOnMove("WAITING", at, new Date(at.getTime() + 24 * 60 * MIN))).toEqual({
      status: "CONFIRMED",
      queueStatus: "CONFIRMED",
      queuedAt: null,
    });
  });

  it("a move within the day keeps the arrival", () => {
    expect(arrivalResetOnMove("WAITING", at, new Date(at.getTime() + 3 * 60 * MIN))).toEqual({});
  });

  it("23:30 to 00:30 is another day in Tashkent, though the same UTC date", () => {
    const lateEvening = new Date("2026-10-02T18:30:00.000Z"); // 23:30 Tashkent
    expect(arrivalResetOnMove("WAITING", lateEvening, new Date(lateEvening.getTime() + 60 * MIN)))
      .toHaveProperty("queuedAt", null);
  });

  it("a booking that has not arrived is left alone", () => {
    for (const s of ["BOOKED", "CONFIRMED", "SKIPPED", null]) {
      expect(arrivalResetOnMove(s, at, new Date(at.getTime() + 24 * 60 * MIN))).toEqual({});
    }
  });
});

describe("AP-18: a refused write in words", () => {
  const messages: Record<string, string> = {
    doctor_busy: "Врач занят{hasUntil}",
    another_visit_in_progress: "У врача уже идёт приём.",
  };
  const t = Object.assign(
    (key: string, values?: Record<string, string>) =>
      messages[key]!.replace("{hasUntil}", values?.hasUntil === "yes" ? ` до ${values.until}` : ""),
    { has: (key: string) => key in messages },
  ) as unknown as ConflictTranslator;

  it("a reason with a message is said in it, with its time", () => {
    expect(conflictReasonText(t, "doctor_busy", "14:30", "Ошибка")).toBe("Врач занят до 14:30");
    expect(conflictReasonText(t, "another_visit_in_progress", undefined, "Ошибка")).toBe(
      "У врача уже идёт приём.",
    );
  });

  it("an unknown or missing reason falls back to the generic line, never the code", () => {
    expect(conflictReasonText(t, "brand_new_reason", null, "Ошибка")).toBe("Ошибка");
    expect(conflictReasonText(t, null, null, "Ошибка")).toBe("Ошибка");
  });

  it("every reason the CRM's appointment writes can name has a message in ru and uz", () => {
    const reasons = [
      "doctor_busy",
      "cabinet_busy",
      "doctor_time_off",
      "outside_schedule",
      "in_past",
      "invalid_transition",
      "not_today",
      "no_show_final",
      "too_early_for_no_show",
      "walkin_locked",
      "another_visit_in_progress",
      "visit_note_unsigned",
      "role_cannot_advance_to",
      "role_cannot_edit_price",
      "doctor_not_found",
      "completed",
      "cancelled",
      "not_cancellable",
    ];
    for (const locale of ["ru", "uz"]) {
      const json = JSON.parse(
        readFileSync(path.join(process.cwd(), `src/messages/${locale}.json`), "utf8"),
      ) as { appointments: { drawer: { conflict: Record<string, string> } } };
      const conflict = json.appointments.drawer.conflict;
      for (const r of reasons) expect(conflict[r], `${locale}.${r}`).toBeTruthy();
    }
    expect(conflictMessageValues("14:30")).toEqual({ until: "14:30", hasUntil: "yes" });
  });

  it("no appointment write hook toasts the raw error any more", () => {
    const src = readFileSync(
      path.join(process.cwd(), "src/app/[locale]/crm/appointments/_hooks/use-appointment.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/toast\.error\(err\.message/);
  });
});

describe("AP-20: who is at no-show risk", () => {
  const now = new Date("2026-10-02T06:00:00.000Z");
  const row = (status: string, minutesAgo: number) => ({
    status: status as never,
    date: new Date(now.getTime() - minutesAgo * MIN),
  });

  it("a no-show is", () => {
    expect(atNoShowRisk(row("NO_SHOW", -60), now)).toBe(true);
  });

  it("a booked or confirmed patient not at the desk 15 minutes past the start is", () => {
    expect(atNoShowRisk(row("BOOKED", 20), now)).toBe(true);
    expect(atNoShowRisk(row("CONFIRMED", 20), now)).toBe(true);
    expect(atNoShowRisk(row("CONFIRMED", 10), now)).toBe(false);
  });

  it("a patient in the hall, at the doctor's or seen is not", () => {
    for (const s of ["WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED"]) {
      expect(atNoShowRisk(row(s, 60), now), s).toBe(false);
    }
  });
});

describe("AP-21: the «Записи» tiles", () => {
  it("are read from the server's tally, the hall counted as arrived and urgent", () => {
    expect(
      tilesFromTally({
        all: 80,
        BOOKED: 25,
        CONFIRMED: 10,
        WAITING: 4,
        IN_PROGRESS: 2,
        COMPLETED: 30,
        soon: 3,
        overdue: 5,
      }),
    ).toEqual({
      all: 80,
      needsAttention: 9,
      soon: 3,
      unconfirmed: 25,
      overdue: 5,
      arrived: 36,
    });
    expect(tilesFromTally(undefined).all).toBe(0);
  });

  it("the server's «просрочены» is the same rule as isOverdue", () => {
    const now = new Date("2026-10-02T06:00:00.000Z");
    const w = timedTileWheres(now).overdue as { endDate: { lt: Date } };
    const edge = w.endDate.lt;
    expect(isOverdue({ status: "BOOKED", date: edge, endDate: new Date(edge.getTime() - 1) }, now)).toBe(true);
    expect(isOverdue({ status: "BOOKED", date: edge, endDate: edge }, now)).toBe(false);
  });

  it("«скоро» is the next 15 minutes, as its hint now says", () => {
    const now = new Date("2026-10-02T06:00:00.000Z");
    const w = timedTileWheres(now).soon as { date: { gte: Date; lte: Date } };
    expect(w.date.lte.getTime() - w.date.gte.getTime()).toBe(SOON_WINDOW_MIN * MIN);
    expect(SOON_WINDOW_MIN).toBe(15);
  });

  it("render the tally, not the loaded rows", () => {
    const html = renderToStaticMarkup(
      React.createElement(AppointmentsTiles, {
        tally: { all: 80, BOOKED: 25, WAITING: 4, IN_PROGRESS: 2, COMPLETED: 30, soon: 3, overdue: 5 },
        activeBucket: "all",
      }),
    );
    expect(html).toContain(">80<");
    expect(html).toContain(">25<");
    expect(html).toContain(">36<");
    // The «+N за сегодня» hint that showed the arrived count is gone.
    expect(html).toContain("appointments.tiles.allHint<");
  });

  it("the «Прибыли» export carries the hall too", () => {
    expect(appointmentExportFilters({ bucket: "arrived" }, {}).statuses).toEqual([
      "WAITING",
      "IN_PROGRESS",
      "COMPLETED",
    ]);
  });
});

describe("AP-23: the «Услуга» filter", () => {
  it("matches the main service or a service line", () => {
    expect(appointmentServiceWhere("svc_eeg")).toEqual({
      OR: [{ serviceId: "svc_eeg" }, { services: { some: { serviceId: "svc_eeg" } } }],
    });
    expect(appointmentServiceWhere(undefined)).toBeNull();
  });

  it("travels into the CSV export, beside the search", () => {
    expect(appointmentExportFilters({}, { serviceId: "svc_eeg" }).serviceId).toBe("svc_eeg");
    const where = appointmentExportWhere({ serviceId: "svc_eeg", q: "Алиев" });
    expect(where.AND).toEqual([appointmentServiceWhere("svc_eeg")]);
    expect(JSON.stringify(where.OR)).toContain("Алиев");
  });
});
