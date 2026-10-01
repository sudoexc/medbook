/**
 * Audit CM-01 — a call whose PBX hangup never arrived is closed by the
 * sweep: RINGING past 10 minutes as a missed call (counted, listed for a
 * call back), ANSWERED past 4 hours as ended with no invented duration.
 * A call closed meanwhile by a hangup or the operator is left alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  clinicId: string;
  direction: "IN" | "OUT" | "MISSED";
  status: "RINGING" | "ANSWERED" | "ENDED" | "MISSED";
  startedAt: Date | null;
  createdAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSec: number | null;
  sipCallId: string | null;
  fromNumber: string;
  toNumber: string;
};

const h = vi.hoisted(() => ({
  rows: [] as Row[],
  events: [] as Array<{ clinicId: string; type: string }>,
  /** Simulates a hangup landing between the read and the write. */
  closeBeforeWrite: null as string | null,
}));

vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: (clinicId: string, e: { type: string }) => {
    h.events.push({ clinicId, type: e.type });
  },
}));
vi.mock("@/lib/prisma", () => {
  const before = (d: Date | null, cut: Date) => d !== null && d < cut;
  return {
    prisma: {
      call: {
        findMany: vi.fn(
          async ({
            where,
          }: {
            where: {
              status: string;
              endedAt: null;
              OR: Array<Record<string, { lt: Date } | null>>;
            };
          }) => {
            const cut = (Object.values(where.OR[0]!)[0] as { lt: Date }).lt;
            const field = where.status === "RINGING" ? "startedAt" : "answeredAt";
            return h.rows.filter(
              (r) =>
                r.status === where.status &&
                r.endedAt === null &&
                (before(r[field], cut) || (r[field] === null && before(r.createdAt, cut))),
            );
          },
        ),
        updateMany: vi.fn(
          async ({ where, data }: { where: { id: string; status: string }; data: Partial<Row> }) => {
            if (h.closeBeforeWrite === where.id) {
              const r = h.rows.find((x) => x.id === where.id)!;
              r.status = "ENDED";
              r.endedAt = new Date();
            }
            const row = h.rows.find(
              (r) => r.id === where.id && r.status === where.status && r.endedAt === null,
            );
            if (!row) return { count: 0 };
            Object.assign(row, data);
            return { count: 1 };
          },
        ),
      },
    },
  };
});

import { closeStaleCalls } from "@/server/workers/call-sweep";

const NOW = new Date("2026-10-01T10:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000);

function row(id: string, over: Partial<Row>): Row {
  return {
    id,
    clinicId: "c1",
    direction: "IN",
    status: "RINGING",
    startedAt: ago(1),
    createdAt: ago(1),
    answeredAt: null,
    endedAt: null,
    durationSec: null,
    sipCallId: `sip-${id}`,
    fromNumber: "+998901234567",
    toNumber: "+998712001020",
    ...over,
  };
}

beforeEach(() => {
  h.rows = [];
  h.events = [];
  h.closeBeforeWrite = null;
});

describe("call sweep", () => {
  it("closes a ghost RINGING call as missed and tells the call center", async () => {
    h.rows = [row("ghost", { startedAt: ago(45), createdAt: ago(45) }), row("fresh", {})];
    const out = await closeStaleCalls(NOW);
    expect(out).toEqual({ missed: 1, ended: 0 });
    expect(h.rows[0]).toMatchObject({
      status: "MISSED",
      direction: "MISSED",
      endedAt: NOW,
      durationSec: null,
    });
    expect(h.rows[1]!.status).toBe("RINGING");
    expect(h.events).toEqual([{ clinicId: "c1", type: "call.missed" }]);
  });

  it("closes an answered call with no hangup for hours, without a duration", async () => {
    h.rows = [row("talk", { status: "ANSWERED", answeredAt: ago(5 * 60), startedAt: ago(5 * 60) })];
    const out = await closeStaleCalls(NOW);
    expect(out).toEqual({ missed: 0, ended: 1 });
    expect(h.rows[0]).toMatchObject({ status: "ENDED", endedAt: NOW, durationSec: null });
    expect(h.events).toEqual([{ clinicId: "c1", type: "call.ended" }]);
  });

  it("leaves a call that a hangup closed a moment before the write", async () => {
    h.rows = [row("race", { startedAt: ago(30), createdAt: ago(30) })];
    h.closeBeforeWrite = "race";
    const out = await closeStaleCalls(NOW);
    expect(out).toEqual({ missed: 0, ended: 0 });
    expect(h.rows[0]!.status).toBe("ENDED");
    expect(h.events).toEqual([]);
  });

  it("a second pass finds nothing", async () => {
    h.rows = [row("ghost", { startedAt: ago(45), createdAt: ago(45) })];
    await closeStaleCalls(NOW);
    expect(await closeStaleCalls(NOW)).toEqual({ missed: 0, ended: 0 });
  });
});
