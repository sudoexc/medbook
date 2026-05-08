/**
 * Unit tests for GET /api/crm/patients/[id]/communications — Phase 12 unified
 * timeline aggregation.
 *
 * We mock everything the route imports (auth / api-handler / prisma) so the
 * handler runs straight through without spinning up the Next/Prisma runtime.
 *
 * Covered scenarios:
 *   - VISIT only when Appointment.status = COMPLETED
 *   - PAYMENT only when Payment.status = PAID
 *   - DOCUMENT included with category=DOC
 *   - CASE emits both opened + closed rows when both timestamps present;
 *     only opened when closedAt is null
 *   - RESCHEDULE limited to AuditLog rows whose entityId is in the patient's
 *     appointments (single bounded query — no N+1)
 *   - Items sort DESC by `at`
 *   - `category` field is set correctly per kind
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------- in-memory state -------------------------------------------------

type Communication = { id: string; patientId: string; createdAt: Date; channel: string; direction: string; subject: string | null; body: string | null; meta: unknown };
type Call = { id: string; patientId: string; createdAt: Date; direction: "IN" | "OUT" | "MISSED"; fromNumber: string; toNumber: string; durationSec: number | null; tags: string[]; summary: string | null };
type NotificationSend = { id: string; patientId: string; createdAt: Date; channel: string; status: string; body: string; scheduledFor: Date | null; sentAt: Date | null };
type Appointment = {
  id: string;
  patientId: string;
  status: string;
  date: Date;
  comments: string | null;
  priceFinal: number | null;
  doctor: { nameRu: string };
};
type Message = { id: string; createdAt: Date; direction: "IN" | "OUT"; body: string; conversationId: string; status: string; conversation: { patientId: string } };
type Payment = {
  id: string;
  patientId: string;
  status: "PAID" | "PENDING" | "UNPAID";
  amount: number;
  currency: string;
  method: string;
  paidAt: Date | null;
  createdAt: Date;
  appointmentId: string | null;
  receiptNumber: string | null;
};
type Document = {
  id: string;
  patientId: string;
  type: string;
  title: string;
  fileUrl: string;
  mimeType: string | null;
  createdAt: Date;
};
type MedicalCase = {
  id: string;
  patientId: string;
  title: string;
  status: string;
  openedAt: Date;
  closedAt: Date | null;
  closedReason: string | null;
};
type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  meta: unknown;
  actorLabel: string | null;
  createdAt: Date;
};

interface State {
  communications: Communication[];
  calls: Call[];
  sends: NotificationSend[];
  appointments: Appointment[];
  messages: Message[];
  payments: Payment[];
  documents: Document[];
  cases: MedicalCase[];
  auditLogs: AuditLog[];
  apptIdsQueried: number;
  auditQueryArgs: { entityIds?: string[] } | null;
}

const state: State = {
  communications: [],
  calls: [],
  sends: [],
  appointments: [],
  messages: [],
  payments: [],
  documents: [],
  cases: [],
  auditLogs: [],
  apptIdsQueried: 0,
  auditQueryArgs: null,
};

// ---------- module mocks ----------------------------------------------------

// Bypass auth + tenant wrapper entirely — we just want the handler body.
vi.mock("@/lib/api-handler", () => ({
  createApiListHandler: (
    _opts: unknown,
    handler: (args: { request: Request; ctx: unknown }) => Promise<Response>,
  ) =>
    (request: Request) =>
      handler({ request, ctx: { kind: "TENANT", clinicId: "c1", userId: "u1", role: "ADMIN" } }),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    communication: {
      findMany: vi.fn(async ({ where }: { where: { patientId: string } }) =>
        state.communications.filter((c) => c.patientId === where.patientId),
      ),
    },
    call: {
      findMany: vi.fn(async ({ where }: { where: { patientId: string } }) =>
        state.calls.filter((c) => c.patientId === where.patientId),
      ),
    },
    notificationSend: {
      findMany: vi.fn(async ({ where }: { where: { patientId: string } }) =>
        state.sends.filter((s) => s.patientId === where.patientId),
      ),
    },
    appointment: {
      findMany: vi.fn(async (args: { where: { patientId: string; status?: string }; select?: Record<string, unknown> }) => {
        // Two callsites:
        //  1. visits — where: { patientId, status: 'COMPLETED' }
        //  2. apptIds shallow lookup — where: { patientId } (no status)
        if (args.select && args.select.id && !args.select.date) {
          state.apptIdsQueried += 1;
          return state.appointments
            .filter((a) => a.patientId === args.where.patientId)
            .map((a) => ({ id: a.id }));
        }
        return state.appointments.filter(
          (a) =>
            a.patientId === args.where.patientId &&
            (args.where.status ? a.status === args.where.status : true),
        );
      }),
    },
    message: {
      findMany: vi.fn(async ({ where }: { where: { conversation: { patientId: string } } }) =>
        state.messages.filter((m) => m.conversation.patientId === where.conversation.patientId),
      ),
    },
    payment: {
      findMany: vi.fn(async ({ where }: { where: { patientId: string; status?: string } }) =>
        state.payments.filter(
          (p) =>
            p.patientId === where.patientId &&
            (where.status ? p.status === where.status : true),
        ),
      ),
    },
    document: {
      findMany: vi.fn(async ({ where }: { where: { patientId: string } }) =>
        state.documents.filter((d) => d.patientId === where.patientId),
      ),
    },
    medicalCase: {
      findMany: vi.fn(async ({ where }: { where: { patientId: string } }) =>
        state.cases.filter((k) => k.patientId === where.patientId),
      ),
    },
    auditLog: {
      findMany: vi.fn(async (args: { where: { action: string; entityType: string; entityId: { in: string[] } } }) => {
        state.auditQueryArgs = { entityIds: args.where.entityId.in };
        return state.auditLogs.filter(
          (a) =>
            a.action === args.where.action &&
            a.entityType === args.where.entityType &&
            args.where.entityId.in.includes(a.entityId ?? ""),
        );
      }),
    },
  },
}));

// ---------- helpers ---------------------------------------------------------

function reset() {
  state.communications = [];
  state.calls = [];
  state.sends = [];
  state.appointments = [];
  state.messages = [];
  state.payments = [];
  state.documents = [];
  state.cases = [];
  state.auditLogs = [];
  state.apptIdsQueried = 0;
  state.auditQueryArgs = null;
}

beforeEach(reset);

async function loadGet() {
  vi.resetModules();
  const mod = await import("@/app/api/crm/patients/[id]/communications/route");
  return mod.GET;
}

function req(patientId: string, query = ""): Request {
  return new Request(`https://x/api/crm/patients/${patientId}/communications${query}`);
}

type Item = {
  id: string;
  kind: string;
  at: string;
  category: "VISIT" | "PAYMENT" | "COMM" | "DOC";
  meta?: unknown;
  title?: string;
};

async function callGet(patientId: string): Promise<Item[]> {
  const GET = await loadGet();
  const res = await GET(req(patientId));
  expect(res.status).toBe(200);
  const body = (await res.json()) as { items: Item[] };
  return body.items;
}

// ---------- tests -----------------------------------------------------------

describe("GET /api/crm/patients/[id]/communications — Phase 12 aggregation", () => {
  it("VISIT items only include appointments where status=COMPLETED", async () => {
    state.appointments = [
      {
        id: "apt_done",
        patientId: "p1",
        status: "COMPLETED",
        date: new Date("2026-04-01T10:00:00Z"),
        comments: null,
        priceFinal: 150_000_00,
        doctor: { nameRu: "Иванов" },
      },
      {
        id: "apt_booked",
        patientId: "p1",
        status: "BOOKED",
        date: new Date("2026-04-02T10:00:00Z"),
        comments: null,
        priceFinal: null,
        doctor: { nameRu: "Петров" },
      },
    ];

    const items = await callGet("p1");
    const visits = items.filter((i) => i.kind === "visit");
    expect(visits).toHaveLength(1);
    expect(visits[0].id).toBe("visit:apt_done");
    expect(visits[0].category).toBe("VISIT");
  });

  it("PAYMENT items only include payments where status=PAID", async () => {
    state.payments = [
      {
        id: "pay_paid",
        patientId: "p1",
        status: "PAID",
        amount: 200_000_00,
        currency: "UZS",
        method: "CASH",
        paidAt: new Date("2026-04-03T11:00:00Z"),
        createdAt: new Date("2026-04-03T10:00:00Z"),
        appointmentId: null,
        receiptNumber: "R-1",
      },
      {
        id: "pay_pending",
        patientId: "p1",
        status: "PENDING",
        amount: 100_000_00,
        currency: "UZS",
        method: "CARD",
        paidAt: null,
        createdAt: new Date("2026-04-04T10:00:00Z"),
        appointmentId: null,
        receiptNumber: null,
      },
    ];

    const items = await callGet("p1");
    const pays = items.filter((i) => i.kind === "payment");
    expect(pays).toHaveLength(1);
    expect(pays[0].id).toBe("pay:pay_paid");
    expect(pays[0].category).toBe("PAYMENT");
  });

  it("DOCUMENT items have category=DOC", async () => {
    state.documents = [
      {
        id: "d1",
        patientId: "p1",
        type: "CONSENT",
        title: "Информированное согласие",
        fileUrl: "/files/d1.pdf",
        mimeType: "application/pdf",
        createdAt: new Date("2026-04-05T09:00:00Z"),
      },
    ];

    const items = await callGet("p1");
    const docs = items.filter((i) => i.kind === "document");
    expect(docs).toHaveLength(1);
    expect(docs[0].category).toBe("DOC");
    expect(docs[0].title).toBe("Информированное согласие");
  });

  it("CASE emits both opened+closed rows when both timestamps present", async () => {
    state.cases = [
      {
        id: "c1",
        patientId: "p1",
        title: "Боль в спине",
        status: "CLOSED",
        openedAt: new Date("2026-03-01T10:00:00Z"),
        closedAt: new Date("2026-03-15T10:00:00Z"),
        closedReason: "Решено",
      },
    ];

    const items = await callGet("p1");
    const cases = items.filter((i) => i.kind === "case");
    expect(cases).toHaveLength(2);
    const opened = cases.find((c) => (c.meta as { action: string }).action === "opened");
    const closed = cases.find((c) => (c.meta as { action: string }).action === "closed");
    expect(opened).toBeDefined();
    expect(closed).toBeDefined();
    expect(opened!.category).toBe("VISIT");
    expect(closed!.category).toBe("VISIT");
  });

  it("CASE emits only opened row when closedAt is null", async () => {
    state.cases = [
      {
        id: "c2",
        patientId: "p1",
        title: "Открытый случай",
        status: "OPEN",
        openedAt: new Date("2026-03-01T10:00:00Z"),
        closedAt: null,
        closedReason: null,
      },
    ];

    const items = await callGet("p1");
    const cases = items.filter((i) => i.kind === "case");
    expect(cases).toHaveLength(1);
    expect((cases[0].meta as { action: string }).action).toBe("opened");
  });

  it("RESCHEDULE filtered by entityId in the patient's appointment ids (single query, no N+1)", async () => {
    state.appointments = [
      {
        id: "apt_p1_a",
        patientId: "p1",
        status: "BOOKED",
        date: new Date("2026-04-10T10:00:00Z"),
        comments: null,
        priceFinal: null,
        doctor: { nameRu: "X" },
      },
      {
        id: "apt_p1_b",
        patientId: "p1",
        status: "BOOKED",
        date: new Date("2026-04-11T10:00:00Z"),
        comments: null,
        priceFinal: null,
        doctor: { nameRu: "X" },
      },
    ];
    state.auditLogs = [
      {
        id: "al_a",
        action: "APPOINTMENT_RESCHEDULED",
        entityType: "Appointment",
        entityId: "apt_p1_a",
        meta: { oldStartTime: "2026-04-10T10:00:00Z", newStartTime: "2026-04-10T11:00:00Z" },
        actorLabel: "Reception",
        createdAt: new Date("2026-04-09T10:00:00Z"),
      },
      {
        id: "al_other",
        action: "APPOINTMENT_RESCHEDULED",
        entityType: "Appointment",
        entityId: "apt_other_patient",
        meta: {},
        actorLabel: null,
        createdAt: new Date("2026-04-09T10:00:00Z"),
      },
    ];

    const items = await callGet("p1");
    const reschedules = items.filter((i) => i.kind === "reschedule");
    expect(reschedules).toHaveLength(1);
    expect(reschedules[0].id).toBe("resched:al_a");
    // Verify the audit query was scoped exactly to this patient's appointment ids.
    expect(state.auditQueryArgs?.entityIds).toEqual(["apt_p1_a", "apt_p1_b"]);
  });

  it("items are sorted DESC by `at` and category labels are correct", async () => {
    state.appointments = [
      {
        id: "apt_done",
        patientId: "p1",
        status: "COMPLETED",
        date: new Date("2026-04-01T10:00:00Z"),
        comments: null,
        priceFinal: null,
        doctor: { nameRu: "X" },
      },
    ];
    state.payments = [
      {
        id: "pay1",
        patientId: "p1",
        status: "PAID",
        amount: 1,
        currency: "UZS",
        method: "CASH",
        paidAt: new Date("2026-05-01T12:00:00Z"),
        createdAt: new Date("2026-05-01T12:00:00Z"),
        appointmentId: null,
        receiptNumber: null,
      },
    ];
    state.documents = [
      {
        id: "d1",
        patientId: "p1",
        type: "OTHER",
        title: "doc",
        fileUrl: "/x",
        mimeType: null,
        createdAt: new Date("2026-04-15T09:00:00Z"),
      },
    ];
    state.calls = [
      {
        id: "c1",
        patientId: "p1",
        createdAt: new Date("2026-04-20T08:00:00Z"),
        direction: "IN",
        fromNumber: "+998901234567",
        toNumber: "+998711111111",
        durationSec: 30,
        tags: [],
        summary: null,
      },
    ];

    const items = await callGet("p1");
    const ats = items.map((i) => new Date(i.at).getTime());
    for (let i = 1; i < ats.length; i++) {
      expect(ats[i - 1]).toBeGreaterThanOrEqual(ats[i]);
    }

    const byKind = Object.fromEntries(items.map((i) => [i.kind, i.category]));
    expect(byKind["visit"]).toBe("VISIT");
    expect(byKind["payment"]).toBe("PAYMENT");
    expect(byKind["document"]).toBe("DOC");
    expect(byKind["call"]).toBe("COMM");
  });
});
