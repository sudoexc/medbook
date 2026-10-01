/**
 * Audit G3-01 — «Я на месте» from the Mini App set `arrivedAt` and showed a
 * four-second toast on the reception page only. No list, card or API showed
 * it; the patient waited in the hall and an hour later got «вы не пришли».
 * (The sweep side is pinned in no-show-sweep-queue-status.test.ts.)
 *
 * Pinned:
 *   1. One rule: checked in and not yet «Пришёл».
 *   2. The badge renders on such a booking and on nothing else, and sits on
 *      every reception list and the appointment card.
 *   3. The alert lives in the CRM layout, stays until someone reacts, and
 *      goes when the visit moves on; the reception page no longer toasts.
 */
import * as React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations: (ns: string) => (key: string, vars?: Record<string, unknown>) =>
    vars ? `${ns}.${key}(${Object.values(vars).join(",")})` : `${ns}.${key}`,
  useLocale: () => "ru",
}));

import {
  awaitsDeskCheckIn,
  deskHasReacted,
} from "@/lib/appointments/self-check-in";
import { SelfCheckInBadge } from "@/components/atoms/self-check-in-badge";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// 14:05 in Tashkent.
const CHECKED_IN = "2026-10-01T09:05:00.000Z";

describe("G3-01: checked in, not yet met", () => {
  it("a booking with a check-in awaits the desk", () => {
    expect(awaitsDeskCheckIn({ arrivedAt: CHECKED_IN, status: "BOOKED" })).toBe(true);
    expect(
      awaitsDeskCheckIn({ arrivedAt: CHECKED_IN, status: "CONFIRMED", queueStatus: "CONFIRMED" }),
    ).toBe(true);
  });

  it("not once «Пришёл» is pressed, nor without a check-in", () => {
    expect(
      awaitsDeskCheckIn({ arrivedAt: CHECKED_IN, status: "CONFIRMED", queueStatus: "WAITING" }),
    ).toBe(false);
    expect(awaitsDeskCheckIn({ arrivedAt: CHECKED_IN, status: "IN_PROGRESS" })).toBe(false);
    expect(awaitsDeskCheckIn({ arrivedAt: null, status: "BOOKED" })).toBe(false);
  });

  it("the desk has reacted once the visit leaves the pre-arrival states", () => {
    for (const s of ["WAITING", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"]) {
      expect(deskHasReacted(s)).toBe(true);
    }
    expect(deskHasReacted("CONFIRMED")).toBe(false);
    expect(deskHasReacted(undefined)).toBe(false);
  });
});

describe("G3-01: the badge", () => {
  it("names the check-in with its Tashkent time", () => {
    const out = renderToStaticMarkup(
      React.createElement(SelfCheckInBadge, {
        row: { arrivedAt: CHECKED_IN, status: "CONFIRMED", queueStatus: "CONFIRMED" },
      }),
    );
    expect(out).toContain("reception.live.selfCheckInBadgeAt(14:05)");
  });

  it("renders nothing for a patient already marked arrived", () => {
    const out = renderToStaticMarkup(
      React.createElement(SelfCheckInBadge, {
        row: { arrivedAt: CHECKED_IN, status: "CONFIRMED", queueStatus: "WAITING" },
      }),
    );
    expect(out).toBe("");
  });

  it.each([
    "src/app/[locale]/crm/reception/_components/doctor-queue-panel.tsx",
    "src/app/[locale]/crm/reception/_components/queue-column.tsx",
    "src/app/[locale]/crm/reception/_components/reception-list-drawer.tsx",
    "src/app/[locale]/crm/appointments/_components/appointments-table.tsx",
    "src/app/[locale]/crm/appointments/_components/appointment-drawer.tsx",
  ])("is on %s", (path) => {
    expect(read(path)).toContain("<SelfCheckInBadge row=");
  });

  it("the list row type carries arrivedAt", () => {
    expect(read("src/app/[locale]/crm/appointments/_hooks/use-appointments-list.ts")).toContain(
      "arrivedAt?: string | null;",
    );
  });
});

describe("G3-01: the alert stays until someone reacts", () => {
  it("is mounted in the CRM layout for the desk roles", () => {
    const layout = read("src/app/[locale]/crm/layout.tsx");
    expect(layout).toContain("<GlobalArrivalAlerts");
  });

  it("does not time out and goes when the visit moves on", () => {
    const src = read("src/components/layout/global-arrival-alerts.tsx");
    expect(src).toContain("duration: Number.POSITIVE_INFINITY");
    expect(src).toContain("toast.dismiss(alertId(p.appointmentId))");
    expect(src).toContain('"patient.arrived", "appointment.statusChanged", "queue.updated"');
  });

  it("the reception page no longer shows its own four-second toast", () => {
    const src = read("src/app/[locale]/crm/reception/_hooks/use-reception-live.ts");
    expect(src).not.toContain("toast(");
    expect(src).not.toContain('t("live.patientArrived")');
  });
});
