/**
 * CONCLUSION PDF re-render on post-finalization changes.
 *
 * Bug being locked down: the handout sweep used to select only
 * `conclusionDocument: { is: null }`, i.e. the PDF was rendered exactly once.
 * An edit inside the legal 24h window (or a later amendment) changed the
 * database but the patient kept seeing the stale file.
 *
 * The fix under test:
 *   - PATCH /visit-notes/[id] stamps `handoutStaleAt` on accepted edits to a
 *     FINALIZED note (and ONLY then — a DRAFT autosave must not);
 *   - the sweep picks up `handoutStaleAt != null` regardless of the backfill
 *     window (an amendment may arrive months later);
 *   - the re-render PRESERVES `verifyToken` and `documentNumber` — the QR on
 *     the paper in the patient's hands must keep resolving;
 *   - amendments ride into the re-rendered PDF;
 *   - the anchor is cleared conditionally (only if it still holds the swept
 *     value) and via raw SQL so `updatedAt` — the optimistic-lock token of
 *     the open editor — is never bumped by a background render.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ----- shared in-memory state ----------------------------------------------

const NOW = new Date("2026-08-20T10:00:00.000Z");
const STALE_AT = new Date("2026-08-20T09:59:00.000Z");

type UpsertArgs = {
  where: { visitNoteId: string };
  create: Record<string, unknown>;
  update: Record<string, unknown>;
};

const state = {
  notes: [] as Array<Record<string, unknown>>,
  existingDoc: null as { verifyToken: string | null } | null,
  upserts: [] as UpsertArgs[],
  rawExecs: [] as Array<{ strings: TemplateStringsArray; values: unknown[] }>,
  renders: [] as Array<Record<string, unknown>>,
  findManyWhere: null as Record<string, unknown> | null,
  patchNoteUpdates: [] as Array<Record<string, unknown>>,
  patchNote: null as Record<string, unknown> | null,
};

function makeSweepNote(
  overrides: Partial<Record<string, unknown>> = {},
): Record<string, unknown> {
  return {
    id: "vn_1",
    clinicId: "c1",
    patientId: "p1",
    appointmentId: "apt_1",
    status: "FINALIZED",
    patientHandoutMarkdown: "# Рекомендации\n- Пить воду",
    documentNumber: "NF-2026-000042",
    finalizedAt: new Date("2026-08-18T10:00:00.000Z"),
    followUpDays: null,
    handoutStaleAt: STALE_AT,
    amendments: [
      {
        reason: "опечатка в дозировке",
        text: "Верно: 5 мг утром",
        createdAt: new Date("2026-08-20T09:58:00.000Z"),
        doctor: { nameRu: "Иванов И.И.", nameUz: "Ivanov I.I." },
      },
    ],
    patient: { fullName: "Тест Пациент", preferredLang: "RU" },
    doctor: { nameRu: "Иванов И.И.", nameUz: "Ivanov I.I." },
    appointment: { date: new Date("2026-08-18T09:00:00.000Z"), time: "09:00" },
    visitPrescriptions: [],
    ...overrides,
  };
}

// ----- module mocks --------------------------------------------------------

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({ kind: "SYSTEM" as const }),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc_1", role: "DOCTOR", clinicId: "c1", email: "d@t" },
  })),
}));

vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));

vi.mock("@/server/clinical-forms/numbering", () => ({
  newVerifyToken: () => "tok_MINTED",
}));

vi.mock("@/server/queue", () => ({
  getQueue: () => ({
    registerWorker: vi.fn(),
    repeat: vi.fn(() => ({ stop: vi.fn() })),
  }),
}));

vi.mock("@/server/storage/minio", () => ({
  uploadObject: vi.fn(async () => ({ url: "https://files/x.pdf" })),
}));

vi.mock("@/server/visit-notes/conclusion-pdf", () => ({
  renderConclusionPdf: vi.fn(async (input: Record<string, unknown>) => {
    state.renders.push(input);
    return Buffer.from("pdf");
  }),
}));

vi.mock("@/server/prescription/cipher-fields", () => ({
  serializePrescriptionForWrite: (x: { notes: string | null }) => x,
}));

vi.mock("@/server/actions/repository", () => ({
  upsertAction: vi.fn(async () => undefined),
}));

vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr_test",
  publishViaOutbox: vi.fn(async () => undefined),
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    document: {
      upsert: vi.fn(async (args: UpsertArgs) => {
        state.upserts.push(args);
        return { id: "doc_1" };
      }),
    },
    $executeRaw: vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        state.rawExecs.push({ strings, values });
        return 1;
      },
    ),
    visitNote: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.patchNoteUpdates.push(data);
        if (state.patchNote) {
          state.patchNote = { ...state.patchNote, ...data };
        }
        return { ...(state.patchNote ?? {}), visitPrescriptions: [] };
      }),
    },
    visitPrescription: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async () => ({ count: 0 })),
    },
  };
  return {
    prisma: {
      visitNote: {
        findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          state.findManyWhere = where;
          return state.notes;
        }),
        findUnique: vi.fn(async () => state.patchNote),
        update: tx.visitNote.update,
      },
      visitPrescription: tx.visitPrescription,
      doctor: { findFirst: vi.fn(async () => ({ id: "doc_1" })) },
      clinic: {
        findUnique: vi.fn(async () => ({
          nameRu: "Клиника",
          nameUz: "Klinika",
          addressRu: null,
          addressUz: null,
          phone: null,
          brandColor: null,
        })),
      },
      document: {
        findUnique: vi.fn(async () => state.existingDoc),
        upsert: tx.document.upsert,
      },
      $executeRaw: tx.$executeRaw,
      $transaction: vi.fn(
        async <T,>(fn: (t: unknown) => Promise<T>): Promise<T> => fn(tx),
      ),
    },
  };
});

beforeEach(() => {
  state.notes = [];
  state.existingDoc = null;
  state.upserts = [];
  state.rawExecs = [];
  state.renders = [];
  state.findManyWhere = null;
  state.patchNoteUpdates = [];
  state.patchNote = null;
});

// ----- worker tests --------------------------------------------------------

describe("handout sweep — re-render of stale conclusions", () => {
  it("re-renders a stale note preserving verifyToken and documentNumber", async () => {
    const mod = await import("@/server/workers/visit-note-handout");
    state.notes = [makeSweepNote()];
    // The document already exists: its verifyToken is printed on paper.
    state.existingDoc = { verifyToken: "tok_PRINTED" };

    const out = await mod.runVisitNoteHandoutTick(NOW);
    expect(out.generated).toBe(1);

    expect(state.upserts).toHaveLength(1);
    const upsert = state.upserts[0];
    // A printed QR must survive re-renders: the existing token is reused,
    // the freshly-mintable one is NOT.
    expect(upsert.update.verifyToken).toBe("tok_PRINTED");
    expect(upsert.create.verifyToken).toBe("tok_PRINTED");
    expect(upsert.update.number).toBe("NF-2026-000042");

    // The PDF was rendered with the same number and with the amendment block.
    expect(state.renders).toHaveLength(1);
    expect(state.renders[0].documentNumber).toBe("NF-2026-000042");
    const amendments = state.renders[0].amendments as Array<{
      text: string;
      doctorName: string | null;
    }>;
    expect(amendments).toHaveLength(1);
    expect(amendments[0].text).toBe("Верно: 5 мг утром");
    expect(amendments[0].doctorName).toBe("Иванов И.И.");
  });

  it("clears the stale anchor conditionally via raw SQL (no updatedAt bump)", async () => {
    const mod = await import("@/server/workers/visit-note-handout");
    state.notes = [makeSweepNote()];
    state.existingDoc = { verifyToken: "tok_PRINTED" };

    await mod.runVisitNoteHandoutTick(NOW);

    expect(state.rawExecs).toHaveLength(1);
    const { strings, values } = state.rawExecs[0];
    const sql = strings.join("?");
    expect(sql).toContain('UPDATE "VisitNote"');
    expect(sql).toContain('"handoutStaleAt" = NULL');
    // The WHERE pins BOTH the id and the swept anchor value — an edit that
    // landed mid-render bumps the stamp and this clear must match nothing.
    expect(values).toContain("vn_1");
    expect(values).toContain(STALE_AT);
  });

  it("first render (no stale anchor) mints a token and skips the anchor clear", async () => {
    const mod = await import("@/server/workers/visit-note-handout");
    state.notes = [makeSweepNote({ handoutStaleAt: null, amendments: [] })];
    state.existingDoc = null;

    await mod.runVisitNoteHandoutTick(NOW);

    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0].create.verifyToken).toBe("tok_MINTED");
    expect(state.rawExecs).toHaveLength(0);
  });

  it("clears the anchor of a stale note whose handout went blank (no render, no starvation)", async () => {
    const mod = await import("@/server/workers/visit-note-handout");
    state.notes = [makeSweepNote({ patientHandoutMarkdown: "   \n\t " })];
    state.existingDoc = { verifyToken: "tok_PRINTED" };

    const out = await mod.runVisitNoteHandoutTick(NOW);
    expect(out.generated).toBe(0);
    // Nothing rendered or uploaded…
    expect(state.renders).toHaveLength(0);
    expect(state.upserts).toHaveLength(0);
    // …but the stale mark is cleared so the sweep converges.
    expect(state.rawExecs).toHaveLength(1);
    expect(state.rawExecs[0].values).toContain("vn_1");
    expect(state.rawExecs[0].values).toContain(STALE_AT);
  });

  it("sweeps stale notes WITHOUT the backfill-window bound (late amendments)", async () => {
    const mod = await import("@/server/workers/visit-note-handout");
    await mod.runVisitNoteHandoutTick(NOW);

    const where = state.findManyWhere!;
    // No top-level finalizedAt bound…
    expect(where.finalizedAt).toBeUndefined();
    // …the bound lives only on the first-render arm; the stale arm is open.
    const or = where.OR as Array<Record<string, unknown>>;
    expect(or).toHaveLength(2);
    expect(or[0].conclusionDocument).toEqual({ is: null });
    expect(or[0].finalizedAt).toBeDefined();
    expect(or[1]).toEqual({ handoutStaleAt: { not: null } });
  });
});

// ----- PATCH stamping tests ------------------------------------------------

describe("PATCH /api/crm/visit-notes/[id] — stale stamping", () => {
  function patchReq(body: unknown): Request {
    return new Request("https://x/api/crm/visit-notes/vn_1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("stamps handoutStaleAt on an accepted in-window edit of a FINALIZED note", async () => {
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
    state.patchNote = {
      id: "vn_1",
      clinicId: "c1",
      appointmentId: "apt_1",
      patientId: "p1",
      doctorId: "doc_1",
      status: "FINALIZED",
      finalizedAt: new Date(Date.now() - 60 * 60 * 1000), // 1h ago — window open
      handoutStaleAt: null,
      updatedAt: new Date(),
    };

    const res = await PATCH(patchReq({ bodyMarkdown: "corrected text" }));
    expect(res.status).toBe(200);
    expect(state.patchNoteUpdates).toHaveLength(1);
    const data = state.patchNoteUpdates[0];
    expect(data.bodyMarkdown).toBe("corrected text");
    expect(data.handoutStaleAt).toBeInstanceOf(Date);
  });

  it("does NOT stamp handoutStaleAt on a DRAFT autosave", async () => {
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
    state.patchNote = {
      id: "vn_1",
      clinicId: "c1",
      appointmentId: "apt_1",
      patientId: "p1",
      doctorId: "doc_1",
      status: "DRAFT",
      finalizedAt: null,
      handoutStaleAt: null,
      updatedAt: new Date(),
    };

    const res = await PATCH(patchReq({ bodyMarkdown: "draft text" }));
    expect(res.status).toBe(200);
    expect(state.patchNoteUpdates).toHaveLength(1);
    expect(state.patchNoteUpdates[0].handoutStaleAt).toBeUndefined();
  });

  it("still locks a FINALIZED note past the window with edit_window_expired", async () => {
    vi.resetModules();
    const { PATCH } = await import("@/app/api/crm/visit-notes/[id]/route");
    state.patchNote = {
      id: "vn_1",
      clinicId: "c1",
      appointmentId: "apt_1",
      patientId: "p1",
      doctorId: "doc_1",
      status: "FINALIZED",
      finalizedAt: new Date(Date.now() - 48 * 60 * 60 * 1000),
      handoutStaleAt: null,
      updatedAt: new Date(),
    };

    const res = await PATCH(patchReq({ bodyMarkdown: "too late" }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("edit_window_expired");
    expect(state.patchNoteUpdates).toHaveLength(0);
  });
});

// ----- pure helpers --------------------------------------------------------

describe("buildPdfAmendments", () => {
  it("picks the doctor name by locale and formats the date", async () => {
    const { buildPdfAmendments } = await import(
      "@/server/workers/visit-note-handout"
    );
    const rows = [
      {
        reason: "r",
        text: "t",
        createdAt: new Date("2026-08-20T09:58:00.000Z"),
        doctor: { nameRu: "Иванов", nameUz: "Ivanov" },
      },
      { reason: "r2", text: "t2", createdAt: new Date(), doctor: null },
    ];
    const ru = buildPdfAmendments(rows, "ru");
    expect(ru[0].doctorName).toBe("Иванов");
    expect(ru[0].dateLabel.length).toBeGreaterThan(0);
    expect(ru[1].doctorName).toBeNull();
    const uz = buildPdfAmendments(rows, "uz");
    expect(uz[0].doctorName).toBe("Ivanov");
  });
});

describe("isEditWindowExpired", () => {
  it("keeps the window open for 24h and locks after", async () => {
    const { isEditWindowExpired, EDIT_WINDOW_MS } = await import(
      "@/server/visit-notes/edit-window"
    );
    const now = new Date("2026-08-20T10:00:00.000Z");
    const open = new Date(now.getTime() - EDIT_WINDOW_MS + 60_000);
    const closed = new Date(now.getTime() - EDIT_WINDOW_MS - 60_000);
    expect(isEditWindowExpired(open, now)).toBe(false);
    expect(isEditWindowExpired(closed, now)).toBe(true);
    // Legacy finalized rows without a timestamp are treated as locked.
    expect(isEditWindowExpired(null, now)).toBe(true);
  });
});
