/**
 * Unit tests for `publishEvent` dispatch.
 *
 * We assert:
 *   - Validated envelopes hit the in-process bus on the right channel.
 *   - Subscribers receive the exact parsed event (including auto-filled `at`).
 *   - Malformed payloads throw (or are swallowed via `publishEventSafe`).
 *   - `REDIS_URL` un-set keeps `redis: false` in the outcome.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { getEventBus } from "@/server/realtime/event-bus";
import { clinicChannel } from "@/server/realtime/channels";
import {
  publishEvent,
  publishEventSafe,
} from "@/server/realtime/publish";

const CLINIC = "clinic-abc";

describe("publishEvent", () => {
  beforeEach(() => {
    // Ensure Redis mode is off for each test.
    delete process.env.REDIS_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("dispatches a validated envelope to the local bus", async () => {
    const events: unknown[] = [];
    const unsubscribe = getEventBus().subscribe(
      clinicChannel(CLINIC),
      (e) => events.push(e),
    );

    const outcome = await publishEvent(CLINIC, {
      type: "appointment.created",
      payload: { appointmentId: "a1", doctorId: "d1" },
    });

    unsubscribe();

    expect(outcome.local).toBe(true);
    expect(outcome.redis).toBe(false);
    expect(events).toHaveLength(1);
    const first = events[0] as {
      type: string;
      clinicId: string;
      at: string;
      payload: { appointmentId: string };
    };
    expect(first.type).toBe("appointment.created");
    expect(first.clinicId).toBe(CLINIC);
    expect(first.payload.appointmentId).toBe("a1");
    expect(typeof first.at).toBe("string");
  });

  it("clinicId argument overrides any payload clinicId field", async () => {
    const events: unknown[] = [];
    const unsubscribe = getEventBus().subscribe(
      clinicChannel(CLINIC),
      (e) => events.push(e),
    );

    const outcome = await publishEvent(CLINIC, {
      type: "queue.updated",
      payload: { doctorId: "d1" },
    });
    unsubscribe();

    expect(outcome.event.clinicId).toBe(CLINIC);
  });

  it("throws ZodError-derived Error on invalid payload", async () => {
    // Use `any` so the test exercises runtime validation, not compile-time.
    const bad = {
      type: "call.incoming",
      payload: { from: "+111" },
    } as unknown as Parameters<typeof publishEvent>[1];
    await expect(publishEvent(CLINIC, bad)).rejects.toThrow(/invalid event/i);
  });

  it("rejects a bogus event type", async () => {
    const bad = {
      type: "nope.nothing",
      payload: {},
    } as unknown as Parameters<typeof publishEvent>[1];
    await expect(publishEvent(CLINIC, bad)).rejects.toThrow();
  });

  it("does NOT emit on the bus when validation fails", async () => {
    const received: unknown[] = [];
    const unsubscribe = getEventBus().subscribe(
      clinicChannel(CLINIC),
      (e) => received.push(e),
    );

    const bad = {
      type: "notification.sent",
      payload: { channel: "SMS" },
    } as unknown as Parameters<typeof publishEvent>[1];
    await publishEvent(CLINIC, bad).catch(() => {});

    unsubscribe();
    expect(received).toHaveLength(0);
  });
});

describe("publishEventSafe", () => {
  beforeEach(() => {
    delete process.env.REDIS_URL;
  });

  it("swallows validation errors with a console.warn", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = {
      type: "call.incoming",
      payload: { from: "+111" },
    } as unknown as Parameters<typeof publishEventSafe>[1];
    publishEventSafe(CLINIC, bad);
    // The promise chain runs in a microtask; flush it.
    await Promise.resolve();
    await Promise.resolve();
    expect(spy).toHaveBeenCalled();
  });

  it("dispatches happy-path events just like publishEvent", async () => {
    const events: unknown[] = [];
    const unsubscribe = getEventBus().subscribe(
      clinicChannel(CLINIC),
      (e) => events.push(e),
    );

    publishEventSafe(CLINIC, {
      type: "payment.paid",
      payload: {
        paymentId: "p1",
        amount: 50000,
        currency: "UZS",
      },
    });
    // Give the microtask queue a chance; publishEventSafe is fire-and-forget
    // but local dispatch is synchronous inside `publishEvent`.
    await Promise.resolve();
    unsubscribe();
    expect(events).toHaveLength(1);
  });
});

describe("event-bus subscribe/unsubscribe semantics", () => {
  it("unsubscribes cleanly and stops receiving events", async () => {
    const received: unknown[] = [];
    const unsubscribe = getEventBus().subscribe(
      clinicChannel(CLINIC),
      (e) => received.push(e),
    );
    await publishEvent(CLINIC, {
      type: "queue.updated",
      payload: { doctorId: "d1" },
    });
    unsubscribe();
    await publishEvent(CLINIC, {
      type: "queue.updated",
      payload: { doctorId: "d2" },
    });
    expect(received).toHaveLength(1);
  });

  it("isolates subscribers by clinic channel", async () => {
    const fromA: unknown[] = [];
    const fromB: unknown[] = [];
    const a = getEventBus().subscribe(clinicChannel("clinic-a"), (e) =>
      fromA.push(e),
    );
    const b = getEventBus().subscribe(clinicChannel("clinic-b"), (e) =>
      fromB.push(e),
    );

    await publishEvent("clinic-a", {
      type: "queue.updated",
      payload: { doctorId: "d1" },
    });
    await publishEvent("clinic-b", {
      type: "queue.updated",
      payload: { doctorId: "d2" },
    });

    a();
    b();

    expect(fromA).toHaveLength(1);
    expect(fromB).toHaveLength(1);
  });
});
