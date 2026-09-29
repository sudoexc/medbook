/**
 * Audit VW-10 — a signed diagnosis corrected inside the 24h window (G43.0 →
 * G44.2 on the conclusion screen) left G43.0 ACTIVE on the patient's card
 * and never added G44.2; re-signing after a revert with another code left
 * both ACTIVE.
 *
 * Pinned (acceptance):
 *   1. Sign G43.0, correct to G44.2 in the window: the card has G44.2
 *      ACTIVE and no ACTIVE G43.0.
 *   2. Revert and re-sign with another code: the old code is not ACTIVE.
 *   3. What the note did not create is left alone: a diagnosis another
 *      signed visit carries, or one typed in the card.
 *   4. A diagnosis removed from the note is resolved with a line saying so,
 *      never deleted.
 *   5. The PATCH route syncs only a signed note whose diagnosis changed.
 *   6. A visit with several diagnoses (29.09.2026): each one follows onto
 *      the card the same way, and another note's additional diagnosis
 *      counts as «carried elsewhere».
 *   7. A resolved row says «исправлен на X» only when one diagnosis was
 *      swapped for another. A note of two losing one, or its main one with
 *      the other promoted, says «убран»: X was signed all along.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { syncPatientDiagnosisWithNote } from "@/server/visit-notes/patient-diagnosis-sync";

type Dx = {
  id: string;
  clinicId: string;
  patientId: string;
  icd10Code: string | null;
  label: string;
  status: string;
  notes: string | null;
  diagnosedAt: Date | null;
  sourceVisitNoteId: string | null;
};
type SignedNote = {
  id: string;
  patientId: string;
  status: string;
  diagnosisCode: string | null;
  diagnosisName: string | null;
  additionalDiagnoses?: Array<{ code: string | null; name: string }>;
};

const h = vi.hoisted(() => ({ published: [] as Array<Record<string, unknown>> }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async (_tx: unknown, envelope: Record<string, unknown>) => {
    h.published.push(envelope);
    return { eventId: "ev", correlationId: "corr_test" };
  }),
}));

const db = {
  rows: [] as Dx[],
  notes: [] as SignedNote[],
  seq: 0,
  // What each note last signed, handed back as `previousDiagnoses` the way
  // the PATCH (its state before the edit) and finalize (the latest
  // revision) do.
  signed: new Map<string, Record<string, unknown>>(),
};

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (k === "OR") {
      return (v as Record<string, unknown>[]).some((w) => matches(row, w));
    }
    if (v && typeof v === "object" && "not" in (v as object)) {
      return row[k] !== (v as { not: unknown }).not;
    }
    // jsonb @>: every pattern entry is met by some stored entry.
    if (v && typeof v === "object" && "array_contains" in (v as object)) {
      const stored = (row[k] ?? []) as Record<string, unknown>[];
      const wanted = (v as { array_contains: Record<string, unknown>[] })
        .array_contains;
      return wanted.every((p) =>
        stored.some((e) => Object.entries(p).every(([pk, pv]) => e[pk] === pv)),
      );
    }
    return row[k] === v;
  });
}

const tx = {
  patientDiagnosis: {
    findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      db.rows.filter((r) => matches(r, where)).map((r) => ({ ...r })),
    ),
    findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
      const r = db.rows.find((x) => matches(x, where));
      return r ? { id: r.id } : null;
    }),
    create: vi.fn(async ({ data }: { data: Partial<Dx> }) => {
      const row: Dx = {
        id: `dx_${++db.seq}`,
        clinicId: "c1",
        patientId: "p1",
        icd10Code: null,
        label: "",
        status: "ACTIVE",
        notes: null,
        diagnosedAt: null,
        sourceVisitNoteId: null,
        ...data,
      };
      db.rows.push(row);
      return { id: row.id };
    }),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Dx> }) => {
      const row = db.rows.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return { id: row.id };
    }),
  },
  visitNote: {
    count: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
      db.notes.filter((n) => matches(n, where)).length,
    ),
  },
};

const NOW = new Date("2026-09-28T09:00:00Z");

async function sign(
  code: string | null,
  name: string | null,
  signedBefore: boolean,
  noteId = "vn_1",
  additionalDiagnoses: Array<{ code: string | null; name: string }> = [],
) {
  const res = await syncPatientDiagnosisWithNote(tx as never, {
    clinicId: "c1",
    patientId: "p1",
    visitNoteId: noteId,
    diagnosisCode: code,
    diagnosisName: name,
    additionalDiagnoses,
    previousDiagnoses: signedBefore ? (db.signed.get(noteId) ?? null) : null,
    now: NOW,
    signedBefore,
    ctx: { kind: "TENANT", clinicId: "c1", userId: "u_doc", role: "DOCTOR" },
  });
  db.signed.set(noteId, {
    diagnosisCode: code,
    diagnosisName: name,
    additionalDiagnoses,
  });
  return res;
}

const active = () =>
  db.rows.filter((r) => r.status === "ACTIVE").map((r) => r.icd10Code ?? r.label).sort();

beforeEach(() => {
  db.rows = [];
  db.notes = [];
  db.seq = 0;
  db.signed.clear();
  h.published = [];
});

describe("a corrected diagnosis follows onto the card (acceptance)", () => {
  it("sign G43.0, correct to G44.2 in the window: only G44.2 is active", async () => {
    await sign("G43.0", "Мигрень без ауры", false);
    expect(active()).toEqual(["G43.0"]);
    expect(db.rows[0]!.sourceVisitNoteId).toBe("vn_1");

    await sign("G44.2", "Головная боль напряжённого типа", true);
    expect(active()).toEqual(["G44.2"]);
    // Moved, not duplicated: one row, with the trace of what it was.
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]!.notes).toContain("было G43.0");
    expect(h.published.at(-1)).toMatchObject({
      type: "patient.medicalRecordChanged",
      payload: { patientId: "p1", record: "diagnosis" },
    });
  });

  it("revert and re-sign with another code: the old code is not left active", async () => {
    await sign("G43.0", "Мигрень без ауры", false);
    // …reverted, then signed again with G44.2 (firstFinalizedAt is set).
    await sign("G44.2", "Головная боль напряжённого типа", true);
    await sign("G43.1", "Мигрень с аурой", true);
    expect(active()).toEqual(["G43.1"]);
  });

  it("the new code already on the card is re-activated; the note's old row is resolved", async () => {
    db.rows.push({
      id: "dx_old",
      clinicId: "c1",
      patientId: "p1",
      icd10Code: "G44.2",
      label: "Головная боль напряжённого типа",
      status: "RESOLVED",
      notes: null,
      diagnosedAt: new Date("2025-01-10T00:00:00Z"),
      sourceVisitNoteId: null,
    });
    await sign("G43.0", "Мигрень без ауры", false);
    await sign("G44.2", "Головная боль напряжённого типа", true);
    expect(active()).toEqual(["G44.2"]);
    const old = db.rows.find((r) => r.icd10Code === "G43.0")!;
    expect(old.status).toBe("RESOLVED");
    expect(old.notes).toContain("исправлен на G44.2");
  });
});

describe("what the note did not create stays", () => {
  it("a diagnosis another signed visit carries stays active", async () => {
    await sign("G43.0", "Мигрень без ауры", false);
    db.notes.push({
      id: "vn_other",
      patientId: "p1",
      status: "FINALIZED",
      diagnosisCode: "G43.0",
      diagnosisName: "Мигрень без ауры",
    });
    await sign("G44.2", "Головная боль напряжённого типа", true);
    expect(active()).toEqual(["G43.0", "G44.2"]);
  });

  it("a diagnosis typed in the card is never moved or resolved", async () => {
    db.rows.push({
      id: "dx_manual",
      clinicId: "c1",
      patientId: "p1",
      icd10Code: "G43.0",
      label: "Мигрень",
      status: "ACTIVE",
      notes: null,
      diagnosedAt: null,
      sourceVisitNoteId: null,
    });
    await sign("G43.0", "Мигрень без ауры", false);
    await sign("G44.2", "Головная боль напряжённого типа", true);
    expect(active()).toEqual(["G43.0", "G44.2"]);
    expect(db.rows.find((r) => r.id === "dx_manual")!.sourceVisitNoteId).toBeNull();
  });
});

describe("a diagnosis removed from the signed note", () => {
  it("is resolved with a line saying so, never deleted", async () => {
    await sign("G43.0", "Мигрень без ауры", false);
    await sign(null, null, true);
    expect(active()).toEqual([]);
    expect(db.rows).toHaveLength(1);
    expect(db.rows[0]!.status).toBe("RESOLVED");
    expect(db.rows[0]!.notes).toContain("убран из заключения");
  });

  it("a free-text diagnosis is matched by its words", async () => {
    await sign(null, "Последствия ЧМТ", false);
    await sign(null, "Посттравматическая головная боль", true);
    expect(active()).toEqual(["Посттравматическая головная боль"]);
  });
});

// Clinic request 29.09.2026: a visit has a main diagnosis and up to three
// more. Each is a diagnosis of the patient and follows onto the card the
// same way.
const TENSION = { code: "G44.2", name: "Головная боль напряжённого типа" };
const CERVICALGIA = { code: "M54.2", name: "Цервикалгия" };

describe("a visit with several diagnoses", () => {
  it("puts every one of them on the card, main first", async () => {
    const res = await sign("G43.0", "Мигрень без ауры", false, "vn_1", [
      TENSION,
      CERVICALGIA,
    ]);
    expect(active()).toEqual(["G43.0", "G44.2", "M54.2"]);
    expect(db.rows.every((r) => r.sourceVisitNoteId === "vn_1")).toBe(true);
    expect(res.patientDiagnosisIds).toHaveLength(3);
    expect(res.patientDiagnosisId).toBe(
      db.rows.find((r) => r.icd10Code === "G43.0")!.id,
    );
  });

  it("an additional diagnosis removed in the window is resolved as removed", async () => {
    await sign("G43.0", "Мигрень без ауры", false, "vn_1", [TENSION, CERVICALGIA]);
    await sign("G43.0", "Мигрень без ауры", true, "vn_1", [TENSION]);
    expect(active()).toEqual(["G43.0", "G44.2"]);
    const gone = db.rows.find((r) => r.icd10Code === "M54.2")!;
    expect(gone.status).toBe("RESOLVED");
    expect(gone.notes).toContain("убран из заключения");
  });

  it("an additional diagnosis corrected in the window moves its row", async () => {
    await sign("G43.0", "Мигрень без ауры", false, "vn_1", [TENSION]);
    await sign("G43.0", "Мигрень без ауры", true, "vn_1", [CERVICALGIA]);
    expect(active()).toEqual(["G43.0", "M54.2"]);
    // Moved, not duplicated: two rows, the second with its trace.
    expect(db.rows).toHaveLength(2);
    expect(db.rows.find((r) => r.icd10Code === "M54.2")!.notes).toContain(
      "было G44.2",
    );
  });

  it("the main one and another swapping places changes nothing on the card", async () => {
    await sign("G43.0", "Мигрень без ауры", false, "vn_1", [TENSION]);
    await sign(TENSION.code, TENSION.name, true, "vn_1", [
      { code: "G43.0", name: "Мигрень без ауры" },
    ]);
    expect(active()).toEqual(["G43.0", "G44.2"]);
    expect(db.rows).toHaveLength(2);
    expect(db.rows.every((r) => !r.notes)).toBe(true);
  });

  it("a row another signed note carries as an additional diagnosis stays", async () => {
    await sign("G43.0", "Мигрень без ауры", false, "vn_1", [TENSION]);
    db.notes.push({
      id: "vn_other",
      patientId: "p1",
      status: "FINALIZED",
      diagnosisCode: "M54.2",
      diagnosisName: "Цервикалгия",
      additionalDiagnoses: [TENSION],
    });
    await sign("G43.0", "Мигрень без ауры", true, "vn_1", []);
    expect(active()).toEqual(["G43.0", "G44.2"]);
  });

  it("an uncoded additional diagnosis is matched by its words", async () => {
    await sign("G43.0", "Мигрень без ауры", false, "vn_1", [
      { code: null, name: "Последствия ЧМТ" },
    ]);
    expect(active()).toEqual(["G43.0", "Последствия ЧМТ"]);
    // Signed again unchanged: nothing moves, nothing duplicates.
    await sign("G43.0", "Мигрень без ауры", true, "vn_1", [
      { code: null, name: "Последствия ЧМТ" },
    ]);
    expect(db.rows).toHaveLength(2);
  });

  it("an additional diagnosis removed from a note of two says removed, not «исправлен на» the main one", async () => {
    await sign("G43.0", "Мигрень без ауры", false, "vn_1", [CERVICALGIA]);
    await sign("G43.0", "Мигрень без ауры", true, "vn_1", []);
    expect(active()).toEqual(["G43.0"]);
    const gone = db.rows.find((r) => r.icd10Code === "M54.2")!;
    expect(gone.status).toBe("RESOLVED");
    expect(gone.notes).toContain("убран из заключения");
    expect(gone.notes).not.toContain("исправлен на");
  });

  it("the main one removed and the other promoted: the old main one says removed", async () => {
    await sign("G43.0", "Мигрень без ауры", false, "vn_1", [CERVICALGIA]);
    await sign(CERVICALGIA.code, CERVICALGIA.name, true, "vn_1", []);
    expect(active()).toEqual(["M54.2"]);
    const gone = db.rows.find((r) => r.icd10Code === "G43.0")!;
    expect(gone.status).toBe("RESOLVED");
    expect(gone.notes).toContain("убран из заключения");
    expect(gone.notes).not.toContain("исправлен на M54.2");
  });

  it("one diagnosis swapped for another still names what replaced it", async () => {
    db.rows.push({
      id: "dx_old",
      clinicId: "c1",
      patientId: "p1",
      icd10Code: "M54.2",
      label: "Цервикалгия",
      status: "RESOLVED",
      notes: null,
      diagnosedAt: null,
      sourceVisitNoteId: null,
    });
    await sign("G43.0", "Мигрень без ауры", false);
    await sign(CERVICALGIA.code, CERVICALGIA.name, true);
    expect(db.rows.find((r) => r.icd10Code === "G43.0")!.notes).toContain(
      "исправлен на M54.2",
    );
  });

  it("an earlier set that is not on record makes no claim", async () => {
    db.rows.push({
      id: "dx_old",
      clinicId: "c1",
      patientId: "p1",
      icd10Code: "G44.2",
      label: TENSION.name,
      status: "RESOLVED",
      notes: null,
      diagnosedAt: null,
      sourceVisitNoteId: null,
    });
    await sign("G43.0", "Мигрень без ауры", false);
    db.signed.delete("vn_1");
    await sign(TENSION.code, TENSION.name, true);
    const gone = db.rows.find((r) => r.icd10Code === "G43.0")!;
    expect(gone.status).toBe("RESOLVED");
    expect(gone.notes).toContain("убран из заключения");
  });

  it("a row that was not the swapped diagnosis says removed", async () => {
    // M54.2 stayed active on this note's row while another visit carried
    // it; that visit no longer does, and this note swaps G43.0 for G44.2.
    db.rows.push(
      {
        id: "dx_g44",
        clinicId: "c1",
        patientId: "p1",
        icd10Code: "G44.2",
        label: TENSION.name,
        status: "RESOLVED",
        notes: null,
        diagnosedAt: null,
        sourceVisitNoteId: null,
      },
      {
        id: "dx_m54",
        clinicId: "c1",
        patientId: "p1",
        icd10Code: "M54.2",
        label: CERVICALGIA.name,
        status: "ACTIVE",
        notes: null,
        diagnosedAt: null,
        sourceVisitNoteId: "vn_1",
      },
    );
    await sign("G43.0", "Мигрень без ауры", false);
    await sign(TENSION.code, TENSION.name, true);
    expect(db.rows.find((r) => r.id === "dx_m54")!.notes).toContain(
      "убран из заключения",
    );
    expect(db.rows.find((r) => r.icd10Code === "G43.0")!.notes).toContain(
      "исправлен на G44.2",
    );
  });

  it("a duplicate of the main one is one row", async () => {
    await sign("G43.0", "Мигрень без ауры", false, "vn_1", [
      { code: "G43.0", name: "Мигрень" },
    ]);
    expect(db.rows).toHaveLength(1);
  });
});

describe("the first signature", () => {
  it("does not look for rows it cannot own yet", async () => {
    tx.patientDiagnosis.findMany.mockClear();
    await sign("G43.0", "Мигрень без ауры", false);
    expect(tx.patientDiagnosis.findMany).not.toHaveBeenCalled();
  });
});

describe("the PATCH route", () => {
  it("syncs a signed note whose diagnosis changed, and only that", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const src = readFileSync(
      path.join(process.cwd(), "src/app/api/crm/visit-notes/[id]/route.ts"),
      "utf8",
    );
    expect(src).toMatch(/if \(isSigned && diagnosisChanged\) \{\s+await syncPatientDiagnosisWithNote\(tx,/);
    const fin = readFileSync(
      path.join(process.cwd(), "src/app/api/crm/visit-notes/[id]/finalize/route.ts"),
      "utf8",
    );
    expect(fin).toContain("signedBefore: note.firstFinalizedAt != null");
    // Both hand over the set signed before, so a resolved row is worded by
    // what really happened.
    expect(src).toContain("previousDiagnoses: beforeDiagnoses,");
    expect(fin).toMatch(/previousDiagnoses: note\.firstFinalizedAt\s+\? \(\(previous\?\.content/);
  });
});
