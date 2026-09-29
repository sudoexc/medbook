/**
 * The reception's control-visit task kept in step with the note's plan
 * (review of the custom follow-up, 29.09.2026). Driven through the real
 * upsert / retire of the Action engine against an in-memory table, on
 * 29 Sep 2026 at noon Tashkent.
 *
 * Pinned:
 *   1. A plan writes the task on its day: the named day (marked exact) or
 *      the signature's Tashkent day plus N; a week ahead, a week past.
 *   2. A moved plan moves the same task; it never becomes a second one.
 *   3. A plan removed retires a task still waiting; a call reception made
 *      stays theirs; no task, nothing written.
 *   4. A due day already gone by never yields a task expired at birth.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  followUpActionExpiry,
  syncFollowUpAction,
  type FollowUpActionNote,
} from "@/server/visit-notes/follow-up-action";

type Row = Record<string, unknown>;

// 29 Sep 2026, 12:00 Tashkent.
const NOW = new Date("2026-09-29T07:00:00.000Z");
const KEY = "VISIT_FOLLOW_UP_DUE:visitNoteId=vn_1";

const table = {
  actions: [] as Row[],
  audits: [] as Row[],
};

const db = {
  action: {
    findUnique: vi.fn(
      async ({ where }: { where: { clinicId_dedupeKey: Row } }) =>
        table.actions.find(
          (a) =>
            a.clinicId === where.clinicId_dedupeKey.clinicId &&
            a.dedupeKey === where.clinicId_dedupeKey.dedupeKey,
        ) ?? null,
    ),
    create: vi.fn(async ({ data }: { data: Row }) => {
      const row = {
        id: `act_${table.actions.length + 1}`,
        doneAt: null,
        dismissedAt: null,
        outcome: null,
        updatedAt: new Date(),
        ...data,
      };
      table.actions.push(row);
      return row;
    }),
    update: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
      const row = table.actions.find((a) => a.id === where.id)!;
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    }),
    updateMany: vi.fn(
      async ({
        where,
        data,
      }: {
        where: { id: { in: string[] }; status: { in: string[] } };
        data: Row;
      }) => {
        let count = 0;
        for (const a of table.actions) {
          if (
            where.id.in.includes(a.id as string) &&
            where.status.in.includes(a.status as string)
          ) {
            Object.assign(a, data);
            count += 1;
          }
        }
        return { count };
      },
    ),
  },
  auditLog: {
    create: vi.fn(async ({ data }: { data: Row }) => {
      table.audits.push(data);
      return data;
    }),
  },
};

function note(over: Partial<FollowUpActionNote> = {}): FollowUpActionNote {
  return {
    id: "vn_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_1",
    // Signed 29 Sep at 10:00 Tashkent.
    finalizedAt: new Date("2026-09-29T05:00:00.000Z"),
    followUpDays: null,
    followUpDate: null,
    followUpNote: null,
    patient: { fullName: "Рахимов Сардор" },
    doctor: { nameRu: "Султанов Азиз" },
    ...over,
  };
}

const sync = (n: FollowUpActionNote, now: Date = NOW) =>
  syncFollowUpAction(db as never, n, now);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  table.actions = [];
  table.audits = [];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("a plan writes the task", () => {
  it("an exact day: on that day, marked exact", async () => {
    expect(
      await sync(
        note({ followUpDays: 16, followUpDate: new Date("2026-10-15T00:00:00.000Z") }),
      ),
    ).toBe("upserted");
    expect(table.actions).toHaveLength(1);
    const task = table.actions[0]!;
    expect(task.dedupeKey).toBe(KEY);
    expect(task.payload).toMatchObject({
      type: "VISIT_FOLLOW_UP_DUE",
      dueDate: "2026-10-15",
      exactDate: true,
      patientName: "Рахимов Сардор",
      doctorName: "Султанов Азиз",
    });
    expect(task.deeplinkPath).toBe("/crm/patients/p1");
    // Hidden until 8 Oct 09:00, gone at midnight after 22 Oct.
    expect(task.status).toBe("SNOOZED");
    expect(task.snoozeUntil).toEqual(new Date("2026-10-08T04:00:00.000Z"));
    expect(task.expiresAt).toEqual(new Date("2026-10-22T19:00:00.000Z"));
  });

  it("days: from the signature's Tashkent day, no exact mark", async () => {
    await sync(note({ followUpDays: 14, followUpNote: " ЭЭГ " }));
    const payload = table.actions[0]!.payload as Row;
    expect(payload.dueDate).toBe("2026-10-13");
    expect(payload.followUpNote).toBe("ЭЭГ");
    expect(payload).not.toHaveProperty("exactDate");
  });

  it("a moved plan moves the same task", async () => {
    await sync(note({ followUpDays: 14 }));
    await sync(
      note({ followUpDays: 21, followUpDate: new Date("2026-10-20T00:00:00.000Z") }),
    );
    expect(table.actions).toHaveLength(1);
    const task = table.actions[0]!;
    expect(task.payload).toMatchObject({ dueDate: "2026-10-20", exactDate: true });
    expect(task.snoozeUntil).toEqual(new Date("2026-10-13T04:00:00.000Z"));
    expect(task.expiresAt).toEqual(new Date("2026-10-27T19:00:00.000Z"));
  });
});

describe("a plan removed", () => {
  it("retires a task still waiting", async () => {
    await sync(note({ followUpDays: 14 }));
    expect(await sync(note())).toBe("retired");
    expect(table.actions[0]!.status).toBe("EXPIRED");
    expect(table.audits.at(-1)).toMatchObject({
      action: "ACTION_EXPIRED",
      meta: expect.objectContaining({ reason: "follow_up_cancelled" }),
    });
  });

  it("and a plan set again brings it back", async () => {
    await sync(note({ followUpDays: 14 }));
    await sync(note());
    await sync(note({ followUpDays: 7 }));
    expect(table.actions).toHaveLength(1);
    expect(table.actions[0]!.status).not.toBe("EXPIRED");
    expect((table.actions[0]!.payload as Row).dueDate).toBe("2026-10-06");
  });

  it("leaves a call reception already made", async () => {
    await sync(note({ followUpDays: 3 }));
    table.actions[0]!.status = "DONE";
    expect(await sync(note())).toBe("none");
    expect(table.actions[0]!.status).toBe("DONE");
  });

  it("with no task on record writes nothing", async () => {
    expect(await sync(note())).toBe("none");
    expect(table.actions).toHaveLength(0);
    expect(db.action.updateMany).not.toHaveBeenCalled();
  });
});

describe("a due day already gone by", () => {
  it("still gets a week in the list, counted from today", async () => {
    // 12 Oct at noon, a note naming 3 Oct.
    const oct12 = new Date("2026-10-12T07:00:00.000Z");
    vi.setSystemTime(oct12);
    await sync(
      note({
        finalizedAt: new Date("2026-10-12T06:00:00.000Z"),
        followUpDays: 2,
        followUpDate: new Date("2026-10-03T00:00:00.000Z"),
      }),
      oct12,
    );
    const task = table.actions[0]!;
    // Shown at once, overdue, until midnight after 19 Oct.
    expect(task.status).toBe("OPEN");
    expect(task.expiresAt).toEqual(new Date("2026-10-19T19:00:00.000Z"));
  });

  it("the expiry rule itself", () => {
    expect(followUpActionExpiry("2026-10-15", NOW).toISOString()).toBe(
      "2026-10-22T19:00:00.000Z",
    );
    // Due today: the week counts from today, which is the due day.
    expect(followUpActionExpiry("2026-09-29", NOW).toISOString()).toBe(
      "2026-10-06T19:00:00.000Z",
    );
    expect(followUpActionExpiry("2026-09-01", NOW).toISOString()).toBe(
      "2026-10-06T19:00:00.000Z",
    );
  });
});
