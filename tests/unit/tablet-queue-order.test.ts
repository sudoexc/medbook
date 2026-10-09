/**
 * Reprint and hand-set queue order on the tablet and the desk (owner
 * request 08.10.2026: «перепечатать талон у любого», «ты первая, ты
 * вторая, ты третья»).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";
import type { TabletApptRow } from "@/lib/reception-tablet/doctor-day";
import {
  arrivedBookingsOf,
  liveQueueOf,
  moveId,
  tapOrderToIds,
  toggleTap,
} from "@/lib/reception-tablet/queue-order";

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

function row(over: Partial<TabletApptRow> & { id: string }): TabletApptRow {
  return {
    date: "2026-10-08T05:00:00.000Z",
    time: null,
    durationMin: 20,
    status: "WAITING",
    queueStatus: "WAITING",
    channel: "WALKIN",
    queuePriority: 0,
    queuedAt: "2026-10-08T05:00:00.000Z",
    ticketSeq: 1,
    queueOrder: 1,
    startedAt: null,
    patient: { id: `p-${over.id}`, fullName: over.id },
    doctor: { id: "d1" },
    ...over,
  };
}

describe("the order she calls out", () => {
  const current = ["a", "b", "c", "d", "e"];

  it("tapped first in tap order, the rest after in their order", () => {
    expect(tapOrderToIds(current, ["d", "a", "e"])).toEqual(["d", "a", "e", "b", "c"]);
    expect(tapOrderToIds(current, [])).toEqual(current);
  });

  it("drops taps for people who left; newcomers go after the tapped", () => {
    expect(tapOrderToIds(["a", "b", "x"], ["b", "gone", "a"])).toEqual(["b", "a", "x"]);
  });

  it("a second tap takes the number back", () => {
    expect(toggleTap(["a", "b"], "c")).toEqual(["a", "b", "c"]);
    expect(toggleTap(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("arrows move one place, not past the ends", () => {
    expect(moveId(current, "c", -1)).toEqual(["a", "c", "b", "d", "e"]);
    expect(moveId(current, "c", 1)).toEqual(["a", "b", "d", "c", "e"]);
    expect(moveId(current, "a", -1)).toBeNull();
    expect(moveId(current, "e", 1)).toBeNull();
    expect(moveId(current, "zz", 1)).toBeNull();
  });
});

describe("whose queue", () => {
  const rows = [
    row({ id: "w2", queuedAt: "2026-10-08T05:10:00.000Z", ticketSeq: 2 }),
    row({ id: "w1", queuedAt: "2026-10-08T05:05:00.000Z", ticketSeq: 1 }),
    row({ id: "urgent", queuedAt: "2026-10-08T05:20:00.000Z", queuePriority: 1, ticketSeq: 3 }),
    row({ id: "inside", status: "IN_PROGRESS", queueStatus: "IN_PROGRESS" }),
    row({ id: "other", doctor: { id: "d2" } }),
    row({ id: "booked-arrived", channel: "PHONE", date: "2026-10-08T06:00:00.000Z" }),
    row({ id: "booked-later", channel: "PHONE", status: "BOOKED", queueStatus: "BOOKED" }),
  ];

  it("the live queue: waiting walk-ins of that doctor, «Срочно» first, then arrival", () => {
    expect(liveQueueOf(rows, "d1").map((r) => r.id)).toEqual(["urgent", "w1", "w2"]);
  });

  it("arrived bookings are listed for a reprint, never in the reorder", () => {
    expect(arrivedBookingsOf(rows, "d1").map((r) => r.id)).toEqual(["booked-arrived"]);
  });
});

describe("wiring", () => {
  const screen = read("src/app/[locale]/crm/reception/tablet/_components/queue-screen.tsx");
  const app = read("src/app/[locale]/crm/reception/tablet/_components/tablet-app.tsx");

  it("the tablet opens «Очередь» from home", () => {
    expect(app).toContain('import { QueueScreen } from "./queue-screen";');
    expect(app).toContain("onOpenQueue={() => setQueueOpen(true)}");
    expect(app).toMatch(/queueOpen \? \(\s*<QueueScreen/);
  });

  it("the tablet saves the order through the desk's reorder mutation, once", () => {
    expect(screen).toContain("const reorder = useReorderQueue();");
    expect(screen).toContain("save(tapOrderToIds(liveIds, tapped)");
    expect(screen).toContain("reorder.mutate({ doctorId: doctor.id, orderedIds }");
  });

  it("reprints go through the hidden frame, never a new tab", () => {
    for (const f of [
      "src/app/[locale]/crm/reception/tablet/_components/queue-screen.tsx",
      "src/app/[locale]/crm/reception/_components/doctor-queue-panel.tsx",
      "src/app/[locale]/crm/appointments/_components/appointment-drawer.tsx",
    ]) {
      const src = read(f);
      expect(src, f).toContain("<TicketPrintFrame");
      expect(src, f).not.toContain("window.open(`/ticket/");
    }
    const panel = read("src/app/[locale]/crm/reception/_components/doctor-queue-panel.tsx");
    expect(panel).toContain('{t("reprint")}');
    const drawer = read("src/app/[locale]/crm/appointments/_components/appointment-drawer.tsx");
    expect(drawer).toContain('{t("reprintTicket")}');
    expect(drawer).toContain("tashkentDateOf(appt.date) === tashkentToday()");
  });

  it("no dropdown, select or popover on the tablet's queue screen", () => {
    expect(screen).not.toMatch(/@\/components\/ui\/(select|dropdown-menu|popover)/);
  });

  it("texts in both languages, no dashes", () => {
    const keys = Object.keys(ru.receptionTablet.queue).sort();
    expect(Object.keys(uz.receptionTablet.queue).sort()).toEqual(keys);
    for (const m of [ru, uz]) {
      for (const v of Object.values(m.receptionTablet.queue)) expect(v).not.toMatch(/[—–]/);
      expect(m.receptionTablet.home.queueOpen).toBeTruthy();
      expect(m.reception.doctorsPanel.panel.reprint).toBeTruthy();
      expect(m.appointments.drawer.reprintTicket).toBeTruthy();
    }
  });
});
