import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit TG-03: every PHONE and KIOSK booking is created CONFIRMED, and a
 * patient who taps «✅ Подтверждаю» is confirmed too. The send worker
 * cancelled EVERY «before» reminder of a confirmed visit («patient already
 * confirmed»), so most of reception's bookings got no 1-day or 3-hour
 * reminder at all, and the scheduler tick did not even look at CONFIRMED
 * visits. Only the reminder that asks to confirm (T-3d) is pointless then.
 */

const NOW = Date.now();

type Send = {
  id: string;
  clinicId: string;
  patientId: string;
  appointmentId: string;
  campaignId: null;
  channel: string;
  recipient: string;
  body: string;
  scheduledFor: Date;
  status: string;
  retryCount: number;
  failedReason: string | null;
  patient: { id: string; phone: string; telegramId: string | null };
  template: { key: string; trigger: string; triggerConfig: Record<string, unknown> | null };
};

const state = vi.hoisted(() => ({
  send: null as null | Record<string, unknown>,
  appt: {
    status: "CONFIRMED",
    confirmedAt: new Date() as Date | null,
    date: new Date(),
  },
  sent: [] as Array<{ body: string; opts: unknown }>,
  delivered: [] as string[],
  // materialiser side
  apptRows: [] as Array<Record<string, unknown>>,
  tickWhere: null as null | Record<string, unknown>,
  templates: {} as Record<number, { id: string; triggerConfig: Record<string, unknown> }>,
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationSend: {
      findUnique: vi.fn(async () => state.send),
      updateMany: vi.fn(
        async ({ where, data }: { where: { id: string; status?: string }; data: Record<string, unknown> }) => {
          const s = state.send;
          if (!s || s.id !== where.id) return { count: 0 };
          if (where.status !== undefined && s.status !== where.status) return { count: 0 };
          Object.assign(s, data);
          return { count: 1 };
        },
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (state.send) Object.assign(state.send, data);
        return state.send;
      }),
      findMany: vi.fn(async () => []),
      createMany: vi.fn(async ({ data }: { data: Array<Record<string, unknown>> }) => {
        state.created.push(...data);
        return { count: data.length };
      }),
    },
    appointment: {
      findUnique: vi.fn(async () => state.appt),
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if (where.date) state.tickWhere = where;
        return state.apptRows;
      }),
    },
    notificationTemplate: {
      findFirst: vi.fn(
        async ({ where }: { where: { triggerConfig?: { equals?: number } } }) => {
          const off = where.triggerConfig?.equals;
          const tpl = off !== undefined ? state.templates[off] : undefined;
          return tpl
            ? { ...tpl, bodyRu: `Напоминание ${off}`, bodyUz: `Eslatma ${off}`, channel: "TG" }
            : null;
        },
      ),
    },
  },
}));

vi.mock("@/server/notifications/adapters", () => ({
  resolveAdapters: vi.fn(async () => ({
    tg: {
      send: vi.fn(async (_chat: string, body: string, opts: unknown) => {
        state.sent.push({ body, opts });
        return { messageId: 1 };
      }),
    },
    inapp: { send: vi.fn(async () => ({ inboxId: "i1" })) },
  })),
}));
vi.mock("@/server/notifications/rate-limit", () => ({
  getRateLimiter: () => ({ check: async () => true }),
}));
vi.mock("@/server/notifications/record-delivery", () => ({
  recordNotificationDelivery: vi.fn(async ({ send }: { send: { id: string } }) => {
    state.delivered.push(send.id);
    if (state.send) state.send.status = "SENT";
  }),
}));
vi.mock("@/server/notifications/no-channel-action", () => ({
  recordPatientNoChannel: vi.fn(async () => undefined),
}));
vi.mock("@/server/queue", () => ({
  enqueue: vi.fn(async () => {}),
  getQueue: () => ({ registerWorker: vi.fn() }),
}));

const BANDS = {
  "5d": { key: "appointment.reminder-5d", offsetMin: -7200 },
  "3d": { key: "appointment.reminder-3d", offsetMin: -4320 },
  "24h": { key: "appointment.reminder-24h", offsetMin: -1440 },
  "3h": { key: "appointment.reminder-3h", offsetMin: -180 },
} as const;

function band(b: keyof typeof BANDS, triggerConfig?: Record<string, unknown>): Send {
  const { key, offsetMin } = BANDS[b];
  return {
    id: `snd_${b}`,
    clinicId: "c1",
    patientId: "p1",
    appointmentId: "apt_1",
    campaignId: null,
    channel: "TG",
    recipient: "tg_1",
    body: `Напоминание ${b}`,
    // Due right now, exactly `offsetMin` before the visit (no drift).
    scheduledFor: new Date(state.appt.date.getTime() + offsetMin * 60_000),
    status: "QUEUED",
    retryCount: 0,
    failedReason: null,
    patient: { id: "p1", phone: "+998901234567", telegramId: "tg_1" },
    template: { key, trigger: "APPOINTMENT_BEFORE", triggerConfig: triggerConfig ?? { offsetMin } },
  };
}

function visitIn(b: keyof typeof BANDS): Date {
  return new Date(NOW - BANDS[b].offsetMin * 60_000 - 1_000);
}

async function deliver(send: Send) {
  const { _deliverForTests } = await import("@/server/workers/notifications-send");
  state.send = send as unknown as Record<string, unknown>;
  await _deliverForTests({ sendId: send.id });
  return state.send as unknown as Send;
}

const hasConfirmButton = (opts: unknown) => JSON.stringify(opts ?? null).includes("confirm:");

beforeEach(() => {
  state.send = null;
  state.appt = { status: "CONFIRMED", confirmedAt: new Date(NOW - 86_400_000), date: new Date() };
  state.sent = [];
  state.delivered = [];
  state.apptRows = [];
  state.tickWhere = null;
  state.templates = {};
  state.created = [];
});

describe("send worker — a confirmed visit (PHONE / KIOSK booking)", () => {
  it("still gets the 1-day and 3-hour reminders, without the confirm button", async () => {
    for (const b of ["24h", "3h"] as const) {
      state.sent = [];
      state.appt.date = visitIn(b);
      const row = await deliver(band(b));
      expect(row.status).toBe("SENT");
      expect(state.sent).toHaveLength(1);
      expect(hasConfirmButton(state.sent[0]!.opts)).toBe(false);
    }
  });

  it("drops only the T-3d reminder, the one that asks to confirm", async () => {
    state.appt.date = visitIn("3d");
    const row = await deliver(band("3d", { offsetMin: -4320, skipIfConfirmed: true }));
    expect(row.status).toBe("CANCELLED");
    expect(row.failedReason).toBe("patient already confirmed");
    expect(state.sent).toEqual([]);
  });

  it("reads a legacy T-3d row (no flag) as asking to confirm", async () => {
    state.appt.date = visitIn("3d");
    const row = await deliver(band("3d"));
    expect(row.status).toBe("CANCELLED");
  });

  it("lets a clinic keep its own 1-day text asking to confirm out of confirmed visits", async () => {
    state.appt.date = visitIn("24h");
    const row = await deliver(band("24h", { offsetMin: -1440, skipIfConfirmed: true }));
    expect(row.status).toBe("CANCELLED");
  });
});

describe("send worker — confirmed by the button on the 5-day reminder", () => {
  it("the 5-day reminder of an unconfirmed visit carries the button; the later ones do not", async () => {
    state.appt = { status: "BOOKED", confirmedAt: null, date: visitIn("5d") };
    await deliver(band("5d"));
    expect(hasConfirmButton(state.sent[0]!.opts)).toBe(true);

    // The patient tapped «✅ Подтверждаю».
    state.appt = { status: "CONFIRMED", confirmedAt: new Date(), date: visitIn("24h") };
    state.sent = [];
    const day = await deliver(band("24h"));
    expect(day.status).toBe("SENT");
    expect(hasConfirmButton(state.sent[0]!.opts)).toBe(false);

    state.appt.date = visitIn("3h");
    state.sent = [];
    const hours3 = await deliver(band("3h"));
    expect(hours3.status).toBe("SENT");
    expect(hasConfirmButton(state.sent[0]!.opts)).toBe(false);
  });
});

describe("scheduler tick — confirmed visits are materialised", () => {
  function confirmedAppt(startsInMin: number) {
    const date = new Date(NOW + startsInMin * 60_000);
    return {
      id: "apt_phone",
      clinicId: "c1",
      patientId: "p1",
      date,
      time: null,
      endDate: new Date(date.getTime() + 30 * 60_000),
      status: "CONFIRMED",
      confirmedAt: new Date(NOW - 86_400_000),
      patient: {
        id: "p1",
        fullName: "Каримова Дилноза",
        phone: "+998901234567",
        telegramId: "tg_1",
        preferredChannel: "TG",
        preferredLang: "RU",
        birthDate: null,
      },
      doctor: { nameRu: "Юсупов", nameUz: "Yusupov" },
      primaryService: null,
      cabinet: null,
      clinic: {
        id: "c1",
        nameRu: "НейроФакс",
        nameUz: "NeuroFax",
        phone: null,
        addressRu: null,
        timezone: "Asia/Tashkent",
      },
    };
  }

  it("looks at CONFIRMED visits too", async () => {
    const { runScheduledTriggers } = await import("@/server/notifications/triggers");
    // Birthdays / payments / case repeats read other tables; stub them empty.
    const { prisma } = await import("@/lib/prisma");
    const p = prisma as unknown as Record<string, Record<string, unknown>>;
    p.patient = { findMany: vi.fn(async () => []) };
    p.payment = { findMany: vi.fn(async () => []) };
    p.medicalCase = { findMany: vi.fn(async () => []) };
    await runScheduledTriggers().catch(() => undefined);
    expect(state.tickWhere?.status).toEqual({ in: ["BOOKED", "CONFIRMED", "WAITING"] });
  });

  it("builds the 24h row for a confirmed visit, and skips the T-3d one", async () => {
    const { materializeForAppointmentsBulk } = await import("@/server/notifications/triggers");
    state.templates = {
      [-1440]: { id: "tpl_24h", triggerConfig: { offsetMin: -1440 } },
      [-4320]: { id: "tpl_3d", triggerConfig: { offsetMin: -4320, skipIfConfirmed: true } },
    };

    state.apptRows = [confirmedAppt(24 * 60 - 30)];
    const day = await materializeForAppointmentsBulk(
      [{ appointmentId: "apt_phone", scheduledFor: new Date(NOW - 30 * 60_000) }],
      "appointment.reminder-24h",
    );
    expect(day.created).toBeGreaterThan(0);
    expect(state.created.some((r) => r.templateId === "tpl_24h" && r.channel === "TG")).toBe(true);

    state.created = [];
    state.apptRows = [confirmedAppt(72 * 60 - 30)];
    const three = await materializeForAppointmentsBulk(
      [{ appointmentId: "apt_phone", scheduledFor: new Date(NOW - 30 * 60_000) }],
      "appointment.reminder-3d",
    );
    expect(three.created).toBe(0);
    expect(state.created).toEqual([]);
  });
});
