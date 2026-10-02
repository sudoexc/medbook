/**
 * The visit note's print route and its GET, three small audit findings.
 *
 * VW-23 — `?embed=1` (the editor's live preview) skipped the chart-read
 *   record although it renders the whole document and the route is open to
 *   ADMIN for any note. Pinned: the preview records the read too (the
 *   helper throttles it), and the same URL opened as a page of its own is a
 *   print like any other, with its audit row.
 * VW-24 — the handout printed before signing told the patient to press
 *   «Сформировать», a button that no longer exists. Pinned: a draft's
 *   handout is composed at print time; no page mentions the button.
 * VW-27 — a clinic's photo of a global drug lives in its overlay, and the
 *   note, the print and Telegram read only Drug.photoUrl. Pinned: the
 *   overlay photo reaches the note's rows and the handout's pack shots.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const state = {
  note: null as Row | null,
  overlays: [] as Array<{ entityCode: string; overridesJson: unknown }>,
  views: [] as unknown[][],
  audits: [] as Row[],
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
vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async (_req: unknown, entry: Row) => {
    state.audits.push(entry);
  }),
}));
vi.mock("@/server/audit/patient-view", () => ({
  notePatientView: vi.fn((...args: unknown[]) => {
    state.views.push(args);
  }),
}));
vi.mock("@/server/visit-notes/previous-visit", () => ({
  findPreviousFinalizedVisit: vi.fn(async () => null),
}));
vi.mock("@/server/storage/inline-image", () => ({
  // Any stored photo inlines, so the pack-shot section shows what it got.
  inlineStorageImage: vi.fn(async (url: string | null) =>
    url ? `data:image/jpeg;base64,${Buffer.from(url).toString("base64")}` : null,
  ),
}));
vi.mock("@/server/telegram/invite-token", () => ({
  mintOrReuseInviteUrl: vi.fn(async () => null),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    visitNote: {
      findUnique: vi.fn(async () => state.note),
      findFirst: vi.fn(async () => state.note),
      findMany: vi.fn(async () => []),
    },
    doctor: { findFirst: vi.fn(async () => ({ id: "doc_1" })) },
    clinic: {
      findUnique: vi.fn(async () => ({
        id: "c1",
        nameRu: "Нейрофакс",
        nameUz: "Neyrofaks",
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
    ePrescription: { findMany: vi.fn(async () => []) },
    referral: { findMany: vi.fn(async () => []) },
    clinicCatalogOverlay: {
      findMany: vi.fn(
        async ({ where }: { where: { entityCode: { in: string[] } } }) =>
          state.overlays.filter((o) => where.entityCode.in.includes(o.entityCode)),
      ),
    },
  },
}));

const RX = {
  id: "rx1",
  sortOrder: 0,
  displayName: "Мидокалм",
  form: "TAB",
  strength: "150 мг",
  dose: "1 таб",
  timesOfDay: ["MORNING", "EVENING"],
  mealRelation: "AFTER_MEAL",
  durationDays: 10,
  instructionRu: null,
  instructionUz: null,
  remindPatient: true,
};

function note(over: Row = {}): Row {
  return {
    id: "vn_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_1",
    status: "DRAFT",
    startedAt: null,
    finalizedAt: null,
    documentNumber: null,
    diagnosisCode: "M54.2",
    diagnosisName: "Цервикалгия",
    additionalDiagnoses: [],
    complaints: [],
    anamnesis: [],
    examination: [],
    prescriptions: [],
    advice: ["Избегать переохлаждения"],
    followUpDays: null,
    followUpDate: null,
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
      telegramId: null,
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
      date: new Date("2026-10-02T06:00:00Z"),
      time: "11:00",
      channel: "BOOKING",
      startedAt: null,
    },
    visitPrescriptions: [
      { ...RX, drugId: "tolperisone", drug: { photoUrl: null } },
    ],
    amendments: [],
    ...over,
  };
}

async function print(qs: string, headers: Record<string, string> = {}) {
  vi.resetModules();
  const { GET } = await import("@/app/api/crm/visit-notes/[id]/print/route");
  const res = await GET(
    new Request(`https://x/api/crm/visit-notes/vn_1/print?${qs}`, { headers }),
  );
  expect(res.status).toBe(200);
  return res.text();
}

beforeEach(() => {
  state.note = note();
  state.overlays = [];
  state.views = [];
  state.audits = [];
});

describe("VW-23: the live preview leaves a trace", () => {
  it("embed=1 records the chart read, still without a print row", async () => {
    await print("embed=1");
    expect(state.views).toHaveLength(1);
    expect(state.views[0]![4]).toBe("visit_note.print");
    expect(state.audits).toEqual([]);
  });

  it("embed=1 opened as a page of its own is an audited print", async () => {
    const html = await print("embed=1", { "sec-fetch-dest": "document" });
    expect(state.audits.map((a) => a.action)).toEqual(["visit_note.print"]);
    expect(html).toContain("window.print()");
  });

  it("inside the editor's frame it stays a bare preview", async () => {
    const html = await print("embed=1", { "sec-fetch-dest": "iframe" });
    expect(state.audits).toEqual([]);
    expect(html).not.toContain("window.print()");
  });
});

describe("VW-24: a draft's handout prints what the doctor wrote", () => {
  it("the package of a draft carries the handout, not «Сформировать»", async () => {
    const html = await print("type=package&embed=1");
    expect(html).not.toContain("Сформировать");
    // The composer's own text, not just the advice the conclusion lists.
    expect(html).toContain("Здравствуйте, Рахимов");
    expect(html).toContain("Избегать переохлаждения");
  });

  it("in Uzbek too", async () => {
    state.note = note({
      patient: { ...(note().patient as Row), preferredLang: "UZ" },
    });
    const html = await print("type=handout&embed=1");
    expect(html).not.toContain("Shakllantirish");
    expect(html).toContain("Assalomu alaykum, Рахимов");
  });

  it("a signed note with nothing to say gets a plain line, not the button", async () => {
    state.note = note({
      status: "FINALIZED",
      finalizedAt: new Date("2026-10-02T07:00:00Z"),
      advice: [],
      visitPrescriptions: [],
    });
    const html = await print("type=handout&embed=1");
    expect(html).not.toContain("Сформировать");
    expect(html).toContain("Рекомендаций по этому приёму не записано.");
  });
});

describe("VW-27: the clinic's photo of a global drug reaches the handout", () => {
  it("the overlay photo is shown in «Как выглядит упаковка»", async () => {
    state.overlays = [
      { entityCode: "tolperisone", overridesJson: { photoUrl: "/files/drugs/c1/midocalm.jpg" } },
    ];
    const html = await print("type=handout&embed=1");
    expect(html).toContain('<div class="packs">');
    expect(html).toContain(
      Buffer.from("/files/drugs/c1/midocalm.jpg").toString("base64"),
    );
  });

  it("no photo anywhere, no section", async () => {
    const html = await print("type=handout&embed=1");
    expect(html).not.toContain('<div class="packs">');
  });
});

describe("VW-27: the overlay photo helper", () => {
  it("puts the overlay photo on linked rows, keeps the rest", async () => {
    state.overlays = [
      { entityCode: "tolperisone", overridesJson: { photoUrl: "/files/a.jpg" } },
      { entityCode: "ketorolac", overridesJson: { nameRu: "Кеторол" } },
    ];
    const { withClinicDrugPhotos } = await import("@/server/catalog/drug-photos");
    const rows = await withClinicDrugPhotos("c1", [
      { drugId: "tolperisone", drug: { photoUrl: null } },
      { drugId: "ketorolac", drug: { photoUrl: null } },
      { drugId: "own-drug", drug: { photoUrl: "/files/own.jpg" } },
      { drugId: null, drug: null },
    ]);
    expect(rows.map((r) => r.drug?.photoUrl ?? null)).toEqual([
      "/files/a.jpg",
      null,
      "/files/own.jpg",
      null,
    ]);
  });
});
