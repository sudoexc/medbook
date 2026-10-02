/**
 * Review fixes for the A4 audit batch.
 *
 *  - AP-21: the «Записи» tiles are counted by the server over every page,
 *    but «Срочные», «Скоро», «Просрочены» and «Прибыли» only narrowed the
 *    loaded page, so «Скоро: 3» could open an empty table with no «Загрузить
 *    ещё». Those tiles are now a server filter (`bucket=`) with the same
 *    predicates the tally counts.
 *  - AP-14: reception is every CRM role's home, and its «Отправить» on
 *    «Напоминания пациентам» was a sure 403 «Forbidden» for the nurse and
 *    the call operator. The card follows the reminders route's roles, and the
 *    toast never shows the server's code.
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
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/ru/crm/appointments",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/app/[locale]/crm/appointments/_hooks/use-bulk-reminders", () => ({
  useBulkReminders: () => ({ send: vi.fn(), isPending: false }),
}));

import {
  bucketWhere,
  isServerBucket,
  timedTileWheres,
} from "@/lib/appointments/list-tiles";
import {
  isRunningLate,
  OVERDUE_CANDIDATE_STATUS_LIST,
  OVERDUE_GRACE_MIN,
} from "@/lib/appointments/overdue";
import {
  BULK_REMINDER_ROLES,
  canSendBulkReminders,
} from "@/lib/appointments/bulk-reminders";
import { listFiltersFor } from "@/app/[locale]/crm/appointments/_hooks/use-appointments-filters";
import { CrmRoleProvider, type Role } from "@/app/[locale]/crm/patients/[id]/_hooks/use-current-role";
import { BottomRow } from "@/app/[locale]/crm/reception/_components/bottom-row";

const MIN = 60_000;
const now = new Date("2026-10-02T10:00:00.000Z");

describe("AP-21: the tiles that are not one status filter on the server", () => {
  it("«Срочные» is the hall plus the overdue, as the tile adds them", () => {
    expect(bucketWhere("needs_attention", now)).toEqual({
      OR: [{ status: "WAITING" }, timedTileWheres(now).overdue],
    });
  });

  it("«Скоро» and «Просрочены» are the very clauses the tally counts", () => {
    expect(bucketWhere("soon", now)).toEqual(timedTileWheres(now).soon);
    expect(bucketWhere("overdue", now)).toEqual(timedTileWheres(now).overdue);
  });

  it("«Прибыли» includes the hall", () => {
    expect(bucketWhere("arrived", now)).toEqual({
      status: { in: ["WAITING", "IN_PROGRESS", "COMPLETED"] },
    });
  });

  it("«опаздывают» is the same window as isRunningLate", () => {
    const w = bucketWhere("late", now) as {
      status: { in: string[] };
      date: { lt: Date };
      endDate: { gte: Date };
    };
    expect(w.status.in).toEqual([...OVERDUE_CANDIDATE_STATUS_LIST]);
    expect(w.date.lt).toEqual(now);
    const edge = w.endDate.gte;
    expect(edge.getTime()).toBe(now.getTime() - OVERDUE_GRACE_MIN * MIN);
    const started = new Date(now.getTime() - 30 * MIN);
    expect(isRunningLate({ status: "BOOKED", date: started, endDate: edge }, now)).toBe(true);
    expect(
      isRunningLate(
        { status: "BOOKED", date: started, endDate: new Date(edge.getTime() - 1) },
        now,
      ),
    ).toBe(false);
  });

  it("only the smart tiles are server buckets; statuses stay statuses", () => {
    for (const b of ["needs_attention", "soon", "overdue", "arrived", "late"]) {
      expect(isServerBucket(b), b).toBe(true);
    }
    for (const b of ["all", "waiting", "booked", "unconfirmed", "no_show", null, undefined]) {
      expect(isServerBucket(b), String(b)).toBe(false);
    }
  });

  it("the list request carries the tile: a server bucket, or its status", () => {
    const today = "2026-10-02";
    const soon = listFiltersFor({ bucket: "soon" }, today);
    expect(soon.bucket).toBe("soon");
    expect(soon.status).toBeUndefined();

    const unconfirmed = listFiltersFor({ bucket: "unconfirmed" }, today);
    expect(unconfirmed.status).toBe("BOOKED");
    expect(unconfirmed.bucket).toBeUndefined();

    const waiting = listFiltersFor({ bucket: "waiting" }, today);
    expect(waiting.status).toBe("WAITING");
    expect(waiting.bucket).toBeUndefined();

    const all = listFiltersFor({ bucket: "all", status: "CANCELLED" }, today);
    expect(all.status).toBe("CANCELLED");
    expect(all.bucket).toBeUndefined();
  });

  it("the page no longer narrows the loaded rows by itself", () => {
    const src = readFileSync(
      path.join(
        process.cwd(),
        "src/app/[locale]/crm/appointments/_components/appointments-page-client.tsx",
      ),
      "utf8",
    );
    expect(src).not.toMatch(/filterRowsByBucket/);
  });
});

describe("AP-14: «Напоминания пациентам» follows the reminders route's roles", () => {
  it("only the admin and the desk may send (the route reads the same set)", () => {
    expect([...BULK_REMINDER_ROLES]).toEqual(["ADMIN", "RECEPTIONIST"]);
    expect(canSendBulkReminders("ADMIN")).toBe(true);
    expect(canSendBulkReminders("RECEPTIONIST")).toBe(true);
    expect(canSendBulkReminders("SUPER_ADMIN")).toBe(true);
    for (const r of ["NURSE", "CALL_OPERATOR", "DOCTOR", null, undefined]) {
      expect(canSendBulkReminders(r), String(r)).toBe(false);
    }
    const route = readFileSync(
      path.join(process.cwd(), "src/app/api/crm/appointments/bulk-reminders/route.ts"),
      "utf8",
    );
    expect(route).toMatch(/roles: \[\.\.\.BULK_REMINDER_ROLES\]/);
  });

  const booked = {
    id: "ap_1",
    date: new Date(Date.now() + 2 * 60 * MIN).toISOString(),
    queueStatus: "BOOKED",
    status: "BOOKED",
    doctor: { id: "d1" },
  };

  function renderFor(role: Role): string {
    return renderToStaticMarkup(
      React.createElement(CrmRoleProvider, {
        role,
        children: React.createElement(BottomRow, {
          todayRows: [booked as never],
          doctors: [],
        }),
      }),
    );
  }

  it("the desk sends", () => {
    const html = renderFor("RECEPTIONIST");
    expect(html).toContain("reception.bottomRow.recRemindTitle");
    expect(html).toContain("reception.bottomRow.recSend");
  });

  it("the call operator is led to the Action Center, not to a 403", () => {
    const html = renderFor("CALL_OPERATOR");
    expect(html).toContain("reception.bottomRow.recRemindTitle");
    expect(html).toContain("reception.bottomRow.recView");
    expect(html).not.toContain("reception.bottomRow.recSend");
  });

  it("a nurse, who can do neither, gets no card", () => {
    const html = renderFor("NURSE");
    expect(html).not.toContain("reception.bottomRow.recRemindTitle");
    expect(html).not.toContain("reception.bottomRow.recSend");
  });

  it("a failed send says the localized line, never the server's code", () => {
    const src = readFileSync(
      path.join(
        process.cwd(),
        "src/app/[locale]/crm/appointments/_hooks/use-bulk-reminders.ts",
      ),
      "utf8",
    );
    expect(src).toMatch(/toast\.error\(t\("rail\.remindersFailed"\)\)/);
    expect(src).not.toMatch(/description: e\.message/);
  });
});
