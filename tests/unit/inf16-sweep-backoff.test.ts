/**
 * Audit INF-16: the conclusion, medication-bridge and referral sweeps took
 * the 25 oldest unfinished rows per tick with no attempt counter. Rows whose
 * render always threw stayed at the head of that order forever, so 25 of them
 * silently stopped every new patient document; the only trace was a console
 * line.
 *
 * Pinned here:
 *   - SweepBackoff: doubling delay with a cap, reset on a new row version,
 *     forgotten after a day;
 *   - a failed note leaves the next query (`id notIn`), so 30 broken notes
 *     hold a healthy one back for one tick at most;
 *   - the fifth failure in a row logs loudly;
 *   - /api/health's workers check turns degraded on a patient document still
 *     missing 30 minutes after it became due, and ignores blank handouts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  notes: [] as Array<Record<string, unknown>>,
  referrals: [] as Array<Record<string, unknown>>,
  rendered: [] as string[],
  findManyWheres: [] as Array<Record<string, unknown>>,
  health: {
    firstRenders: [] as Array<Record<string, unknown>>,
    stale: null as Record<string, unknown> | null,
    unbridged: null as Record<string, unknown> | null,
    referral: null as Record<string, unknown> | null,
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
}));
vi.mock("@/server/clinical-forms/numbering", () => ({ newVerifyToken: () => "tok" }));
vi.mock("@/server/queue", () => ({
  getQueue: () => ({ registerWorker: vi.fn(), repeat: vi.fn(() => ({ stop: vi.fn() })) }),
}));
vi.mock("@/server/storage/minio", () => ({
  uploadObject: vi.fn(async (_b: unknown, key: string) => ({ url: `u/${key}`, key })),
}));
vi.mock("@/server/visit-notes/conclusion-pdf", () => ({
  renderConclusionPdf: vi.fn(async (input: { documentNumber: string }) => {
    if (input.documentNumber.startsWith("BAD")) throw new Error("glyph missing");
    state.rendered.push(input.documentNumber);
    return Buffer.from("pdf");
  }),
}));
vi.mock("@/server/referrals/referral-pdf", () => ({
  renderReferralPdf: vi.fn(async (input: { reason: string }) => {
    if (input.reason === "BAD") throw new Error("render failed");
    state.rendered.push(`ref:${input.reason}`);
    return Buffer.from("pdf");
  }),
}));
vi.mock("@/server/prescription/cipher-fields", () => ({
  serializePrescriptionForWrite: (x: unknown) => x,
}));
vi.mock("@/server/visit-notes/follow-up-action", () => ({
  syncFollowUpAction: vi.fn(async () => undefined),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => undefined),
}));

function sweep<T extends Record<string, unknown>>(
  pool: T[],
  where: Row,
  orderKey: string,
): T[] {
  const notIn = ((where.id as { notIn?: string[] } | undefined)?.notIn ?? []) as string[];
  return pool
    .filter((r) => !notIn.includes(r.id as string))
    .sort((a, b) => (a[orderKey] as Date).getTime() - (b[orderKey] as Date).getTime())
    .slice(0, 25);
}

vi.mock("@/lib/prisma", () => {
  const tx = {
    document: { upsert: vi.fn(async () => ({ id: "doc" })) },
    $executeRaw: vi.fn(async () => 1),
  };
  return {
    prisma: {
      visitNote: {
        findMany: vi.fn(async (args: { where: Row; take?: number }) => {
          // The health probe's first-render query asks for 10 rows.
          if (args.take === 10) return state.health.firstRenders;
          state.findManyWheres.push(args.where);
          return sweep(state.notes, args.where, "finalizedAt");
        }),
        findFirst: vi.fn(async (args: { where: Row }) =>
          "handoutStaleAt" in args.where ? state.health.stale : state.health.unbridged,
        ),
      },
      referral: {
        findMany: vi.fn(async (args: { where: Row }) =>
          sweep(state.referrals, args.where, "createdAt"),
        ),
        findFirst: vi.fn(async () => state.health.referral),
      },
      eventOutbox: { findFirst: vi.fn(async () => null), count: vi.fn(async () => 0) },
      notificationSend: { findFirst: vi.fn(async () => null) },
      clinic: { findUnique: vi.fn(async () => null) },
      document: { findUnique: vi.fn(async () => null), upsert: tx.document.upsert },
      $executeRaw: tx.$executeRaw,
      $transaction: vi.fn(async <T,>(fn: (t: unknown) => Promise<T>) => fn(tx)),
    },
  };
});

import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  SweepBackoff,
} from "@/server/workers/sweep-backoff";
import {
  __resetSweepBackoffForTests as resetHandout,
  runVisitNoteHandoutTick,
} from "@/server/workers/visit-note-handout";
import {
  __resetSweepBackoffForTests as resetReferral,
  runReferralDocumentTick,
} from "@/server/workers/referral-document";
import {
  DOCUMENT_UNDELIVERED_MAX_SEC,
  readBacklog,
  workersVerdict,
} from "@/server/observability/worker-health";

const T0 = new Date("2026-10-02T09:00:00.000Z");
const at = (ms: number) => new Date(T0.getTime() + ms);

function note(id: string, documentNumber: string, finalizedAt: Date): Row {
  return {
    id,
    clinicId: "c1",
    patientId: `p_${id}`,
    appointmentId: null,
    status: "FINALIZED",
    patientHandoutMarkdown: "# Памятка",
    documentNumber,
    finalizedAt,
    followUpDays: null,
    followUpDate: null,
    handoutStaleAt: null,
    updatedAt: finalizedAt,
    revisions: [],
    amendments: [],
    patient: { fullName: "Пациент", preferredLang: "RU" },
    doctor: null,
    appointment: null,
    visitPrescriptions: [],
  };
}

const spyOnErrors = () => vi.spyOn(console, "error").mockImplementation(() => {});
let errorSpy: ReturnType<typeof spyOnErrors>;
beforeEach(() => {
  state.notes = [];
  state.referrals = [];
  state.rendered = [];
  state.findManyWheres = [];
  state.health = { firstRenders: [], stale: null, unbridged: null, referral: null };
  resetHandout();
  resetReferral();
  errorSpy = spyOnErrors();
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("SweepBackoff", () => {
  it("doubles the delay per failure and caps it at an hour", () => {
    const b = new SweepBackoff();
    expect(b.fail("n1", "v", 0)).toBe(1);
    expect(b.waiting(BACKOFF_BASE_MS - 1)).toEqual(["n1"]);
    expect(b.waiting(BACKOFF_BASE_MS)).toEqual([]);
    expect(b.fail("n1", "v", 0)).toBe(2);
    expect(b.waiting(2 * BACKOFF_BASE_MS - 1)).toEqual(["n1"]);
    for (let i = 0; i < 10; i += 1) b.fail("n1", "v", 0);
    expect(b.waiting(BACKOFF_MAX_MS - 1)).toEqual(["n1"]);
    expect(b.waiting(BACKOFF_MAX_MS)).toEqual([]);
  });

  it("an edited row starts over, a success forgets it, a day of silence too", () => {
    const b = new SweepBackoff();
    b.fail("n1", "v1", 0);
    b.fail("n1", "v1", 0);
    expect(b.fail("n1", "v2", 0)).toBe(1);
    b.succeed("n1");
    expect(b.waiting(0)).toEqual([]);
    b.fail("n2", "v", 0);
    b.waiting(24 * 60 * 60_000 + 1);
    expect(b.fail("n2", "v", 24 * 60 * 60_000 + 2)).toBe(1);
  });

  it("park sets a row aside for the longest delay without counting a failure", () => {
    const b = new SweepBackoff();
    b.park("n1", "v", 0);
    expect(b.waiting(BACKOFF_MAX_MS - 1)).toEqual(["n1"]);
    expect(b.fail("n1", "v", 0)).toBe(1);
  });
});

describe("conclusion sweep with broken notes", () => {
  it("30 always-failing notes cannot starve a healthy one", async () => {
    for (let i = 0; i < 30; i += 1) {
      state.notes.push(note(`bad${i}`, `BAD-${i}`, at(-3_600_000 + i * 1000)));
    }
    state.notes.push(note("good", "NF-1", at(-1000)));

    const first = await runVisitNoteHandoutTick(T0);
    expect(first).toEqual({ scanned: 25, generated: 0 });
    expect(state.findManyWheres[0]!.id).toBeUndefined();

    // Next tick: the 25 failed notes are left out of the query.
    const second = await runVisitNoteHandoutTick(at(30_000));
    expect((state.findManyWheres[1]!.id as { notIn: string[] }).notIn).toHaveLength(25);
    expect(second.generated).toBe(1);
    expect(state.rendered).toEqual(["NF-1"]);
  });

  it("the fifth failure in a row is logged loudly", async () => {
    state.notes.push(note("bad", "BAD-1", at(-60_000)));
    // 1, 2, 4 and 8 minute delays between the five attempts.
    for (const ms of [0, 60_000, 180_000, 420_000, 900_000]) {
      await runVisitNoteHandoutTick(at(ms));
    }
    const lines: string[] = errorSpy.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(lines.filter((l) => l.includes("note bad failed"))).toHaveLength(5);
    expect(lines[4]).toMatch(/failed 5 times in a row/);
  });

  it("a blank first render is set aside instead of holding a slot every tick", async () => {
    state.notes.push({ ...note("blank", "NF-2", at(-60_000)), patientHandoutMarkdown: "  " });
    await runVisitNoteHandoutTick(T0);
    await runVisitNoteHandoutTick(at(30_000));
    expect((state.findManyWheres[1]!.id as { notIn: string[] }).notIn).toEqual(["blank"]);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("referral sweep with a broken referral", () => {
  it("leaves the failed referral out of the next query", async () => {
    const ref = (id: string, reason: string, createdAt: Date) => ({
      id,
      clinicId: "c1",
      patientId: "p1",
      toDoctorId: null,
      externalTo: "МРТ центр",
      reason,
      diagnosisCode: null,
      diagnosisName: null,
      createdAt,
      patient: { fullName: "Пациент", preferredLang: "RU" },
      fromDoctor: { name: "Врач", doctor: null },
      toDoctor: null,
    });
    state.referrals = [ref("r_bad", "BAD", at(-60_000)), ref("r_ok", "ok", at(-1000))];
    expect(await runReferralDocumentTick(T0)).toEqual({ scanned: 2, generated: 1 });
    state.referrals = state.referrals.filter((r) => r.id !== "r_ok");
    expect(await runReferralDocumentTick(at(30_000))).toEqual({ scanned: 0, generated: 0 });
    expect(await runReferralDocumentTick(at(BACKOFF_BASE_MS))).toEqual({
      scanned: 1,
      generated: 0,
    });
  });
});

describe("/api/health sees undelivered patient documents", () => {
  const NOW = at(0);
  const clean = { oldestPendingSec: null, dead24h: 0, oldestOverdueSec: null };
  const fresh = { process: JSON.stringify({ at: NOW.getTime() - 5_000, everyMs: 30_000 }) };

  it("the verdict turns degraded on an undelivered document", () => {
    expect(workersVerdict(fresh, { ...clean, oldestUndeliveredSec: null }, NOW.getTime()).status).toBe("ok");
    const v = workersVerdict(fresh, { ...clean, oldestUndeliveredSec: 3600 }, NOW.getTime());
    expect(v.status).toBe("degraded");
    expect(v.documents).toEqual({ oldestUndeliveredSec: 3600 });
  });

  it("readBacklog reports the oldest due document and skips blank handouts", async () => {
    state.health.firstRenders = [
      { status: "FINALIZED", patientHandoutMarkdown: "   ", finalizedAt: at(-5 * 3_600_000) },
      { status: "FINALIZED", patientHandoutMarkdown: "# ok", finalizedAt: at(-2 * 3_600_000) },
    ];
    state.health.referral = { createdAt: at(-3_600_000) };
    const b = await readBacklog(NOW);
    expect(b.oldestUndeliveredSec).toBe(2 * 3600);
  });

  it("nothing due: null, and the stale and bridge arms count too", async () => {
    expect((await readBacklog(NOW)).oldestUndeliveredSec).toBeNull();
    state.health.unbridged = { updatedAt: at(-(DOCUMENT_UNDELIVERED_MAX_SEC + 60) * 1000) };
    expect((await readBacklog(NOW)).oldestUndeliveredSec).toBe(DOCUMENT_UNDELIVERED_MAX_SEC + 60);
    state.health.stale = { handoutStaleAt: at(-4 * 3_600_000) };
    expect((await readBacklog(NOW)).oldestUndeliveredSec).toBe(4 * 3600);
  });
});
