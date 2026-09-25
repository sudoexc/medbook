import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit PT-02: a Mini App follow-up that was silently filed under the
 * patient's open case kept its full price, while the same attach from the CRM
 * made it free under the service's `freeRepeatDays`. The Mini App paths set
 * `medicalCaseId` bare; now every attach re-prices in the same transaction
 * and writes the `appointment.free_repeat_applied` audit. And two bookings
 * racing with no open case used to create two «Новая жалоба» cases.
 *
 * The real pricing engine runs here against a small in-memory store.
 */

type Appt = {
  id: string;
  patientId: string;
  date: Date;
  createdAt: Date;
  status: string;
  medicalCaseId: string | null;
  serviceId: string;
  priceService: number | null;
  priceBase: number | null;
  priceFinal: number | null;
  discountPct: number;
  discountAmount: number;
};
type Case = { id: string; patientId: string; status: string; title: string };

const CONSULT = { id: "svc_consult", priceBase: 300_000, freeRepeatDays: 14 };

const store = vi.hoisted(() => ({
  appts: [] as Appt[],
  cases: [] as Case[],
  audits: [] as Array<Record<string, unknown>>,
  calls: [] as string[],
  lock: Promise.resolve() as Promise<void>,
}));

function makeTx() {
  return {
    $executeRaw: vi.fn(async () => {
      store.calls.push("lock");
      return 1;
    }),
    medicalCase: {
      findMany: vi.fn(async ({ where }: { where: { patientId: string; status: string } }) => {
        store.calls.push("read-open-cases");
        return store.cases
          .filter((c) => c.patientId === where.patientId && c.status === where.status)
          .map((c) => ({
            ...c,
            primaryDoctor: null,
            appointments: [],
            _count: { appointments: store.appts.filter((a) => a.medicalCaseId === c.id).length },
          }));
      }),
      create: vi.fn(async ({ data }: { data: Omit<Case, "id"> }) => {
        const c = { id: `case_${store.cases.length + 1}`, ...data };
        store.cases.push(c as Case);
        return { id: c.id, title: c.title };
      }),
    },
    appointment: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Appt> }) => {
        const a = store.appts.find((x) => x.id === where.id)!;
        Object.assign(a, data);
        return a;
      }),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { medicalCaseId: string; OR?: unknown };
        }) => {
          const rows = store.appts
            .filter((a) => a.medicalCaseId === where.medicalCaseId)
            .filter((a) =>
              where.OR ? a.status !== "CANCELLED" && a.status !== "NO_SHOW" : true,
            )
            .sort((x, y) => x.date.getTime() - y.date.getTime());
          return rows.map((a) => ({ id: a.id, date: a.date }));
        },
      ),
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const a = store.appts.find((x) => x.id === where.id);
        if (!a) return null;
        return {
          ...a,
          payments: [],
          services: [],
          primaryService: CONSULT,
        };
      }),
    },
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        store.audits.push(data);
        return data;
      }),
    },
  };
}

vi.mock("@/lib/prisma", () => {
  const prisma = {
    // A transaction holds the per-patient advisory lock for its whole body,
    // like pg_advisory_xact_lock: the next one waits for the previous commit.
    $transaction: vi.fn(async (fn: (tx: ReturnType<typeof makeTx>) => unknown) => {
      const prev = store.lock;
      let release!: () => void;
      store.lock = new Promise<void>((r) => (release = r));
      const tx = makeTx();
      tx.$executeRaw = vi.fn(async () => {
        store.calls.push("lock");
        await prev;
        return 1;
      });
      try {
        return await fn(tx);
      } finally {
        release();
      }
    }),
  };
  return { prisma };
});

vi.mock("@/server/miniapp/handler", () => ({
  createMiniAppHandler:
    (
      opts: { bodySchema: { parse: (v: unknown) => unknown } },
      handler: (a: { request: Request; body: unknown; ctx: unknown }) => Promise<Response>,
    ) =>
    async (request: Request) =>
      handler({
        request,
        body: opts.bodySchema.parse(await request.json()),
        ctx: { clinicId: "c1", patientId: "p1", patient: { preferredLang: "RU" } },
      }),
}));

import { autoAttachCase } from "@/server/cases/attach";

const PATIENT_ACTOR = {
  actor: {
    role: "PATIENT" as const,
    userId: null,
    patientId: "p1",
    onBehalfOfPatientId: null,
    label: "patient:p1",
  },
  surface: "MINIAPP" as const,
  correlationId: "corr_1",
};

function appt(id: string, date: string, medicalCaseId: string | null = null): Appt {
  return {
    id,
    patientId: "p1",
    date: new Date(date),
    createdAt: new Date(date),
    status: "BOOKED",
    medicalCaseId,
    serviceId: CONSULT.id,
    priceService: CONSULT.priceBase,
    priceBase: CONSULT.priceBase,
    priceFinal: CONSULT.priceBase,
    discountPct: 0,
    discountAmount: 0,
  };
}

function attachInput(appointmentId: string) {
  return {
    clinicId: "c1",
    patientId: "p1",
    appointmentId,
    doctorId: "d1",
    startAt: store.appts.find((a) => a.id === appointmentId)!.date,
    preferredLang: "RU" as const,
    primaryComplaint: null,
    audit: PATIENT_ACTOR,
  };
}

beforeEach(() => {
  store.appts = [];
  store.cases = [];
  store.audits = [];
  store.calls = [];
  store.lock = Promise.resolve();
});

describe("Mini App auto-attach re-prices by the free-repeat rule", () => {
  it("a follow-up inside freeRepeatDays of the one open case becomes free, with the audit row", async () => {
    store.cases = [{ id: "case_head", patientId: "p1", status: "OPEN", title: "Головные боли" }];
    store.appts = [
      { ...appt("first", "2026-09-01T05:00:00Z", "case_head"), status: "COMPLETED" },
      appt("repeat", "2026-09-10T05:00:00Z"),
    ];

    const out = await autoAttachCase(attachInput("repeat"));

    expect(out).toEqual({ kind: "auto", caseId: "case_head" });
    const repeat = store.appts.find((a) => a.id === "repeat")!;
    expect(repeat.medicalCaseId).toBe("case_head");
    expect(repeat.priceFinal).toBe(0);
    // The first visit stays paid.
    expect(store.appts.find((a) => a.id === "first")!.priceFinal).toBe(300_000);

    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toMatchObject({
      action: "appointment.free_repeat_applied",
      entityId: "repeat",
      actorRole: "PATIENT",
      actorLabel: "patient:p1",
      surface: "MINIAPP",
    });
  });

  it("outside the window the price stays and no audit is written", async () => {
    store.cases = [{ id: "case_head", patientId: "p1", status: "OPEN", title: "Головные боли" }];
    store.appts = [
      { ...appt("first", "2026-08-01T05:00:00Z", "case_head"), status: "COMPLETED" },
      appt("late", "2026-09-10T05:00:00Z"),
    ];
    await autoAttachCase(attachInput("late"));
    expect(store.appts.find((a) => a.id === "late")!.priceFinal).toBe(300_000);
    expect(store.audits).toHaveLength(0);
  });

  it("takes the per-patient lock before reading the open cases", async () => {
    store.appts = [appt("a1", "2026-09-10T05:00:00Z")];
    await autoAttachCase(attachInput("a1"));
    expect(store.calls.slice(0, 2)).toEqual(["lock", "read-open-cases"]);
  });

  it("two simultaneous bookings with no open case create ONE case", async () => {
    store.appts = [
      appt("a1", "2026-09-10T05:00:00Z"),
      appt("a2", "2026-09-11T05:00:00Z"),
    ];
    const [r1, r2] = await Promise.all([
      autoAttachCase(attachInput("a1")),
      autoAttachCase(attachInput("a2")),
    ]);
    expect(store.cases).toHaveLength(1);
    expect(r1.kind).toBe("created");
    expect(r2).toEqual({ kind: "auto", caseId: store.cases[0]!.id });
    expect(store.appts.every((a) => a.medicalCaseId === store.cases[0]!.id)).toBe(true);
  });
});

describe("POST /api/miniapp/appointments/[id]/attach-case", () => {
  it("the patient's own pick re-prices the visit exactly like the CRM attach", async () => {
    store.cases = [{ id: "case_head", patientId: "p1", status: "OPEN", title: "Головные боли" }];
    store.appts = [
      { ...appt("first", "2026-09-01T05:00:00Z", "case_head"), status: "COMPLETED" },
      appt("repeat", "2026-09-10T05:00:00Z"),
    ];
    const prismaMod = (await import("@/lib/prisma")) as unknown as {
      prisma: Record<string, unknown>;
    };
    // Route-level reads outside the transaction.
    prismaMod.prisma.appointment = {
      findFirst: vi.fn(async () => {
        const a = store.appts.find((x) => x.id === "repeat")!;
        return { id: a.id, doctorId: "d1", date: a.date, medicalCaseId: a.medicalCaseId };
      }),
    };
    prismaMod.prisma.medicalCase = {
      findFirst: vi.fn(async () => ({ id: "case_head", title: "Головные боли", status: "OPEN" })),
    };

    const { POST } = await import("@/app/api/miniapp/appointments/[id]/attach-case/route");
    const res = await POST(
      new Request("https://x/api/miniapp/appointments/repeat/attach-case", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ caseId: "case_head" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(store.appts.find((a) => a.id === "repeat")!.priceFinal).toBe(0);
    expect(store.audits[0]).toMatchObject({
      action: "appointment.free_repeat_applied",
      entityId: "repeat",
      surface: "MINIAPP",
    });
  });
});
