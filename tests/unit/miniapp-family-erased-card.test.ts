/**
 * Final review of P5: after a DSAR erasure the Mini App family link
 * survived. A son who managed his mother in «Семья» still saw «Удалённый
 * пациент» in the switcher, and with `?onBehalfOf=<her card>` he opened her
 * kept medical record and booked new visits onto the erased card.
 *
 * The erasure now deletes the links (p5-privacy-dsar-erasure.test.ts); and
 * a link left to a deleted card (erased before this release, or removed at
 * the desk) opens nothing: the family check, the account's card set and
 * the family list all skip a card with `deletedAt`.
 *
 * The prisma mock applies the `linkedPatient.deletedAt` filter only when
 * the query asks for it, so a query without it returns the erased card, as
 * the database did.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Link = {
  id: string;
  clinicId: string;
  ownerPatientId: string;
  linkedPatientId: string;
  relationship: string;
  createdAt: Date;
  linkedPatient: {
    id: string;
    fullName: string;
    phone: string;
    birthDate: Date | null;
    gender: string | null;
    preferredLang: string | null;
    deletedAt: Date | null;
  };
};

const state = vi.hoisted(() => ({ links: [] as Link[] }));

const CTX = {
  clinicId: "c1",
  clinicSlug: "neurofax",
  patientId: "p_son",
  preferredLang: "RU" as const,
  patient: { id: "p_son", fullName: "Каримов Сардор", preferredLang: "RU" },
};

type FamilyWhere = {
  clinicId?: string;
  ownerPatientId?: string;
  linkedPatientId?: string;
  linkedPatient?: { deletedAt?: null };
};

function matches(link: Link, where: FamilyWhere): boolean {
  if (where.clinicId !== undefined && link.clinicId !== where.clinicId) return false;
  if (where.ownerPatientId !== undefined && link.ownerPatientId !== where.ownerPatientId) {
    return false;
  }
  if (where.linkedPatientId !== undefined && link.linkedPatientId !== where.linkedPatientId) {
    return false;
  }
  if (where.linkedPatient && where.linkedPatient.deletedAt === null) {
    if (link.linkedPatient.deletedAt !== null) return false;
  }
  return true;
}

vi.mock("@/lib/prisma", () => ({
  prisma: {
    patientFamily: {
      findFirst: vi.fn(async ({ where }: { where: FamilyWhere }) => {
        const l = state.links.find((x) => matches(x, where));
        return l ? { linkedPatient: l.linkedPatient } : null;
      }),
      findMany: vi.fn(async ({ where, select }: { where: FamilyWhere; select?: unknown }) =>
        state.links
          .filter((x) => matches(x, where))
          .map((l) => (select ? { linkedPatientId: l.linkedPatientId } : l)),
      ),
    },
    patient: {
      findFirst: vi.fn(async () => ({
        id: "p_son",
        fullName: "Каримов Сардор",
        phone: "+998901112233",
        birthDate: null,
        gender: "MALE",
      })),
    },
  },
}));

vi.mock("@/server/miniapp/handler", () => {
  const wrap =
    (_opts: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
    async (request: Request) =>
      handler({ request, ctx: CTX });
  return { createMiniAppHandler: wrap, createMiniAppListHandler: wrap };
});
vi.mock("@/server/services/patient-number", () => ({
  allocatePatientNumber: vi.fn(async () => "P-0100"),
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => undefined),
}));

function link(id: string, patientId: string, deletedAt: Date | null, fullName: string): Link {
  return {
    id,
    clinicId: "c1",
    ownerPatientId: "p_son",
    linkedPatientId: patientId,
    relationship: "parent",
    createdAt: new Date("2026-09-01T00:00:00Z"),
    linkedPatient: {
      id: patientId,
      fullName,
      phone: "",
      birthDate: null,
      gender: null,
      preferredLang: "UZ",
      deletedAt,
    },
  };
}

beforeEach(() => {
  state.links = [
    link("l_mama", "p_mama", new Date("2026-09-30T10:00:00Z"), "Удалённый пациент"),
    link("l_daughter", "p_daughter", null, "Каримова Малика"),
  ];
});

describe("a family link to a deleted card opens nothing", () => {
  it("onBehalfOf the erased mother is not linked (403 in every route)", async () => {
    const { resolveActivePatient } = await import("@/server/miniapp/active-patient");
    expect(await resolveActivePatient({ ctx: CTX, onBehalfOf: "p_mama" })).toEqual({
      ok: false,
      reason: "on_behalf_of_not_linked",
    });
    // A live relative still works.
    expect(await resolveActivePatient({ ctx: CTX, onBehalfOf: "p_daughter" })).toMatchObject({
      ok: true,
      patientId: "p_daughter",
      isOnBehalfOf: true,
      ownerPatientId: "p_son",
    });
  });

  it("the account's cards (SSE filter, booking and upload limits) leave her out", async () => {
    const { getFamilyAllowedPatientIds } = await import("@/server/miniapp/active-patient");
    expect(await getFamilyAllowedPatientIds("c1", "p_son")).toEqual(["p_son", "p_daughter"]);
  });

  it("the «Семья» list no longer shows «Удалённый пациент»", async () => {
    const { GET } = await import("@/app/api/miniapp/family/route");
    const res = await GET(new Request("https://neurofax.uz/api/miniapp/family?clinicSlug=neurofax"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { members: Array<{ patient: { id: string } }> };
    expect(body.members.map((m) => m.patient.id)).toEqual(["p_daughter"]);
  });
});
