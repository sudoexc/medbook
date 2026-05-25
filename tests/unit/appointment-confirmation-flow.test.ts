/**
 * Integration test for the five-path appointment confirmation flow.
 *
 * The flow lives at the seam of four systems:
 *   1. `src/server/appointments/confirm.ts`              — the central helper
 *   2. `src/server/actions/detectors/unconfirmed-24h.ts` — emits "needs confirming"
 *   3. `src/app/api/sms/webhook/[clinicSlug]/route.ts`   — inbound SMS reply path
 *   4. `src/server/realtime/publish.ts`                  — realtime fan-out
 *
 * A bug in any one of those silently corrupts the rest — the helper closes
 * the dedupe-keyed Action the detector wrote, and the SMS route fans through
 * the helper. This test exercises the loop end-to-end with a Prisma mock so
 * the four pieces have to agree on field names + dedupe key shape + status
 * predicates or it goes red.
 *
 * Style mirrors `tests/unit/detectors/unconfirmed-24h.test.ts` and
 * `tests/unit/appointment-reschedule-audit.test.ts` — vitest, `vi.mock` for
 * collaborators, in-memory state for prisma.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dedupeKeyFor } from "@/lib/actions/types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared in-memory state. One appointment is the system under test in most
// scenarios; we mutate it across the helper + detector calls to assert end-
// to-end behaviour. Scenario B (the SMS branch) also seeds clinic/patient/
// provider rows.
// ─────────────────────────────────────────────────────────────────────────────

type Appointment = {
  id: string;
  clinicId: string;
  patientId: string;
  doctorId: string;
  date: Date;
  status: string;
  queueStatus: string;
  confirmedAt: Date | null;
  confirmedBy: string | null;
  confirmedVia: string | null;
  channel: string;
  patient: { fullName: string };
  doctor: { nameRu: string };
};

type ActionRow = {
  id: string;
  clinicId: string;
  dedupeKey: string;
  status: "OPEN" | "SNOOZED" | "DISMISSED" | "DONE" | "EXPIRED";
  doneAt: Date | null;
};

type AuditRow = {
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  actorRole: string | null;
  actorLabel: string | null;
  clinicId: string | null;
  meta: Record<string, unknown>;
};

type ClinicRow = { id: string; slug: string };
type PatientRow = {
  id: string;
  clinicId: string;
  phone: string;
  phoneNormalized: string;
  preferredLang: string | null;
  marketingOptOut: boolean;
};
type ProviderRow = {
  clinicId: string;
  active: boolean;
  kind: "SMS" | "TELEGRAM";
  config: Record<string, unknown> | null;
};
type ConversationRow = {
  id: string;
  clinicId: string;
  externalId: string;
  patientId: string | null;
};

const state = {
  appointments: [] as Appointment[],
  actions: [] as ActionRow[],
  audits: [] as AuditRow[],
  clinics: [] as ClinicRow[],
  patients: [] as PatientRow[],
  providers: [] as ProviderRow[],
  conversations: [] as ConversationRow[],
  messages: [] as Array<{ conversationId: string; body: string }>,
  publishes: [] as Array<{ clinicId: string; type: string; payload: unknown }>,
  nextId: 1,
};

function nextId(prefix: string): string {
  return `${prefix}_${state.nextId++}`;
}

function resetState(): void {
  state.appointments = [];
  state.actions = [];
  state.audits = [];
  state.clinics = [];
  state.patients = [];
  state.providers = [];
  state.conversations = [];
  state.messages = [];
  state.publishes = [];
  state.nextId = 1;
}

function makeAppointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "apt_1",
    clinicId: "c1",
    patientId: "p1",
    doctorId: "doc_1",
    date: new Date("2026-06-01T10:00:00.000Z"),
    status: "BOOKED",
    queueStatus: "BOOKED",
    confirmedAt: null,
    confirmedBy: null,
    confirmedVia: null,
    channel: "TELEGRAM",
    patient: { fullName: "Иван Петров" },
    doctor: { nameRu: "Иванов" },
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Collaborator mocks. Order matches the order the helper / route imports.
// ─────────────────────────────────────────────────────────────────────────────

vi.mock("@/server/realtime/publish", () => ({
  publishEventSafe: vi.fn(
    (clinicId: string, ev: { type: string; payload: unknown }) => {
      state.publishes.push({ clinicId, type: ev.type, payload: ev.payload });
    },
  ),
}));

vi.mock("@/lib/tenant-context", () => ({
  // For these tests we don't care about tenant scoping; just execute the
  // body. The real extension would scope by clinicId — we already filter by
  // clinicId in our mock prisma where applicable.
  runWithTenant: <T,>(_ctx: unknown, fn: () => T | Promise<T>): T | Promise<T> =>
    fn(),
  getTenant: () => ({
    kind: "SYSTEM" as const,
  }),
}));

vi.mock("@/lib/audit", () => ({
  audit: vi.fn(async () => undefined),
}));

vi.mock("@/server/patient/last-contacted", () => ({
  bumpPatientLastContact: vi.fn(async () => undefined),
}));

// Prisma surface. Only the methods the helper + detector + SMS route call.
vi.mock("@/lib/prisma", () => ({
  prisma: {
    appointment: {
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) => {
          const row = state.appointments.find((a) => a.id === where.id);
          return row ?? null;
        },
      ),
      findFirst: vi.fn(
        async ({
          where,
          orderBy,
        }: {
          where: {
            clinicId: string;
            patientId?: { in: string[] };
            confirmedAt: null;
            status: { notIn: string[] };
            date: { gte: Date };
          };
          orderBy?: { date: "asc" | "desc" };
        }) => {
          const candidates = state.appointments.filter((a) => {
            if (a.clinicId !== where.clinicId) return false;
            if (where.patientId && !where.patientId.in.includes(a.patientId))
              return false;
            if (a.confirmedAt !== null) return false;
            if (where.status.notIn.includes(a.status)) return false;
            if (a.date.getTime() < where.date.gte.getTime()) return false;
            return true;
          });
          candidates.sort((a, b) =>
            orderBy?.date === "desc"
              ? b.date.getTime() - a.date.getTime()
              : a.date.getTime() - b.date.getTime(),
          );
          return candidates[0] ?? null;
        },
      ),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            confirmedAt: null;
            status: { notIn: string[] };
            date: { gte: Date; lte: Date };
          };
        }) => {
          return state.appointments
            .filter((a) => {
              if (a.confirmedAt !== null) return false;
              if (where.status.notIn.includes(a.status)) return false;
              if (a.date.getTime() < where.date.gte.getTime()) return false;
              if (a.date.getTime() > where.date.lte.getTime()) return false;
              return true;
            })
            .map((a) => ({
              id: a.id,
              date: a.date,
              patientId: a.patientId,
              patient: { fullName: a.patient.fullName },
              doctor: { nameRu: a.doctor.nameRu },
            }));
        },
      ),
      update: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Partial<Appointment>;
        }) => {
          const idx = state.appointments.findIndex((a) => a.id === where.id);
          if (idx < 0) throw new Error("appointment not found");
          state.appointments[idx] = {
            ...state.appointments[idx]!,
            ...data,
          };
          return state.appointments[idx];
        },
      ),
    },
    action: {
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: {
            clinicId: string;
            dedupeKey: string;
            status: { in: Array<"OPEN" | "SNOOZED"> };
          };
          data: { status: "DONE"; doneAt: Date };
        }) => {
          let count = 0;
          for (const row of state.actions) {
            if (row.clinicId !== where.clinicId) continue;
            if (row.dedupeKey !== where.dedupeKey) continue;
            if (!where.status.in.includes(row.status as "OPEN" | "SNOOZED"))
              continue;
            row.status = data.status;
            row.doneAt = data.doneAt;
            count++;
          }
          return { count };
        },
      ),
    },
    auditLog: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            action: string;
            entityType: string;
            entityId: string | null;
            actorId: string | null;
            actorRole: string | null;
            actorLabel: string | null;
            clinicId: string | null;
            meta: Record<string, unknown>;
          };
        }) => {
          state.audits.push({
            action: data.action,
            entityType: data.entityType,
            entityId: data.entityId,
            actorId: data.actorId,
            actorRole: data.actorRole,
            actorLabel: data.actorLabel,
            clinicId: data.clinicId,
            meta: data.meta,
          });
          return { id: nextId("audit") };
        },
      ),
    },
    clinic: {
      findUnique: vi.fn(
        async ({ where }: { where: { slug: string } }) =>
          state.clinics.find((c) => c.slug === where.slug) ?? null,
      ),
    },
    providerConnection: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: { clinicId: string; active: boolean; kind: string };
        }) =>
          state.providers.find(
            (p) =>
              p.clinicId === where.clinicId &&
              p.kind === where.kind &&
              p.active === where.active,
          ) ?? null,
      ),
    },
    patient: {
      findFirst: vi.fn(
        async ({
          where,
        }: {
          where: {
            clinicId: string;
            phoneNormalized?: { contains: string };
          };
        }) => {
          return (
            state.patients.find(
              (p) =>
                p.clinicId === where.clinicId &&
                (!where.phoneNormalized ||
                  p.phoneNormalized.includes(
                    where.phoneNormalized.contains,
                  )),
            ) ?? null
          );
        },
      ),
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: {
            clinicId: string;
            OR?: Array<{ phoneNormalized: { contains: string } }>;
            phoneNormalized?: { contains: string };
            marketingOptOut?: boolean;
          };
        }) => {
          return state.patients.filter((p) => {
            if (p.clinicId !== where.clinicId) return false;
            if (
              where.marketingOptOut !== undefined &&
              p.marketingOptOut !== where.marketingOptOut
            )
              return false;
            if (where.OR) {
              const ok = where.OR.some((cond) =>
                p.phoneNormalized.includes(cond.phoneNormalized.contains),
              );
              if (!ok) return false;
            } else if (where.phoneNormalized) {
              if (!p.phoneNormalized.includes(where.phoneNormalized.contains))
                return false;
            }
            return true;
          });
        },
      ),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
    conversation: {
      findUnique: vi.fn(
        async ({
          where,
        }: {
          where: {
            clinicId_externalId: { clinicId: string; externalId: string };
          };
        }) =>
          state.conversations.find(
            (c) =>
              c.clinicId === where.clinicId_externalId.clinicId &&
              c.externalId === where.clinicId_externalId.externalId,
          ) ?? null,
      ),
      create: vi.fn(
        async ({
          data,
        }: {
          data: {
            clinicId: string;
            externalId: string;
            patientId: string | null;
          };
        }) => {
          const row = {
            id: nextId("conv"),
            clinicId: data.clinicId,
            externalId: data.externalId,
            patientId: data.patientId,
          };
          state.conversations.push(row);
          return { id: row.id };
        },
      ),
      update: vi.fn(async () => undefined),
    },
    message: {
      create: vi.fn(
        async ({
          data,
        }: {
          data: { conversationId: string; body: string };
        }) => {
          state.messages.push({
            conversationId: data.conversationId,
            body: data.body,
          });
          return { id: nextId("msg") };
        },
      ),
    },
    notificationSend: { create: vi.fn(async () => ({ id: "ns_1" })) },
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Lazy imports — must come AFTER vi.mock declarations.
// ─────────────────────────────────────────────────────────────────────────────

async function loadHelper() {
  const mod = await import("@/server/appointments/confirm");
  return mod.confirmAppointment;
}

async function loadDetector() {
  const mod = await import("@/server/actions/detectors/unconfirmed-24h");
  return mod;
}

async function loadSmsRoute() {
  const mod = await import("@/app/api/sms/webhook/[clinicSlug]/route");
  return mod.POST;
}

async function loadPrismaMock() {
  const mod = await import("@/lib/prisma");
  return mod.prisma as unknown as {
    auditLog: { create: ReturnType<typeof vi.fn> };
    appointment: { update: ReturnType<typeof vi.fn> };
    action: { updateMany: ReturnType<typeof vi.fn> };
  };
}

async function loadPublishMock() {
  const mod = await import("@/server/realtime/publish");
  return mod.publishEventSafe as unknown as ReturnType<typeof vi.fn>;
}

// `DetectorConfig` is freeform from the detector's perspective for this
// detector (the function takes the arg but doesn't read it). Use an empty
// object cast — keeps the test independent of unrelated config-shape churn.
const stubConfig = {} as never;

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  resetState();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("A. Happy loop — TELEGRAM appointment 36h ahead", () => {
  it("detector → Action close → no second action emitted after confirm", async () => {
    const now = new Date("2026-05-30T22:00:00.000Z"); // 36h before the appt
    const appt = makeAppointment({
      date: new Date(now.getTime() + 36 * 60 * 60 * 1000),
      channel: "TELEGRAM",
    });
    state.appointments.push(appt);

    const detector = await loadDetector();

    // 1) Detector emits exactly one UNCONFIRMED_24H payload (within 72h).
    const payloads = await detector.detectUnconfirmed24h(
      // The real engine passes the prisma extension; we forward our mock.
      (await import("@/lib/prisma")).prisma as never,
      appt.clinicId,
      now,
      stubConfig,
    );
    expect(payloads).toHaveLength(1);
    expect(payloads[0]?.type).toBe("UNCONFIRMED_24H");
    expect(payloads[0]?.appointmentId).toBe(appt.id);

    // At 36h the severity tier from `severityForUnconfirmed24h` is `low`
    // (≥24h && <72h). The task brief includes a self-corrected note about
    // this — we lock the assertion to `low`.
    expect(detector.severityForUnconfirmed24h(payloads[0]!, now)).toBe("low");

    // Pretend the engine upserted a row for that payload.
    const dedupeKey = dedupeKeyFor(payloads[0]!);
    state.actions.push({
      id: "act_1",
      clinicId: appt.clinicId,
      dedupeKey,
      status: "OPEN",
      doneAt: null,
    });

    // 2) Reception (or whoever) clicks "Confirm" — single entry point.
    const confirm = await loadHelper();
    const result = await confirm({
      appointmentId: appt.id,
      clinicId: appt.clinicId,
      actorId: "u1",
      via: "MANUAL_CRM",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.alreadyConfirmed).toBe(false);

    // appointment.update payload — keys + status flip.
    const prisma = await loadPrismaMock();
    expect(prisma.appointment.update).toHaveBeenCalledTimes(1);
    const updateArgs = prisma.appointment.update.mock.calls[0]![0] as {
      where: { id: string };
      data: Record<string, unknown>;
    };
    expect(updateArgs.where.id).toBe(appt.id);
    expect(updateArgs.data.confirmedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.confirmedBy).toBe("u1");
    expect(updateArgs.data.confirmedVia).toBe("MANUAL_CRM");
    expect(updateArgs.data.status).toBe("CONFIRMED");
    expect(updateArgs.data.queueStatus).toBe("CONFIRMED");

    // action.updateMany — exact where clause AND data shape.
    expect(prisma.action.updateMany).toHaveBeenCalledTimes(1);
    const updMany = prisma.action.updateMany.mock.calls[0]![0] as {
      where: {
        clinicId: string;
        dedupeKey: string;
        status: { in: string[] };
      };
      data: { status: string; doneAt: Date };
    };
    expect(updMany.where.clinicId).toBe(appt.clinicId);
    expect(updMany.where.dedupeKey).toBe(dedupeKey);
    expect(updMany.where.status.in).toEqual(["OPEN", "SNOOZED"]);
    expect(updMany.data.status).toBe("DONE");
    expect(updMany.data.doneAt).toBeInstanceOf(Date);

    // Action row was closed in-place.
    expect(state.actions[0]?.status).toBe("DONE");
    expect(state.actions[0]?.doneAt).toBeInstanceOf(Date);

    // Audit row — exactly one APPOINTMENT_CONFIRMED with `statusFlipped: true`.
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const audit = state.audits[0]!;
    expect(audit.action).toBe("APPOINTMENT_CONFIRMED");
    expect(audit.entityType).toBe("Appointment");
    expect(audit.entityId).toBe(appt.id);
    expect(audit.actorId).toBe("u1");
    expect(audit.meta.via).toBe("MANUAL_CRM");
    expect(audit.meta.statusBefore).toBe("BOOKED");
    expect(audit.meta.statusAfter).toBe("CONFIRMED");
    expect(audit.meta.statusFlipped).toBe(true);

    // Realtime fan-out — both events.
    const publish = await loadPublishMock();
    expect(publish).toHaveBeenCalledTimes(2);
    const types = state.publishes.map((p) => p.type).sort();
    expect(types).toEqual(["appointment.statusChanged", "queue.updated"]);

    // 3) Detector re-run — confirmed row no longer satisfies predicate.
    const second = await detector.detectUnconfirmed24h(
      (await import("@/lib/prisma")).prisma as never,
      appt.clinicId,
      now,
      stubConfig,
    );
    expect(second).toEqual([]);
  });
});

describe("B. SMS-YES branch — webhook routes through the helper", () => {
  // Build the inbound payload the SMS route actually parses. Route reads JSON
  // with the schema { from, to?, body, providerId?, externalId? } — verified
  // against `src/app/api/sms/webhook/[clinicSlug]/route.ts` BodySchema.
  function smsRequest(slug: string, body: string, from = "+998901234567"): Request {
    return new Request(`http://test.local/api/sms/webhook/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from, body }),
    });
  }

  it("first YES confirms, second YES hits the alreadyConfirmed branch", async () => {
    const now = new Date();
    // Seed clinic + patient + appointment.
    state.clinics.push({ id: "c1", slug: "neurofax" });
    state.patients.push({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
      preferredLang: "RU",
      marketingOptOut: false,
    });
    const appt = makeAppointment({
      id: "apt_sms_1",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    });
    state.appointments.push(appt);

    const POST = await loadSmsRoute();
    const prisma = await loadPrismaMock();

    // No webhook secret configured + dev-mode → accepted with a console warn.
    const res1 = await POST(smsRequest("neurofax", "YES"));
    expect(res1.status).toBe(200);

    // Audit row created via the helper.
    const confirmAudits = state.audits.filter(
      (a) => a.action === "APPOINTMENT_CONFIRMED",
    );
    expect(confirmAudits).toHaveLength(1);
    expect(confirmAudits[0]?.meta.via).toBe("SMS_REPLY");
    expect(confirmAudits[0]?.actorId).toBeNull();
    expect(confirmAudits[0]?.actorLabel).toBe("confirm:SMS_REPLY");

    // Appointment row is now confirmed.
    expect(state.appointments[0]?.confirmedAt).toBeInstanceOf(Date);
    expect(state.appointments[0]?.confirmedVia).toBe("SMS_REPLY");
    expect(state.appointments[0]?.status).toBe("CONFIRMED");

    const updateCount = prisma.appointment.update.mock.calls.length;

    // Second YES — provider retry. Route MUST return 200 (no provider
    // retries). The helper finds the row already confirmed, so no second
    // update call is issued.
    const res2 = await POST(smsRequest("neurofax", "YES"));
    expect(res2.status).toBe(200);

    // The route's "find nearest unconfirmed" filters confirmedAt: null first.
    // Since the row is now confirmed, the route won't even reach
    // confirmAppointment on the second call → no extra audit row.
    expect(
      state.audits.filter((a) => a.action === "APPOINTMENT_CONFIRMED").length,
    ).toBe(1);
    expect(prisma.appointment.update.mock.calls.length).toBe(updateCount);
  });

  it("non-keyword body never invokes the helper", async () => {
    state.clinics.push({ id: "c1", slug: "neurofax" });
    state.patients.push({
      id: "p1",
      clinicId: "c1",
      phone: "+998901234567",
      phoneNormalized: "+998901234567",
      preferredLang: "RU",
      marketingOptOut: false,
    });
    const appt = makeAppointment({
      id: "apt_sms_2",
      clinicId: "c1",
      patientId: "p1",
      date: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });
    state.appointments.push(appt);

    const POST = await loadSmsRoute();
    const res = await POST(
      new Request("http://test.local/api/sms/webhook/neurofax", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: "+998901234567", body: "hello there" }),
      }),
    );
    expect(res.status).toBe(200);
    expect(state.audits.filter((a) => a.action === "APPOINTMENT_CONFIRMED"))
      .toHaveLength(0);
    expect(state.appointments[0]?.confirmedAt).toBeNull();
  });
});

describe("C. Late-YES — status already past BOOKED, only timestamp recorded", () => {
  it("records confirmedAt but does NOT downgrade status/queueStatus", async () => {
    const appt = makeAppointment({
      status: "WAITING",
      queueStatus: "WAITING",
      confirmedAt: null,
      date: new Date(Date.now() + 60 * 60 * 1000),
    });
    state.appointments.push(appt);

    const confirm = await loadHelper();
    const result = await confirm({
      appointmentId: appt.id,
      clinicId: appt.clinicId,
      actorId: null,
      via: "SMS_REPLY",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.alreadyConfirmed).toBe(false);

    const prisma = await loadPrismaMock();
    const updateArgs = prisma.appointment.update.mock.calls[0]![0] as {
      data: Record<string, unknown>;
    };
    expect(updateArgs.data.confirmedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.confirmedVia).toBe("SMS_REPLY");
    // Critical: `status` and `queueStatus` must NOT be present in the update
    // payload — the helper's `shouldFlipStatus` guard excluded the spread.
    expect(updateArgs.data).not.toHaveProperty("status");
    expect(updateArgs.data).not.toHaveProperty("queueStatus");

    // Status in storage stays WAITING (no regression to CONFIRMED).
    expect(state.appointments[0]?.status).toBe("WAITING");
    expect(state.appointments[0]?.queueStatus).toBe("WAITING");

    // Audit captures `statusFlipped: false` so support can grep for it.
    expect(state.audits).toHaveLength(1);
    expect(state.audits[0]?.meta.statusFlipped).toBe(false);
    expect(state.audits[0]?.meta.statusBefore).toBe("WAITING");
    expect(state.audits[0]?.meta.statusAfter).toBe("WAITING");
  });
});

describe("D. Terminal-state refusal — CANCELLED / NO_SHOW / COMPLETED", () => {
  const cases: Array<{
    status: "CANCELLED" | "NO_SHOW" | "COMPLETED";
    expected: "cancelled" | "completed";
  }> = [
    { status: "CANCELLED", expected: "cancelled" },
    { status: "NO_SHOW", expected: "cancelled" }, // helper lumps these under "cancelled"
    { status: "COMPLETED", expected: "completed" },
  ];

  for (const { status, expected } of cases) {
    it(`${status} → { ok:false, reason:"${expected}" } with zero side effects`, async () => {
      state.appointments.push(makeAppointment({ status, queueStatus: status }));

      const confirm = await loadHelper();
      const result = await confirm({
        appointmentId: "apt_1",
        clinicId: "c1",
        actorId: "u1",
        via: "MANUAL_CRM",
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.reason).toBe(expected);

      const prisma = await loadPrismaMock();
      expect(prisma.appointment.update).not.toHaveBeenCalled();
      expect(prisma.action.updateMany).not.toHaveBeenCalled();
      expect(prisma.auditLog.create).not.toHaveBeenCalled();
      const publish = await loadPublishMock();
      expect(publish).not.toHaveBeenCalled();
    });
  }

  it("not_found → { ok:false, reason:'not_found' }", async () => {
    const confirm = await loadHelper();
    const result = await confirm({
      appointmentId: "nope",
      clinicId: "c1",
      actorId: "u1",
      via: "MANUAL_CRM",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("not_found");
    const prisma = await loadPrismaMock();
    expect(prisma.appointment.update).not.toHaveBeenCalled();
  });
});

describe("E. Idempotency contract — second caller hits alreadyConfirmed", () => {
  it("two sequential calls produce ONE update + ONE audit, second returns alreadyConfirmed:true", async () => {
    const appt = makeAppointment({
      date: new Date(Date.now() + 12 * 60 * 60 * 1000),
    });
    state.appointments.push(appt);

    const confirm = await loadHelper();
    const first = await confirm({
      appointmentId: appt.id,
      clinicId: appt.clinicId,
      actorId: "u1",
      via: "MANUAL_CRM",
    });
    const second = await confirm({
      appointmentId: appt.id,
      clinicId: appt.clinicId,
      actorId: null,
      via: "SMS_REPLY",
    });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("unreachable");
    expect(first.alreadyConfirmed).toBe(false);
    expect(second.alreadyConfirmed).toBe(true);

    const prisma = await loadPrismaMock();
    // Helper writes exactly once: only the non-idempotent caller mutates.
    expect(prisma.appointment.update).toHaveBeenCalledTimes(1);
    // Audit row is written once per non-idempotent confirm. The
    // alreadyConfirmed branch is *silent* on the audit log — that's the
    // documented contract.
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    // The audit row reflects the first caller's `via`.
    expect(state.audits[0]?.meta.via).toBe("MANUAL_CRM");
  });

  it("concurrent calls (Promise.all) — at most TWO audit rows; both resolve ok", async () => {
    // Document the race contract: the helper itself does NOT serialise
    // findUnique → update; that's the DB's job. In production the row's
    // unique constraint + transaction isolation handles the conflict. In a
    // mock, both findUniques observe `confirmedAt: null` and both reach
    // the audit-write path — so we cap the audit count at 2, NOT 1.
    const appt = makeAppointment({
      date: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });
    state.appointments.push(appt);

    const confirm = await loadHelper();
    const [a, b] = await Promise.all([
      confirm({
        appointmentId: appt.id,
        clinicId: appt.clinicId,
        actorId: "u1",
        via: "MANUAL_CRM",
      }),
      confirm({
        appointmentId: appt.id,
        clinicId: appt.clinicId,
        actorId: null,
        via: "TG_BUTTON",
      }),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    // Audit count is at most 2 (one per writer). The "exactly 1" outcome is
    // also legal if Prisma serialises the calls and the second hits the
    // alreadyConfirmed branch.
    const audits = state.audits.filter(
      (x) => x.action === "APPOINTMENT_CONFIRMED",
    );
    expect(audits.length).toBeGreaterThanOrEqual(1);
    expect(audits.length).toBeLessThanOrEqual(2);
  });
});

describe("F. closeOpenConfirmActions — covers OPEN and SNOOZED, defensive on re-confirm", () => {
  it("first confirm closes OPEN + SNOOZED rows; re-confirm calls updateMany again as no-op", async () => {
    const appt = makeAppointment({
      date: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });
    state.appointments.push(appt);

    // Pre-seed two action rows for the same appointment — one OPEN, one
    // SNOOZED — under the dedupe key the helper rebuilds internally.
    const dedupeKey = dedupeKeyFor({
      type: "UNCONFIRMED_24H",
      appointmentId: appt.id,
      patientId: "",
      patientName: "",
      appointmentAt: "",
      doctorName: "",
    });
    state.actions.push(
      {
        id: "act_open",
        clinicId: appt.clinicId,
        dedupeKey,
        status: "OPEN",
        doneAt: null,
      },
      {
        id: "act_snoozed",
        clinicId: appt.clinicId,
        dedupeKey,
        status: "SNOOZED",
        doneAt: null,
      },
    );

    const confirm = await loadHelper();
    const r1 = await confirm({
      appointmentId: appt.id,
      clinicId: appt.clinicId,
      actorId: "u1",
      via: "MANUAL_CRM",
    });
    expect(r1.ok).toBe(true);

    const prisma = await loadPrismaMock();
    const firstCallArgs = prisma.action.updateMany.mock.calls[0]![0] as {
      where: { status: { in: string[] } };
    };
    // The helper closes both OPEN and SNOOZED in a single sweep.
    expect(firstCallArgs.where.status.in).toEqual(["OPEN", "SNOOZED"]);
    // Both rows are now DONE.
    expect(state.actions.find((a) => a.id === "act_open")?.status).toBe("DONE");
    expect(state.actions.find((a) => a.id === "act_snoozed")?.status).toBe(
      "DONE",
    );

    // Re-confirm hits the alreadyConfirmed branch, which the helper
    // documents as "close any stale confirm-call Actions (defensive — usually
    // closed at first flip) and return early". Assert updateMany IS called
    // a second time and returns count:0.
    const r2 = await confirm({
      appointmentId: appt.id,
      clinicId: appt.clinicId,
      actorId: null,
      via: "SMS_REPLY",
    });
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("unreachable");
    expect(r2.alreadyConfirmed).toBe(true);
    expect(prisma.action.updateMany).toHaveBeenCalledTimes(2);
    // The second call is a no-op against our in-memory store (everything is
    // already DONE), so the count returned by the mock would be 0. The
    // assertion is the *call itself happened* — defensive close.
  });
});
