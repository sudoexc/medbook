/**
 * The conclusion print and its preview without conclusion text.
 *
 * The visit screen's conclusion editor is gone (clinic request 03.10.2026),
 * so most new notes carry no text of their own, and the sheet printed
 * «Текст заключения» over a lone dash. Pinned: no text, no heading (blank
 * or whitespace alike, in both languages, in the package too); a note with
 * text, an older one or a protocol's template, prints it as before.
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

describe("no conclusion text, no «Текст заключения»", () => {
  for (const [label, body] of [
    ["null", null],
    ["empty", ""],
    ["whitespace only", "  \n\n  "],
  ] as const) {
    it(`a note whose text is ${label} prints no heading and no dash for it`, async () => {
      state.note = note({ bodyMarkdown: body });
      const html = await print("embed=1");
      expect(html).not.toContain("Текст заключения");
      expect(html).not.toContain('<div class="body-md">');
      // The rest of the sheet is still there.
      expect(html).toContain("Цервикалгия");
      expect(html).toContain("Избегать переохлаждения");
    });
  }

  it("in Uzbek too, and inside «распечатать всё»", async () => {
    state.note = note({ bodyMarkdown: "" });
    expect(await print("lang=uz&embed=1")).not.toContain("Xulosa matni");
    expect(await print("type=package&embed=1")).not.toContain("Текст заключения");
  });

  it("a signed note without text keeps its corrections block", async () => {
    state.note = note({
      status: "FINALIZED",
      finalizedAt: new Date("2026-10-02T07:00:00Z"),
      bodyMarkdown: null,
    });
    const html = await print("embed=1");
    expect(html).not.toContain("Текст заключения");
    expect(html).toContain("Султанов Азиз");
  });
});

describe("a note with conclusion text prints it as before", () => {
  it("the heading and the text, escaped", async () => {
    state.note = note({
      bodyMarkdown: "Рекомендовано: МРТ <шейного> отдела.\nКонтроль через 14 дней.",
    });
    const html = await print("embed=1");
    expect(html).toContain("<h3>Текст заключения</h3>");
    expect(html).toContain(
      '<div class="body-md">Рекомендовано: МРТ &lt;шейного&gt; отдела.\nКонтроль через 14 дней.</div>',
    );
  });

  it("in Uzbek under its own heading", async () => {
    const html = await print("lang=uz&embed=1");
    expect(html).toContain("<h3>Xulosa matni</h3>");
    expect(html).toContain('<div class="body-md">Заключение.</div>');
  });
});
