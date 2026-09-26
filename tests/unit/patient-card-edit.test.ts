/**
 * Audit PT-01: the front desk corrects a patient's name, phone, birth date,
 * gender, address, passport, source and language from the CRM card.
 *
 * «Редактировать» on «Основная информация» had no handler and the only
 * component with inline editing (PatientHeader) was never rendered, so a
 * Mini App sign-up stayed «Jasur 🙂» with no birth date forever. The card
 * now opens EditPatientDialog; these tests pin what it sends and what the
 * PATCH does with it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  draftFromPatient,
  editPatientPatch,
} from "@/app/[locale]/crm/patients/[id]/_components/edit-patient-form";

const state = vi.hoisted(() => ({
  before: null as null | Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  owner: null as null | { id: string; fullName: string; birthDate: Date | null },
  released: [] as string[],
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = { kind: "TENANT", clinicId: "c1", userId: "u1", role: "RECEPTIONIST" };
  return {
    createApiHandler:
      (
        opts: { bodySchema?: { parse: (v: unknown) => unknown } },
        handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
      ) =>
      async (request: Request) =>
        handler({
          request,
          body: opts.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined,
          ctx,
        }),
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx }),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/audit/patient-view", () => ({ recordPatientView: vi.fn() }));
vi.mock("@/server/patient/phone-identity", () => ({
  findVerifiedPhoneOwners: vi.fn(async () => (state.owner ? [state.owner] : [])),
  releaseUnverifiedPhone: vi.fn(async (_db: unknown, _c: string, phone: string) => {
    state.released.push(phone);
    return [];
  }),
  isRealPhone: (v: string | null | undefined) => typeof v === "string" && v.startsWith("+"),
  isUniqueViolation: () => false,
}));
vi.mock("@/lib/prisma", () => {
  const patient = {
    findUnique: vi.fn(async () => (state.before ? { ...state.before } : null)),
    update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      state.updates.push(data);
      return { ...state.before, ...data };
    }),
  };
  return {
    prisma: {
      patient,
      $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn({ patient })),
    },
  };
});

const MINIAPP_CARD = {
  id: "p1",
  clinicId: "c1",
  fullName: "Jasur 🙂",
  phone: "+998901234567",
  phoneNormalized: "+998901234567",
  phoneVerifiedAt: new Date("2026-09-01T00:00:00Z"),
  birthDate: null as Date | null,
  gender: null,
  address: null,
  passport: null,
  notes: null,
  source: "TELEGRAM",
  preferredLang: "UZ",
};

beforeEach(() => {
  state.before = { ...MINIAPP_CARD };
  state.updates = [];
  state.owner = null;
  state.released = [];
});

function patch(body: unknown) {
  return new Request("https://x/api/crm/patients/p1", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CARD_FOR_FORM = {
  fullName: "Jasur 🙂",
  phone: "+998901234567",
  birthDate: null as string | null,
  gender: null as "MALE" | "FEMALE" | null,
  address: null as string | null,
  passport: null as string | null,
  source: "TELEGRAM" as const,
  preferredLang: "UZ" as const,
};

describe("the edit form sends only what staff changed", () => {
  it("birth date and phone: exactly those two fields", () => {
    const draft = {
      ...draftFromPatient(CARD_FOR_FORM),
      birthDate: "1987-03-14",
      phone: "+998 93 555 44 33",
    };
    expect(editPatientPatch(CARD_FOR_FORM, draft)).toEqual({
      ok: true,
      patch: { birthDate: "1987-03-14", phone: "+998 93 555 44 33" },
    });
  });

  it("an untouched form sends nothing", () => {
    expect(editPatientPatch(CARD_FOR_FORM, draftFromPatient(CARD_FOR_FORM))).toEqual({
      ok: true,
      patch: {},
    });
  });

  it("the stored birth date round-trips to the date input unchanged", () => {
    const card = { ...CARD_FOR_FORM, birthDate: "1969-01-01T00:00:00.000Z" };
    expect(draftFromPatient(card).birthDate).toBe("1969-01-01");
    expect(editPatientPatch(card, draftFromPatient(card))).toEqual({ ok: true, patch: {} });
  });

  it("clearing optional fields sends null; gender, source, language, address, passport", () => {
    const card = {
      ...CARD_FOR_FORM,
      gender: "MALE" as const,
      address: "Чиланзар 5",
      passport: "AA1234567",
    };
    const draft = {
      ...draftFromPatient(card),
      gender: "" as const,
      source: "" as const,
      preferredLang: "RU" as const,
      address: "  ",
      passport: "AB7654321",
    };
    expect(editPatientPatch(card, draft)).toEqual({
      ok: true,
      patch: {
        gender: null,
        source: null,
        preferredLang: "RU",
        address: null,
        passport: "AB7654321",
      },
    });
  });

  it("a name shorter than 2 letters and a removed phone are refused before any request", () => {
    const base = draftFromPatient(CARD_FOR_FORM);
    expect(editPatientPatch(CARD_FOR_FORM, { ...base, fullName: " J " })).toEqual({
      ok: false,
      error: "name",
    });
    expect(editPatientPatch(CARD_FOR_FORM, { ...base, phone: "" })).toEqual({
      ok: false,
      error: "phone",
    });
  });
});

describe("PATCH /api/crm/patients/[id]", () => {
  it("saves a new birth date and phone (the acceptance case)", async () => {
    const { PATCH } = await import("@/app/api/crm/patients/[id]/route");
    const res = await PATCH(patch({ birthDate: "1987-03-14", phone: "+998 93 555 44 33" }));
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({
      birthDate: new Date("1987-03-14T00:00:00.000Z"),
      phone: "+998 93 555 44 33",
      phoneNormalized: "+998935554433",
      phoneVerifiedAt: expect.any(Date),
    });
  });

  it("«Турматов Отабек 1969» in the name: the year goes to the birth date", async () => {
    const { PATCH } = await import("@/app/api/crm/patients/[id]/route");
    await PATCH(patch({ fullName: "Турматов Отабек 1969" }));
    expect(state.updates[0]).toMatchObject({
      fullName: "Турматов Отабек",
      birthDate: new Date("1969-01-01T00:00:00.000Z"),
    });
  });

  it("a birth date typed in the same save wins over the year in the name", async () => {
    const { PATCH } = await import("@/app/api/crm/patients/[id]/route");
    await PATCH(patch({ fullName: "Турматов Отабек 1969", birthDate: "1969-05-12" }));
    expect(state.updates[0]).toMatchObject({
      fullName: "Турматов Отабек",
      birthDate: new Date("1969-05-12T00:00:00.000Z"),
    });
  });

  it("a full date of the same year already on the card is kept", async () => {
    state.before = { ...MINIAPP_CARD, birthDate: new Date("1969-05-12T00:00:00.000Z") };
    const { PATCH } = await import("@/app/api/crm/patients/[id]/route");
    await PATCH(patch({ fullName: "Турматов Отабек 1969" }));
    expect(state.updates[0].fullName).toBe("Турматов Отабек");
    expect(state.updates[0]).not.toHaveProperty("birthDate");
  });

  it("a number that is another patient's identity: 409 naming whose, nothing written", async () => {
    state.owner = { id: "p_owner", fullName: "Каримова Дилноза", birthDate: null };
    const { PATCH } = await import("@/app/api/crm/patients/[id]/route");
    const res = await PATCH(patch({ phone: "+998 90 777 66 55" }));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      reason: "phone_taken",
      owner: { id: "p_owner", fullName: "Каримова Дилноза" },
    });
    expect(state.updates).toEqual([]);
    expect(state.released).toEqual([]);
  });

  it("re-saving the card's own number is not a conflict", async () => {
    state.owner = { id: "p1", fullName: "Jasur", birthDate: null };
    const { PATCH } = await import("@/app/api/crm/patients/[id]/route");
    const res = await PATCH(patch({ phone: "+998 90 123 45 67", gender: "MALE" }));
    expect(res.status).toBe(200);
    expect(state.updates[0]).toMatchObject({ gender: "MALE" });
  });
});
