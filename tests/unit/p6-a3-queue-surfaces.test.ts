/**
 * P6 A3, the live queue surfaces.
 *
 * Q-22 — the reception panel kept its drag override until the live list
 * matched it element by element; any call, new walk-in or «Срочно» made
 * that impossible and the panel froze in the dragged order for the day.
 *
 * Q-23 — a drag rewrites `queuedAt` (the lane's sort key), and the doctor's
 * «ждёт N мин» read the same field: a just-arrived patient dragged to the top
 * «waited» two hours. The doctor now reads the walk-in's arrival (createdAt),
 * and the desk is told when a «Срочно» row kept its place (exact=false).
 *
 * Q-24 — the ticket page had no state for SKIPPED, CANCELLED or NO_SHOW and
 * kept the blue «active» card with an empty status block.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ticketClosedCopyKeys,
  ticketClosedReason,
} from "@/app/q/[token]/_components/ticket-state";
import ru from "@/messages/ru.json";
import uz from "@/messages/uz.json";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  appointmentFindMany: vi.fn(async (_a: Row): Promise<Row[]> => []),
  projection: new Map<string, unknown>(),
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
vi.mock("@/server/appointments/queue-projection", () => ({
  getQueueProjection: vi.fn(async () => db.projection),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    doctor: {
      findFirst: vi.fn(async () => ({ id: "doc_1", userId: "u_doc_1" })),
    },
    appointment: {
      findMany: db.appointmentFindMany,
      findFirst: vi.fn(async () => null),
      groupBy: vi.fn(async () => []),
    },
    patient: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
      count: vi.fn(async () => 0),
    },
    patientAllergy: { findMany: vi.fn(async () => []) },
    patientChronicCondition: { findMany: vi.fn(async () => []) },
    document: { findFirst: vi.fn(async () => null) },
    conversation: {
      aggregate: vi.fn(async () => ({ _sum: { unreadCount: 0 } })),
      findMany: vi.fn(async () => []),
    },
    message: { groupBy: vi.fn(async () => []) },
    doctorSchedule: { findMany: vi.fn(async () => []) },
    prescription: { findMany: vi.fn(async () => []) },
  },
}));

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

beforeEach(() => {
  vi.resetModules();
  db.appointmentFindMany.mockReset().mockResolvedValue([]);
  db.projection = new Map();
});

describe("Q-22 — the drag override lives one round-trip", () => {
  it("the panel drops it when the reorder settles, success or failure", () => {
    const panel = read(
      "src/app/[locale]/crm/reception/_components/doctor-queue-panel.tsx",
    );
    expect(panel).toMatch(
      /reorder\.mutate\([\s\S]*?onSettled: \(\) => setPendingOrder\(null\)/,
    );
    // Not only on error any more: an error-only reset was the bug.
    expect(panel).not.toMatch(/onError: \(\) => setPendingOrder\(null\)/);
  });
});

describe("Q-23 — «ждёт N мин» reads the arrival, not the sort key", () => {
  it("the live queue carries the walk-in's createdAt, untouched by a drag", async () => {
    const arrived = new Date("2026-10-02T06:40:00.000Z"); // 11:40 Tashkent
    const draggedKey = new Date("2026-10-02T04:00:00.000Z"); // 09:00, base of the drag
    db.appointmentFindMany.mockResolvedValue([
      {
        id: "apt_w",
        date: arrived,
        durationMin: 30,
        status: "WAITING",
        startedAt: null,
        calledAt: null,
        completedAt: null,
        comments: null,
        ticketSeq: 9,
        queueOrder: 9,
        channel: "WALKIN",
        createdAt: arrived,
        queuedAt: draggedKey,
        patient: {
          id: "p1",
          fullName: "Рахимов Сардор",
          phone: "+998901112233",
          birthDate: null,
          photoUrl: null,
          visitsCount: 2,
          tags: [],
          segment: "ACTIVE",
          lastVisitAt: null,
          notes: null,
        },
      },
    ]);
    db.projection = new Map([
      [
        "doc_1",
        {
          waiting: [
            {
              appointmentId: "apt_w",
              patientFullName: "Рахимов Сардор",
              ticketNumber: "A-009",
              position: 1,
              etaMinutes: 0,
            },
          ],
        },
      ],
    ]);

    const { GET } = await import("@/app/api/crm/doctors/me/today/route");
    const res = await GET(new Request("https://x/api/crm/doctors/me/today"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { liveQueue: Row[] };

    expect(body.liveQueue).toHaveLength(1);
    expect(body.liveQueue[0]!.arrivedAt).toBe(arrived.toISOString());
    expect(body.liveQueue[0]).not.toHaveProperty("queuedAt");
  });

  it("the doctor's card and the visit screen read the arrival", () => {
    const card = read("src/app/[locale]/doctor/my-day/_components/live-queue-card.tsx");
    expect(card).toContain("entry.arrivedAt");
    expect(card).not.toContain("entry.queuedAt");
    const visit = read(
      "src/app/[locale]/doctor/reception/_components/active-patient-card.tsx",
    );
    expect(visit).toContain("formatTime(activeAppointment.createdAt ??");
  });

  it("the desk is told when «Срочно» kept a row above the dragged one", () => {
    const hook = read("src/app/[locale]/crm/appointments/_hooks/use-appointment.ts");
    expect(hook).toMatch(/result\.exact === false\) toast\.info\(t\("reorderPriorityKept"\)\)/);
    expect(ru.crmToasts.appointment.reorderPriorityKept).toBeTruthy();
    expect(uz.crmToasts.appointment.reorderPriorityKept).toBeTruthy();
  });
});

describe("Q-24 — a closed ticket says what happened", () => {
  it("SKIPPED, CANCELLED and NO_SHOW are closed; live states are not", () => {
    expect(ticketClosedReason("SKIPPED")).toBe("skipped");
    expect(ticketClosedReason("CANCELLED")).toBe("cancelled");
    expect(ticketClosedReason("NO_SHOW")).toBe("noShow");
    for (const s of ["WAITING", "IN_PROGRESS", "COMPLETED", "BOOKED", "CONFIRMED"]) {
      expect(ticketClosedReason(s)).toBeNull();
    }
  });

  it("a cancelled paper ticket leaves the queue; a cancelled booking is a «запись»", () => {
    expect(ticketClosedCopyKeys("cancelled", "live").title).toBe("cancelledLive");
    expect(ticketClosedCopyKeys("cancelled", "schedule").title).toBe("cancelledBooking");
    expect(ticketClosedCopyKeys("skipped", "live")).toEqual({
      title: "skipped",
      hint: "skippedHint",
    });
  });

  it("every message the page can show exists in both languages, without dashes", () => {
    const keys = new Set<string>();
    for (const reason of ["skipped", "cancelled", "noShow"] as const) {
      for (const lane of ["live", "schedule"] as const) {
        const k = ticketClosedCopyKeys(reason, lane);
        keys.add(k.title);
        keys.add(k.hint);
      }
    }
    for (const k of keys) {
      const ruText = (ru.queueStatusPage as Record<string, string>)[k];
      const uzText = (uz.queueStatusPage as Record<string, string>)[k];
      expect(ruText, k).toBeTruthy();
      expect(uzText, k).toBeTruthy();
      expect(ruText).not.toMatch(/[—–]/);
      expect(uzText).not.toMatch(/[—–]/);
    }
  });
});

describe("Q-19 — the desk's ticket dialog keeps what it asked", () => {
  it("sends «Пол» and «Источник», and a repeat press is not a new ticket", () => {
    const dialog = read(
      "src/app/[locale]/crm/reception/_components/walkin-ticket-dialog.tsx",
    );
    expect(dialog).toContain("...(gender ? { gender } : {})");
    expect(dialog).toContain("...(source ? { source } : {})");
    expect(dialog).toMatch(/if \(issued\.duplicate\) \{\s*toast\.info\(t\("toastDuplicate"/);
    expect(dialog).toContain('t("result.titleDuplicate")');
    for (const m of [ru, uz]) {
      expect(m.reception.walkin.toastDuplicate).toContain("{number}");
      expect(m.reception.walkin.result.titleDuplicate).toBeTruthy();
    }
  });
});
