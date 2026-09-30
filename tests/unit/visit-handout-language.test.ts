/**
 * Audit VW-07 — the patient's handout was always composed in Russian. A
 * patient who reads Uzbek got «Bemor uchun eslatma», an Uzbek intake grid
 * and a Russian text in between, in the PDF, the Mini App and the print.
 *
 * Pinned:
 *   1. The handout is composed in the patient's language: the text, the
 *      prescription lines, the doctor's and clinic's Uzbek names.
 *   2. The print of the handout follows the language picked on its print
 *      bar: the stored handout when it is in that language, composed again
 *      in it when not, as stored when the composer did not write it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  composePatientHandout,
  composedHandoutLocale,
} from "@/lib/catalogs/handout-composer";
import { composeNoteHandout, handoutLocaleOf } from "@/server/visit-notes/handout";

type Row = Record<string, unknown>;

const state = { note: null as Row | null };

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
  },
}));

const RX = {
  displayName: "Карбамазепин",
  form: "TAB",
  strength: "200 мг",
  dose: "1 таб",
  timesOfDay: ["MORNING", "EVENING"],
  mealRelation: "AFTER",
  durationDays: 14,
  instructionRu: null,
  instructionUz: null,
  remindPatient: true,
};

const context = (lang: "RU" | "UZ") => ({
  patient: { fullName: "Рахимов Сардор", preferredLang: lang },
  doctor: {
    nameRu: "Султанов Азиз",
    nameUz: "Sultanov Aziz",
    specializationRu: "Невролог",
    specializationUz: "Nevrolog",
  },
  clinic: { nameRu: "Нейрофакс", nameUz: "Neyrofaks" },
  appointment: { date: new Date("2026-09-29T06:00:00Z") },
});

const fields = {
  diagnosisName: "Мигрень без ауры",
  complaints: [],
  prescriptions: [],
  advice: ["Режим сна"],
  followUpNote: null,
  visitPrescriptions: [RX],
};

describe("the handout follows the patient's language", () => {
  it("Uzbek for a patient who reads Uzbek", () => {
    const md = composeNoteHandout(context("UZ"), fields)!;
    expect(md.startsWith("# Bemor uchun eslatma")).toBe(true);
    expect(md).toContain("Assalomu alaykum, Рахимов!");
    expect(md).toContain("Sultanov Aziz");
    expect(md).not.toContain("Здравствуйте");
    expect(md).not.toContain("Султанов Азиз");
    // The prescription line itself is Uzbek, not only the headings.
    const ru = composeNoteHandout(context("RU"), fields)!;
    const rxLine = (m: string) => m.split("\n").find((l) => l.startsWith("- Карбамазепин"))!;
    expect(rxLine(md)).not.toBe(rxLine(ru));
  });

  it("Russian otherwise, as before", () => {
    expect(composeNoteHandout(context("RU"), fields)!.startsWith("# Памятка для пациента")).toBe(
      true,
    );
    expect(handoutLocaleOf({ patient: { fullName: "x" } })).toBe("ru");
  });

  it("knows which language a composed handout is in", () => {
    expect(composedHandoutLocale(composePatientHandout({ locale: "uz", advice: ["x"] }))).toBe("uz");
    expect(composedHandoutLocale(composePatientHandout({ locale: "ru", advice: ["x"] }))).toBe("ru");
    expect(composedHandoutLocale("Написано вручную")).toBeNull();
    expect(composedHandoutLocale(null)).toBeNull();
  });
});

function note(lang: "RU" | "UZ", handout: string | null): Row {
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
    advice: ["Режим сна"],
    followUpDays: null,
    followUpDate: null,
    followUpNote: null,
    dynamics: null,
    dynamicsNote: null,
    bodyMap: null,
    bodyMarkdown: "Заключение.",
    patientHandoutMarkdown: handout,
    aiGenerated: false,
    patient: {
      id: "p1",
      fullName: "Рахимов Сардор",
      phone: "+998901234567",
      telegramId: "42",
      birthDate: null,
      gender: "MALE",
      preferredLang: lang,
    },
    doctor: context(lang).doctor,
    appointment: {
      id: "apt_1",
      date: new Date("2026-09-29T06:00:00Z"),
      time: "11:00",
      channel: "BOOKING",
      startedAt: null,
    },
    visitPrescriptions: [{ ...RX, id: "rx1", sortOrder: 0, drugId: null, drug: null }],
    amendments: [],
  };
}

async function printHandout(lang?: "ru" | "uz"): Promise<string> {
  vi.resetModules();
  const { GET } = await import("@/app/api/crm/visit-notes/[id]/print/route");
  const qs = `type=handout&embed=1${lang ? `&lang=${lang}` : ""}`;
  const res = await GET(new Request(`https://x/api/crm/visit-notes/vn_1/print?${qs}`));
  expect(res.status).toBe(200);
  return res.text();
}

beforeEach(() => {
  state.note = null;
});

describe("the printed handout", () => {
  it("an Uzbek patient's handout prints in Uzbek by default", async () => {
    state.note = note("UZ", composeNoteHandout(context("UZ"), fields));
    const html = await printHandout();
    expect(html).toContain("Assalomu alaykum");
    expect(html).not.toContain("Здравствуйте");
  });

  it("an old Russian handout of an Uzbek patient prints in Uzbek", async () => {
    state.note = note("UZ", composeNoteHandout(context("RU"), fields));
    const html = await printHandout();
    expect(html).toContain("Assalomu alaykum");
    expect(html).not.toContain("Здравствуйте");
  });

  it("the print bar's RU switches the body too", async () => {
    state.note = note("UZ", composeNoteHandout(context("UZ"), fields));
    const html = await printHandout("ru");
    expect(html).toContain("Здравствуйте");
    expect(html).not.toContain("Assalomu alaykum");
  });

  it("text the composer did not write prints as stored", async () => {
    state.note = note("UZ", "Написано врачом вручную");
    expect(await printHandout()).toContain("Написано врачом вручную");
  });
});
