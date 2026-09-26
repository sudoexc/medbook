/**
 * Review of DC-01 + VW-01: «Подписать» on the conclusion card overtook the
 * doctor's last corrections.
 *
 * A draft of a completed visit, a slow link. The doctor changes a dose
 * (PATCH1 leaves), clicks a time chip (PATCH2 waits in the per-note queue
 * for PATCH1's answer) and clicks «Подписать». The finalize POST does not go
 * through the queue, so it reached the server before PATCH2: the SIGNED
 * revision had no chip, and PATCH2 then carried a pre-signature version
 * token and was refused with 409. The empty-sections check read the
 * optimistic cache, so a drug whose save was about to fail counted as
 * prescribed.
 *
 * The fix: the card signs through `prepareVisitNoteSignature`, which waits
 * for the queue (`settleVisitNotePatches`), refuses to go on if a queued
 * correction did not land, and runs the check on the row read back from the
 * server. These tests drive the real queue against a slow fake server that
 * applies requests in arrival order with the optimistic lock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import {
  enqueueVisitNotePatch,
  prepareVisitNoteSignature,
  settleVisitNotePatches,
  signVisitNoteWhenSaved,
  visitNoteKey,
  type VisitNotePatch,
  type VisitNoteRow,
  type VisitPrescriptionDraft,
} from "@/app/[locale]/doctor/reception/_hooks/use-visit-note";
import {
  toggleTimeOfDay,
  toPrescriptionDrafts,
  withRowEdited,
} from "@/app/[locale]/doctor/reception/_hooks/prescription-rows";

const LATENCY_MS = 30;

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

function baseNote(
  id: string,
  rows: VisitPrescriptionDraft[],
  over: Partial<VisitNoteRow> = {},
): VisitNoteRow {
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
    diagnosisCode: "G43.0",
    diagnosisName: "Мигрень без ауры",
    bodyMarkdown: "Заключение",
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
    ...over,
  };
}

type LogEntry = { kind: "PATCH" | "GET" | "FINALIZE"; status: number };

/**
 * PATCH, GET and finalize of one note, each applied after LATENCY_MS in
 * arrival order. `failNextPatch` makes the next PATCH answer 500.
 */
function fakeServer(initial: VisitNoteRow) {
  const server = {
    row: structuredClone(initial) as VisitNoteRow,
    version: 0,
    log: [] as LogEntry[],
    signed: null as VisitNoteRow | null,
    failNextPatch: false,
  };
  const bump = () => {
    server.version += 1;
    return new Date(
      Date.parse(initial.updatedAt) + server.version * 1000,
    ).toISOString();
  };
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    await new Promise((r) => setTimeout(r, LATENCY_MS));

    if (method === "GET") {
      server.log.push({ kind: "GET", status: 200 });
      return new Response(JSON.stringify(server.row), { status: 200 });
    }

    if (url.endsWith("/finalize")) {
      server.row = { ...server.row, status: "FINALIZED", updatedAt: bump() };
      server.signed = structuredClone(server.row);
      server.log.push({ kind: "FINALIZE", status: 200 });
      return new Response(
        JSON.stringify({
          note: server.row,
          appointment: { id: "apt_1", status: "COMPLETED" },
        }),
        { status: 200 },
      );
    }

    const body = JSON.parse(String(init?.body)) as VisitNotePatch & {
      expectedUpdatedAt?: string;
    };
    const { expectedUpdatedAt, ...patch } = body;
    if (server.failNextPatch) {
      server.failNextPatch = false;
      server.log.push({ kind: "PATCH", status: 500 });
      return new Response("", { status: 500 });
    }
    if (expectedUpdatedAt && expectedUpdatedAt !== server.row.updatedAt) {
      server.log.push({ kind: "PATCH", status: 409 });
      return new Response(JSON.stringify({ reason: "version_conflict" }), {
        status: 409,
      });
    }
    const next: VisitNoteRow = {
      ...server.row,
      ...patch,
      updatedAt: bump(),
    } as VisitNoteRow;
    if (patch.visitPrescriptions) {
      next.visitPrescriptions = patch.visitPrescriptions.map((r, i) => ({
        ...r,
        id: `srv_${server.version}_${i}`,
        sortOrder: i,
      }));
    }
    server.row = next;
    server.log.push({ kind: "PATCH", status: 200 });
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

function setup(rows: VisitPrescriptionDraft[], over: Partial<VisitNoteRow> = {}) {
  const noteId = `vn_sign_${seq}`;
  const note = baseNote(noteId, rows, over);
  qc.setQueryData(visitNoteKey(noteId), note);
  const { server, fetchMock } = fakeServer(note);
  vi.stubGlobal("fetch", fetchMock);

  /** One constructor action: compose on the live cache row, then queue. */
  const act = (
    build: (cur: VisitPrescriptionDraft[]) => VisitPrescriptionDraft[] | null,
  ) => {
    const live = qc.getQueryData<VisitNoteRow>(visitNoteKey(noteId))!;
    const next = build(toPrescriptionDrafts(live.visitPrescriptions ?? []));
    // The card's own onError handles a rejection; the test reads the log.
    return next
      ? enqueueVisitNotePatch(qc, noteId, { visitPrescriptions: next }).catch(
          () => null,
        )
      : Promise.resolve(null);
  };

  /** The card's refetch: what the server holds right now. */
  const readSavedRow = vi.fn(async () => {
    const res = await fetch(`/api/crm/visit-notes/${noteId}`);
    return (await res.json()) as VisitNoteRow;
  });

  const finalize = () =>
    fetch(`/api/crm/visit-notes/${noteId}/finalize`, { method: "POST" });

  const cached = () => qc.getQueryData<VisitNoteRow>(visitNoteKey(noteId))!;

  return { noteId, server, act, readSavedRow, finalize, cached };
}

/** Dose change, then a time chip before the first answer. */
function doseThenChip(act: ReturnType<typeof setup>["act"]) {
  return [
    act((cur) => withRowEdited(cur, 0, { dose: "200 мг" })),
    act((cur) =>
      withRowEdited(cur, 0, (row) => ({
        timesOfDay: toggleTimeOfDay(row.timesOfDay, "MORNING"),
      })),
    ),
  ];
}

describe("review of DC-01: «Подписать» waits for the queued corrections", () => {
  it("control: a finalize sent straight away overtakes the queued chip (the reported race)", async () => {
    const { server, act, finalize } = setup([draft("Карбамазепин")]);

    const pending = doseThenChip(act);
    // «Подписать» a moment later, the old way: straight to the server.
    await new Promise((r) => setTimeout(r, 10));
    await Promise.all([finalize(), ...pending]);

    expect(server.log.map((e) => `${e.kind} ${e.status}`)).toEqual([
      "PATCH 200",
      "FINALIZE 200",
      "PATCH 409",
    ]);
    expect(server.signed?.visitPrescriptions?.[0].timesOfDay).toEqual([]);
  });

  it("signs only after every queued correction answered: dose and chip are in the signed row, no 409", async () => {
    const { noteId, server, act, readSavedRow, finalize } = setup([
      draft("Карбамазепин"),
    ]);

    const pending = doseThenChip(act);
    await new Promise((r) => setTimeout(r, 10));

    // What the card's sign() does.
    const ready = await prepareVisitNoteSignature(noteId, readSavedRow);
    expect(ready.kind).toBe("ready");
    if (ready.kind !== "ready") return;
    expect(ready.missing).toEqual([]);
    await finalize();
    await Promise.all(pending);

    expect(server.log.map((e) => `${e.kind} ${e.status}`)).toEqual([
      "PATCH 200",
      "PATCH 200",
      "GET 200",
      "FINALIZE 200",
    ]);
    expect(server.signed?.visitPrescriptions?.[0]).toMatchObject({
      dose: "200 мг",
      timesOfDay: ["MORNING"],
    });
  });

  it("the empty-sections check runs on the saved row: a drug whose save failed does not count", async () => {
    const { noteId, server, act, readSavedRow, cached } = setup([]);

    server.failNextPatch = true;
    const pending = act((cur) => [...cur, draft("Конкор", { dose: "5 мг" })]);
    // The screen (and the old check) already see the drug.
    expect(cached().visitPrescriptions).toHaveLength(1);

    const ready = await prepareVisitNoteSignature(noteId, readSavedRow);
    await pending;

    expect(ready).toEqual({ kind: "unsaved" });
    expect(readSavedRow).not.toHaveBeenCalled();
    expect(server.log.some((e) => e.kind === "FINALIZE")).toBe(false);
  });

  it("the check reads the server row after the queue drained, not the optimistic cache", async () => {
    const { noteId, server, act, readSavedRow } = setup([], {
      diagnosisCode: null,
      diagnosisName: null,
    });

    const pending = act((cur) => [...cur, draft("Конкор", { dose: "5 мг" })]);
    const ready = await prepareVisitNoteSignature(noteId, readSavedRow);
    await pending;

    expect(server.log.map((e) => e.kind)).toEqual(["PATCH", "GET"]);
    expect(ready.kind).toBe("ready");
    if (ready.kind !== "ready") return;
    expect(ready.row.visitPrescriptions?.[0].id).toMatch(/^srv_/);
    // The drug is saved, the diagnosis really is empty.
    expect(ready.missing).toEqual(["diagnosis"]);
  });
});

describe("settleVisitNotePatches", () => {
  it("an idle note resolves true at once", async () => {
    expect(await settleVisitNotePatches("vn_never_patched")).toBe(true);
  });

  it("reports a failure among the PATCHes it waited for", async () => {
    const { noteId, server, act } = setup([draft("A")]);
    server.failNextPatch = true;
    const pending = act((cur) => withRowEdited(cur, 0, { dose: "2 мг" }));
    expect(await settleVisitNotePatches(noteId)).toBe(false);
    await pending;
  });

  it("an older failure that settled before the call does not block a later signature", async () => {
    const { noteId, server, act } = setup([draft("A")]);
    server.failNextPatch = true;
    await act((cur) => withRowEdited(cur, 0, { dose: "2 мг" }));
    expect(await settleVisitNotePatches(noteId)).toBe(true);

    const next = act((cur) => withRowEdited(cur, 0, { dose: "3 мг" }));
    expect(await settleVisitNotePatches(noteId)).toBe(true);
    await next;
    expect(server.row.visitPrescriptions?.[0].dose).toBe("3 мг");
  });
});

/**
 * Audit VW-04: the visit screen's «Завершить приём» (visit-action-bar)
 * flushed only the conclusion text and then sent finalize straight past the
 * PATCH queue. It now signs through `signVisitNoteWhenSaved`: text flush
 * (which joins the queue), drain, read back, and only then finalize.
 */
describe("VW-04: «Завершить приём» on the visit screen waits for the queued saves", () => {
  const noFlush = async () => undefined;

  it("a drug picked just before the click is in the signed row: finalize goes after the PATCH, no 409", async () => {
    const { noteId, server, act, readSavedRow, finalize } = setup([
      draft("Карбамазепин"),
    ]);

    // Pick a drug, click at once (the PATCH is still on the wire).
    const pending = act((cur) => [...cur, draft("Конкор", { dose: "5 мг" })]);
    const step = await signVisitNoteWhenSaved({
      noteId,
      flushDraftEdits: noFlush,
      readSavedRow,
      finalize,
      emptyConfirmed: false,
    });
    await pending;

    expect(step).toEqual({ kind: "finalized" });
    expect(server.log.map((e) => `${e.kind} ${e.status}`)).toEqual([
      "PATCH 200",
      "GET 200",
      "FINALIZE 200",
    ]);
    expect(
      server.signed?.visitPrescriptions?.map((r) => r.displayName),
    ).toEqual(["Карбамазепин", "Конкор"]);
  });

  it("a diagnosis picked a second ago does not trigger «sign without a diagnosis?»", async () => {
    const { noteId, server, readSavedRow, finalize } = setup(
      [draft("Карбамазепин")],
      { diagnosisCode: null, diagnosisName: null },
    );

    const pending = enqueueVisitNotePatch(qc, noteId, {
      diagnosisCode: "G43.0",
      diagnosisName: "Мигрень без ауры",
    });
    const step = await signVisitNoteWhenSaved({
      noteId,
      flushDraftEdits: noFlush,
      readSavedRow,
      finalize,
      emptyConfirmed: false,
    });
    await pending;

    expect(step).toEqual({ kind: "finalized" });
    expect(server.signed?.diagnosisCode).toBe("G43.0");
  });

  it("the conclusion text flush joins the same queue, behind a card save already in flight", async () => {
    const { noteId, server, act, readSavedRow, finalize } = setup([
      draft("Карбамазепин"),
    ]);

    const pending = act((cur) => withRowEdited(cur, 0, { dose: "200 мг" }));
    // What the editor's registered flush does: a PATCH through the queue.
    const flushDraftEdits = async () => {
      await enqueueVisitNotePatch(qc, noteId, {
        bodyMarkdown: "Заключение, дописанное перед кликом",
      });
    };
    const step = await signVisitNoteWhenSaved({
      noteId,
      flushDraftEdits,
      readSavedRow,
      finalize,
      emptyConfirmed: false,
    });
    await pending;

    expect(step).toEqual({ kind: "finalized" });
    expect(server.log.map((e) => `${e.kind} ${e.status}`)).toEqual([
      "PATCH 200",
      "PATCH 200",
      "GET 200",
      "FINALIZE 200",
    ]);
    expect(server.signed?.bodyMarkdown).toBe(
      "Заключение, дописанное перед кликом",
    );
    expect(server.signed?.visitPrescriptions?.[0].dose).toBe("200 мг");
  });

  it("a refused card save stops the signature", async () => {
    const { noteId, server, act, readSavedRow, finalize } = setup([
      draft("Карбамазепин"),
    ]);

    server.failNextPatch = true;
    const pending = act((cur) => [...cur, draft("Конкор")]);
    const step = await signVisitNoteWhenSaved({
      noteId,
      flushDraftEdits: noFlush,
      readSavedRow,
      finalize,
      emptyConfirmed: false,
    });
    await pending;

    expect(step).toEqual({ kind: "unsaved" });
    expect(server.log.some((e) => e.kind === "FINALIZE")).toBe(false);
  });

  it("empty sections are judged on the saved row and asked about, not signed", async () => {
    const { noteId, server, readSavedRow, finalize } = setup([], {
      diagnosisCode: null,
      diagnosisName: null,
    });

    const step = await signVisitNoteWhenSaved({
      noteId,
      flushDraftEdits: noFlush,
      readSavedRow,
      finalize,
      emptyConfirmed: false,
    });

    expect(step).toEqual({
      kind: "confirm",
      missing: ["diagnosis", "prescriptions"],
    });
    expect(server.log.some((e) => e.kind === "FINALIZE")).toBe(false);
  });

  it("the confirmed second pass drains the queue again before signing", async () => {
    const { noteId, server, act, readSavedRow, finalize } = setup([], {
      diagnosisCode: null,
      diagnosisName: null,
    });

    // The doctor adds a drug while the dialog is up, then confirms.
    const pending = act((cur) => [...cur, draft("Конкор")]);
    const step = await signVisitNoteWhenSaved({
      noteId,
      flushDraftEdits: noFlush,
      readSavedRow,
      finalize,
      emptyConfirmed: true,
    });
    await pending;

    expect(step).toEqual({ kind: "finalized" });
    expect(server.log.map((e) => e.kind)).toEqual(["PATCH", "FINALIZE"]);
    expect(server.signed?.visitPrescriptions).toHaveLength(1);
  });

  it("a text flush that fails is reported and nothing is signed", async () => {
    const { noteId, server, readSavedRow, finalize } = setup([draft("A")]);
    const boom = new Error("flush failed");

    const step = await signVisitNoteWhenSaved({
      noteId,
      flushDraftEdits: async () => {
        throw boom;
      },
      readSavedRow,
      finalize,
      emptyConfirmed: false,
    });

    expect(step).toEqual({ kind: "flushFailed", error: boom });
    expect(server.log).toEqual([]);
  });
});
