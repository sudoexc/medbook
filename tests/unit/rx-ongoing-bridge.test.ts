/**
 * «Постоянно» (doctor's request 10.10.2026) on the patient's side: the
 * medication bridge and the reminder worker.
 *
 * Pinned:
 *   1. buildBridgeSchedule writes `{days: null, ongoing: true}` for a
 *      lifelong row and the exact old shape (no `ongoing` key) otherwise.
 *   2. planCourseSupersede: the same drug written at a later visit, by a
 *      row that reminds, replaces the earlier visit's ACTIVE course
 *      (COMPLETED, marked); a row without a time of day replaces nothing;
 *      another form, PAUSED, case courses, other drugs and later visits
 *      (by FIRST signature) are left alone; a correction that takes the
 *      drug off the newer note brings the older course back, unless a
 *      visit between them still reminds it. A visit that does not repeat
 *      a lifelong drug never stops it (owner, 10.10.2026); a mark the
 *      removed stop rule wrote is undone by the next pass of its note.
 *   3. The bridge runs that pass in its transaction: a control visit that
 *      writes amlodipine «постоянно» again completes the earlier visit's
 *      amlodipine course instead of adding a second never-ending reminder.
 *      Its own courses keep a newer note's mark through a re-bridge, start
 *      over when the key now holds another drug, are cancelled when their
 *      row is gone, and are written COMPLETED when a newer visit already
 *      reminds the drug.
 *   4. The reminder worker never completes a lifelong course, 400 days on,
 *      and still reminds its dose.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  STOPPED_BY_NOTE_KEY,
  SUPERSEDED_BY_NOTE_KEY,
  isSameDrug,
  ownCourseState,
  planCourseSupersede,
  type DrugIdentity,
  type SupersedeCandidate,
} from "@/server/visit-notes/course-supersede";

const state = vi.hoisted(() => ({
  bridgeNotes: [] as Array<Record<string, unknown>>,
  candidates: [] as Array<Record<string, unknown>>,
  sources: [] as Array<Record<string, unknown>>,
  existing: new Map<number, Record<string, unknown>>(),
  ownCompleted: [] as Array<Record<string, unknown>>,
  updateManys: [] as Array<{ where: unknown; data: Record<string, unknown> }>,
  candidateWheres: [] as unknown[],
  upserts: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ where: { id: string }; data: Record<string, unknown> }>,
  reminderRows: [] as Array<Record<string, unknown>>,
  completedWhere: [] as unknown[],
  doses: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "SYSTEM" as const }),
}));
vi.mock("@/server/queue", () => ({
  getQueue: () => ({ registerWorker: vi.fn(), repeat: vi.fn(() => ({ stop: vi.fn() })) }),
}));
vi.mock("@/server/prescription/cipher-fields", () => ({
  serializePrescriptionForWrite: (x: { notes: string | null }) => x,
  hydratePrescriptionForRead: (x: unknown) => x,
}));
vi.mock("@/server/visit-notes/follow-up-action", () => ({
  syncFollowUpAction: vi.fn(async () => undefined),
}));
vi.mock("@/server/visit-notes/legacy-line-drugs", () => ({
  // The text lines' catalog drugs: «Нормодипин» is amlodipine.
  resolveLineDrugIds: vi.fn(async (lines: string[]) =>
    lines.map((l) => (/нормодипин/i.test(l) ? "amlodipine" : null)),
  ),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async () => undefined),
}));
vi.mock("@/server/notifications/ensure-template", () => ({
  ensureClinicTemplate: vi.fn(async () => ({
    id: "tpl_med",
    bodyRu: "в {{time}} пора принять {{drug.name}}",
    bodyUz: "soat {{time}} da {{drug.name}}",
    channel: "TG",
    isActive: true,
    triggerConfig: null,
  })),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    prescription: {
      findUnique: vi.fn(
        async (args: {
          where: { visitNoteId_visitNoteSortOrder: { visitNoteSortOrder: number } };
        }) =>
          state.existing.get(args.where.visitNoteId_visitNoteSortOrder.visitNoteSortOrder) ??
          null,
      ),
      upsert: vi.fn(async (args: Record<string, unknown>) => {
        state.upserts.push(args);
        return { id: "rx_new", status: "ACTIVE", ...(args.create as object) };
      }),
      updateMany: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        state.updateManys.push(args);
        return { count: 0 };
      }),
      // Two reads: this note's own COMPLETED courses (withdrawal pass, keyed
      // by its id) and the other visits' courses (the supersede candidates).
      findMany: vi.fn(async (args: { where: { visitNoteId?: unknown } }) => {
        if (typeof args.where.visitNoteId === "string") return state.ownCompleted;
        state.candidateWheres.push(args.where);
        return state.candidates;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        state.updates.push(args);
        return {};
      }),
    },
    visitPrescription: {
      findMany: vi.fn(async () => state.sources),
    },
  };
  return {
    prisma: {
      visitNote: { findMany: vi.fn(async () => state.bridgeNotes) },
      clinic: {
        findUnique: vi.fn(async () => ({
          medicationRemindersEnabled: true,
          medicationSlotTimes: null,
        })),
      },
      $transaction: vi.fn(async <T,>(fn: (t: unknown) => Promise<T>) => fn(tx)),
      $executeRaw: vi.fn(async () => 1),
      // The reminder worker reads and completes through the root client.
      prescription: {
        findMany: vi.fn(async () => state.reminderRows),
        updateMany: vi.fn(async (args: { where: unknown }) => {
          state.completedWhere.push(args.where);
          return { count: 0 };
        }),
      },
      medicationReminderSend: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          state.doses.push(data);
          return { id: `d${state.doses.length}`, ...data };
        }),
        update: vi.fn(async () => ({})),
      },
      notificationSend: { create: vi.fn(async ({ data }: { data: unknown }) => data) },
    },
  };
});

beforeEach(() => {
  state.bridgeNotes = [];
  state.candidates = [];
  state.sources = [];
  state.existing = new Map();
  state.ownCompleted = [];
  state.updateManys = [];
  state.candidateWheres = [];
  state.upserts = [];
  state.updates = [];
  state.reminderRows = [];
  state.completedWhere = [];
  state.doses = [];
});

// ── 1. The schedule shape ────────────────────────────────────────────

describe("buildBridgeSchedule: «постоянно»", () => {
  const at = new Date("2026-10-10T05:00:00.000Z");
  const slots = { MORNING: "08:00", NOON: "13:00", EVENING: "19:00", NIGHT: "22:00" };

  it("a lifelong row has no days and says so", async () => {
    const { buildBridgeSchedule } = await import("@/server/workers/visit-note-handout");
    expect(
      buildBridgeSchedule({ timesOfDay: ["MORNING"], durationDays: null, ongoing: true }, slots, at),
    ).toEqual({ times: ["08:00"], days: null, startsAt: at.toISOString(), ongoing: true });
    // Days are dropped even if the row somehow carries both.
    expect(
      buildBridgeSchedule({ timesOfDay: ["MORNING"], durationDays: 30, ongoing: true }, slots, at)
        .days,
    ).toBeNull();
  });

  it("every other row keeps the exact old shape", async () => {
    const { buildBridgeSchedule } = await import("@/server/workers/visit-note-handout");
    const s = buildBridgeSchedule({ timesOfDay: ["EVENING", "MORNING"], durationDays: 10 }, slots, at);
    expect(s).toEqual({ times: ["08:00", "19:00"], days: 10, startsAt: at.toISOString() });
    expect("ongoing" in s).toBe(false);
    expect(
      "ongoing" in
        buildBridgeSchedule({ timesOfDay: [], durationDays: null, ongoing: false }, slots, at),
    ).toBe(false);
  });
});

// ── 2. The supersede plan ────────────────────────────────────────────

describe("planCourseSupersede", () => {
  const NOTE = "note_new";
  const SIGNED = new Date("2026-10-10T05:00:00.000Z");
  const EARLIER = new Date("2026-08-10T05:00:00.000Z");
  const BETWEEN = new Date("2026-09-10T05:00:00.000Z");
  const AMLO: DrugIdentity = { drugId: "amlodipine", displayName: "Амлодипин", form: "TAB" };
  const course = (over: Partial<SupersedeCandidate> = {}): SupersedeCandidate => ({
    id: "rx_old",
    status: "ACTIVE",
    schedule: { times: ["08:00"], days: null, startsAt: EARLIER.toISOString(), ongoing: true },
    drugName: "Амлодипин",
    noteId: "note_old",
    noteDoctorId: "d1",
    noteSignedAt: EARLIER,
    source: { drugId: "amlodipine", displayName: "Амлодипин", form: "TAB" },
    ...over,
  });
  /** Default: the note writes amlodipine with a time of day (it reminds). */
  const plan = (
    candidates: SupersedeCandidate[],
    opts: { replacing?: DrugIdentity[] } = {},
  ) =>
    planCourseSupersede({
      noteId: NOTE,
      signedAt: SIGNED,
      replacing: opts.replacing ?? [AMLO],
      candidates,
    });

  it("the same drug from an earlier visit is completed, and marked", () => {
    const p = plan([course()]);
    expect(p.restore).toEqual([]);
    expect(p.complete).toEqual([
      {
        id: "rx_old",
        schedule: {
          times: ["08:00"],
          days: null,
          startsAt: EARLIER.toISOString(),
          ongoing: true,
          [SUPERSEDED_BY_NOTE_KEY]: NOTE,
        },
      },
    ]);
  });

  it("a row that does not remind (no time of day, «напоминать» off) replaces nothing", () => {
    // The parsed «Амлодипин 5 мг — по 1 таб., постоянно» has no time words:
    // its course never reminds, so the 08:00 course must keep reminding.
    expect(plan([course()], { replacing: [] })).toEqual({
      complete: [],
      restore: [],
    });
  });

  it("by catalog id when both have one, else by the folded name; the same form", () => {
    expect(isSameDrug({ drugId: "a", displayName: "X" }, { drugId: "a", displayName: "Y" })).toBe(true);
    expect(isSameDrug({ drugId: "a", displayName: "X" }, { drugId: "b", displayName: "X" })).toBe(false);
    expect(
      isSameDrug({ drugId: null, displayName: "Амлодипин " }, { drugId: "amlodipine", displayName: "амлодипин" }),
    ).toBe(true);
    // Diclofenac gel at the dermatologist is not the neurologist's tablets.
    expect(
      isSameDrug(
        { drugId: "diclofenac", displayName: "Диклофенак", form: "GEL" },
        { drugId: "diclofenac", displayName: "Диклофенак", form: "TAB" },
      ),
    ).toBe(false);
    expect(
      isSameDrug(
        { drugId: "diclofenac", displayName: "Диклофенак", form: null },
        { drugId: "diclofenac", displayName: "Диклофенак", form: "TAB" },
      ),
    ).toBe(true);
    expect(
      plan([course()], { replacing: [{ ...AMLO, form: "INJ_IM" }] }).complete,
    ).toEqual([]);
    // A manual row of the earlier visit, gone source: the course's own name.
    expect(plan([course({ source: null, drugName: "АМЛОДИПИН" })]).complete).toHaveLength(1);
  });

  it("leaves other drugs, later visits and an unsigned source alone", () => {
    expect(
      plan([course({ source: { drugId: "losartan", displayName: "Лозартан" }, drugName: "Лозартан" })])
        .complete,
    ).toEqual([]);
    expect(plan([course({ noteSignedAt: new Date("2026-10-11T05:00:00.000Z") })]).complete).toEqual([]);
    expect(plan([course({ noteSignedAt: null })]).complete).toEqual([]);
    // Statuses the query never asks for are ignored all the same.
    expect(plan([course({ status: "PAUSED" }), course({ status: "CANCELLED" })])).toEqual({
      complete: [],
      restore: [],
    });
  });

  it("a course this note superseded comes back when the drug is taken off it", () => {
    const marked = course({
      status: "COMPLETED",
      schedule: { times: ["08:00"], days: null, ongoing: true, [SUPERSEDED_BY_NOTE_KEY]: NOTE },
    });
    // Another doctor's course: the stop rule does not touch it.
    const theirs = { ...marked, noteDoctorId: "d2" };
    expect(plan([theirs], { replacing: [] })).toEqual({
      complete: [],
      restore: [{ id: "rx_old", schedule: { times: ["08:00"], days: null, ongoing: true } }],
    });
    // Still named: stays completed. Marked by another note: not ours.
    expect(plan([marked])).toEqual({ complete: [], restore: [] });
    expect(
      plan(
        [course({ status: "COMPLETED", schedule: { times: ["08:00"], [SUPERSEDED_BY_NOTE_KEY]: "other" } })],
        { replacing: [] },
      ),
    ).toEqual({ complete: [], restore: [] });
  });

  it("does not bring a course back while a visit between them still reminds the drug", () => {
    const oldMarked = course({
      status: "COMPLETED",
      noteDoctorId: "d2",
      schedule: { times: ["08:00"], ongoing: true, [SUPERSEDED_BY_NOTE_KEY]: NOTE },
    });
    const between = course({
      id: "rx_between",
      noteId: "note_between",
      noteDoctorId: "d3",
      noteSignedAt: BETWEEN,
      schedule: { times: ["08:00"], ongoing: true },
    });
    // The newer dose of the visit between goes on; the oldest course is
    // marked as replaced by that visit, so it can come back from there.
    expect(plan([oldMarked, between], { replacing: [] })).toEqual({
      complete: [
        {
          id: "rx_old",
          schedule: { times: ["08:00"], ongoing: true, [SUPERSEDED_BY_NOTE_KEY]: "note_between" },
        },
      ],
      restore: [],
    });
    // Both marked by this note: the newer one comes back, the older stays
    // replaced, by it.
    const betweenMarked = {
      ...between,
      status: "COMPLETED",
      schedule: { times: ["08:00"], ongoing: true, [SUPERSEDED_BY_NOTE_KEY]: NOTE },
    };
    expect(plan([oldMarked, betweenMarked], { replacing: [] })).toEqual({
      complete: [
        {
          id: "rx_old",
          schedule: { times: ["08:00"], ongoing: true, [SUPERSEDED_BY_NOTE_KEY]: "note_between" },
        },
      ],
      restore: [{ id: "rx_between", schedule: { times: ["08:00"], ongoing: true } }],
    });
  });

  it("orders visits by the first signature it is given, not by a re-signature", () => {
    // The bridge passes firstFinalizedAt: a re-signed older visit stays older,
    // so it never completes the newer visit's current dose.
    const newer = course({ id: "rx_newer", noteId: "note_thu", noteSignedAt: new Date("2026-10-11T05:00:00.000Z") });
    expect(plan([newer])).toEqual({ complete: [], restore: [] });
  });

  describe("a lifelong course is never stopped because a visit does not repeat it", () => {
    // Owner's decision 10.10.2026: blood pressure and sugar drugs are taken
    // for life; a control visit about something else need not list them.
    const other: DrugIdentity = { drugId: "nimesulide", displayName: "Нимесил", form: "TAB" };

    it("the same doctor, «постоянно», named nowhere: left alone", () => {
      expect(plan([course()], { replacing: [other] })).toEqual({ complete: [], restore: [] });
      expect(plan([course()], { replacing: [] })).toEqual({ complete: [], restore: [] });
    });

    it("a mark the removed stop rule wrote is undone by the next pass of its note", () => {
      const stopped = course({
        status: "COMPLETED",
        schedule: { times: ["08:00"], ongoing: true, [STOPPED_BY_NOTE_KEY]: NOTE },
      });
      expect(plan([stopped], { replacing: [other] })).toEqual({
        complete: [],
        restore: [{ id: "rx_old", schedule: { times: ["08:00"], ongoing: true } }],
      });
      // Written again as a reminding row: replaced by it instead.
      expect(plan([stopped], { replacing: [AMLO] }).complete).toEqual([
        { id: "rx_old", schedule: { times: ["08:00"], ongoing: true, [SUPERSEDED_BY_NOTE_KEY]: NOTE } },
      ]);
    });
  });
});

describe("ownCourseState: this note's own course on a re-bridge", () => {
  const SIGNED = new Date("2026-10-06T05:00:00.000Z");
  const row: DrugIdentity = { drugId: "amlodipine", displayName: "Амлодипин", form: "TAB" };
  const newer: SupersedeCandidate = {
    id: "rx_thu",
    status: "ACTIVE",
    schedule: { times: ["08:00"], ongoing: true },
    drugName: "Амлодипин",
    noteId: "note_thu",
    noteDoctorId: "d1",
    noteSignedAt: new Date("2026-10-09T05:00:00.000Z"),
    source: row,
  };
  const state = (existing: { status: string; schedule: unknown; drugName: string } | null, candidates: SupersedeCandidate[] = []) =>
    ownCourseState({ row, existing, signedAt: SIGNED, candidates });

  it("keeps a newer note's mark and status while it is still the same drug", () => {
    expect(
      state({ status: "COMPLETED", schedule: { times: ["08:00"], [SUPERSEDED_BY_NOTE_KEY]: "note_thu" }, drugName: "Амлодипин" }),
    ).toEqual({ status: undefined, mark: { [SUPERSEDED_BY_NOTE_KEY]: "note_thu" } });
  });

  it("a key that now holds another drug starts it over", () => {
    expect(
      ownCourseState({
        row: { drugId: "losartan", displayName: "Лозартан" },
        existing: { status: "COMPLETED", schedule: { [SUPERSEDED_BY_NOTE_KEY]: "note_thu" }, drugName: "Амлодипин" },
        signedAt: SIGNED,
        candidates: [newer],
      }),
    ).toEqual({ status: "ACTIVE", mark: {} });
  });

  it("a drug a newer visit already reminds is written completed under it", () => {
    const under = { status: "COMPLETED", mark: { [SUPERSEDED_BY_NOTE_KEY]: "note_thu" } };
    expect(state(null, [newer])).toEqual(under);
    expect(state({ status: "CANCELLED", schedule: {}, drugName: "Амлодипин" }, [newer])).toEqual(under);
    expect(state({ status: "ACTIVE", schedule: {}, drugName: "Амлодипин" }, [newer])).toEqual(under);
    // A newer course that does not remind takes nothing over.
    expect(state(null, [{ ...newer, schedule: { times: [] } }])).toEqual({ status: "ACTIVE", mark: {} });
  });

  it("PAUSED and COMPLETED without a mark are left as they are; CANCELLED comes back", () => {
    expect(state({ status: "PAUSED", schedule: {}, drugName: "Амлодипин" })).toEqual({ status: undefined, mark: {} });
    expect(state({ status: "COMPLETED", schedule: {}, drugName: "Амлодипин" })).toEqual({ status: undefined, mark: {} });
    expect(state({ status: "CANCELLED", schedule: {}, drugName: "Амлодипин" })).toEqual({ status: "ACTIVE", mark: {} });
    expect(state({ status: "ACTIVE", schedule: {}, drugName: "Амлодипин" })).toEqual({ status: undefined, mark: {} });
    expect(state(null)).toEqual({ status: "ACTIVE", mark: {} });
  });
});

// ── 3. The bridge runs it ────────────────────────────────────────────

describe("bridge: a control visit's «постоянно» replaces the earlier course", () => {
  const note = (rows: Array<Record<string, unknown>>) => ({
    id: "note_new",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "d1",
    finalizedAt: new Date("2026-10-10T05:00:00.000Z"),
    updatedAt: new Date("2026-10-10T05:00:00.000Z"),
    followUpDays: null,
    followUpDate: null,
    followUpNote: null,
    patient: { fullName: "Каримов Азиз", preferredLang: "RU" },
    doctor: { nameRu: "Врач" },
    visitPrescriptions: rows,
  });
  const AMLO = {
    drugId: "amlodipine",
    displayName: "Амлодипин",
    strength: "5 мг",
    dose: "1 таб.",
    timesOfDay: ["MORNING"],
    durationDays: null,
    ongoing: true,
    instructionRu: null,
    instructionUz: null,
    remindPatient: true,
    sortOrder: 0,
  };

  it("writes the lifelong schedule and completes the older amlodipine course only", async () => {
    const { runMedicationBridgeTick } = await import("@/server/workers/visit-note-handout");
    state.bridgeNotes = [note([AMLO])];
    state.candidates = [
      {
        id: "rx_amlo_old",
        status: "ACTIVE",
        schedule: { times: ["08:00"], days: null, startsAt: "2026-08-10T05:00:00.000Z", ongoing: true },
        drugName: "Амлодипин",
        visitNoteId: "note_old",
        visitNoteSortOrder: 0,
        visitNote: {
          firstFinalizedAt: new Date("2026-08-10T05:00:00.000Z"),
          finalizedAt: new Date("2026-08-10T05:00:00.000Z"),
          doctorId: "d1",
        },
      },
      {
        id: "rx_nimesil_old",
        status: "ACTIVE",
        schedule: { times: ["08:00"], days: 5 },
        drugName: "Нимесил",
        visitNoteId: "note_old",
        visitNoteSortOrder: 1,
        visitNote: {
          firstFinalizedAt: new Date("2026-08-10T05:00:00.000Z"),
          finalizedAt: new Date("2026-08-10T05:00:00.000Z"),
          doctorId: "d1",
        },
      },
    ];
    state.sources = [
      { visitNoteId: "note_old", sortOrder: 0, drugId: "amlodipine", displayName: "Амлодипин" },
      { visitNoteId: "note_old", sortOrder: 1, drugId: "nimesulide", displayName: "Нимесил" },
    ];

    const res = await runMedicationBridgeTick(new Date("2026-10-10T05:00:30.000Z"));
    expect(res).toEqual({ scanned: 1, bridged: 1 });

    const create = state.upserts[0]!.create as { schedule: Record<string, unknown> };
    expect(create.schedule).toEqual({
      times: ["08:00"],
      days: null,
      startsAt: "2026-10-10T05:00:00.000Z",
      ongoing: true,
    });

    // The query asks only for this patient's visit courses, not case ones,
    // not this note's own, ACTIVE or marked by this note.
    expect(state.candidateWheres[0]).toMatchObject({
      clinicId: "c1",
      patientId: "p1",
      caseId: null,
      AND: [{ visitNoteId: { not: null } }, { visitNoteId: { not: "note_new" } }],
    });

    expect(state.updates).toEqual([
      {
        where: { id: "rx_amlo_old" },
        data: {
          status: "COMPLETED",
          schedule: {
            times: ["08:00"],
            days: null,
            startsAt: "2026-08-10T05:00:00.000Z",
            ongoing: true,
            [SUPERSEDED_BY_NOTE_KEY]: "note_new",
          },
        },
      },
    ]);
  });

  it("no course of another visit: nothing else is read or written", async () => {
    const { runMedicationBridgeTick } = await import("@/server/workers/visit-note-handout");
    state.bridgeNotes = [note([AMLO])];
    await runMedicationBridgeTick(new Date("2026-10-10T05:00:30.000Z"));
    expect(state.updates).toEqual([]);
  });

  const OLD_AMLO = (over: Record<string, unknown> = {}) => ({
    id: "rx_amlo_old",
    status: "ACTIVE",
    schedule: { times: ["08:00"], days: null, startsAt: "2026-08-10T05:00:00.000Z", ongoing: true },
    drugName: "Амлодипин",
    visitNoteId: "note_old",
    visitNoteSortOrder: 0,
    visitNote: {
      firstFinalizedAt: new Date("2026-08-10T05:00:00.000Z"),
      finalizedAt: new Date("2026-08-10T05:00:00.000Z"),
      doctorId: "d1",
    },
    ...over,
  });
  const OLD_SOURCE = { visitNoteId: "note_old", sortOrder: 0, drugId: "amlodipine", displayName: "Амлодипин", form: "TAB" };

  it("a new row without a time of day does not complete the old reminding course", async () => {
    const { runMedicationBridgeTick } = await import("@/server/workers/visit-note-handout");
    // Adopted from «Амлодипин 5 мг — по 1 таб., постоянно»: no time words.
    state.bridgeNotes = [note([{ ...AMLO, timesOfDay: [] }])];
    state.candidates = [OLD_AMLO()];
    state.sources = [OLD_SOURCE];
    await runMedicationBridgeTick(new Date("2026-10-10T05:00:30.000Z"));
    expect(state.upserts).toHaveLength(1);
    expect((state.upserts[0]!.create as { remindersEnabled: boolean }).remindersEnabled).toBe(false);
    // Named on the note, so not stopped either: it keeps reminding.
    expect(state.updates).toEqual([]);
  });

  it("an older visit re-signed after a newer one never completes the newer course", async () => {
    const { runMedicationBridgeTick } = await import("@/server/workers/visit-note-handout");
    // Monday's visit, reverted and re-signed on Friday; Thursday's visit
    // wrote the current dose.
    state.bridgeNotes = [
      {
        ...note([AMLO]),
        id: "note_mon",
        firstFinalizedAt: new Date("2026-10-05T05:00:00.000Z"),
        finalizedAt: new Date("2026-10-09T09:00:00.000Z"),
      },
    ];
    state.candidates = [
      OLD_AMLO({
        id: "rx_amlo_thu",
        visitNoteId: "note_thu",
        visitNote: {
          firstFinalizedAt: new Date("2026-10-08T05:00:00.000Z"),
          finalizedAt: new Date("2026-10-08T05:00:00.000Z"),
          doctorId: "d1",
        },
      }),
    ];
    state.sources = [{ ...OLD_SOURCE, visitNoteId: "note_thu" }];
    await runMedicationBridgeTick(new Date("2026-10-09T09:00:30.000Z"));
    expect(state.updates).toEqual([]);
    // Monday's own course is written under Thursday's, not next to it.
    const create = state.upserts[0]!.create as { status: string; schedule: Record<string, unknown> };
    expect(create.status).toBe("COMPLETED");
    expect(create.schedule[SUPERSEDED_BY_NOTE_KEY]).toBe("note_thu");
  });

  it("a re-bridge keeps a newer note's mark on the same drug, and starts another drug over", async () => {
    const { runMedicationBridgeTick } = await import("@/server/workers/visit-note-handout");
    const LOSARTAN = { ...AMLO, drugId: "losartan", displayName: "Лозартан", sortOrder: 1 };
    state.bridgeNotes = [note([AMLO, LOSARTAN])];
    state.existing.set(0, {
      id: "rx_own_0",
      status: "COMPLETED",
      schedule: { times: ["08:00"], ongoing: true, [SUPERSEDED_BY_NOTE_KEY]: "note_later" },
      drugName: "Амлодипин",
    });
    // The editor renumbered rows: key 1 held a superseded amlodipine course
    // of a removed row, and now holds losartan.
    state.existing.set(1, {
      id: "rx_own_1",
      status: "COMPLETED",
      schedule: { times: ["08:00"], [SUPERSEDED_BY_NOTE_KEY]: "note_later" },
      drugName: "Амлодипин",
    });
    await runMedicationBridgeTick(new Date("2026-10-10T05:00:30.000Z"));
    const [same, renamed] = state.upserts as Array<{ update: Record<string, unknown> }>;
    expect(same!.update.status).toBeUndefined();
    expect((same!.update.schedule as Record<string, unknown>)[SUPERSEDED_BY_NOTE_KEY]).toBe("note_later");
    expect(renamed!.update.status).toBe("ACTIVE");
    expect(SUPERSEDED_BY_NOTE_KEY in (renamed!.update.schedule as Record<string, unknown>)).toBe(false);
  });

  it("a marked course whose row is gone is cancelled, so it can never come back", async () => {
    const { runMedicationBridgeTick } = await import("@/server/workers/visit-note-handout");
    state.bridgeNotes = [note([AMLO])];
    state.ownCompleted = [
      { id: "rx_marked", schedule: { times: ["08:00"], [SUPERSEDED_BY_NOTE_KEY]: "note_later" } },
      { id: "rx_finished", schedule: { times: ["08:00"], days: 5 } },
    ];
    await runMedicationBridgeTick(new Date("2026-10-10T05:00:30.000Z"));
    expect(state.updateManys).toContainEqual({
      where: { id: { in: ["rx_marked"] } },
      data: { status: "CANCELLED", remindersEnabled: false },
    });
  });

  it("the same doctor not naming his lifelong drug leaves it reminding", async () => {
    // Owner's decision 10.10.2026: a control visit about something else does
    // not stop a blood pressure drug taken for life.
    const { runMedicationBridgeTick } = await import("@/server/workers/visit-note-handout");
    const NIMESIL = { ...AMLO, drugId: "nimesulide", displayName: "Нимесил", ongoing: false, durationDays: 5 };
    state.bridgeNotes = [note([NIMESIL])];
    state.candidates = [OLD_AMLO()];
    state.sources = [OLD_SOURCE];
    await runMedicationBridgeTick(new Date("2026-10-10T05:00:30.000Z"));
    expect(state.updates).toEqual([]);
  });
});

// ── 4. The reminder worker ───────────────────────────────────────────

describe("reminder worker: a lifelong course 400 days on", () => {
  it("still reminds its dose and is never completed", async () => {
    const { runMedicationReminderTick } = await import("@/server/workers/medication-reminder");
    const startsAt = "2025-09-01T03:00:00.000Z";
    state.reminderRows = [
      {
        id: "rx_amlo",
        clinicId: "c1",
        patientId: "p1",
        drugName: "Амлодипин",
        dosage: "1 таб. (5 мг)",
        schedule: { times: ["08:00"], days: null, startsAt, ongoing: true },
        createdAt: new Date(startsAt),
        patient: {
          fullName: "Каримов Азиз",
          phone: "+998",
          telegramId: "tg_1",
          tgBlockedAt: null,
          preferredChannel: "TG",
          preferredLang: "RU",
          marketingOptOut: false,
          deletedAt: null,
        },
        clinic: {
          id: "c1",
          nameRu: "НейроФакс",
          nameUz: "NeuroFax",
          timezone: "Asia/Tashkent",
          medicationRemindersEnabled: true,
        },
      },
    ];
    const now = new Date("2026-10-10T08:03:00+05:00");
    const res = await runMedicationReminderTick(now);
    expect(res.created).toBe(1);
    expect(state.doses[0]!.scheduledFor).toEqual(new Date("2026-10-10T08:00:00+05:00"));
    expect(res.completed).toBe(0);
    expect(state.completedWhere).toEqual([]);
  });
});
