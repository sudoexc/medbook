import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit MA-10: the Mini App appointment routes spread the whole Appointment
 * row into the patient's response, reception notes (`comments`), staff
 * `notes`, cancel internals and all. Every route returning an appointment to
 * the patient now carries an explicit list of patient-safe fields.
 */

const FORBIDDEN = [
  "comments",
  "notes",
  "cancelReason",
  "cancelledBy",
  "createdById",
  "leadId",
  "confirmedBy",
  "preVisitData",
  "priceBase",
  "discountPct",
  "discountAmount",
  "clinicId",
  "patientId",
  "medicalCaseId",
  "queuePriority",
];

const SAFE_SCALARS = [
  "arrivedAt",
  "channel",
  "date",
  "durationMin",
  "endDate",
  "id",
  "priceFinal",
  "status",
  "ticketCode",
  "time",
];

/** Everything Prisma would have on the row, internal columns included. */
const FULL_ROW = {
  id: "apt_1",
  clinicId: "c1",
  patientId: "p_tg",
  doctorId: "d1",
  cabinetId: "cab1",
  serviceId: "s1",
  date: new Date("2026-10-01T05:00:00Z"),
  time: "10:00",
  durationMin: 30,
  endDate: new Date("2026-10-01T05:30:00Z"),
  ticketCode: "ABC123",
  status: "BOOKED",
  queueStatus: "BOOKED",
  queuePriority: 0,
  arrivedAt: null,
  cancelReason: "пациент грубил",
  cancelledBy: "user_admin",
  confirmedBy: "user_recept",
  medicalCaseId: "case_1",
  channel: "PHONE",
  leadId: "lead_1",
  priceService: 100,
  priceBase: 100,
  discountPct: 10,
  discountAmount: 10,
  priceFinal: 90,
  createdById: "user_recept",
  comments: "конфликтный, долг 400 000",
  notes: "подозрение на алкогольную энцефалопатию",
  preVisitData: { secret: true },
  doctor: {
    id: "d1",
    nameRu: "Бусаков",
    nameUz: "Busakov",
    specializationRu: "Невролог",
    specializationUz: "Nevrolog",
    photoUrl: null,
    salaryPercent: 40,
  },
  cabinet: { id: "cab1", number: "1", floor: 1 },
  primaryService: { id: "s1", nameRu: "Консультация", nameUz: "Konsultatsiya", priceBase: 100 },
  services: [
    {
      id: "as1",
      priceSnap: 100,
      service: { id: "s1", nameRu: "Консультация", nameUz: "Konsultatsiya", priceBase: 100 },
    },
  ],
  payments: [{ id: "pay1", amount: 90, status: "PAID", method: "CASH", externalRef: "x" }],
  visitNote: {
    followUpDays: 14,
    finalizedAt: new Date("2026-10-01T06:00:00Z"),
    followUpNote: "внутреннее",
    conclusionDocument: { id: "doc1" },
  },
};

/** What Prisma returns for a `select`: only the selected keys, recursively. */
function project(value: unknown, select: Record<string, unknown>): unknown {
  if (Array.isArray(value)) return value.map((v) => project(v, select));
  if (value === null || typeof value !== "object" || value instanceof Date) return value;
  const out: Record<string, unknown> = {};
  for (const [k, spec] of Object.entries(select)) {
    const v = (value as Record<string, unknown>)[k];
    if (spec === true) out[k] = v;
    else if (spec && typeof spec === "object" && "select" in spec) {
      out[k] = v == null ? v : project(v, (spec as { select: Record<string, unknown> }).select);
    }
  }
  return out;
}

const state = vi.hoisted(() => ({
  findManyArgs: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/server/miniapp/handler", () => {
  const ctx = {
    clinicId: "c1",
    clinicSlug: "neurofax",
    patientId: "p_tg",
    patient: { id: "p_tg", fullName: "Dilnoza", preferredLang: "RU" },
  };
  const wrap =
    (
      opts: { bodySchema?: { parse: (v: unknown) => unknown } },
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) => {
      const body = opts?.bodySchema ? opts.bodySchema.parse(await request.json()) : undefined;
      return handler({ request, body, ctx });
    };
  return {
    createMiniAppHandler: wrap,
    createMiniAppListHandler: wrap,
  };
});

vi.mock("@/lib/prisma", () => {
  const appointment = {
    findMany: vi.fn(async (args: { select?: Record<string, unknown> }) => {
      state.findManyArgs.push(args as Record<string, unknown>);
      return [args.select ? project(FULL_ROW, args.select) : FULL_ROW];
    }),
    findFirst: vi.fn(async () => ({ ...FULL_ROW })),
    update: vi.fn(async () => ({ ...FULL_ROW, time: "11:00" })),
  };
  const tx = {
    appointment,
    appointmentService: { deleteMany: vi.fn(), createMany: vi.fn() },
    service: { findMany: vi.fn(async () => []) },
  };
  return {
    prisma: {
      appointment,
      doctor: { findFirst: vi.fn(async () => ({ id: "d1" })) },
      service: { findMany: vi.fn(async () => []) },
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    },
  };
});

vi.mock("@/server/miniapp/active-patient", () => ({
  resolveActivePatient: vi.fn(async () => ({
    ok: true,
    patientId: "p_tg",
    isOnBehalfOf: false,
    preferredLang: "RU",
  })),
}));
vi.mock("@/server/miniapp/idempotency", () => ({
  withIdempotency: (_r: Request, _s: unknown, fn: () => Promise<Response>) => fn(),
}));
vi.mock("@/server/observability/metrics", () => ({
  getMetrics: () => ({ bookingDuration: { observe: () => undefined } }),
}));
vi.mock("@/server/appointments/book", () => ({ bookAppointment: vi.fn() }));
vi.mock("@/server/appointments/cancel", () => ({
  cancelAppointment: vi.fn(async () => ({
    ok: true,
    appointment: { ...FULL_ROW, status: "CANCELLED" },
  })),
}));
vi.mock("@/server/services/appointments", () => ({
  computeEndDate: (d: Date, min: number) => new Date(d.getTime() + min * 60_000),
  detectConflicts: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/server/notifications/triggers", () => ({ fireTrigger: vi.fn() }));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: vi.fn(async () => ({ eventId: "ev1" })),
}));

import { GET } from "@/app/api/miniapp/appointments/route";
import { DELETE, PATCH } from "@/app/api/miniapp/appointments/[id]/route";
import {
  MINIAPP_APPOINTMENT_SELECT,
  toMiniAppAppointmentSummary,
} from "@/server/miniapp/appointment-view";

async function json(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}

function expectNoInternals(obj: Record<string, unknown>) {
  for (const k of FORBIDDEN) expect(obj, k).not.toHaveProperty(k);
}

beforeEach(() => {
  state.findManyArgs.length = 0;
});

describe("GET /api/miniapp/appointments", () => {
  it("selects explicitly (no include) and returns exactly the patient-safe keys", async () => {
    const res = await GET(
      new Request("http://x/api/miniapp/appointments?clinicSlug=neurofax&scope=past"),
    );
    expect(res.status).toBe(200);
    const args = state.findManyArgs[0]!;
    expect(args).not.toHaveProperty("include");
    expect(args.select).toBe(MINIAPP_APPOINTMENT_SELECT);

    const body = await json(res);
    const [appt] = body.appointments as Array<Record<string, unknown>>;
    expect(Object.keys(appt!).sort()).toEqual(
      [
        ...SAFE_SCALARS,
        "cabinet",
        "conclusionUrl",
        "doctor",
        "followUpAt",
        "payments",
        "primaryService",
        "services",
      ].sort(),
    );
    expectNoInternals(appt!);
    expect(appt).not.toHaveProperty("visitNote");
    expect(appt!.services).toEqual([
      { service: { id: "s1", nameRu: "Консультация", nameUz: "Konsultatsiya", priceBase: 100 } },
    ]);
    expect(appt!.conclusionUrl).toBe("/api/miniapp/documents/doc1/file?clinicSlug=neurofax");
  });

  it("the select itself names no internal column", () => {
    for (const k of FORBIDDEN) expect(MINIAPP_APPOINTMENT_SELECT).not.toHaveProperty(k);
  });
});

describe("PATCH / DELETE /api/miniapp/appointments/[id]", () => {
  it("cancel via PATCH answers with patient-safe fields only", async () => {
    const res = await PATCH(
      new Request("http://x/api/miniapp/appointments/apt_1?clinicSlug=neurofax", {
        method: "PATCH",
        body: JSON.stringify({ cancel: true, cancelReason: "не смогу" }),
      }),
    );
    expect(res.status).toBe(200);
    const appt = (await json(res)).appointment as Record<string, unknown>;
    expect(Object.keys(appt).sort()).toEqual(SAFE_SCALARS);
    expect(appt.status).toBe("CANCELLED");
  });

  it("reschedule answers with patient-safe fields only", async () => {
    const res = await PATCH(
      new Request("http://x/api/miniapp/appointments/apt_1?clinicSlug=neurofax", {
        method: "PATCH",
        body: JSON.stringify({ startAt: "2026-10-02T06:00:00.000Z" }),
      }),
    );
    expect(res.status).toBe(200);
    const appt = (await json(res)).appointment as Record<string, unknown>;
    expect(Object.keys(appt).sort()).toEqual(SAFE_SCALARS);
    expectNoInternals(appt);
  });

  it("DELETE answers with patient-safe fields only", async () => {
    const res = await DELETE(
      new Request("http://x/api/miniapp/appointments/apt_1?clinicSlug=neurofax", {
        method: "DELETE",
      }),
    );
    expect(res.status).toBe(200);
    const appt = (await json(res)).appointment as Record<string, unknown>;
    expect(Object.keys(appt).sort()).toEqual(SAFE_SCALARS);
  });
});

describe("toMiniAppAppointmentSummary", () => {
  it("drops every internal column of a full row", () => {
    const out = toMiniAppAppointmentSummary(FULL_ROW as never);
    expect(Object.keys(out).sort()).toEqual(SAFE_SCALARS);
  });
});
