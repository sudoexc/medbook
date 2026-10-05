/**
 * Clinic request 29.09.2026, the visit screen half: «Диагноз» takes one to
 * four diagnoses (one main, up to three «сопутствующих»), and the left column
 * keeps only «Диагноз» and «Контрольный визит» while «Назначения» moves to a
 * card of its own in the middle.
 *
 * Pinned here:
 *   1. The card's edits (pick, remove, «сделать основным») as pure functions
 *      on the live note: the first pick is the main one, the next ones follow;
 *      a duplicate or a fifth is refused; removing the main one promotes the
 *      next; every result is already settled the way the server settles it.
 *   2. The main diagnosis is written into the cache with the list, so quick
 *      actions compose on each other through the real patch queue: a removal
 *      right after «сделать основным» does not bring the old main one back.
 *   3. The screen layout the clinic asked for, and prescription lines that
 *      wrap instead of being cut.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import { normalizeNoteDiagnoses } from "@/lib/visit-diagnoses";
import {
  canAddDiagnosis,
  diagnosisListOf,
  hasDiagnosis,
  MAX_VISIT_DIAGNOSES,
  withDiagnosisMadeMain,
  withDiagnosisPicked,
  withDiagnosisRemoved,
  type DiagnosisItem,
} from "@/app/[locale]/doctor/reception/_hooks/diagnosis-list";
import {
  enqueueVisitNotePatch,
  foldPatchIntoRow,
  OPTIMISTIC_FIELDS,
  visitNoteKey,
  type VisitNotePatch,
  type VisitNoteRow,
} from "@/app/[locale]/doctor/reception/_hooks/use-visit-note";

const MIGRAINE = { code: "G43.0", name: "Мигрень без ауры" };
const TENSION = { code: "G44.2", name: "Головная боль напряжённого типа" };
const CERVICALGIA = { code: "M54.2", name: "Цервикалгия" };
const TBI = { code: null, name: "Последствия ЧМТ" };
const INSOMNIA = { code: "G47.0", name: "Инсомния" };

type Set3 = {
  diagnosisCode: string | null;
  diagnosisName: string | null;
  additionalDiagnoses: { code: string | null; name: string }[];
};

function noteOf(...list: DiagnosisItem[]): Set3 {
  const [main, ...rest] = list;
  return {
    diagnosisCode: main?.code ?? null,
    diagnosisName: main?.name ?? null,
    additionalDiagnoses: rest.map((d) => ({ code: d.code, name: d.name ?? "" })),
  };
}

/** Every edit must already be what the server will store. */
function expectSettled(set: Set3 | null) {
  expect(set).not.toBeNull();
  expect(normalizeNoteDiagnoses(set!)).toEqual(set);
}

describe("reading the visit's diagnoses", () => {
  it("lists the main one first, then the others in the doctor's order", () => {
    expect(diagnosisListOf(noteOf(MIGRAINE, TENSION, TBI))).toEqual([
      MIGRAINE,
      TENSION,
      TBI,
    ]);
    expect(diagnosisListOf(noteOf())).toEqual([]);
  });

  it("an older note (no list stored) reads as its one diagnosis", () => {
    expect(
      diagnosisListOf({ diagnosisCode: "G43.0", diagnosisName: "Мигрень без ауры" }),
    ).toEqual([MIGRAINE]);
  });

  it("a main diagnosis stored as a bare code keeps its empty name", () => {
    expect(diagnosisListOf({ diagnosisCode: "G43.0", diagnosisName: null })).toEqual([
      { code: "G43.0", name: null },
    ]);
  });
});

describe("picking a diagnosis", () => {
  it("the first pick is the main one, the next ones follow it", () => {
    const one = withDiagnosisPicked(noteOf(), MIGRAINE);
    expect(one).toEqual(noteOf(MIGRAINE));
    const two = withDiagnosisPicked(one!, TENSION);
    expect(two).toEqual(noteOf(MIGRAINE, TENSION));
    const three = withDiagnosisPicked(two!, TBI);
    expect(three).toEqual(noteOf(MIGRAINE, TENSION, TBI));
    expectSettled(three);
  });

  it("up to four: one main and three more, then the card is full", () => {
    let note = noteOf();
    for (const d of [MIGRAINE, TENSION, CERVICALGIA, TBI]) {
      expect(canAddDiagnosis(note)).toBe(true);
      note = withDiagnosisPicked(note, d)!;
    }
    expect(diagnosisListOf(note)).toHaveLength(MAX_VISIT_DIAGNOSES);
    expect(MAX_VISIT_DIAGNOSES).toBe(4);
    expect(canAddDiagnosis(note)).toBe(false);
    expect(withDiagnosisPicked(note, INSOMNIA)).toBeNull();
  });

  it("a diagnosis already on the visit is not added twice (code case aside, words spacing aside)", () => {
    const note = noteOf(MIGRAINE, TBI);
    expect(withDiagnosisPicked(note, { code: "g43.0", name: "Мигрень" })).toBeNull();
    expect(
      withDiagnosisPicked(note, { code: null, name: "  последствия   ЧМТ " }),
    ).toBeNull();
    expect(hasDiagnosis(note, { code: "G43.0", name: null })).toBe(true);
    expect(hasDiagnosis(note, TENSION)).toBe(false);
  });

  it("an empty pick changes nothing; words are trimmed", () => {
    expect(withDiagnosisPicked(noteOf(), { code: " ", name: "  " })).toBeNull();
    expect(
      withDiagnosisPicked(noteOf(MIGRAINE), { code: null, name: "  Цервикалгия " }),
    ).toEqual(noteOf(MIGRAINE, { code: null, name: "Цервикалгия" }));
  });

  it("adding a second diagnosis does not rewrite a bare-code main one", () => {
    const next = withDiagnosisPicked(
      { diagnosisCode: "G43.0", diagnosisName: null, additionalDiagnoses: [] },
      TENSION,
    );
    expect(next).toEqual({
      diagnosisCode: "G43.0",
      diagnosisName: null,
      additionalDiagnoses: [TENSION],
    });
  });
});

describe("removing and «сделать основным»", () => {
  it("removing the main one promotes the next, like the server does", () => {
    const next = withDiagnosisRemoved(noteOf(MIGRAINE, TENSION, TBI), MIGRAINE);
    expect(next).toEqual(noteOf(TENSION, TBI));
    expectSettled(next);
  });

  it("removing one of the others keeps the order of the rest", () => {
    expect(
      withDiagnosisRemoved(noteOf(MIGRAINE, TENSION, CERVICALGIA, TBI), CERVICALGIA),
    ).toEqual(noteOf(MIGRAINE, TENSION, TBI));
  });

  it("removing the only diagnosis clears the main one", () => {
    expect(withDiagnosisRemoved(noteOf(MIGRAINE), MIGRAINE)).toEqual(noteOf());
  });

  it("a diagnosis is found by what it is, not by a stale position", () => {
    // The doctor saw TBI third; a pending edit has moved it. Still TBI goes.
    expect(withDiagnosisRemoved(noteOf(TBI, MIGRAINE), TBI)).toEqual(
      noteOf(MIGRAINE),
    );
    expect(withDiagnosisRemoved(noteOf(MIGRAINE), TENSION)).toBeNull();
  });

  it("«сделать основным» moves it to the front, the former main one becomes the first of the others", () => {
    const next = withDiagnosisMadeMain(
      noteOf(MIGRAINE, TENSION, CERVICALGIA, TBI),
      CERVICALGIA,
    );
    expect(next).toEqual(noteOf(CERVICALGIA, MIGRAINE, TENSION, TBI));
    expectSettled(next);
    // A diagnosis in the clinic's own words can be the main one too.
    expect(withDiagnosisMadeMain(noteOf(MIGRAINE, TBI), TBI)).toEqual(
      noteOf(TBI, MIGRAINE),
    );
  });

  it("the main one or an unknown one: nothing to do", () => {
    expect(withDiagnosisMadeMain(noteOf(MIGRAINE, TENSION), MIGRAINE)).toBeNull();
    expect(withDiagnosisMadeMain(noteOf(MIGRAINE, TENSION), TBI)).toBeNull();
  });
});

// ── Through the real patch queue ─────────────────────────────────────────

const LATENCY_MS = 20;

function baseNote(id: string, set: Set3): VisitNoteRow {
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
    ...set,
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
    createdAt: "2026-09-29T08:00:00.000Z",
    updatedAt: "2026-09-29T08:00:00.000Z",
    visitPrescriptions: [],
  };
}

/** Applies PATCHes in order, slowly, with the version lock, and settles the set like the route. */
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
    const merged = { ...server.row, ...patch } as VisitNoteRow;
    const next: VisitNoteRow = {
      ...merged,
      ...normalizeNoteDiagnoses(merged),
      updatedAt: new Date(
        Date.parse(initial.updatedAt) + server.version * 1000,
      ).toISOString(),
    };
    server.row = next;
    return new Response(JSON.stringify(next), { status: 200 });
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

function setup(set: Set3) {
  const noteId = `vn_dx_${seq}`;
  const note = baseNote(noteId, set);
  qc.setQueryData(visitNoteKey(noteId), note);
  const { server, fetchMock } = fakeServer(note);
  vi.stubGlobal("fetch", fetchMock);
  const cached = () => qc.getQueryData<VisitNoteRow>(visitNoteKey(noteId))!;
  /** What the card does on every action: read the live row, edit, send. */
  const act = (edit: (live: VisitNoteRow) => Set3 | null) => {
    const next = edit(cached());
    return next ? enqueueVisitNotePatch(qc, noteId, next) : Promise.resolve(null);
  };
  return { server, cached, act };
}

describe("quick actions on the diagnosis card all land", () => {
  it("the main diagnosis travels with the list in the optimistic cache", () => {
    expect(OPTIMISTIC_FIELDS).toEqual(
      expect.arrayContaining(["diagnosisCode", "diagnosisName", "additionalDiagnoses"]),
    );
    const folded = foldPatchIntoRow(baseNote("vn_fold_dx", noteOf(MIGRAINE)), {
      diagnosisCode: null,
      diagnosisName: "Последствия ЧМТ",
      additionalDiagnoses: [MIGRAINE],
    });
    expect(folded).toMatchObject(noteOf(TBI, MIGRAINE));
  });

  it("three picks before any answer: all three on screen at once and on the server", async () => {
    const { server, cached, act } = setup(noteOf());
    const pending = [
      act((live) => withDiagnosisPicked(live, MIGRAINE)),
      act((live) => withDiagnosisPicked(live, TENSION)),
      act((live) => withDiagnosisPicked(live, TBI)),
    ];
    expect(diagnosisListOf(cached())).toEqual([MIGRAINE, TENSION, TBI]);
    await Promise.all(pending);
    expect(diagnosisListOf(server.row)).toEqual([MIGRAINE, TENSION, TBI]);
    expect(diagnosisListOf(cached())).toEqual([MIGRAINE, TENSION, TBI]);
  });

  it("«сделать основным», then at once remove the former main one: it does not come back", async () => {
    const { server, cached, act } = setup(noteOf(MIGRAINE, TENSION, TBI));
    const pending = [
      act((live) => withDiagnosisMadeMain(live, TBI)),
      act((live) => withDiagnosisRemoved(live, MIGRAINE)),
    ];
    expect(diagnosisListOf(cached())).toEqual([TBI, TENSION]);
    await Promise.all(pending);
    expect(diagnosisListOf(server.row)).toEqual([TBI, TENSION]);
    // No request carried the removed diagnosis back after the removal.
    expect(server.received.at(-1)).toEqual(noteOf(TBI, TENSION));
  });

  it("remove the main one, then another before the answer: both removals stick", async () => {
    const { server, act } = setup(noteOf(MIGRAINE, TENSION, CERVICALGIA));
    await Promise.all([
      act((live) => withDiagnosisRemoved(live, MIGRAINE)),
      act((live) => withDiagnosisRemoved(live, CERVICALGIA)),
    ]);
    expect(diagnosisListOf(server.row)).toEqual([TENSION]);
  });
});

// ── The screen ──────────────────────────────────────────────────────────

const read = (rel: string) =>
  readFileSync(path.join(process.cwd(), "src/app/[locale]/doctor", rel), "utf8");

describe("the visit screen layout", () => {
  const session = read("reception/_components/session-tab-content.tsx");
  const panels = read("reception/_components/structured-fields-panel.tsx");

  it("wide column: diagnosis over prescriptions; side column: advice over the control visit", () => {
    const order = [
      "<DiagnosisPanel />",
      "<PrescriptionsPanel />",
      "<AdvicePanel />",
      "<FollowUpPanel />",
    ].map((tag) => session.indexOf(tag));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // «Диагноз» on top, «Назначения» right under it (owner request
    // 03.10.2026); the conclusion editor left the screen.
    expect(session).toMatch(
      /<div className="flex min-w-0 flex-col gap-4 xl:gap-5">\s*<DiagnosisPanel \/>\s*<PrescriptionsPanel \/>\s*<\/div>/,
    );
    // «Контрольный визит» under «Рекомендации» (owner request 05.10.2026).
    expect(session).toMatch(
      /<div className="flex min-w-0 flex-col gap-4 self-start xl:gap-5">\s*<AdvicePanel \/>\s*<FollowUpPanel \/>\s*<\/div>/,
    );
    expect(session).not.toContain("NotesEditorPanel");
    expect(session).not.toContain("DiagnosisFollowUpPanel");
  });

  it("the control visit panel keeps only the control visit; the diagnosis panel holds the card and its protocols", () => {
    const left = panels.slice(
      panels.indexOf("export function FollowUpPanel"),
      panels.indexOf("export function PrescriptionsPanel"),
    );
    expect(left).toContain("<FollowUpCard");
    expect(left).not.toContain("<DiagnosisCard");
    expect(left).not.toContain("<PrescriptionConstructor");
    expect(left).not.toContain("<CdsWarningsCard");
    // Always one grid cell, even on a signed note without a control visit.
    expect(left).toMatch(/return \(\s*<div className="flex min-w-0 flex-col gap-4">/);
    const dx = panels.slice(
      panels.indexOf("export function DiagnosisPanel"),
      panels.indexOf("export function FollowUpPanel"),
    );
    expect(dx).toContain("<DiagnosisCard");
    expect(dx).toContain("<ApplyProtocolDialog");
    expect(dx).toContain("useTemplatesFollowDiagnoses({");
    expect(dx).not.toContain("<FollowUpCard");
    const middle = panels.slice(panels.indexOf("export function PrescriptionsPanel"));
    expect(middle).toContain("<PrescriptionConstructor");
    // The interaction check still reads every diagnosis of the visit.
    expect(middle).toContain("diagnoses={visitDiagnosesOf(note)}");
  });

  it("two tracks from lg up: the wide one for the pickers, a fixed side one", () => {
    const grid = session.match(/<div className="(grid grid-cols-1[^"]*)">/)![1]!;
    const tracks = grid.split(/\s+/).filter((c) => /grid-cols-\[/.test(c));
    expect(tracks).toEqual([
      "lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]",
      "xl:grid-cols-[minmax(0,1fr)_minmax(0,340px)]",
      "2xl:grid-cols-[minmax(0,1fr)_minmax(0,360px)]",
    ]);
    expect(grid).not.toMatch(/grid-rows|row-span/);
  });

  it("the paused AI rail leaves no empty column behind", () => {
    const page = read("reception/page.tsx");
    expect(page).toMatch(/\{AI_ENABLED && \(\s*<div className="hidden xl:block">\s*<ActiveAIRail \/>/);
  });

  it("the «Назначения» header wraps instead of pushing its buttons out of the card", () => {
    const rx = read("reception/_components/prescription-constructor.tsx");
    expect(rx).toContain(
      '<div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">',
    );
    expect(rx.match(/inline-flex items-center gap-1 whitespace-nowrap rounded-md/g)).toHaveLength(2);
  });


  it("a prescription line wraps, it is never cut", () => {
    const rx = read("reception/_components/prescription-constructor.tsx");
    const lineSpan = rx.slice(rx.indexOf("Wrapped, never cut"));
    expect(lineSpan.slice(0, 400)).toContain("break-words");
    expect(rx).not.toMatch(/truncate text-xs font-medium text-foreground">\s*\{line\}/);
  });

  it("the history views show every diagnosis of a visit, not only the main one", () => {
    const readers: Array<[string, string]> = [
      ["reception/_components/diagnosis-history-card.tsx", "d.additionalDiagnoses"],
      ["reception/_components/last-diagnosis-card.tsx", "withDiagnosis.additionalDiagnoses"],
      ["patients/[id]/_components/visits-section.tsx", "v.additionalDiagnoses"],
      ["visits/[patientId]/_components/visits-list.tsx", "v.additionalDiagnoses"],
      ["conclusions/_components/conclusions-list.tsx", "row.additionalDiagnoses"],
    ];
    for (const [file, prop] of readers) {
      expect(read(file), file).toMatch(
        new RegExp(`<AdditionalDiagnosesLine\\s+diagnoses=\\{${prop.replace(".", "\\.")}\\}`),
      );
    }
    // The read-only visit page loads the column and lists the others.
    const page = read("visits/[patientId]/[visitId]/page.tsx");
    expect(page).toContain("additionalDiagnoses: true,");
    expect(page).toMatch(/additionalDiagnoses: parseAdditionalDiagnoses\(\s*data\.note\.additionalDiagnoses/);
    const readonly = read("visits/[patientId]/[visitId]/_components/visit-note-readonly.tsx");
    expect(readonly).toContain("visitDiagnosesOf(note)");
    expect(readonly).toContain('t("note.additionalDiagnoses")');
  });

  it("the conclusion page uses the same card, without protocols", () => {
    const detail = read("conclusions/[id]/_components/conclusion-detail.tsx");
    expect(detail).toMatch(/<DiagnosisCard[\s\S]*?onChange=\{applyStructuredPatch\}/);
    expect(detail).not.toContain("onRequestApplyProtocol={() => {}}");
  });
});
