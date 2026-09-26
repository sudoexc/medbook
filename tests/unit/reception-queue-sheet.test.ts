/**
 * Audit UX-02, the drill-down: the «В очереди сейчас» tile was fixed to count
 * only who is WAITING, but the sheet it opens (same title) still put every
 * BOOKED / CONFIRMED booking of the day into its badge. At 9:00 the tile read
 * 3 and one click later the sheet read 23.
 *
 * Acceptance: 3 WAITING (two walk-ins and one booking that arrived) plus 20
 * bookings later in the day: the tile and the sheet's badge both read 3; the
 * 20 stay listed in their own «Ожидаются по записи» section with their own
 * count, and the header names both numbers.
 */
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
  useTranslations:
    (ns: string) =>
    (key: string, values?: Record<string, unknown>) =>
      `${ns}.${key}${values ? JSON.stringify(values) : ""}`,
  useLocale: () => "ru",
}));
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string;
    children: React.ReactNode;
  }) => React.createElement("a", { href }, children),
}));
// The real Sheet portals into document.body, which a static render never
// reaches. Inline stand-ins keep the drawer's own markup.
vi.mock("@/components/ui/sheet", () => {
  const pass =
    (tag: string, attrs: Record<string, string> = {}) =>
    ({ children }: { children?: React.ReactNode }) =>
      React.createElement(tag, attrs, children);
  return {
    Sheet: ({
      open,
      children,
    }: {
      open: boolean;
      children?: React.ReactNode;
    }) => (open ? React.createElement("div", null, children) : null),
    SheetContent: pass("div"),
    SheetHeader: pass("header"),
    SheetTitle: pass("h2", { "data-title": "" }),
    SheetDescription: pass("p", { "data-description": "" }),
  };
});
vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("b", { "data-badge": "" }, children),
}));

import { receptionQueueKpis, receptionQueueSheet } from "@/lib/reception-kpi";
import { ReceptionListDrawer } from "@/app/[locale]/crm/reception/_components/reception-list-drawer";
import type { AppointmentRow } from "@/app/[locale]/crm/appointments/_hooks/use-appointments-list";

type Status = AppointmentRow["status"];

let seq = 0;
function row(
  channel: AppointmentRow["channel"],
  status: Status,
  hhmm: string,
): AppointmentRow {
  seq += 1;
  const date = `2026-09-26T${hhmm}:00+05:00`;
  return {
    id: `a${seq}`,
    date,
    endDate: date,
    durationMin: 30,
    status,
    queueStatus: status,
    channel,
    queuePriority: 0,
    queuedAt: status === "WAITING" ? date : null,
    ticketSeq: channel === "WALKIN" ? seq : null,
    queueOrder: null,
    startedAt: null,
    patient: { id: `p${seq}`, fullName: `Пациент ${seq}`, photoUrl: null },
    doctor: { id: "d1", nameRu: "Султанов Азиз", nameUz: "Sultonov Aziz" },
    primaryService: null,
    cabinet: null,
  } as unknown as AppointmentRow;
}

/** The dashboard's snapshot: today's rows grouped by queueStatus. */
function bucketsOf(rows: AppointmentRow[]) {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.queueStatus, (m.get(r.queueStatus) ?? 0) + 1);
  return [...m].map(([status, count]) => ({ status, count }));
}

/** 9:00: two walk-ins and one arrived booking wait, 20 bookings to come. */
function nineAm(): AppointmentRow[] {
  seq = 0;
  const rows = [
    row("WALKIN", "WAITING", "08:40"),
    row("WALKIN", "WAITING", "08:55"),
    row("PHONE", "WAITING", "09:00"),
    // Off the queue: on the table, seen, gone, cancelled.
    row("WALKIN", "IN_PROGRESS", "08:20"),
    row("WALKIN", "COMPLETED", "08:00"),
    row("WALKIN", "SKIPPED", "08:30"),
    row("PHONE", "CANCELLED", "10:00"),
  ];
  for (let i = 0; i < 20; i += 1) {
    const hh = String(10 + Math.floor(i / 3)).padStart(2, "0");
    const mm = String((i % 3) * 20).padStart(2, "0");
    // Phone bookings are created CONFIRMED; Telegram ones start BOOKED.
    rows.push(
      row(i % 2 ? "PHONE" : "TELEGRAM", i % 2 ? "CONFIRMED" : "BOOKED", `${hh}:${mm}`),
    );
  }
  return rows;
}

function drawer(rows: AppointmentRow[]): string {
  const html = renderToStaticMarkup(
    React.createElement(ReceptionListDrawer, {
      mode: "queue",
      rows,
      onOpenChange: () => {},
      onRowClick: () => {},
    }),
  );
  return html.replace(/&quot;/g, '"');
}

function badge(html: string): string {
  return /<b data-badge="">(\d+)<\/b>/.exec(html)?.[1] ?? "";
}

/** The count printed in a section header, located by its title key. */
function sectionCount(html: string, titleKey: string): string | null {
  const at = html.indexOf(`${titleKey}<`);
  if (at === -1) return null;
  return /<span[^>]*>(\d+)<\/span>/.exec(html.slice(at))?.[1] ?? null;
}

describe("UX-02: the queue sheet agrees with the tile", () => {
  it("3 waiting and 20 bookings to come: the lanes split by arrival", () => {
    const sheet = receptionQueueSheet(nineAm());
    expect(sheet.live).toHaveLength(2);
    expect(sheet.arrived).toHaveLength(1);
    expect(sheet.expected).toHaveLength(20);
    expect(sheet.waitingNow).toBe(3);
    // The same rows the dashboard groups for the tile: one number.
    expect(sheet.waitingNow).toBe(receptionQueueKpis(bucketsOf(nineAm())).waitingNow);
  });

  it("bookings to come are ordered by slot, walk-ins by arrival", () => {
    const { live, expected } = receptionQueueSheet(nineAm());
    expect(live.map((r) => r.date)).toEqual([
      "2026-09-26T08:40:00+05:00",
      "2026-09-26T08:55:00+05:00",
    ]);
    const times = expected.map((r) => new Date(r.date).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it("the sheet's badge reads 3, not 23, under «В очереди сейчас»", () => {
    const html = drawer(nineAm());
    expect(html).toContain("reception.listDrawer.queueTitle<");
    expect(badge(html)).toBe("3");
    expect(html).toContain(
      'reception.listDrawer.queueSubtitle{"waiting":3,"expected":20}',
    );
  });

  it("the 20 bookings stay listed, in a section of their own", () => {
    const html = drawer(nineAm());
    expect(sectionCount(html, "reception.queueColumn.subsectionLive")).toBe("2");
    expect(sectionCount(html, "reception.listDrawer.subsectionArrived")).toBe("1");
    expect(sectionCount(html, "reception.listDrawer.subsectionExpected")).toBe("20");
    // 23 rows on screen: the list is complete, only the count changed.
    expect(html.match(/<li>/g)).toHaveLength(23);
    // Off-queue rows never appear.
    expect(html).not.toContain("Пациент 4<");
    expect(html).not.toContain("Пациент 7<");
  });

  it("nobody waiting yet: badge 0, the day's bookings still shown", () => {
    const later = [
      row("PHONE", "CONFIRMED", "11:00"),
      row("TELEGRAM", "BOOKED", "12:00"),
    ];
    const html = drawer(later);
    expect(badge(html)).toBe("0");
    expect(html).not.toContain("reception.listDrawer.queueEmpty");
    expect(sectionCount(html, "reception.listDrawer.subsectionExpected")).toBe("2");
  });

  it("an empty day shows the empty state", () => {
    const html = drawer([]);
    expect(badge(html)).toBe("0");
    expect(html).toContain("reception.listDrawer.queueEmpty<");
  });
});
