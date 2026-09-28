/**
 * Audit PT-16: a case counts money and visit numbers the way the patient
 * card and the pricing engine do.
 *
 * Scenario from the card: the patient cancelled the 01.09 visit, came on
 * 03.09 and paid 300 000 сум, and is booked for 20.09. The case read
 * «Оплачено: 900 000 сум» (every visit's price, in a clinic that records no
 * payments), the 03.09 visit was «Повторный (2-й)», and the printed card
 * said «Итого начислено 600 000 сум».
 *
 * Acceptance: no fake «Оплачено» (payments are not tracked: only the cost
 * of what took place; when they are, the real 300 000), the 03.09 visit is
 * «Первичный», the print says «Итого начислено 300 000».
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  caseVisitOrdinals,
  caseVisitStats,
  numberedSiblingsWhere,
} from "@/lib/cases/case-visits";
import { formatMoney } from "@/lib/format";

const SUM = 100; // тийин per сум

const VISITS = [
  { id: "a-0109", date: new Date("2026-09-01T05:00:00Z"), status: "CANCELLED", priceFinal: 300_000 * SUM },
  { id: "a-0309", date: new Date("2026-09-03T05:00:00Z"), status: "COMPLETED", priceFinal: 300_000 * SUM },
  { id: "a-2009", date: new Date("2026-09-20T05:00:00Z"), status: "BOOKED", priceFinal: 300_000 * SUM },
];

const state = vi.hoisted(() => ({
  trackedSince: null as Date | null,
  payments: [] as Array<{ appointmentId: string; amount: number; status: string }>,
  role: "DOCTOR",
}));

vi.mock("@/lib/api-handler", () => {
  const ctx = () => ({ kind: "TENANT", clinicId: "c1", userId: "u1", role: state.role });
  return {
    createApiHandler:
      (_o: unknown, handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, body: undefined, ctx: ctx() }),
    createApiListHandler:
      (_o: unknown, handler: (a: { request: Request; ctx: unknown }) => Promise<Response>) =>
      async (request: Request) =>
        handler({ request, ctx: ctx() }),
  };
});
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => undefined) }));
vi.mock("@/server/audit/patient-view", () => ({ recordPatientView: vi.fn() }));
vi.mock("@/server/storage/inline-image", () => ({ inlineStorageImage: vi.fn(async () => null) }));
vi.mock("@/lib/prisma", () => {
  const appts = () =>
    VISITS.map((v) => ({
      ...v,
      clinicId: "c1",
      medicalCaseId: "case1",
      time: null,
      durationMin: 30,
      doctorId: "d1",
      completedAt: v.status === "COMPLETED" ? v.date : null,
      doctor: { id: "d1", nameRu: "Султанов Азиз", nameUz: "Sultanov Aziz", color: null, photoUrl: null },
      primaryService: { id: "s1", nameRu: "Консультация", nameUz: "Konsultatsiya" },
      services: [],
      payments: state.payments.filter((p) => p.appointmentId === v.id && p.status === "PAID").map(() => ({ id: "pay" })),
    }));
  const caseRow = () => ({
    id: "case1",
    clinicId: "c1",
    patientId: "p1",
    primaryDoctorId: "d1",
    title: "Головная боль",
    status: "OPEN",
    primaryComplaint: "Головная боль",
    diagnosisText: "G43.0 Мигрень без ауры",
    diagnosisCode: "G43.0",
    notes: null,
    soapDraft: "S: жалобы",
    openedAt: new Date("2026-09-01T00:00:00Z"),
    closedAt: null,
    closedReason: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-03T00:00:00Z"),
    primaryDoctor: null,
    patient: { id: "p1", fullName: "Пациент", phone: "+998901112233", birthDate: null, gender: null },
    appointments: appts(),
    prescriptions: [],
  });
  return {
    prisma: {
      medicalCase: { findUnique: vi.fn(async () => caseRow()) },
      clinic: {
        findUnique: vi.fn(async () => ({
          id: "c1",
          nameRu: "Клиника",
          nameUz: "Klinika",
          addressRu: null,
          addressUz: null,
          phone: null,
          logoUrl: null,
          brandColor: null,
          paymentsTrackedSince: state.trackedSince,
        })),
      },
      appointment: {
        findMany: vi.fn(async ({ where }: { where: { medicalCaseId?: string; status?: string } }) =>
          appts().filter(
            (a) =>
              (where.medicalCaseId === undefined || a.medicalCaseId === where.medicalCaseId) &&
              (where.status === undefined || a.status === where.status),
          ),
        ),
      },
      payment: {
        findMany: vi.fn(async ({ where }: { where: { appointment?: { medicalCaseId: string } } }) =>
          state.payments
            .filter((p) => p.status === "PAID" && where.appointment?.medicalCaseId === "case1")
            .map((p) => ({ amount: p.amount, refundedAmount: 0, currency: "UZS", fxRate: null })),
        ),
      },
      exchangeRate: { findFirst: vi.fn(async () => null) },
    },
  };
});

beforeEach(() => {
  state.trackedSince = null;
  state.payments = [];
  state.role = "DOCTOR";
});

describe("visit numbering", () => {
  it("a cancelled visit takes no number: 03.09 is the first, 20.09 the second", () => {
    const n = caseVisitOrdinals(VISITS);
    expect(n.get("a-0109")).toBeNull();
    expect(n.get("a-0309")).toBe(1);
    expect(n.get("a-2009")).toBe(2);
  });

  it("the drawer numbers a visit among the ones that happen, and always itself", () => {
    const where = numberedSiblingsWhere("case1", "a-0109");
    const eligible = VISITS.filter(
      (v) =>
        where.OR.some((o) =>
          "id" in o ? v.id === o.id : !o.status.notIn.includes(v.status as never),
        ),
    ).map((v) => v.id);
    expect(eligible).toEqual(["a-0109", "a-0309", "a-2009"]);
    const forCompleted = numberedSiblingsWhere("case1", "a-0309");
    expect(
      VISITS.filter((v) =>
        forCompleted.OR.some((o) =>
          "id" in o ? v.id === o.id : !o.status.notIn.includes(v.status as never),
        ),
      ).map((v) => v.id),
    ).toEqual(["a-0309", "a-2009"]);
  });

  it("only what took place costs; free repeats are completed repeats at 0", () => {
    expect(caseVisitStats(VISITS)).toEqual({
      numberedVisits: 2,
      completedVisits: 1,
      completedTotal: 300_000 * SUM,
      freeRepeats: 0,
    });
    expect(
      caseVisitStats([
        ...VISITS,
        { id: "a-cancel-free", status: "CANCELLED", priceFinal: 0 },
        { id: "a-free", status: "COMPLETED", priceFinal: 0 },
      ]).freeRepeats,
    ).toBe(1);
  });
});

describe("GET /api/crm/cases/[id]", () => {
  it("payments not tracked: no «Оплачено», the cost of the visit that took place", async () => {
    const { GET } = await import("@/app/api/crm/cases/[id]/route");
    const res = await GET(new Request("https://x/api/crm/cases/case1"));
    const body = await res.json();
    expect(body.visitCount).toBe(2);
    expect(body.finance).toMatchObject({
      tracksPayments: false,
      paid: 0,
      visitsTotal: 300_000 * SUM,
    });
  });

  it("payments tracked: «Оплачено» is what was actually paid", async () => {
    state.trackedSince = new Date("2026-08-01T00:00:00Z");
    state.payments = [{ appointmentId: "a-0309", amount: 300_000 * SUM, status: "PAID" }];
    const { GET } = await import("@/app/api/crm/cases/[id]/route");
    const body = await (await GET(new Request("https://x/api/crm/cases/case1"))).json();
    expect(body.finance).toMatchObject({
      tracksPayments: true,
      paid: 300_000 * SUM,
      visitsTotal: 300_000 * SUM,
      debt: 0,
    });
  });
});

describe("the printed «Карта случая»", () => {
  it("«Итого начислено 300 000», 03.09 «Первичный», the cancelled visit «Не состоялся»", async () => {
    const { GET } = await import("@/app/api/crm/cases/[id]/pdf/route");
    const html = await (await GET(new Request("https://x/api/crm/cases/case1/pdf?lang=ru"))).text();
    const total = html.slice(html.indexOf("Итого начислено"));
    expect(total).toContain(formatMoney(300_000 * SUM, "UZS", "ru"));
    expect(total).not.toContain(formatMoney(600_000 * SUM, "UZS", "ru"));
    const rows = html.slice(html.indexOf("<tbody>"), html.indexOf("</tbody>"));
    const cells = rows.split("<tr>").slice(1);
    expect(cells[0]).toContain("Не состоялся");
    expect(cells[1]).toContain("Первичный");
    expect(cells[1]).not.toContain("Повторный");
    expect(cells[2]).toContain("Повторный (2-я)");
  });
});
