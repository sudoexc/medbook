/**
 * Audit VW-01: the prescription constructor lost edits.
 *
 * The list is saved replace-all. «Ввёл дозу 200 мг, сразу кликнул „Утро“»
 * sent PATCH1 {dose: 200} and then PATCH2 built from the render snapshot
 * {dose: 100, times: [MORNING]}; the server applied both in order and the
 * dose silently went back to 100. Two chips before the first answer kept
 * only the second; two drugs added in a row kept only the second.
 *
 * The fix: every edit is written into the query cache the moment it is made
 * (before its request leaves), each action is composed on that live row,
 * and an earlier response never overwrites a field a later PATCH still
 * carries. These tests drive the real queue (`enqueueVisitNotePatch`) and
 * the real row helpers against a fake server that answers slowly, which is
 * exactly the acceptance scenario of the card: a 500 ms network, compressed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import {
  enqueueVisitNotePatch,
  foldPatchIntoRow,
  mergePatchResponse,
  visitNoteKey,
  type VisitNoteRow,
  type VisitNotePatch,
  type VisitPrescriptionDraft,
} from "@/app/[locale]/doctor/reception/_hooks/use-visit-note";
import {
  toggleTimeOfDay,
  toPrescriptionDrafts,
  withRowEdited,
  withRowRemoved,
} from "@/app/[locale]/doctor/reception/_hooks/prescription-rows";

const LATENCY_MS = 25;

function draft(
  displayName: string,
  over: Partial<VisitPrescriptionDraft> = {},
): VisitPrescriptionDraft {
  return {
    drugId: null,
    displayName,
    form: null,
    strength: null,
    dose: "100 мг",
    timesOfDay: [],
    mealRelation: "NO_MATTER",
    durationDays: null,
    instructionRu: null,
    instructionUz: null,
    remindPatient: true,
    ...over,
  };
}

function baseNote(id: string, rows: VisitPrescriptionDraft[]): VisitNoteRow {
  return {
    id,
    clinicId: "c1",
    appointmentId: "apt_1",
    patientId: "p1",
    doctorId: "doc_1",
    status: "DRAFT",
    startedAt: null,
    finalizedAt: null,
    firstFinalizedAt: null,
    documentNumber: null,
    complaints: [],
    anamnesis: [],
    examination: [],
    prescriptions: [],
    advice: [],
    diagnosisCode: null,
    diagnosisName: null,
    bodyMarkdown: null,
    patientHandoutMarkdown: null,
    followUpDays: null,
    followUpNote: null,
    dynamics: null,
    dynamicsNote: null,
    bodyMap: null,
    aiGenerated: false,
    aiModel: null,
    aiTokens: null,
    createdAt: "2026-09-25T08:00:00.000Z",
    updatedAt: "2026-09-25T08:00:00.000Z",
    visitPrescriptions: rows.map((r, i) => ({
      ...r,
      id: `vp_${i}`,
      sortOrder: i,
    })),
    patient: { id: "p1", fullName: "Тест Пациент" },
  };
}

/** A server that applies PATCHes in arrival order, slowly, with the lock. */
function fakeServer(initial: VisitNoteRow) {
  const server = {
    row: structuredClone(initial) as VisitNoteRow,
    version: 0,
    received: [] as VisitNotePatch[],
  };
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as VisitNotePatch & {
      expectedUpdatedAt?: string;
    };
    const { expectedUpdatedAt, ...patch } = body;
    server.received.push(patch);
    await new Promise((r) => setTimeout(r, LATENCY_MS));
    if (expectedUpdatedAt && expectedUpdatedAt !== server.row.updatedAt) {
      return new Response(JSON.stringify({ reason: "version_conflict" }), {
        status: 409,
      });
    }
    server.version += 1;
    const next: VisitNoteRow = {
      ...server.row,
      ...patch,
      updatedAt: new Date(Date.parse(initial.updatedAt) + server.version * 1000).toISOString(),
    } as VisitNoteRow;
    if (patch.visitPrescriptions) {
      next.visitPrescriptions = patch.visitPrescriptions.map((r, i) => ({
        ...r,
        id: `srv_${server.version}_${i}`,
        sortOrder: i,
      }));
    }
    server.row = next;
    // The PATCH response omits the GET includes, like the real route.
    const { patient: _patient, ...response } = next;
    return new Response(JSON.stringify(response), { status: 200 });
  });
  return { server, fetchMock };
}

let qc: QueryClient;
let seq = 0;

beforeEach(() => {
  qc = new QueryClient();
  seq += 1;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function setup(rows: VisitPrescriptionDraft[]) {
  const noteId = `vn_${seq}`;
  const note = baseNote(noteId, rows);
  qc.setQueryData(visitNoteKey(noteId), note);
  const { server, fetchMock } = fakeServer(note);
  vi.stubGlobal("fetch", fetchMock);
  /** What the constructor does on every action: read the live row, edit, send. */
  const act = (
    build: (cur: VisitPrescriptionDraft[]) => VisitPrescriptionDraft[] | null,
  ) => {
    const live = qc.getQueryData<VisitNoteRow>(visitNoteKey(noteId))!;
    const next = build(toPrescriptionDrafts(live.visitPrescriptions ?? []));
    return next
      ? enqueueVisitNotePatch(qc, noteId, { visitPrescriptions: next })
      : Promise.resolve(null);
  };
  const cached = () => qc.getQueryData<VisitNoteRow>(visitNoteKey(noteId))!;
  return { noteId, server, act, cached };
}

describe("VW-01: quick edits in the prescription constructor all land", () => {
  it("dose change + two time chips before any answer: new dose AND both times", async () => {
    const { server, act, cached } = setup([draft("Карбамазепин")]);

    const pending = [
      act((cur) => withRowEdited(cur, 0, { dose: "200 мг" })),
      act((cur) =>
        withRowEdited(cur, 0, (row) => ({
          timesOfDay: toggleTimeOfDay(row.timesOfDay, "MORNING"),
        })),
      ),
      act((cur) =>
        withRowEdited(cur, 0, (row) => ({
          timesOfDay: toggleTimeOfDay(row.timesOfDay, "EVENING"),
        })),
      ),
    ];

    // The doctor sees every edit at once, before any response.
    expect(cached().visitPrescriptions?.[0].dose).toBe("200 мг");
    expect(cached().visitPrescriptions?.[0].timesOfDay).toEqual([
      "MORNING",
      "EVENING",
    ]);

    await Promise.all(pending);

    // What the database holds: the new dose and both times.
    const saved = server.row.visitPrescriptions![0];
    expect(saved.dose).toBe("200 мг");
    expect(saved.timesOfDay).toEqual(["MORNING", "EVENING"]);
    // Every request carried the whole, current row: none reverted the dose.
    for (const p of server.received) {
      expect(p.visitPrescriptions?.[0].dose).toBe("200 мг");
    }
    expect(cached().visitPrescriptions?.[0]).toMatchObject({
      dose: "200 мг",
      timesOfDay: ["MORNING", "EVENING"],
    });
  });

  it("an earlier answer does not blink a pending edit off (and a new action in that gap keeps it)", async () => {
    const { server, act, cached } = setup([draft("Карбамазепин")]);

    const first = act((cur) =>
      withRowEdited(cur, 0, (row) => ({
        timesOfDay: toggleTimeOfDay(row.timesOfDay, "MORNING"),
      })),
    );
    const second = act((cur) =>
      withRowEdited(cur, 0, (row) => ({
        timesOfDay: toggleTimeOfDay(row.timesOfDay, "EVENING"),
      })),
    );

    await first;
    // The first answer says [MORNING] only; the cache must keep EVENING,
    // which the second (still pending) PATCH is carrying.
    expect(cached().visitPrescriptions?.[0].timesOfDay).toEqual([
      "MORNING",
      "EVENING",
    ]);
    // An action taken right now composes on the live row, not on the answer.
    const third = act((cur) =>
      withRowEdited(cur, 0, (row) => ({
        timesOfDay: toggleTimeOfDay(row.timesOfDay, "NIGHT"),
      })),
    );
    await Promise.all([second, third]);

    expect(server.row.visitPrescriptions![0].timesOfDay).toEqual([
      "MORNING",
      "EVENING",
      "NIGHT",
    ]);
  });

  it("two drugs added in a row are both on the visit", async () => {
    const { server, act } = setup([]);

    await Promise.all([
      act((cur) => [...cur, draft("Конкор", { dose: "5 мг" })]),
      act((cur) => [...cur, draft("Мидокалм", { dose: "150 мг" })]),
    ]);

    expect(server.row.visitPrescriptions!.map((r) => r.displayName)).toEqual([
      "Конкор",
      "Мидокалм",
    ]);
  });

  it("remove then edit the next row: the removal sticks", async () => {
    const { server, act } = setup([draft("A"), draft("B")]);

    await Promise.all([
      act((cur) => withRowRemoved(cur, 0)),
      act((cur) => withRowEdited(cur, 0, { dose: "2 таб" })),
    ]);

    expect(server.row.visitPrescriptions).toHaveLength(1);
    expect(server.row.visitPrescriptions![0]).toMatchObject({
      displayName: "B",
      dose: "2 таб",
    });
  });

  it("the last answer lands server truth (real ids) once nothing is pending", async () => {
    const { act, cached } = setup([draft("A")]);
    await act((cur) => withRowEdited(cur, 0, { dose: "3 мг" }));
    expect(cached().visitPrescriptions?.[0].id).toMatch(/^srv_/);
    // The GET include the PATCH response omits survives the merge.
    expect(cached().patient?.fullName).toBe("Тест Пациент");
  });
});

describe("VW-01: pure pieces", () => {
  it("toggleTimeOfDay keeps the morning → night order", () => {
    expect(toggleTimeOfDay(["EVENING"], "MORNING")).toEqual([
      "MORNING",
      "EVENING",
    ]);
    expect(toggleTimeOfDay(["MORNING", "EVENING"], "MORNING")).toEqual([
      "EVENING",
    ]);
  });

  it("withRowEdited applies a function edit to the row's live state", () => {
    const rows = [draft("A", { timesOfDay: ["NOON"] })];
    const next = withRowEdited(rows, 0, (row) => ({
      timesOfDay: toggleTimeOfDay(row.timesOfDay, "NIGHT"),
    }));
    expect(next?.[0].timesOfDay).toEqual(["NOON", "NIGHT"]);
    expect(rows[0].timesOfDay).toEqual(["NOON"]); // input untouched
    expect(withRowEdited(rows, 5, { dose: "x" })).toBeNull();
  });

  it("foldPatchIntoRow writes the replace-all fields and leaves the rest", () => {
    const note = baseNote("vn_fold", [draft("A")]);
    const folded = foldPatchIntoRow(note, {
      visitPrescriptions: [draft("A", { dose: "9 мг" }), draft("B")],
      advice: ["Сон 8 часов"],
    });
    expect(folded.visitPrescriptions?.map((r) => [r.id, r.dose])).toEqual([
      ["vp_0", "9 мг"],
      ["optimistic-1", "100 мг"],
    ]);
    expect(folded.advice).toEqual(["Сон 8 часов"]);
    expect(folded.updatedAt).toBe(note.updatedAt);
  });

  it("mergePatchResponse keeps pending fields but always takes the new version token", () => {
    const prev = baseNote("vn_merge", [draft("A", { dose: "new" })]);
    const response = {
      ...baseNote("vn_merge", [draft("A", { dose: "old" })]),
      updatedAt: "2026-09-25T09:00:00.000Z",
      patient: undefined,
    };
    const merged = mergePatchResponse(
      prev,
      response,
      new Set(["visitPrescriptions"]),
    );
    expect(merged.visitPrescriptions?.[0].dose).toBe("new");
    expect(merged.updatedAt).toBe("2026-09-25T09:00:00.000Z");
  });
});
