/**
 * Audit INF-09 — a new prescription is reminded however many old ones exist.
 *
 * The tick read `take: 500` with no order and no paging, and a course never
 * left ACTIVE when its days ran out; once 500 finished courses piled up, a
 * new one could fall outside the batch and never be reminded. The tick now
 * walks every eligible row by id and completes finished courses, which then
 * leave the pool.
 *
 * Acceptance from the audit: 600 ACTIVE prescriptions with an expired course
 * and 1 new one; the tick reminds the new one, the expired ones become
 * COMPLETED and are not scanned by the next tick.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Rx = {
  id: string;
  status: string;
  schedule: Record<string, unknown>;
  createdAt: Date;
};

const state = vi.hoisted(() => ({
  rx: [] as Rx[],
  sends: [] as Array<{ prescriptionId: string; scheduledFor: Date }>,
  findManyCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_ctx: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/server/queue", () => ({ getQueue: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  type Where = {
    status?: string | { in: string[] };
    id?: { gt?: string; in?: string[] };
  };
  const matches = (rx: Rx, w: Where) =>
    (w.status === undefined ||
      (typeof w.status === "string" ? rx.status === w.status : w.status.in.includes(rx.status))) &&
    (w.id?.gt === undefined || rx.id > w.id.gt) &&
    (w.id?.in === undefined || w.id.in.includes(rx.id));
  return {
    prisma: {
      prescription: {
        findMany: vi.fn(
          async (args: { where: Where; orderBy?: { id: "asc" }; take?: number }) => {
            state.findManyCalls.push(args as Record<string, unknown>);
            let rows = state.rx.filter((rx) => matches(rx, args.where));
            if (args.orderBy?.id === "asc") rows = rows.sort((a, b) => (a.id < b.id ? -1 : 1));
            if (args.take) rows = rows.slice(0, args.take);
            return rows.map((rx) => ({
              ...rx,
              clinicId: "c1",
              patientId: `p-${rx.id}`,
              drugName: "Карбамазепин",
              dosage: "200 мг",
              patient: {
                fullName: "Пациент",
                phone: "+998901112233",
                telegramId: "1",
                preferredChannel: "TG",
                marketingOptOut: false,
                deletedAt: null,
              },
              clinic: {
                id: "c1",
                nameRu: "Клиника",
                nameUz: "Klinika",
                timezone: "Asia/Tashkent",
                medicationRemindersEnabled: true,
              },
            }));
          },
        ),
        updateMany: vi.fn(async ({ where, data }: { where: Where; data: { status: string } }) => {
          let count = 0;
          for (const rx of state.rx) {
            if (matches(rx, where)) {
              rx.status = data.status;
              count += 1;
            }
          }
          return { count };
        }),
      },
      notificationTemplate: { findMany: vi.fn(async () => []) },
      medicationReminderSend: {
        create: vi.fn(async ({ data }: { data: { prescriptionId: string; scheduledFor: Date } }) => {
          if (
            state.sends.some(
              (s) =>
                s.prescriptionId === data.prescriptionId &&
                s.scheduledFor.getTime() === data.scheduledFor.getTime(),
            )
          ) {
            throw new Error("unique violation");
          }
          state.sends.push(data);
          return { id: `s-${data.prescriptionId}` };
        }),
      },
    },
  };
});

import {
  courseEndsAt,
  isCourseFinished,
  parseSchedule,
} from "@/lib/patient-experience/medication-schedule";
import { PAGE_SIZE, runMedicationReminderTick } from "@/server/workers/medication-reminder";

// 09:00 in Tashkent.
const NOW = new Date("2026-09-28T04:00:00Z");

beforeEach(() => {
  state.sends = [];
  state.findManyCalls = [];
  state.rx = [];
  for (let i = 0; i < 600; i++) {
    state.rx.push({
      id: `rx-${String(i).padStart(4, "0")}`,
      status: "ACTIVE",
      // A 10-day course that ended in spring.
      schedule: { times: ["09:00"], days: 10, startsAt: "2026-03-01T00:00:00.000Z" },
      createdAt: new Date("2026-03-01T00:00:00Z"),
    });
  }
  // Prescribed yesterday, sorts after every old id: outside the old `take: 500`.
  state.rx.push({
    id: "rx-zz-new",
    status: "ACTIVE",
    schedule: { times: ["09:00", "21:00"], days: 14, startsAt: "2026-09-27T04:00:00.000Z" },
    createdAt: new Date("2026-09-27T04:00:00Z"),
  });
});

describe("course end", () => {
  it("startsAt + days; open-ended courses never finish", () => {
    const s = parseSchedule({ times: ["09:00"], days: 10, startsAt: "2026-03-01T00:00:00.000Z" }, NOW)!;
    expect(courseEndsAt(s)).toEqual(new Date("2026-03-11T00:00:00.000Z"));
    expect(isCourseFinished(s, new Date("2026-03-10T23:59:59Z"))).toBe(false);
    expect(isCourseFinished(s, new Date("2026-03-11T00:00:00Z"))).toBe(true);
    const open = parseSchedule({ times: ["09:00"] }, new Date("2020-01-01T00:00:00Z"))!;
    expect(courseEndsAt(open)).toBeNull();
    expect(isCourseFinished(open, NOW)).toBe(false);
  });
});

describe("the tick over 600 finished courses and 1 new one", () => {
  it("reminds the new course and completes the finished ones", async () => {
    const res = await runMedicationReminderTick(NOW);
    expect(res).toEqual({ scanned: 601, created: 1, completed: 600 });
    expect(state.sends.map((s) => s.prescriptionId)).toEqual(["rx-zz-new"]);
    expect(state.rx.filter((r) => r.status === "COMPLETED")).toHaveLength(600);
    expect(state.rx.find((r) => r.id === "rx-zz-new")!.status).toBe("ACTIVE");
  });

  it("walks the rows page by page in id order, never a single unordered batch", async () => {
    await runMedicationReminderTick(NOW);
    expect(state.findManyCalls).toHaveLength(2);
    for (const call of state.findManyCalls) {
      expect(call.orderBy).toEqual({ id: "asc" });
      expect(call.take).toBe(PAGE_SIZE);
    }
    expect((state.findManyCalls[1]!.where as { id: { gt: string } }).id).toEqual({
      gt: `rx-${String(PAGE_SIZE - 1).padStart(4, "0")}`,
    });
  });

  it("the next tick no longer scans the completed courses", async () => {
    await runMedicationReminderTick(NOW);
    const next = await runMedicationReminderTick(new Date("2026-09-28T16:00:00Z")); // 21:00
    expect(next).toEqual({ scanned: 1, created: 1, completed: 0 });
  });

  it("a course paused by staff meanwhile keeps its status", async () => {
    state.rx[0]!.status = "PAUSED";
    await runMedicationReminderTick(NOW);
    expect(state.rx[0]!.status).toBe("PAUSED");
  });
});
