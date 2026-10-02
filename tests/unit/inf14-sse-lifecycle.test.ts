import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Audit INF-14 — SSE stream lifecycle.
 *
 *   1. Both streams (/api/events and /api/miniapp/events) attached their
 *      `abort` listener only after awaiting the Last-Event-ID replay. A client
 *      that left during the replay fired `abort` before anyone listened, so
 *      the bus subscription and the intervals (and the Mini App connection
 *      gauge) stayed up for the life of the process.
 *   2. The Mini App allow-set (owner + linked relatives) was read once per
 *      connect: after the owner unlinked a relative, the open stream kept
 *      delivering that relative's events until a reconnect.
 *
 * The real in-process event bus is used so `bus.size(channel)` shows what is
 * left subscribed.
 */

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const h = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
  family: vi.fn(),
  gaugeInc: vi.fn(),
  gaugeDec: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u1", role: "RECEPTIONIST", clinicId: "c1", sessionId: "s1" },
  })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { eventOutbox: { findUnique: h.findUnique, findMany: h.findMany } },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => Promise.resolve(fn()),
}));
vi.mock("@/server/auth/session-guard", () => ({
  evaluateStaffSession: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/server/realtime/redis-adapter", () => ({
  isRedisEnabled: () => false,
  ensureRedisSubscriber: () => {},
}));
vi.mock("@/server/miniapp/handler", () => ({
  resolveMiniAppContext: vi.fn(async () => ({
    ok: true,
    ctx: { clinicId: "c1", patientId: "p_owner" },
  })),
  resolveMiniAppLink: vi.fn(),
}));
vi.mock("@/server/miniapp/active-patient", () => ({
  getFamilyAllowedPatientIds: h.family,
}));
vi.mock("@/server/observability/metrics", () => ({
  getMetrics: () => ({
    sseConnectionsActive: { inc: h.gaugeInc, dec: h.gaugeDec },
    sseEventsDelivered: { inc: () => {} },
    sseReplayEvents: { inc: () => {} },
  }),
}));

import { NextRequest } from "next/server";
import { GET as crmEvents } from "@/app/api/events/route";
import {
  GET as miniappEvents,
  isOwnFamilyChange,
} from "@/app/api/miniapp/events/route";
import { getEventBus } from "@/server/realtime/event-bus";
import { clinicChannel } from "@/server/realtime/channels";

const CHANNEL = clinicChannel("c1");
const flush = () => new Promise((r) => setTimeout(r, 0));

function envelope(
  id: string,
  type: string,
  patientId: string,
  payload: Record<string, unknown> = { patientId },
) {
  return {
    eventId: id,
    correlationId: `cor_${id}`,
    at: "2026-10-02T10:00:00.000Z",
    type,
    payload,
    actor: {
      role: "PATIENT",
      userId: null,
      patientId,
      onBehalfOfPatientId: null,
      label: `patient:${patientId}`,
    },
    surface: "MINIAPP",
    tenantScope: { clinicId: "c1", patientId },
  };
}

beforeEach(() => {
  h.findUnique.mockReset();
  h.findMany.mockReset().mockResolvedValue([]);
  h.family.mockReset().mockResolvedValue(["p_owner"]);
  h.gaugeInc.mockReset();
  h.gaugeDec.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("client leaving during the replay releases the stream", () => {
  it("/api/events: no subscriber is left behind", async () => {
    const cursor = deferred<unknown>();
    h.findUnique.mockReturnValue(cursor.promise);
    const ac = new AbortController();
    const res = await crmEvents(
      new NextRequest("https://neurofax.uz/api/events?since=ev_0", {
        signal: ac.signal,
      }),
    );
    expect(res.status).toBe(200);
    await flush();
    expect(h.findUnique).toHaveBeenCalledOnce();

    ac.abort();
    cursor.resolve({ createdAt: new Date(), clinicId: "c1" });
    await flush();

    expect(getEventBus().size(CHANNEL)).toBe(0);
  });

  it("/api/miniapp/events: no subscriber and the gauge comes back down", async () => {
    const cursor = deferred<unknown>();
    h.findUnique.mockReturnValue(cursor.promise);
    const ac = new AbortController();
    const res = await miniappEvents(
      new NextRequest("https://neurofax.uz/api/miniapp/events?since=ev_0", {
        signal: ac.signal,
      }),
    );
    expect(res.status).toBe(200);
    await flush();

    ac.abort();
    cursor.resolve({ createdAt: new Date(), clinicId: "c1" });
    await flush();

    expect(getEventBus().size(CHANNEL)).toBe(0);
    expect(h.gaugeInc).toHaveBeenCalledTimes(1);
    expect(h.gaugeDec).toHaveBeenCalledTimes(1);
  });

  it("a normal disconnect after the replay still unsubscribes once", async () => {
    const ac = new AbortController();
    await miniappEvents(
      new NextRequest("https://neurofax.uz/api/miniapp/events", {
        signal: ac.signal,
      }),
    );
    await flush();
    expect(getEventBus().size(CHANNEL)).toBe(1);
    ac.abort();
    ac.abort();
    expect(getEventBus().size(CHANNEL)).toBe(0);
    expect(h.gaugeDec).toHaveBeenCalledTimes(1);
  });
});

describe("Mini App allow-set follows family link changes", () => {
  it("stops delivering an unlinked relative's events without a reconnect", async () => {
    h.family
      .mockResolvedValueOnce(["p_owner", "p_rel"])
      .mockResolvedValue(["p_owner"]);
    const ac = new AbortController();
    const res = await miniappEvents(
      new NextRequest("https://neurofax.uz/api/miniapp/events", {
        signal: ac.signal,
      }),
    );
    const reader = res.body!.getReader();
    const next = async () => new TextDecoder().decode((await reader.read()).value);
    expect(await next()).toContain(": ok");
    await flush();

    const bus = getEventBus();
    bus.publish(CHANNEL, envelope("ev_1", "appointment.created", "p_rel"));
    expect(await next()).toContain("ev_1");

    bus.publish(
      CHANNEL,
      envelope("ev_2", "patient.familyUnlinked", "p_owner", {
        ownerPatientId: "p_owner",
        linkedPatientId: "p_rel",
      }),
    );
    // The unlink event itself reaches the owner, then the set is re-read.
    expect(await next()).toContain("ev_2");
    await flush();
    expect(h.family).toHaveBeenCalledTimes(2);

    bus.publish(CHANNEL, envelope("ev_3", "appointment.created", "p_rel"));
    bus.publish(CHANNEL, envelope("ev_4", "appointment.created", "p_owner"));
    const chunk = await next();
    expect(chunk).toContain("ev_4");
    expect(chunk).not.toContain("ev_3");

    ac.abort();
  });

  it("re-reads the set periodically as a safety net", async () => {
    vi.useFakeTimers();
    const ac = new AbortController();
    await miniappEvents(
      new NextRequest("https://neurofax.uz/api/miniapp/events", {
        signal: ac.signal,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(h.family).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.family).toHaveBeenCalledTimes(2);
    ac.abort();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(h.family).toHaveBeenCalledTimes(2);
  });

  it("isOwnFamilyChange matches only the owner's link events in its clinic", () => {
    const own = envelope("e", "patient.familyUnlinked", "p_owner", {
      ownerPatientId: "p_owner",
      linkedPatientId: "p_rel",
    });
    expect(isOwnFamilyChange(own, "c1", "p_owner")).toBe(true);
    expect(
      isOwnFamilyChange(
        { ...own, type: "patient.familyLinked" },
        "c1",
        "p_owner",
      ),
    ).toBe(true);
    expect(isOwnFamilyChange(own, "c1", "p_other")).toBe(false);
    expect(isOwnFamilyChange(own, "c2", "p_owner")).toBe(false);
    expect(
      isOwnFamilyChange(
        envelope("e", "appointment.created", "p_owner", {
          ownerPatientId: "p_owner",
        }),
        "c1",
        "p_owner",
      ),
    ).toBe(false);
    expect(isOwnFamilyChange({ type: "patient.familyUnlinked" }, "c1", "p_owner")).toBe(false);
  });
});
