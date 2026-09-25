import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit AP-02 in the send worker:
 *   - a row whose `scheduledFor` is still ahead is never delivered early,
 *     whoever enqueued it (it stays QUEUED for the dispatch loop);
 *   - the staff-sent manual reminder (MANUAL template, due now) is delivered
 *     with the confirm button and is not killed by the cascade drift check;
 *   - an appointment reminder never reaches a patient already in the hall.
 */

type Send = {
  id: string;
  clinicId: string;
  patientId: string;
  appointmentId: string | null;
  campaignId: string | null;
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
  apptStatus: "BOOKED",
  apptDate: new Date(),
  sent: [] as Array<{ body: string; opts: unknown }>,
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
    },
    appointment: {
      findUnique: vi.fn(async () => ({
        confirmedAt: null,
        status: state.apptStatus,
        date: state.apptDate,
      })),
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

function makeSend(overrides: Partial<Send> = {}): Send {
  return {
    id: "snd_1",
    clinicId: "c1",
    patientId: "p1",
    appointmentId: "apt_1",
    campaignId: null,
    channel: "TG",
    recipient: "tg_1",
    body: "Напоминаем о приёме.",
    scheduledFor: new Date(Date.now() - 1_000),
    status: "QUEUED",
    retryCount: 0,
    failedReason: null,
    patient: { id: "p1", phone: "+998901234567", telegramId: "tg_1" },
    template: {
      key: "appointment.reminder-manual",
      trigger: "MANUAL",
      triggerConfig: null,
    },
    ...overrides,
  };
}

beforeEach(() => {
  state.send = null;
  state.apptStatus = "BOOKED";
  // A 16:00 visit, reminded at 09:00: 7 hours ahead.
  state.apptDate = new Date(Date.now() + 7 * 60 * 60_000);
  state.sent = [];
});

describe("notifications-send — due-time and manual-reminder guards", () => {
  it("never delivers a cascade row before its time (it stays QUEUED)", async () => {
    const { _deliverForTests } = await import("@/server/workers/notifications-send");
    // The «через 3 часа» row of a 16:00 visit, due at 13:00.
    state.send = makeSend({
      scheduledFor: new Date(state.apptDate.getTime() - 180 * 60_000),
      template: {
        key: "appointment.reminder-3h",
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { offsetMin: -180 },
      },
    });
    await _deliverForTests({ sendId: "snd_1" });
    expect(state.sent).toEqual([]);
    expect(state.send!.status).toBe("QUEUED");
  });

  it("delivers the manual reminder now, with the confirm button, no drift cancel", async () => {
    const { _deliverForTests } = await import("@/server/workers/notifications-send");
    state.send = makeSend();
    await _deliverForTests({ sendId: "snd_1" });
    expect(state.sent).toHaveLength(1);
    expect(JSON.stringify(state.sent[0]!.opts)).toContain("confirm:apt_1");
    expect(state.send!.status).not.toBe("CANCELLED");
  });

  it("drops a manual reminder once the patient is already in the hall", async () => {
    const { _deliverForTests } = await import("@/server/workers/notifications-send");
    state.send = makeSend();
    state.apptStatus = "WAITING";
    await _deliverForTests({ sendId: "snd_1" });
    expect(state.sent).toEqual([]);
    expect(state.send!.status).toBe("CANCELLED");
  });

  it("drops a cascade reminder for a patient already waiting in the clinic", async () => {
    const { _deliverForTests } = await import("@/server/workers/notifications-send");
    state.apptDate = new Date(Date.now() + 180 * 60_000);
    state.send = makeSend({
      scheduledFor: new Date(Date.now() - 1_000 + 0),
      template: {
        key: "appointment.reminder-3h",
        trigger: "APPOINTMENT_BEFORE",
        triggerConfig: { offsetMin: -180 },
      },
    });
    state.apptStatus = "WAITING";
    await _deliverForTests({ sendId: "snd_1" });
    expect(state.sent).toEqual([]);
    expect(state.send!.status).toBe("CANCELLED");
  });
});
