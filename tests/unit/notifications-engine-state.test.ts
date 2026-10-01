/**
 * Notification pipeline: the pure delivery rules and the terminal-state
 * write (audit TG-06, TG-08, TG-12).
 *
 *   - which rows staff may retry (FAILED, or SENDING abandoned past the
 *     timeout), never SENT / fresh SENDING;
 *   - the appointment start a reminder was written for, kept across
 *     `scheduledFor` moves;
 *   - one queue dedupe key per attempt;
 *   - the in-memory queue drops a second job under a waiting key, like
 *     BullMQ deduplication, and frees the key once the job ran;
 *   - a successful send leaves retryCount alone, a failure stamps failedAt.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  LIVE_SEND_STATUSES,
  SENDING_REQUEUE_MAX_AGE_MS,
  SENDING_STALE_MS,
  deliveryAttemptKey,
  isRetryable,
  isStaleSending,
  pinnedAnchor,
  reminderAnchorMs,
  stuckSendingVerdict,
} from "@/server/notifications/delivery-state";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

describe("isRetryable / isStaleSending", () => {
  it("allows FAILED rows", () => {
    expect(isRetryable({ status: "FAILED", scheduledFor: minutesAgo(5) }, NOW)).toBe(true);
  });

  it("refuses SENT, QUEUED and CANCELLED rows (a retry would reach the patient twice)", () => {
    for (const status of ["SENT", "DELIVERED", "READ", "QUEUED", "CANCELLED"]) {
      expect(isRetryable({ status, scheduledFor: minutesAgo(60) }, NOW), status).toBe(false);
    }
  });

  it("refuses a SENDING row claimed moments ago, allows one abandoned past the timeout", () => {
    const fresh = { status: "SENDING", claimedAt: minutesAgo(1), scheduledFor: minutesAgo(30) };
    const stale = { status: "SENDING", claimedAt: minutesAgo(11), scheduledFor: minutesAgo(30) };
    expect(isStaleSending(fresh, NOW)).toBe(false);
    expect(isRetryable(fresh, NOW)).toBe(false);
    expect(isStaleSending(stale, NOW)).toBe(true);
    expect(isRetryable(stale, NOW)).toBe(true);
  });

  it("falls back to scheduledFor for rows claimed before claimedAt existed", () => {
    const legacy = { status: "SENDING", claimedAt: null, scheduledFor: minutesAgo(11) };
    const legacyFresh = { status: "SENDING", claimedAt: null, scheduledFor: minutesAgo(2) };
    expect(isStaleSending(legacy, NOW)).toBe(true);
    expect(isStaleSending(legacyFresh, NOW)).toBe(false);
  });

  it("uses a ten minute timeout", () => {
    expect(SENDING_STALE_MS).toBe(10 * 60_000);
  });
});

describe("stuckSendingVerdict (TG-12 review)", () => {
  it("requeues a recent abandoned row while it has attempts left", () => {
    expect(stuckSendingVerdict({ claimedAt: minutesAgo(11), scheduledFor: minutesAgo(11), retryCount: 0 }, NOW)).toBe("requeue");
    expect(stuckSendingVerdict({ claimedAt: minutesAgo(11), scheduledFor: minutesAgo(11), retryCount: 2 }, NOW)).toBe("out_of_attempts");
  });

  it("fails a row abandoned over an hour ago, whatever its attempts", () => {
    expect(SENDING_REQUEUE_MAX_AGE_MS).toBe(60 * 60_000);
    expect(stuckSendingVerdict({ claimedAt: minutesAgo(61), scheduledFor: minutesAgo(61), retryCount: 0 }, NOW)).toBe("too_old");
    expect(stuckSendingVerdict({ claimedAt: minutesAgo(59), scheduledFor: minutesAgo(59), retryCount: 0 }, NOW)).toBe("requeue");
  });

  it("ages a legacy row (no claimedAt) by its due moment", () => {
    expect(stuckSendingVerdict({ claimedAt: null, scheduledFor: minutesAgo(30 * 24 * 60), retryCount: 0 }, NOW)).toBe("too_old");
    expect(stuckSendingVerdict({ claimedAt: null, scheduledFor: minutesAgo(30), retryCount: 0 }, NOW)).toBe("requeue");
  });
});

describe("LIVE_SEND_STATUSES", () => {
  it("counts a row being sent as scheduled, a failed or cancelled one as not", () => {
    expect(LIVE_SEND_STATUSES).toContain("SENDING");
    expect(LIVE_SEND_STATUSES).not.toContain("FAILED");
    expect(LIVE_SEND_STATUSES).not.toContain("CANCELLED");
  });
});

describe("reminderAnchorMs / pinnedAnchor", () => {
  const START = new Date("2026-10-02T06:00:00.000Z");

  it("reads appointmentAt when the row carries it, whatever scheduledFor says", () => {
    expect(
      reminderAnchorMs({ appointmentAt: START, scheduledFor: NOW }, -1440),
    ).toBe(START.getTime());
  });

  it("derives it from scheduledFor - offsetMin for older rows", () => {
    const scheduledFor = new Date(START.getTime() - 1440 * 60_000);
    expect(reminderAnchorMs({ appointmentAt: null, scheduledFor }, -1440)).toBe(
      START.getTime(),
    );
  });

  it("knows nothing without either", () => {
    expect(reminderAnchorMs({ appointmentAt: null, scheduledFor: NOW }, undefined)).toBeNull();
  });

  it("pins the derived anchor of a legacy cascade row before scheduledFor moves", () => {
    const scheduledFor = new Date(START.getTime() - 180 * 60_000);
    expect(
      pinnedAnchor({
        appointmentId: "a1",
        appointmentAt: null,
        scheduledFor,
        template: { trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -180 } },
      }),
    ).toEqual({ appointmentAt: START });
  });

  it("pins nothing for rows that already carry it or are not reminders", () => {
    expect(
      pinnedAnchor({
        appointmentId: "a1",
        appointmentAt: START,
        scheduledFor: NOW,
        template: { trigger: "APPOINTMENT_BEFORE", triggerConfig: { offsetMin: -180 } },
      }),
    ).toEqual({});
    expect(
      pinnedAnchor({
        appointmentId: "a1",
        appointmentAt: null,
        scheduledFor: NOW,
        template: { trigger: "MANUAL", triggerConfig: null },
      }),
    ).toEqual({});
  });
});

describe("deliveryAttemptKey", () => {
  it("is stable for one attempt and new for the next", () => {
    const a = deliveryAttemptKey({ id: "cksnd1", scheduledFor: NOW });
    expect(a).toBe(deliveryAttemptKey({ id: "cksnd1", scheduledFor: new Date(NOW) }));
    expect(deliveryAttemptKey({ id: "cksnd1", scheduledFor: new Date(NOW.getTime() + 60_000) })).not.toBe(a);
  });

  it("names the row it belongs to", () => {
    expect(deliveryAttemptKey({ id: "cksnd1", scheduledFor: NOW })).toBe(
      `send-cksnd1-${NOW.getTime()}`,
    );
  });
});

describe("in-memory queue honours dedupeId like BullMQ", () => {
  it("runs one job for two enqueues under the same waiting key", async () => {
    vi.resetModules();
    const prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    const { getQueue, __setQueueForTests } = await import("@/server/queue");
    __setQueueForTests(null);
    const q = getQueue();
    const seen: string[] = [];
    q.registerWorker<{ sendId: string }>("t:q", "deliver", async (d) => {
      seen.push(d.sendId);
    });
    // A delayed attempt (the backoff) and the dispatch loop offering the
    // same attempt again while it waits: one run.
    await q.enqueue("t:q", "deliver", { sendId: "s1" }, { dedupeId: "send-s1-1", delay: 20 });
    await q.enqueue("t:q", "deliver", { sendId: "s1" }, { dedupeId: "send-s1-1" });
    await q.enqueue("t:q", "deliver", { sendId: "s2" }, { dedupeId: "send-s2-1", delay: 20 });
    await new Promise((r) => setTimeout(r, 60));
    expect(seen.sort()).toEqual(["s1", "s2"]);
    // The key is free again once its job ran: an attempt that ended without
    // a result can be offered again.
    await q.enqueue("t:q", "deliver", { sendId: "s1" }, { dedupeId: "send-s1-1" });
    await new Promise((r) => setTimeout(r, 10));
    expect(seen.filter((x) => x === "s1")).toHaveLength(2);
    await q.shutdown();
    __setQueueForTests(null);
    if (prevRedis !== undefined) process.env.REDIS_URL = prevRedis;
  });
});

// ── recordNotificationDelivery ─────────────────────────────────────────────

const writes = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>> }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        notificationSend: {
          update: async ({ data }: { data: Record<string, unknown> }) => {
            writes.data.push(data);
            return {};
          },
          groupBy: async () => [],
        },
        campaign: { updateMany: async () => ({ count: 0 }) },
      }),
  },
}));
vi.mock("@/server/realtime/outbox", () => ({
  newCorrelationId: () => "corr",
  publishViaOutbox: async () => ({ eventId: "e1", correlationId: "corr" }),
}));

describe("recordNotificationDelivery (audit TG-06)", () => {
  beforeEach(() => {
    writes.data = [];
  });

  const send = {
    id: "s1",
    clinicId: "c1",
    patientId: "p1",
    channel: "TG" as const,
    templateKey: "appointment.reminder-24h",
    campaignId: null,
  };

  it("does not count a successful send as a retry", async () => {
    const { recordNotificationDelivery } = await import(
      "@/server/notifications/record-delivery"
    );
    await recordNotificationDelivery({
      send,
      outcome: { kind: "sent", externalId: "42", sentAt: NOW },
    });
    expect(writes.data[0]).toMatchObject({ status: "SENT" });
    expect(writes.data[0]).not.toHaveProperty("retryCount");
  });

  it("stamps failedAt on the terminal failure", async () => {
    const { recordNotificationDelivery } = await import(
      "@/server/notifications/record-delivery"
    );
    await recordNotificationDelivery({
      send,
      outcome: { kind: "failed", failedReason: "Telegram 502", retryCount: 3 },
    });
    expect(writes.data[0]).toMatchObject({ status: "FAILED", retryCount: 3 });
    expect(writes.data[0]!.failedAt).toBeInstanceOf(Date);
  });
});
