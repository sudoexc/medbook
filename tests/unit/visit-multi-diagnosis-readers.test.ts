/**
 * Clinic request 29.09.2026: one main diagnosis and up to three more per
 * visit. The routes that read them.
 *
 * Pinned (acceptance), each route driven for real against a mocked prisma:
 *   1. The printed conclusion lists the main diagnosis, then «Сопутствующие:»
 *      with code and name of each other one (ru and uz); a single-diagnosis
 *      note prints as before.
 *   2. The Mini App visit summary carries the others by name, never codes.
 *   3. The «Было раньше» / diagnosis-history rows carry each visit's others.
 *   4. The conclusions list search finds a conclusion by any of them.
 *   5. The drug check gets every diagnosis of the visit: the ones the page
 *      sends, or, from a page that sends only the main code, the note's.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const TENSION = { code: "G44.2", name: "Головная боль напряжённого типа" };
const TBI = { code: null, name: "Последствия ЧМТ" };

const state = {
  note: null as Row | null,
  noteRows: [] as Row[],
  findManyArgs: [] as Row[],
  findFirstArgs: [] as Row[],
  cdsInputs: [] as Row[],
};

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u_doc_1", role: "DOCTOR", clinicId: "c1", email: "d@t" },
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
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/visit-notes/previous-visit", () => ({
  findPreviousFinalizedVisit: vi.fn(async () => null),
}));
vi.mock("@/server/storage/inline-image", () => ({
  inlineStorageImage: vi.fn(async () => null),
}));
vi.mock("@/server/telegram/invite-token", () => ({
  mintOrReuseInviteUrl: vi.fn(async () => null),
}));
vi.mock("@/server/miniapp/handler", () => ({
  createMiniAppListHandler:
    (_opts: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({
        request,
        ctx: {
          clinicId: "c1",
          clinicSlug: "neurofax",
          patientId: "p1",
          patient: { preferredLang: "RU" },
        },
      }),
}));
vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({ ok: true, patientId: "p1" })),
}));
vi.mock("@/server/miniapp/link-token", () => ({
  miniAppDocumentUrl: vi.fn(() => "https://x/doc"),
}));
vi.mock("@/server/cds/drug-check", () => ({
  runDrugCheck: vi.fn(async (input: Row) => {
    state.cdsInputs.push(input);
    return { warnings: [], resolvedDrugs: [], unresolvedLines: [], noInteractionData: [] };
  }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    visitNote: {
      findUnique: vi.fn(async () => state.note),
      findFirst: vi.fn(async (args: Row) => {
        state.findFirstArgs.push(args);
        return state.note;
      }),
      findMany: vi.fn(async (args: Row) => {
        state.findManyArgs.push(args);
        return state.noteRows;
      }),
    },
    doctor: { findFirst: vi.fn(async () => ({ id: "doc_1" })) },
    clinic: {
      findUnique: vi.fn(async () => ({
        id: "c1",
        nameRu: "NeuroFax",
        nameUz: "NeuroFax",
        addressRu: null,
        addressUz: null,
        phone: null,
        logoUrl: null,
        letterheadUrl: null,
        brandColor: null,
      })),
    },
    document: { findUnique: vi.fn(async () => null) },
    patient: { findFirst: vi.fn(async () => ({ id: "p1" })) },
    appointment: { findFirst: vi.fn(async () => ({ id: "apt_1" })) },
  },
}));

function printableNote(over: Row = {}): Row {
  return {
    id: "vn_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_1",
    status: "FINALIZED",
    startedAt: null,
    finalizedAt: new Date("2026-09-29T07:00:00Z"),
    documentNumber: "NF-2026-000042",
    diagnosisCode: "G43.0",
    diagnosisName: "Мигрень без ауры",
    additionalDiagnoses: [],
    complaints: [],
    anamnesis: [],
    examination: [],
    prescriptions: [],
    advice: [],
    followUpDays: null,
    followUpNote: null,
    dynamics: null,
    dynamicsNote: null,
    bodyMap: null,
    bodyMarkdown: "Заключение.",
    patientHandoutMarkdown: null,
    aiGenerated: false,
    patient: {
      id: "p1",
      fullName: "Рахимов Сардор",
      phone: "+998901234567",
      telegramId: "42",
      birthDate: null,
      gender: "MALE",
      preferredLang: "RU",
    },
    doctor: {
      id: "doc_1",
      nameRu: "Султанов Азиз",
      nameUz: "Sultanov Aziz",
      specializationRu: "Невролог",
      specializationUz: "Nevrolog",
    },
    appointment: {
      id: "apt_1",
      date: new Date("2026-09-29T06:00:00Z"),
      time: "11:00",
      channel: "BOOKING",
      startedAt: null,
    },
    visitPrescriptions: [],
    amendments: [],
    ...over,
  };
}

async function print(lang: "ru" | "uz"): Promise<string> {
  vi.resetModules();
  const { GET } = await import("@/app/api/crm/visit-notes/[id]/print/route");
  const res = await GET(
    new Request(`https://x/api/crm/visit-notes/vn_1/print?lang=${lang}&embed=1`),
  );
  expect(res.status).toBe(200);
  return res.text();
}

/** The diagnosis section of the printed page. */
function diagnosisSection(html: string, heading: string): string {
  const at = html.indexOf(`<h3>${heading}</h3>`);
  expect(at).toBeGreaterThan(-1);
  return html.slice(at, html.indexOf("</section>", at));
}

beforeEach(() => {
  state.note = null;
  state.noteRows = [];
  state.findManyArgs = [];
  state.findFirstArgs = [];
  state.cdsInputs = [];
});

describe("the printed conclusion", () => {
  it("ru: main diagnosis, then «Сопутствующие:» with code and name", async () => {
    state.note = printableNote({ additionalDiagnoses: [TENSION, TBI] });
    const section = diagnosisSection(await print("ru"), "Диагноз (МКБ-10)");
    const main = section.indexOf("G43.0 · Мигрень без ауры");
    const more = section.indexOf("Сопутствующие:");
    expect(main).toBeGreaterThan(-1);
    expect(more).toBeGreaterThan(main);
    expect(section).toContain(
      "G44.2 · Головная боль напряжённого типа; Последствия ЧМТ",
    );
  });

  it("uz: the same under «Yondosh tashxislar»", async () => {
    state.note = printableNote({ additionalDiagnoses: [TENSION] });
    const section = diagnosisSection(await print("uz"), "Tashxis (ICD-10)");
    expect(section).toContain("Yondosh tashxislar:");
    expect(section).toContain("G44.2 · Головная боль напряжённого типа");
  });

  it("a single-diagnosis note prints as before", async () => {
    state.note = printableNote();
    const section = diagnosisSection(await print("ru"), "Диагноз (МКБ-10)");
    expect(section).toContain("<div>G43.0 · Мигрень без ауры</div>");
    expect(section).not.toContain("Сопутствующие");
  });

  it("escapes what the doctor typed", async () => {
    state.note = printableNote({
      additionalDiagnoses: [{ code: null, name: "<b>ЧМТ</b>" }],
    });
    const section = diagnosisSection(await print("ru"), "Диагноз (МКБ-10)");
    expect(section).toContain("&lt;b&gt;ЧМТ&lt;/b&gt;");
  });
});

describe("the Mini App visit summary", () => {
  it("carries the others by name, never the codes", async () => {
    state.note = {
      diagnosisName: "Мигрень без ауры",
      additionalDiagnoses: [TENSION, TBI],
      patientHandoutMarkdown: null,
      followUpDays: null,
      finalizedAt: new Date("2026-09-29T07:00:00Z"),
      documentNumber: "NF-2026-000042",
      conclusionDocument: null,
      doctor: { id: "doc_1" },
      appointment: { date: new Date("2026-09-29T06:00:00Z"), time: "11:00" },
      // G3-03 — the summary carries the doctor's later corrections.
      amendments: [],
    };
    vi.resetModules();
    const { GET } = await import("@/app/api/miniapp/visit-summary/[appointmentId]/route");
    const res = await GET(new Request("https://x/api/miniapp/visit-summary/apt_1"));
    const { summary } = (await res.json()) as { summary: Row };
    expect(summary.additionalDiagnosisNames).toEqual([TENSION.name, TBI.name]);
    expect(JSON.stringify(summary)).not.toContain("G44.2");
    // Asked for, or the list would silently be empty.
    const select = (state.findFirstArgs[0]!.select ?? {}) as Row;
    expect(select.additionalDiagnoses).toBe(true);
  });
});

describe("the patient's diagnosis history («Было раньше»)", () => {
  it("each visit row carries its other diagnoses", async () => {
    state.noteRows = [
      {
        id: "vn_0",
        appointmentId: "apt_0",
        finalizedAt: new Date("2026-09-01T07:00:00Z"),
        diagnosisCode: "G43.0",
        diagnosisName: "Мигрень без ауры",
        additionalDiagnoses: [TENSION],
        doctor: { nameRu: "Султанов Азиз", specializationRu: "Невролог" },
        appointment: { date: new Date("2026-09-01T06:00:00Z") },
      },
    ];
    vi.resetModules();
    const { GET } = await import(
      "@/app/api/crm/doctors/me/patients/[patientId]/diagnoses/route"
    );
    const res = await GET(
      new Request("https://x/api/crm/doctors/me/patients/p1/diagnoses"),
    );
    const { rows } = (await res.json()) as { rows: Row[] };
    expect(rows[0]).toMatchObject({
      visitNoteId: "vn_0",
      diagnosisCode: "G43.0",
      additionalDiagnoses: [TENSION],
    });
  });
});

describe("the conclusions list search", () => {
  it("finds a conclusion by any of its other diagnoses", async () => {
    vi.resetModules();
    const { GET } = await import("@/app/api/crm/visit-notes/route");
    await GET(new Request("https://x/api/crm/visit-notes?q=напряж"));
    const where = state.findManyArgs[0]!.where as { OR: Row[] };
    const paths = where.OR.flatMap((c) =>
      c.additionalDiagnoses
        ? [(c.additionalDiagnoses as { path: string[] }).path.join(".")]
        : [],
    );
    expect(paths).toEqual(["0.name", "0.code", "1.name", "1.code", "2.name", "2.code"]);
    expect(where.OR[2]).toMatchObject({
      additionalDiagnoses: { string_contains: "напряж", mode: "insensitive" },
    });
  });
});

describe("the drug check", () => {
  async function checkRoute(body: Row) {
    vi.resetModules();
    const { POST } = await import("@/app/api/crm/cds/drug-check/route");
    const res = await POST(
      new Request("https://x/api/crm/cds/drug-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientId: "p1", prescriptions: ["Метоклопрамид"], ...body }),
      }),
    );
    expect(res.status).toBe(200);
    return state.cdsInputs.at(-1)!;
  }

  it("passes on every diagnosis the page sends", async () => {
    const input = await checkRoute({
      diagnosisCode: "G43.0",
      diagnoses: [{ code: "G43.0", name: "Мигрень без ауры" }, { code: "G40.9", name: "Эпилепсия" }],
      visitNoteId: "vn_1",
    });
    expect(input.visitDiagnoses).toEqual([
      { code: "G43.0", name: "Мигрень без ауры" },
      { code: "G40.9", name: "Эпилепсия" },
    ]);
    // What the page sent is current: the stored note is not read.
    expect(state.findFirstArgs).toHaveLength(0);
  });

  it("a page that sends only the main code gets the note's others checked", async () => {
    state.note = { additionalDiagnoses: [{ code: "G40.9", name: "Эпилепсия" }] };
    const input = await checkRoute({ diagnosisCode: "G43.0", visitNoteId: "vn_1" });
    expect(input.diagnosisCode).toBe("G43.0");
    expect(input.visitDiagnoses).toEqual([{ code: "G40.9", name: "Эпилепсия" }]);
    // Only the note of this patient in this clinic.
    expect(state.findFirstArgs[0]!.where).toMatchObject({
      id: "vn_1",
      clinicId: "c1",
      patientId: "p1",
    });
  });

  it("refuses more than four", async () => {
    vi.resetModules();
    const { POST } = await import("@/app/api/crm/cds/drug-check/route");
    const five = Array.from({ length: 5 }, (_, i) => ({ code: `G4${i}`, name: "x" }));
    const res = await POST(
      new Request("https://x/api/crm/cds/drug-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ patientId: "p1", prescriptions: ["x"], diagnoses: five }),
      }),
    );
    expect(res.status).toBe(400);
  });
});
