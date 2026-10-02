/**
 * Audit AC-26: the board's per-visit ETA read one shared `take: doctors × 30`
 * of completed visits ordered by completion, so a busy doctor took the whole
 * budget and the others fell back to «~30 мин». Acceptance: with 150 fresh
 * visits of doctor A and 20 of doctor B, B's estimate is built from his own
 * 20 visits, not from the fallback.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Visit = {
  doctorId: string;
  status: string;
  date: Date;
  startedAt: Date | null;
  completedAt: Date | null;
};

const db = vi.hoisted(() => ({
  visits: [] as Visit[],
  queries: [] as Array<Record<string, unknown>>,
}));

type FindManyArgs = {
  where: {
    doctorId?: string | { in: string[] };
    status?: string;
    date?: { gte: Date };
  };
  orderBy?: { completedAt: "desc" };
  take?: number;
};

vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findMany: vi.fn(async (args: FindManyArgs) => {
        db.queries.push(args as unknown as Record<string, unknown>);
        const w = args.where;
        const rows = db.visits
          .filter((v) =>
            typeof w.doctorId === "string"
              ? v.doctorId === w.doctorId
              : !w.doctorId || w.doctorId.in.includes(v.doctorId),
          )
          .filter((v) => !w.status || v.status === w.status)
          .filter((v) => !w.date || v.date.getTime() >= w.date.gte.getTime())
          .filter((v) => v.startedAt && v.completedAt)
          .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime());
        return args.take === undefined ? rows : rows.slice(0, args.take);
      }),
    },
  },
}));

import { predictPerVisitMinutes } from "@/server/ai/per-visit-eta";

const NOW = new Date("2026-10-02T09:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** `count` visits of `minutes` each, the latest `agoMs` before now. */
function seed(doctorId: string, count: number, minutes: number, agoMs: number) {
  for (let i = 0; i < count; i++) {
    const completedAt = new Date(NOW.getTime() - agoMs - i * HOUR);
    const v: Visit = {
      doctorId,
      status: "COMPLETED",
      date: new Date(completedAt.getTime() - minutes * MIN),
      startedAt: new Date(completedAt.getTime() - minutes * MIN),
      completedAt,
    };
    db.visits.push(v);
  }
}

beforeEach(() => {
  db.visits = [];
  db.queries = [];
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("predictPerVisitMinutes (audit AC-26)", () => {
  it("builds each doctor's estimate from his own visits, however busy the other is", async () => {
    // A finished 150 visits of 15 min in the last days, all more recent than
    // any of B's 20 visits of 50 min.
    seed("doc_a", 150, 15, HOUR);
    seed("doc_b", 20, 50, 8 * DAY);

    const out = await predictPerVisitMinutes(["doc_a", "doc_b"], 30);

    expect(out.get("doc_a")).toMatchObject({ etaMin: 15, confidence: "high", source: "history" });
    expect(out.get("doc_b")).toMatchObject({
      etaMin: 50,
      sampleSize: 20,
      confidence: "high",
      source: "history",
    });
    // One query per doctor, each capped at his own 30 visits.
    expect(db.queries).toHaveLength(2);
    for (const q of db.queries) expect(q.take).toBe(30);
  });

  it("forgets visits older than the history window and falls back", async () => {
    seed("doc_c", 12, 40, 120 * DAY);
    const out = await predictPerVisitMinutes(["doc_c"], new Map([["doc_c", 25]]));
    expect(out.get("doc_c")).toMatchObject({ etaMin: 25, confidence: "low", source: "fallback" });
  });

  it("answers every requested id, duplicates included, with one query each", async () => {
    seed("doc_a", 5, 20, HOUR);
    const out = await predictPerVisitMinutes(["doc_a", "doc_a", "doc_x"]);
    expect(db.queries).toHaveLength(2);
    expect(out.get("doc_a")?.confidence).toBe("med");
    expect(out.get("doc_x")).toMatchObject({ etaMin: 30, source: "fallback" });
  });
});
