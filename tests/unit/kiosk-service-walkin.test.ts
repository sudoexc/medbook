/**
 * Audit Q-06: the service chosen on the kiosk reached nobody.
 *
 * The patient picked «ЭЭГ, 250 000 сум», confirmed, and the walk-in sent
 * only name, phone and doctor: the visit had no service and was priced as a
 * consultation, the cash desk showed another price, and the slip printed no
 * «Услуга» line.
 *
 * Pinned here:
 *   - /api/kiosk/doctors lists each service with its id and THIS doctor's
 *     price (his override over the catalog's);
 *   - registerWalkin stores the service as the visit's primary service and
 *     line, priced at that same price, and refuses a service the doctor does
 *     not offer before any patient card is touched;
 *   - the kiosk walk-in route forwards the id and answers 409
 *     `service_not_offered`;
 *   - the kiosk sends the id (walkinRequestBody).
 * The printed line itself is pinned in kiosk-print-frame.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  link: null as null | Record<string, unknown>,
  linkArgs: [] as Array<Record<string, unknown>>,
  created: [] as Array<Record<string, unknown>>,
  lines: [] as Array<Record<string, unknown>>,
  patientLookups: 0,
  verified: [] as string[],
  doctorsRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/prisma", () => {
  const tx = {
    appointment: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.created.push(data);
        return { id: "appt_1" };
      }),
    },
    appointmentService: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        h.lines.push(data);
        return data;
      }),
    },
  };
  return {
    prisma: {
      doctor: {
        findFirst: vi.fn(async () => ({
          id: "doc_1",
          nameRu: "Султанов Азиз",
          nameUz: "Sultonov Aziz",
          color: null,
          pricePerVisit: 20_000_000,
          cabinetId: "cab_1",
          ticketPrefix: "A",
          cabinet: { number: "3" },
        })),
        findMany: vi.fn(async () => h.doctorsRows),
      },
      serviceOnDoctor: {
        findFirst: vi.fn(async (args: Record<string, unknown>) => {
          h.linkArgs.push(args);
          return h.link;
        }),
      },
      patient: {
        findFirst: vi.fn(async () => {
          h.patientLookups += 1;
          return { id: "p1", fullName: "Каримова Дилноза" };
        }),
      },
      __tx: tx,
    },
  };
});

vi.mock("@/server/appointments/queue-order", async () => {
  const { prisma } = (await import("@/lib/prisma")) as unknown as {
    prisma: { __tx: unknown };
  };
  return {
    runQueueTx: async (fn: (tx: unknown) => unknown) => fn(prisma.__tx),
    allocateQueueOrder: vi.fn(async () => ({ queueOrder: 4, ticketSeq: 4 })),
  };
});
vi.mock("@/server/appointments/ticket-code", () => ({
  generateTicketCode: vi.fn(async () => "TK1"),
}));
vi.mock("@/server/realtime/publish", () => ({ publishEventSafe: vi.fn() }));
vi.mock("@/server/patient/segments", () => ({
  refreshPatientSegment: vi.fn(async () => undefined),
}));
vi.mock("@/server/doctors/on-duty", () => ({
  loadOnDutyDoctorIds: vi.fn(async () => new Set(["doc_1"])),
}));
vi.mock("@/server/patient/phone-identity", () => ({
  verifyPhoneInPerson: vi.fn(async (_db: unknown, _c: string, id: string) => {
    h.verified.push(id);
  }),
  releaseUnverifiedPhone: vi.fn(),
  contactPhoneStub: () => "contact:x",
  isUniqueViolation: () => false,
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_c: unknown, fn: () => unknown) => fn(),
}));
vi.mock("@/lib/public-clinic", () => ({
  resolvePublicClinic: vi.fn(async () => ({ id: "c1", slug: "neurofax" })),
}));

import { registerWalkin } from "@/server/appointments/walkin";
import { walkinRequestBody } from "@/lib/kiosk-flow";

const EEG = {
  priceOverride: 25_000_000,
  durationMinOverride: null,
  service: { id: "svc_eeg", priceBase: 15_000_000, durationMin: 40 },
};

beforeEach(() => {
  h.link = null;
  h.linkArgs = [];
  h.created = [];
  h.lines = [];
  h.patientLookups = 0;
  h.verified = [];
  h.doctorsRows = [];
});

describe("registerWalkin with the kiosk's service", () => {
  it("stores the service on the visit, priced at this doctor's price for it", async () => {
    h.link = EEG;
    const r = await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_1",
      patient: { id: "p1" },
      serviceId: "svc_eeg",
    });
    expect(r.ok).toBe(true);
    const where = h.linkArgs[0]!.where as Record<string, unknown>;
    expect(where).toMatchObject({
      doctorId: "doc_1",
      serviceId: "svc_eeg",
      service: { clinicId: "c1", isActive: true },
    });
    expect(h.created[0]).toMatchObject({
      serviceId: "svc_eeg",
      priceService: 25_000_000,
      priceBase: 25_000_000,
      priceFinal: 25_000_000,
      // The service's own length, not the 30 minute default.
      durationMin: 40,
    });
    expect(h.lines).toEqual([
      {
        clinicId: "c1",
        appointmentId: "appt_1",
        serviceId: "svc_eeg",
        priceSnap: 25_000_000,
        quantity: 1,
      },
    ]);
  });

  it("the catalog price when the doctor has no price of his own", async () => {
    h.link = { ...EEG, priceOverride: null };
    await registerWalkin({ clinicId: "c1", doctorId: "doc_1", patient: { id: "p1" }, serviceId: "svc_eeg" });
    expect(h.created[0]).toMatchObject({ priceFinal: 15_000_000 });
  });

  it("refuses a service the doctor does not offer, before any patient card is touched", async () => {
    h.link = null;
    const r = await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_1",
      patient: { id: "p1" },
      serviceId: "svc_other",
    });
    expect(r).toEqual({ ok: false, reason: "service_not_offered" });
    expect(h.patientLookups).toBe(0);
    expect(h.created).toHaveLength(0);
  });

  it("P1D-02: a Mini App claim picked on the kiosk becomes the verified number", async () => {
    await registerWalkin({
      clinicId: "c1",
      doctorId: "doc_1",
      patient: { id: "p1", confirmPhoneClaim: true },
    });
    expect(h.verified).toEqual(["p1"]);
    await registerWalkin({ clinicId: "c1", doctorId: "doc_1", patient: { id: "p1" } });
    expect(h.verified).toEqual(["p1"]);
  });

  it("without a service: the consultation price, no line, as before", async () => {
    await registerWalkin({ clinicId: "c1", doctorId: "doc_1", patient: { id: "p1" } });
    expect(h.linkArgs).toHaveLength(0);
    expect(h.created[0]).toMatchObject({ priceBase: 20_000_000, priceFinal: 20_000_000, durationMin: 30 });
    expect(h.created[0]).not.toHaveProperty("serviceId");
    expect(h.lines).toHaveLength(0);
  });
});

describe("/api/kiosk/doctors", () => {
  it("each service carries its id and this doctor's price in whole soms", async () => {
    h.doctorsRows = [
      {
        id: "doc_1",
        nameRu: "Султанов Азиз",
        nameUz: "Sultonov Aziz",
        cabinet: { number: "3" },
        services: [
          {
            priceOverride: 25_000_000,
            service: { id: "svc_eeg", nameRu: "ЭЭГ", nameUz: "EEG", priceBase: 15_000_000, isActive: true },
          },
          {
            priceOverride: null,
            service: { id: "svc_cons", nameRu: "Консультация", nameUz: "Konsultatsiya", priceBase: 20_000_000, isActive: true },
          },
          {
            priceOverride: null,
            service: { id: "svc_off", nameRu: "Старая", nameUz: "Eski", priceBase: 1, isActive: false },
          },
        ],
      },
    ];
    const { GET } = await import("@/app/api/kiosk/doctors/route");
    const body = await (await GET(new Request("https://x/api/kiosk/doctors?c=neurofax"))).json();
    expect(body[0].services).toEqual([
      { id: "svc_eeg", nameRu: "ЭЭГ", nameUz: "EEG", price: 250_000 },
      { id: "svc_cons", nameRu: "Консультация", nameUz: "Konsultatsiya", price: 200_000 },
    ]);
  });
});

describe("the kiosk sends the chosen service by id", () => {
  it("serviceId in the walk-in body; nothing when skipped", () => {
    const base = {
      fullName: "Каримова Дилноза",
      phone: "+998901234567",
      doctorId: "doc_1",
      lang: "ru" as const,
      pickedPatientId: null,
      notOwner: false,
    };
    expect(
      walkinRequestBody({
        ...base,
        service: { id: "svc_eeg", nameRu: "ЭЭГ", nameUz: "EEG", price: 250_000 },
      }),
    ).toMatchObject({ serviceId: "svc_eeg", doctorId: "doc_1", lang: "RU" });
    expect(walkinRequestBody({ ...base, service: null })).not.toHaveProperty("serviceId");
  });
});
