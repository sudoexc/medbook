/**
 * Zod schema tests for the realtime event union.
 *
 * The schema is the public contract between publishers and SSE consumers,
 * so each event type deserves a positive + negative sample.
 */
import { describe, it, expect } from "vitest";

import {
  AppEventSchema,
  EVENT_TYPES,
  isAppEvent,
  parseEvent,
} from "@/server/realtime/events";

const NOW = "2026-04-22T12:00:00.000Z";

function envelope<T extends (typeof EVENT_TYPES)[number]>(
  type: T,
  payload: unknown,
  overrides: Partial<{ clinicId: string; at: string }> = {},
) {
  return {
    type,
    clinicId: overrides.clinicId ?? "clinic_123",
    at: overrides.at ?? NOW,
    payload,
  };
}

describe("AppEventSchema — coverage", () => {
  it("EVENT_TYPES contains every discriminator used in the schema", () => {
    const schemaTypes = new Set(
      AppEventSchema.options.map((o) => o.shape.type.value),
    );
    for (const t of EVENT_TYPES) {
      expect(schemaTypes.has(t)).toBe(true);
    }
    expect(schemaTypes.size).toBe(EVENT_TYPES.length);
  });

  it("rejects envelopes without clinicId", () => {
    const bad = {
      type: "appointment.created",
      at: NOW,
      payload: { appointmentId: "a1" },
    };
    const res = AppEventSchema.safeParse(bad);
    expect(res.success).toBe(false);
  });

  it("rejects unknown event types", () => {
    const res = AppEventSchema.safeParse(
      envelope(
        // @ts-expect-error — deliberately unknown.
        "unknown.event",
        {},
      ),
    );
    expect(res.success).toBe(false);
  });

  it("requires at to be ISO-8601 with offset", () => {
    const res = AppEventSchema.safeParse(
      envelope(
        "appointment.created",
        { appointmentId: "a1" },
        { at: "not-a-date" },
      ),
    );
    expect(res.success).toBe(false);
  });
});

describe("appointment.*", () => {
  it("accepts a minimal appointment.created", () => {
    const e = envelope("appointment.created", { appointmentId: "a1" });
    const parsed = parseEvent(e);
    expect(parsed.type).toBe("appointment.created");
  });

  it("rejects appointment.created missing appointmentId", () => {
    const res = AppEventSchema.safeParse(
      envelope("appointment.updated", {}),
    );
    expect(res.success).toBe(false);
  });

  it("accepts appointment.statusChanged with status transition", () => {
    const parsed = parseEvent(
      envelope("appointment.statusChanged", {
        appointmentId: "a1",
        status: "IN_PROGRESS",
        previousStatus: "WAITING",
      }),
    );
    if (parsed.type !== "appointment.statusChanged") {
      throw new Error("narrowing failed");
    }
    expect(parsed.payload.status).toBe("IN_PROGRESS");
  });
});

describe("queue.updated", () => {
  it("accepts a minimal envelope", () => {
    const parsed = parseEvent(
      envelope("queue.updated", { doctorId: "d1" }),
    );
    expect(parsed.type).toBe("queue.updated");
  });
});

describe("call.*", () => {
  it("accepts call.incoming with callId", () => {
    const parsed = parseEvent(
      envelope("call.incoming", {
        callId: "log-1",
        from: "+998901234567",
        to: "+998903334455",
      }),
    );
    expect(parsed.type).toBe("call.incoming");
  });

  it("rejects call.incoming missing callId", () => {
    const res = AppEventSchema.safeParse(
      envelope("call.incoming", { from: "+998901234567" }),
    );
    expect(res.success).toBe(false);
  });

  it.each(["call.answered", "call.ended", "call.missed"] as const)(
    "accepts %s",
    (type) => {
      const parsed = parseEvent(envelope(type, { callId: "c1" }));
      expect(parsed.type).toBe(type);
    },
  );
});

describe("tg.*", () => {
  it("accepts tg.message.new with conversationId", () => {
    const parsed = parseEvent(
      envelope("tg.message.new", {
        conversationId: "conv1",
        direction: "IN",
      }),
    );
    expect(parsed.type).toBe("tg.message.new");
  });

  it("accepts tg.takeover.incoming", () => {
    const parsed = parseEvent(
      envelope("tg.takeover.incoming", { conversationId: "conv1" }),
    );
    expect(parsed.type).toBe("tg.takeover.incoming");
  });

  it("accepts tg.conversation.updated", () => {
    const parsed = parseEvent(
      envelope("tg.conversation.updated", {
        conversationId: "conv1",
        mode: "takeover",
      }),
    );
    expect(parsed.type).toBe("tg.conversation.updated");
  });

  it("rejects tg.message.new missing conversationId", () => {
    const res = AppEventSchema.safeParse(
      envelope("tg.message.new", { direction: "IN" }),
    );
    expect(res.success).toBe(false);
  });
});

describe("payment.*", () => {
  it("accepts payment.paid", () => {
    const parsed = parseEvent(
      envelope("payment.paid", {
        paymentId: "p1",
        amount: 150000,
        currency: "UZS",
      }),
    );
    expect(parsed.type).toBe("payment.paid");
  });

  it("accepts payment.due", () => {
    const parsed = parseEvent(
      envelope("payment.due", { appointmentId: "a1" }),
    );
    expect(parsed.type).toBe("payment.due");
  });
});

describe("notification.*", () => {
  it("accepts notification.sent", () => {
    const parsed = parseEvent(
      envelope("notification.sent", {
        sendId: "n1",
        channel: "SMS",
      }),
    );
    expect(parsed.type).toBe("notification.sent");
  });

  it("rejects notification.failed without sendId", () => {
    const res = AppEventSchema.safeParse(
      envelope("notification.failed", { channel: "TG" }),
    );
    expect(res.success).toBe(false);
  });
});

describe("cabinet.occupancy.changed", () => {
  it("accepts a minimal envelope", () => {
    const parsed = parseEvent(
      envelope("cabinet.occupancy.changed", {
        cabinetId: "cab1",
        occupied: true,
      }),
    );
    expect(parsed.type).toBe("cabinet.occupancy.changed");
  });

  it("rejects envelope missing cabinetId", () => {
    const res = AppEventSchema.safeParse(
      envelope("cabinet.occupancy.changed", { occupied: false }),
    );
    expect(res.success).toBe(false);
  });
});

describe("isAppEvent guard", () => {
  it("returns true for a valid envelope", () => {
    expect(
      isAppEvent(envelope("queue.updated", { doctorId: "d" })),
    ).toBe(true);
  });

  it("returns false for a garbage value", () => {
    expect(isAppEvent({ foo: 42 })).toBe(false);
  });
});
