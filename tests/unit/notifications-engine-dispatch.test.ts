/**
 * Audit TG-12: the dispatcher and the send worker's retry bookkeeping.
 *
 *   - a failed attempt moves scheduledFor by the backoff (60 s first), so the
 *     5 s dispatch loop does not resend it at once;
 *   - a rate-limited send is pushed back the same way;
 *   - every hand-over carries a dedupe key tied to the attempt, so repeated
 *     dispatch passes add no duplicate jobs;
 *   - a row stuck in SENDING past ten minutes goes back to work (or to
 *     FAILED once out of attempts); a fresh claim is left alone.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { matchesWhere } from "./notifications/where-matcher";

type Row = Record<string, unknown>;

const state = vi.hoisted(() => ({
  sends: [] as Array<Record<string, unknown>>,
  enqueued: [] as Array<{ data: { sendId: string }; opts?: { delay?: number; dedupeId?: string } }>,
  tgFails: false,
  rateOk: true,
}));

vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_s: unknown, fn: () => T) => fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationSend: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
        const s = state.sends.find((x) => x.id === where.id);
        return s
          ? {
              ...s,
              template: { key: "broadcast", trigger: "MANUAL", triggerConfig: null },
              patient: { id: "p1", phone: "+998", telegramId: "tg1", preferredLang: "RU" },
              clinic: { slug: "neurofax" },
            }
          : null;
      }),
      findMany: vi.fn(
        async ({ where, take, orderBy }: { where: Row; take?: number; orderBy?: Row }) => {
          let rows = state.sends.filter((s) => matchesWhere(s, where));
          if (orderBy && "scheduledFor" in orderBy) {
            rows = rows.sort(
              (a, b) => (a.scheduledFor as Date).getTime() - (b.scheduledFor as Date).getTime(),
            );
          }
          return rows.slice(0, take ?? rows.length).map((r) => ({ ...r, template: null }));
        },
      ),
      updateMany: vi.fn(async ({ where, data }: { where: Row; data: Row }) => {
        let count = 0;
        for (const s of state.sends) {
          if (!matchesWhere(s, where)) continue;
          Object.assign(s, data);
          count += 1;
        }
        return { count };
      }),
    },
    appointment: { findUnique: vi.fn(async () => null) },
  },
}));

vi.mock("@/server/notifications/adapters", () => ({
  resolveAdapters: vi.fn(async () => ({
    tg: {
      send: vi.fn(async () => {
        if (state.tgFails) throw new Error("fetch failed: Telegram unreachable");
        return { messageId: 1 };
      }),
    },
  })),
}));
vi.mock("@/server/notifications/rate-limit", () => ({
  getRateLimiter: () => ({ check: async () => state.rateOk }),
}));
vi.mock("@/server/notifications/record-delivery", () => ({
  recordNotificationDelivery: vi.fn(
    async ({ send, outcome }: { send: { id: string }; outcome: { kind: string } }) => {
      const s = state.sends.find((x) => x.id === send.id)!;
      s.status = outcome.kind === "sent" ? "SENT" : "FAILED";
    },
  ),
}));
vi.mock("@/server/conversations/notification-mirror", () => ({
  mirrorNotificationToConversation: vi.fn(async () => undefined),
}));
vi.mock("@/server/queue", () => ({
  enqueue: vi.fn(
    async (_q: string, _j: string, data: { sendId: string }, opts?: { delay?: number; dedupeId?: string }) => {
      state.enqueued.push({ data, opts });
    },
  ),
  getQueue: () => ({ registerWorker: vi.fn(), repeat: vi.fn() }),
}));
// The scheduler module imports the trigger registry; its passes are not
// under test here.
vi.mock("@/server/notifications/triggers", () => ({
  APPOINTMENT_REFS_INCLUDE: {},
  renderAppointmentBody: () => "",
  runScheduledTriggers: async () => ({}),
}));
vi.mock("@/server/notifications/no-channel-action", () => ({
  recordPatientNoChannel: vi.fn(async () => undefined),
}));

const NOW = new Date("2026-10-01T09:00:00.000Z");

function row(over: Row = {}): Row {
  return {
    id: "snd_1",
    clinicId: "c1",
    patientId: "p1",
    appointmentId: null,
    appointmentAt: null,
    campaignId: "cmp_1",
    channel: "TG",
    recipient: "tg1",
    body: "Акция",
    status: "QUEUED",
    retryCount: 0,
    claimedAt: null,
    failedAt: null,
    scheduledFor: new Date(NOW.getTime() - 1_000),
    ...over,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  state.sends = [];
  state.enqueued = [];
  state.tgFails = false;
  state.rateOk = true;
});

describe("send worker: failed attempt", () => {
  it("goes back to QUEUED due in 60 s, under a dedupe key for that moment", async () => {
    const { _deliverForTests } = await import("@/server/workers/notifications-send");
    const { deliveryAttemptKey } = await import("@/server/notifications/delivery-state");
    state.sends.push(row());
    state.tgFails = true;

    await _deliverForTests({ sendId: "snd_1" });

    const s = state.sends[0]!;
    expect(s.status).toBe("QUEUED");
    expect(s.retryCount).toBe(1);
    expect(s.claimedAt).toBeNull();
    expect((s.scheduledFor as Date).getTime()).toBe(NOW.getTime() + 60_000);
    expect(state.enqueued).toHaveLength(1);
    expect(state.enqueued[0]!.opts).toEqual({
      delay: 60_000,
      dedupeId: deliveryAttemptKey({ id: "snd_1", scheduledFor: s.scheduledFor as Date }),
    });
  });

  it("is not handed out again by the dispatch loop before its time", async () => {
    const { _deliverForTests } = await import("@/server/workers/notifications-send");
    const { dispatchDue } = await import("@/server/workers/notifications-scheduler");
    state.sends.push(row());
    state.tgFails = true;
    await _deliverForTests({ sendId: "snd_1" });
    state.enqueued = [];

    expect(await dispatchDue(new Date(NOW.getTime() + 5_000))).toBe(0);
    expect(await dispatchDue(new Date(NOW.getTime() + 61_000))).toBe(1);
  });

  it("lands in FAILED on the third failure", async () => {
    const { _deliverForTests } = await import("@/server/workers/notifications-send");
    state.sends.push(row({ retryCount: 2 }));
    state.tgFails = true;
    await _deliverForTests({ sendId: "snd_1" });
    expect(state.sends[0]!.status).toBe("FAILED");
  });
});

describe("send worker: rate limit", () => {
  it("pushes the row back 60 s instead of leaving it due", async () => {
    const { _deliverForTests } = await import("@/server/workers/notifications-send");
    state.sends.push(row());
    state.rateOk = false;
    await _deliverForTests({ sendId: "snd_1" });
    const s = state.sends[0]!;
    expect(s.status).toBe("QUEUED");
    expect(s.retryCount).toBe(0);
    expect((s.scheduledFor as Date).getTime()).toBe(NOW.getTime() + 60_000);
    expect(state.enqueued[0]!.opts?.delay).toBe(60_000);
  });
});

describe("dispatchDue", () => {
  it("offers each due row under one dedupe key, the same on every pass", async () => {
    const { dispatchDue } = await import("@/server/workers/notifications-scheduler");
    state.sends.push(row({ id: "a" }), row({ id: "b" }));
    await dispatchDue(NOW);
    await dispatchDue(new Date(NOW.getTime() + 5_000));
    const ids = state.enqueued.map((e) => e.opts?.dedupeId);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(2);
  });
});

describe("sweepStuckSending", () => {
  it("returns a row stuck in SENDING for 11 minutes to the queue, due now", async () => {
    const { sweepStuckSending } = await import("@/server/workers/notifications-scheduler");
    state.sends.push(
      row({ status: "SENDING", claimedAt: new Date(NOW.getTime() - 11 * 60_000) }),
    );
    const res = await sweepStuckSending(NOW);
    expect(res).toEqual({ requeued: 1, failed: 0 });
    const s = state.sends[0]!;
    expect(s.status).toBe("QUEUED");
    expect(s.retryCount).toBe(1);
    expect((s.scheduledFor as Date).getTime()).toBe(NOW.getTime());
    expect(s.claimedAt).toBeNull();
  });

  it("leaves a fresh claim alone", async () => {
    const { sweepStuckSending } = await import("@/server/workers/notifications-scheduler");
    state.sends.push(row({ status: "SENDING", claimedAt: new Date(NOW.getTime() - 60_000) }));
    expect(await sweepStuckSending(NOW)).toEqual({ requeued: 0, failed: 0 });
    expect(state.sends[0]!.status).toBe("SENDING");
  });

  it("fails a row that has no attempts left, stamping failedAt", async () => {
    const { sweepStuckSending } = await import("@/server/workers/notifications-scheduler");
    state.sends.push(
      row({ status: "SENDING", retryCount: 2, claimedAt: new Date(NOW.getTime() - 20 * 60_000) }),
    );
    expect(await sweepStuckSending(NOW)).toEqual({ requeued: 0, failed: 1 });
    expect(state.sends[0]!.status).toBe("FAILED");
    expect((state.sends[0]!.failedAt as Date).getTime()).toBe(NOW.getTime());
  });

  it("sweeps a legacy SENDING row (no claimedAt) by its due moment", async () => {
    const { sweepStuckSending } = await import("@/server/workers/notifications-scheduler");
    state.sends.push(
      row({ status: "SENDING", claimedAt: null, scheduledFor: new Date(NOW.getTime() - 30 * 60_000) }),
    );
    expect((await sweepStuckSending(NOW)).requeued).toBe(1);
  });

  // Review of TG-12: a broadcast or a reminder stuck weeks ago by an earlier
  // deploy must not go out now, months late, on the first tick.
  it("fails a legacy SENDING row stuck for weeks instead of re-sending it", async () => {
    const { sweepStuckSending } = await import("@/server/workers/notifications-scheduler");
    state.sends.push(
      row({
        status: "SENDING",
        claimedAt: null,
        body: "Скидка до 1 июля",
        scheduledFor: new Date(NOW.getTime() - 40 * 24 * 3_600_000),
      }),
    );
    expect(await sweepStuckSending(NOW)).toEqual({ requeued: 0, failed: 1 });
    const s = state.sends[0]!;
    expect(s.status).toBe("FAILED");
    expect((s.failedAt as Date).getTime()).toBe(NOW.getTime());
    expect(s.failedReason).toContain("not resent automatically");
    // Not due again: the dispatch loop does not pick it up.
    await dispatchDueNow();
    expect(state.enqueued).toEqual([]);
  });

  it("fails a claimed row abandoned more than an hour ago, requeues one from 50 minutes ago", async () => {
    const { sweepStuckSending } = await import("@/server/workers/notifications-scheduler");
    state.sends.push(
      row({ id: "old", status: "SENDING", claimedAt: new Date(NOW.getTime() - 61 * 60_000) }),
      row({ id: "recent", status: "SENDING", claimedAt: new Date(NOW.getTime() - 50 * 60_000) }),
    );
    expect(await sweepStuckSending(NOW)).toEqual({ requeued: 1, failed: 1 });
    expect(state.sends.find((s) => s.id === "old")!.status).toBe("FAILED");
    expect(state.sends.find((s) => s.id === "recent")!.status).toBe("QUEUED");
  });
});

async function dispatchDueNow() {
  const { dispatchDue } = await import("@/server/workers/notifications-scheduler");
  await dispatchDue(NOW);
}
