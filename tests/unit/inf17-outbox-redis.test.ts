/**
 * Audit INF-17 — the outbox's at-least-once promise held only up to Redis.
 *
 *   - The pumper runs in the worker, where no SSE client listens; Redis is
 *     the only road to the screens. `publishEnvelopeToRedis` swallowed a
 *     failed PUBLISH and returned true, and the row was marked DELIVERED.
 *     Now it throws, the row stays FAILED (attempts untouched: an outage is
 *     not the event's fault) and the batch waits for the next tick.
 *   - `ensureRedisSubscriber` set `started` before psubscribe succeeded, so
 *     an app started while Redis was down never subscribed. It now retries
 *     with a doubling delay, attaches its message handler once, and reports
 *     a failing subscription to health.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
  process.env.REDIS_URL = "redis://fake:6379";
  return {
    publishFail: false,
    published: [] as string[],
    psubscribeFailures: 0,
    psubscribeCalls: 0,
    pmessageHandlers: 0,
  };
});

vi.mock("ioredis", () => {
  class FakeRedis {
    on(ev: string) {
      if (ev === "pmessage") fake.pmessageHandlers += 1;
      return this;
    }
    async publish(channel: string) {
      if (fake.publishFail) throw new Error("Connection is closed.");
      fake.published.push(channel);
      return 1;
    }
    psubscribe() {
      fake.psubscribeCalls += 1;
      if (fake.psubscribeFailures > 0) {
        fake.psubscribeFailures -= 1;
        return Promise.reject(new Error("connect ECONNREFUSED"));
      }
      return Promise.resolve(1);
    }
    quit() {
      return Promise.resolve("OK");
    }
  }
  return { default: FakeRedis };
});

const db = vi.hoisted(() => ({
  rows: [] as Array<{ id: string; envelope: unknown; attempts: number }>,
  updates: [] as Array<{ id: string; data: Record<string, unknown> }>,
}));
vi.mock("@/lib/prisma", () => {
  const tx = {
    $queryRaw: vi.fn(async () => db.rows),
    eventOutbox: {
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        db.updates.push({ id: args.where.id, data: args.data });
      }),
    },
  };
  return {
    prisma: {
      $transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
      auditLog: { createMany: vi.fn() },
    },
  };
});
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: (_ctx: unknown, fn: () => unknown) => fn(),
}));

import { pumpOnce } from "@/server/workers/outbox-pumper";
import {
  __resetRedisForTests,
  ensureRedisSubscriber,
  isRedisSubscriptionHealthy,
  publishEnvelopeToRedis,
  RedisPublishError,
} from "@/server/realtime/redis-adapter";

function envelope(id: string) {
  return {
    eventId: id,
    correlationId: `cor_${id}`,
    at: "2026-10-02T10:00:00.000Z",
    type: "appointment.updated",
    payload: { appointmentId: "a1" },
    actor: { role: "SYSTEM", userId: null, patientId: null, onBehalfOfPatientId: null, label: "system:test" },
    surface: "WORKER",
    tenantScope: { clinicId: "c1" },
  };
}

beforeEach(async () => {
  fake.publishFail = false;
  fake.published = [];
  fake.psubscribeFailures = 0;
  fake.psubscribeCalls = 0;
  fake.pmessageHandlers = 0;
  db.rows = [
    { id: "ev1", envelope: envelope("ev1"), attempts: 0 },
    { id: "ev2", envelope: envelope("ev2"), attempts: 0 },
  ];
  db.updates = [];
  await __resetRedisForTests();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterAll(() => {
  delete process.env.REDIS_URL;
});

describe("outbox pumper with Redis down", () => {
  it("publishEnvelopeToRedis rejects instead of reporting success", async () => {
    fake.publishFail = true;
    await expect(publishEnvelopeToRedis(envelope("e") as never)).rejects.toBeInstanceOf(
      RedisPublishError,
    );
  });

  it("a failed publish leaves the row FAILED with its attempts, and holds the batch", async () => {
    fake.publishFail = true;
    const r = await pumpOnce();
    expect(r).toEqual({ delivered: 0, failed: 1, dead: 0 });
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]!.id).toBe("ev1");
    expect(db.updates[0]!.data.status).toBe("FAILED");
    expect(db.updates[0]!.data.attempts).toBeUndefined();
    expect(String(db.updates[0]!.data.lastError)).toMatch(/Connection is closed/);
    expect(db.updates.some((u) => u.data.status === "DELIVERED")).toBe(false);
  });

  it("Redis back: the same rows are delivered in order on the next tick", async () => {
    fake.publishFail = true;
    await pumpOnce();
    fake.publishFail = false;
    db.updates = [];
    const r = await pumpOnce();
    expect(r.delivered).toBe(2);
    expect(db.updates.map((u) => [u.id, u.data.status])).toEqual([
      ["ev1", "DELIVERED"],
      ["ev2", "DELIVERED"],
    ]);
    expect(fake.published).toEqual(["events:c1", "events:c1"]);
  });

  it("a bad envelope still counts an attempt toward dead-lettering", async () => {
    db.rows = [{ id: "bad", envelope: { nope: true }, attempts: 0 }];
    const r = await pumpOnce();
    expect(r.failed).toBe(1);
    expect(db.updates[0]!.data).toMatchObject({ status: "FAILED", attempts: 1 });
  });
});

describe("realtime subscriber when Redis is down at app start", () => {
  it("retries psubscribe until it succeeds, with one message handler", async () => {
    vi.useFakeTimers();
    try {
      fake.psubscribeFailures = 2;
      ensureRedisSubscriber();
      ensureRedisSubscriber();
      await vi.advanceTimersByTimeAsync(0);
      expect(fake.psubscribeCalls).toBe(1);
      expect(isRedisSubscriptionHealthy()).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      expect(fake.psubscribeCalls).toBe(2);
      expect(isRedisSubscriptionHealthy()).toBe(false);

      await vi.advanceTimersByTimeAsync(2_000);
      expect(fake.psubscribeCalls).toBe(3);
      expect(isRedisSubscriptionHealthy()).toBe(true);

      await vi.advanceTimersByTimeAsync(60_000);
      expect(fake.psubscribeCalls).toBe(3);
      expect(fake.pmessageHandlers).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a fresh process that never needed the subscriber reports healthy", () => {
    expect(isRedisSubscriptionHealthy()).toBe(true);
  });
});
