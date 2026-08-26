/**
 * Send-worker backstop: never deliver a reminder whose time has gone stale.
 *
 * Reminder rows are materialised eagerly with the wall-clock time baked into
 * `body` and `scheduledFor` derived from the start the appointment had at
 * booking time. The reschedule path cancels those rows before rebuilding the
 * cascade, but that is a best-effort, post-commit hook — it can lose a race
 * with an in-flight dispatch, and rows predating the fix are still out there.
 *
 * So the worker re-derives the expected fire moment from the appointment's
 * CURRENT start (`date + offsetMin`) and refuses to send when the queued row
 * no longer lines up. Delivering it would tell the patient to arrive at an
 * hour that no longer exists — the exact failure this guard exists to stop.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Send = {
  id: string;
  clinicId: string;
  patientId: string;
  appointmentId: string | null;
  channel: string;
  recipient: string;
  body: string;
  scheduledFor: Date;
  status: string;
  retryCount: number;
  failedReason: string | null;
  patient: { id: string; phone: string; telegramId: string | null };
  template: {
    key: string;
    trigger: string;
    triggerConfig: Record<string, unknown> | null;
  };
};

/** Appointment start: 2026-09-12 11:00 Tashkent (UTC+5) → 06:00Z. */
const START = new Date("2026-09-12T06:00:00.000Z");
const OFFSET_MIN = -1440; // the 24h band

const state = {
  send: null as Send | null,
  apptStart: START,
  apptStatus: "BOOKED" as string,
  confirmedAt: null as Date | null,
  sentBodies: [] as string[],
};

function makeSend(overrides: Partial<Send> = {}): Send {
  return {
    id: "snd_1",
    clinicId: "c1",
    patientId: "p1",
    appointmentId: "apt_1",
    channel: "TG",
    recipient: "tg_1",
    body: "Завтра в 11:00.",
    // Healthy by construction: exactly `offsetMin` before the current start.
    scheduledFor: new Date(START.getTime() + OFFSET_MIN * 60_000),
    status: "QUEUED",
    retryCount: 0,
    failedReason: null,
    patient: { id: "p1", phone: "+998901234567", telegramId: "tg_1" },
    template: {
      key: "appointment.reminder-24h",
      trigger: "APPOINTMENT_BEFORE",
      triggerConfig: { offsetMin: OFFSET_MIN },
    },
    ...overrides,
  };
}

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_scope: unknown, fn: () => T) => fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationSend: {
      findUnique: vi.fn(async () => state.send),
      updateMany: vi.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string; status?: string };
          data: Partial<Send>;
        }) => {
          const s = state.send;
          if (!s || s.id !== where.id) return { count: 0 };
          if (where.status !== undefined && s.status !== where.status)
            return { count: 0 };
          Object.assign(s, data);
          return { count: 1 };
        },
      ),
      update: vi.fn(async ({ data }: { data: Partial<Send> }) => {
        if (state.send) Object.assign(state.send, data);
        return state.send;
      }),
    },
    appointment: {
      findUnique: vi.fn(async () => ({
        confirmedAt: state.confirmedAt,
        status: state.apptStatus,
        date: state.apptStart,
      })),
    },
  },
}));

// Any adapter reach-through means the guard let the row through — record it.
vi.mock("@/server/notifications/adapters", () => ({
  resolveAdapters: vi.fn(async () => ({
    tg: {
      send: vi.fn(async (_chatId: string, body: string) => {
        state.sentBodies.push(body);
        return { messageId: 1 };
      }),
    },
  })),
}));

vi.mock("@/server/notifications/rate-limit", () => ({
  getRateLimiter: () => ({ check: async () => true }),
}));

vi.mock("@/server/notifications/record-delivery", () => ({
  recordNotificationDelivery: vi.fn(async () => {}),
}));

vi.mock("@/server/queue", () => ({
  enqueue: vi.fn(async () => {}),
  getQueue: () => ({ registerWorker: vi.fn() }),
}));

beforeEach(() => {
  state.send = null;
  state.apptStart = START;
  state.apptStatus = "BOOKED";
  state.confirmedAt = null;
  state.sentBodies = [];
});

describe("notifications-send worker — stale-time guard", () => {
  it("cancels instead of sending when the appointment moved after the row was queued", async () => {
    const { _deliverForTests } = await import(
      "@/server/workers/notifications-send"
    );

    state.send = makeSend();
    // The clinic pushed the appointment two days later; this row still points
    // at the old slot and its body still says 11:00 on the 12th.
    state.apptStart = new Date("2026-09-14T06:00:00.000Z");

    await _deliverForTests({ sendId: "snd_1" });

    expect(state.sentBodies).toEqual([]);
    expect(state.send!.status).toBe("CANCELLED");
    expect(state.send!.failedReason).toBe(
      "appointment time changed after reminder was queued",
    );
  });

  it("still sends when the queued time matches the appointment's current start", async () => {
    const { _deliverForTests } = await import(
      "@/server/workers/notifications-send"
    );

    state.send = makeSend();

    await _deliverForTests({ sendId: "snd_1" });

    expect(state.send!.status).not.toBe("CANCELLED");
    expect(state.sentBodies).toEqual(["Завтра в 11:00."]);
  });

  it("tolerates sub-minute drift (the scheduler ticks on a 60s cadence)", async () => {
    const { _deliverForTests } = await import(
      "@/server/workers/notifications-send"
    );

    state.send = makeSend({
      scheduledFor: new Date(START.getTime() + OFFSET_MIN * 60_000 + 30_000),
    });

    await _deliverForTests({ sendId: "snd_1" });

    expect(state.send!.status).not.toBe("CANCELLED");
    expect(state.sentBodies.length).toBe(1);
  });

  it("leaves templates without a numeric offset alone — we can't infer an expected time", async () => {
    const { _deliverForTests } = await import(
      "@/server/workers/notifications-send"
    );

    state.send = makeSend({
      template: {
        key: "appointment.reminder-custom",
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: null,
      },
    });
    state.apptStart = new Date("2026-09-14T06:00:00.000Z");

    await _deliverForTests({ sendId: "snd_1" });

    // Refusing to send would be worse than sending: no offset means no
    // expectation to compare against.
    expect(state.send!.status).not.toBe("CANCELLED");
    expect(state.sentBodies.length).toBe(1);
  });

  it("keeps cancelling on the pre-existing confirmed/closed guard", async () => {
    const { _deliverForTests } = await import(
      "@/server/workers/notifications-send"
    );

    state.send = makeSend();
    state.apptStatus = "CANCELLED";

    await _deliverForTests({ sendId: "snd_1" });

    expect(state.sentBodies).toEqual([]);
    expect(state.send!.status).toBe("CANCELLED");
    expect(state.send!.failedReason).toBe(
      "patient already confirmed (or appointment closed)",
    );
  });
});
