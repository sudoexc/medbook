/**
 * Unit tests for the LogOnly telephony adapter.
 *
 * We mock Prisma + the tenant-context module so the adapter can be exercised
 * without a live database. The event bus is the real one — we subscribe and
 * assert on emitted events (it's a process-local stub, so tests are cheap).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CallRow = {
  id: string;
  clinicId: string;
  direction: "IN" | "OUT" | "MISSED";
  fromNumber: string;
  toNumber: string;
  operatorId: string | null;
  sipCallId: string | null;
  createdAt: Date;
  endedAt: Date | null;
  durationSec: number | null;
  recordingUrl: string | null;
  summary: string | null;
  tags: string[];
  patientId: string | null;
};

const rows: CallRow[] = [];
let nextId = 1;

vi.mock("@/lib/prisma", () => ({
  prisma: {
    call: {
      create: vi.fn(async (args: { data: Partial<CallRow> }) => {
        const row: CallRow = {
          id: String(nextId++),
          clinicId: "clinic-a",
          direction: args.data.direction ?? "OUT",
          fromNumber: args.data.fromNumber ?? "",
          toNumber: args.data.toNumber ?? "",
          operatorId: args.data.operatorId ?? null,
          sipCallId: args.data.sipCallId ?? null,
          createdAt: new Date("2026-04-22T10:00:00Z"),
          endedAt: null,
          durationSec: null,
          recordingUrl: null,
          summary: null,
          tags: [],
          patientId: null,
        };
        rows.push(row);
        return row;
      }),
      findUnique: vi.fn(async (args: { where: { clinicId_sipCallId: { clinicId: string; sipCallId: string } } }) => {
        const { clinicId, sipCallId } = args.where.clinicId_sipCallId;
        return rows.find((r) => r.clinicId === clinicId && r.sipCallId === sipCallId) ?? null;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Partial<CallRow> }) => {
        const row = rows.find((r) => r.id === args.where.id);
        if (!row) throw new Error("Not found");
        Object.assign(row, args.data);
        return row;
      }),
    },
  },
}));

vi.mock("@/lib/tenant-context", () => ({
  requireTenant: vi.fn(() => ({
    kind: "TENANT",
    clinicId: "clinic-a",
    userId: "user-1",
    role: "CALL_OPERATOR",
  })),
}));

// Import AFTER mocks so the adapter picks them up.
import { LogOnlyTelephonyAdapter } from "@/server/telephony/log-only";
import { getEventBus } from "@/server/realtime/event-bus";
import { TELEPHONY_CHANNELS, CALL_CHANNELS } from "@/server/telephony/adapter";

beforeEach(() => {
  rows.length = 0;
  nextId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LogOnlyTelephonyAdapter.call", () => {
  it("creates a Call row with direction=OUT and returns a log- callId", async () => {
    const adapter = new LogOnlyTelephonyAdapter();
    const result = await adapter.call("+998901234567", "+998712001020");
    expect(result.callId).toMatch(/^log-/);
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.direction).toBe("OUT");
    expect(row?.fromNumber).toBe("+998712001020");
    expect(row?.toNumber).toBe("+998901234567");
    expect(row?.operatorId).toBe("user-1");
    expect(row?.sipCallId).toBe(result.callId);
  });

  it("publishes ringing + call.incoming events", async () => {
    const bus = getEventBus();
    const ringing: unknown[] = [];
    const incoming: unknown[] = [];
    const u1 = bus.subscribe(TELEPHONY_CHANNELS.ringing, (p) => ringing.push(p));
    const u2 = bus.subscribe(CALL_CHANNELS.incoming, (p) => incoming.push(p));

    const adapter = new LogOnlyTelephonyAdapter();
    await adapter.call("+998900000001", "+998712001020");

    expect(ringing).toHaveLength(1);
    expect(incoming).toHaveLength(1);

    u1();
    u2();
  });
});

describe("LogOnlyTelephonyAdapter.hangup", () => {
  it("closes the call and computes durationSec", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-04-22T10:00:00Z"));
      const adapter = new LogOnlyTelephonyAdapter();
      const { callId } = await adapter.call("+998900000002", "+998712001020");

      vi.setSystemTime(new Date("2026-04-22T10:01:30Z")); // +90s
      await adapter.hangup(callId);

      const row = rows.find((r) => r.sipCallId === callId);
      expect(row?.endedAt).toBeInstanceOf(Date);
      expect(row?.durationSec).toBe(90);
    } finally {
      vi.useRealTimers();
    }
  });

  it("is idempotent for an already-ended call", async () => {
    const adapter = new LogOnlyTelephonyAdapter();
    const { callId } = await adapter.call("+998900000003", "+998712001020");
    await adapter.hangup(callId);
    const first = rows.find((r) => r.sipCallId === callId)?.endedAt;
    // Second hangup must not throw or move the endedAt.
    await adapter.hangup(callId);
    const second = rows.find((r) => r.sipCallId === callId)?.endedAt;
    expect(first?.getTime()).toBe(second?.getTime());
  });

  it("no-ops on an unknown callId", async () => {
    const adapter = new LogOnlyTelephonyAdapter();
    await expect(adapter.hangup("log-does-not-exist")).resolves.toBeUndefined();
  });
});

describe("LogOnlyTelephonyAdapter.onEvent", () => {
  it("forwards every telephony.* channel", () => {
    const adapter = new LogOnlyTelephonyAdapter();
    const events: unknown[] = [];
    const unsub = adapter.onEvent((e) => events.push(e));

    const bus = getEventBus();
    const base = {
      callId: "log-1",
      from: "+998900000004",
      to: "+998712001020",
      timestamp: new Date("2026-04-22T10:00:00Z"),
    };
    bus.publish(TELEPHONY_CHANNELS.ringing, { kind: "ringing", ...base });
    bus.publish(TELEPHONY_CHANNELS.answered, { kind: "answered", ...base });
    bus.publish(TELEPHONY_CHANNELS.hangup, { kind: "hangup", ...base });
    bus.publish(TELEPHONY_CHANNELS.missed, { kind: "missed", ...base });

    expect(events).toHaveLength(4);
    unsub();

    bus.publish(TELEPHONY_CHANNELS.ringing, { kind: "ringing", ...base });
    expect(events).toHaveLength(4);
  });

  it("ignores payloads that aren't TelephonyEvents", () => {
    const adapter = new LogOnlyTelephonyAdapter();
    const events: unknown[] = [];
    const unsub = adapter.onEvent((e) => events.push(e));

    const bus = getEventBus();
    // Malformed payload — missing required fields.
    bus.publish(TELEPHONY_CHANNELS.ringing, { not: "a telephony event" });
    bus.publish(TELEPHONY_CHANNELS.ringing, null);
    bus.publish(TELEPHONY_CHANNELS.ringing, "garbage");

    expect(events).toHaveLength(0);
    unsub();
  });
});
