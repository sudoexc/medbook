/**
 * Amendments (исправления) to finalized conclusions —
 * /api/crm/visit-notes/[id]/amendments.
 *
 * The medico-legal contract under test:
 *
 *   1. POST appends a VisitNoteAmendment and leaves the original note
 *      byte-for-byte intact — the ONLY note write is the technical
 *      `handoutStaleAt` re-render anchor. documentNumber and the clinical
 *      fields must survive unchanged.
 *   2. Only the note's own doctor may amend (same ownership rule as PATCH).
 *   3. Amendments are for the locked phase only: inside the 24h window the
 *      doctor edits directly (409 edit_window_open), and a DRAFT has nothing
 *      to amend (409 not_finalized).
 *
 * Strategy mirrors visit-note-version-conflict.test.ts: mock every
 * collaborator, drive the real route handlers with fetch Requests.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ----- shared in-memory state ----------------------------------------------

type Note = {
  id: string;
  clinicId: string;
  appointmentId: string;
  patientId: string;
  doctorId: string;
  status: string;
  finalizedAt: Date | null;
  documentNumber: string | null;
  bodyMarkdown: string | null;
  complaints: string[];
  handoutStaleAt: Date | null;
  updatedAt: Date;
};

type Amendment = {
  id: string;
  visitNoteId: string;
  doctorId: string;
  reason: string;
  text: string;
  createdAt: Date;
  doctor: { nameRu: string; nameUz: string };
};

const NOW = Date.now();
const TWO_DAYS_AGO = new Date(NOW - 48 * 60 * 60 * 1000);
const ONE_HOUR_AGO = new Date(NOW - 60 * 60 * 1000);

const state = {
  note: null as Note | null,
  amendments: [] as Amendment[],
  /** Every `data` object passed to visitNote.update. */
  noteUpdateData: [] as Array<Record<string, unknown>>,
  viewerDoctorId: "doc_1",
  audits: 0,
};

function makeNote(overrides: Partial<Note> = {}): Note {
  return {
    id: "vn_1",
    clinicId: "c1",
    appointmentId: "apt_1",
    patientId: "p1",
    doctorId: "doc_1",
    status: "FINALIZED",
    finalizedAt: TWO_DAYS_AGO,
    documentNumber: "NF-2026-000123",
    bodyMarkdown: "original clinical text",
    complaints: ["головная боль"],
    handoutStaleAt: null,
    updatedAt: new Date(NOW - 47 * 60 * 60 * 1000),
    ...overrides,
  };
}

// ----- module mocks --------------------------------------------------------

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: {
      id: "u_doc_1",
      role: "DOCTOR",
      clinicId: "c1",
      email: "doctor@example.test",
    },
  })),
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_ctx: unknown, fn: () => T) => fn(),
  getTenant: () => ({
    kind: "TENANT" as const,
    clinicId: "c1",
    userId: "u_doc_1",
    role: "DOCTOR" as const,
  }),
}));

vi.mock("@/server/platform/branch-cookie", () => ({
  readActiveBranchFromCookieHeader: () => null,
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => {
    state.audits += 1;
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    visitNote: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        if (state.note && state.note.id === where.id) return state.note;
        return null;
      }),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          if (!state.note || state.note.id !== where.id) {
            throw new Error("not found");
          }
          state.noteUpdateData.push(data);
          state.note = { ...state.note, ...(data as Partial<Note>) };
          return state.note;
        },
      ),
    },
    visitNoteAmendment: {
      create: vi.fn(
        async ({ data }: { data: Record<string, unknown> }) => {
          const row: Amendment = {
            id: `am_${state.amendments.length + 1}`,
            visitNoteId: data.visitNoteId as string,
            doctorId: data.doctorId as string,
            reason: data.reason as string,
            text: data.text as string,
            createdAt: new Date(NOW),
            doctor: { nameRu: "Иванов И.И.", nameUz: "Ivanov I.I." },
          };
          state.amendments.push(row);
          return row;
        },
      ),
      findMany: vi.fn(async () => state.amendments),
    },
    doctor: {
      findFirst: vi.fn(async () => ({ id: state.viewerDoctorId })),
    },
    $transaction: vi.fn(
      async <T,>(fn: (tx: unknown) => Promise<T>): Promise<T> => {
        const { prisma } = await import("@/lib/prisma");
        return fn(prisma);
      },
    ),
  },
}));

// ----- helpers -------------------------------------------------------------

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/crm/visit-notes/[id]/amendments/route");
}

function postReq(body: unknown): Request {
  return new Request("https://x/api/crm/visit-notes/vn_1/amendments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getReq(): Request {
  return new Request("https://x/api/crm/visit-notes/vn_1/amendments");
}

beforeEach(() => {
  state.note = makeNote();
  state.amendments = [];
  state.noteUpdateData = [];
  state.viewerDoctorId = "doc_1";
  state.audits = 0;
});

// ----- tests ---------------------------------------------------------------

describe("POST /api/crm/visit-notes/[id]/amendments", () => {
  it("appends an amendment and leaves the original note untouched", async () => {
    const { POST } = await loadRoute();
    const original = { ...state.note! };

    const res = await POST(
      postReq({ reason: "опечатка в дозировке", text: "Верно: 5 мг" }),
    );
    expect(res.status).toBe(201);
    const row = (await res.json()) as Amendment;
    expect(row.reason).toBe("опечатка в дозировке");
    expect(row.text).toBe("Верно: 5 мг");
    expect(row.doctorId).toBe("doc_1");
    expect(state.amendments).toHaveLength(1);

    // THE invariant: no clinical field of the note may move. The only write
    // is the technical re-render anchor for the handout worker.
    expect(state.noteUpdateData).toHaveLength(1);
    expect(Object.keys(state.noteUpdateData[0])).toEqual(["handoutStaleAt"]);
    expect(state.note!.bodyMarkdown).toBe(original.bodyMarkdown);
    expect(state.note!.complaints).toEqual(original.complaints);
    expect(state.note!.documentNumber).toBe(original.documentNumber);
    expect(state.note!.status).toBe("FINALIZED");
    expect(state.note!.finalizedAt).toEqual(original.finalizedAt);
    expect(state.note!.handoutStaleAt).toBeInstanceOf(Date);

    expect(state.audits).toBe(1);
  });

  it("rejects a doctor who is not the note's author with 403", async () => {
    const { POST } = await loadRoute();
    state.viewerDoctorId = "doc_INTRUDER";

    const res = await POST(postReq({ reason: "r", text: "t" }));
    expect(res.status).toBe(403);
    expect(state.amendments).toHaveLength(0);
    expect(state.noteUpdateData).toHaveLength(0);
    expect(state.audits).toBe(0);
  });

  it("rejects while the 24h edit window is still open (edit directly instead)", async () => {
    const { POST } = await loadRoute();
    state.note = makeNote({ finalizedAt: ONE_HOUR_AGO });

    const res = await POST(postReq({ reason: "r", text: "t" }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("edit_window_open");
    expect(state.amendments).toHaveLength(0);
    expect(state.noteUpdateData).toHaveLength(0);
  });

  it("rejects a DRAFT note (nothing issued to amend)", async () => {
    const { POST } = await loadRoute();
    state.note = makeNote({ status: "DRAFT", finalizedAt: null });

    const res = await POST(postReq({ reason: "r", text: "t" }));
    expect(res.status).toBe(409);
    const body = (await res.json()) as { reason: string };
    expect(body.reason).toBe("not_finalized");
    expect(state.amendments).toHaveLength(0);
  });

  it("treats a legacy FINALIZED note without finalizedAt as locked → amendable", async () => {
    const { POST } = await loadRoute();
    state.note = makeNote({ finalizedAt: null });

    const res = await POST(postReq({ reason: "r", text: "t" }));
    expect(res.status).toBe(201);
    expect(state.amendments).toHaveLength(1);
  });

  it("rejects blank reason/text with 400 before touching anything", async () => {
    const { POST } = await loadRoute();
    for (const body of [
      { reason: "", text: "t" },
      { reason: "r", text: "   " },
      { text: "t" },
      { reason: "r" },
    ]) {
      const res = await POST(postReq(body));
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(state.amendments).toHaveLength(0);
    expect(state.noteUpdateData).toHaveLength(0);
  });
});

describe("GET /api/crm/visit-notes/[id]/amendments", () => {
  it("returns the note's amendments for the owning doctor", async () => {
    const { GET, POST } = await loadRoute();
    await POST(postReq({ reason: "r1", text: "t1" }));
    await POST(postReq({ reason: "r2", text: "t2" }));

    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Amendment[] };
    expect(body.items.map((a) => a.reason)).toEqual(["r1", "r2"]);
  });

  it("hides another doctor's note with 403", async () => {
    const { GET } = await loadRoute();
    state.viewerDoctorId = "doc_INTRUDER";
    const res = await GET(getReq());
    expect(res.status).toBe(403);
  });
});
