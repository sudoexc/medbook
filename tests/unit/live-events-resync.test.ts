/**
 * Audit INF-06: the CRM's SSE replay was dead. After any drop (deploy,
 * Wi-Fi blink, laptop sleep) events published during the gap were lost and
 * nothing refreshed the screen: the doctor kept seeing «ожидается» for a
 * patient reception had already checked in.
 *
 *   - The client reconnected with a fresh `new EventSource("/api/events")`,
 *     which carries no Last-Event-ID, so the server's outbox replay never
 *     ran. It now resumes with `?since=<last eventId>`.
 *   - Replay covers only outbox (v2) events, so every reconnect after a drop
 *     also tells subscribers to refetch (`onResync`).
 *   - The server's «cursor too old» signal was an SSE comment, invisible to
 *     JS. It is a named event now, joined by `replay-truncated` and
 *     `replay-failed`.
 *
 * The client side is driven through a fake EventSource installed with the
 * test seam; the server side through the real route with a mocked outbox.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ----- server mocks (the /api/events route) --------------------------------

const srv = vi.hoisted(() => ({
  cursor: null as null | { createdAt: Date; clinicId: string },
  missed: [] as Array<{ envelope: unknown }>,
  replayThrows: false,
}));

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(async () => ({
    user: { id: "u1", role: "DOCTOR", clinicId: "c1", sessionId: "s1" },
  })),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    eventOutbox: {
      findUnique: vi.fn(async () => {
        if (srv.replayThrows) throw new Error("db down");
        return srv.cursor;
      }),
      findMany: vi.fn(async () => srv.missed),
    },
  },
}));
vi.mock("@/lib/tenant-context", () => ({
  runWithTenant: <T,>(_c: unknown, fn: () => T) => Promise.resolve(fn()),
}));
vi.mock("@/server/auth/session-guard", () => ({
  evaluateStaffSession: vi.fn(async () => ({ ok: true })),
}));
vi.mock("@/server/realtime/event-bus", () => ({
  getEventBus: () => ({ subscribe: () => () => {} }),
}));
vi.mock("@/server/realtime/redis-adapter", () => ({
  isRedisEnabled: () => false,
  ensureRedisSubscriber: () => {},
}));

import { NextRequest } from "next/server";

import {
  SSE_RESYNC_EVENTS,
  __resetLiveEventsForTests,
  __setLiveEventsTransportForTests,
  liveEventsUrl,
  subscribeLiveEvents,
} from "@/hooks/use-live-events";

// ----- a fake EventSource ---------------------------------------------------

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string; lastEventId: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private named = new Map<string, Array<() => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(name: string, fn: () => void) {
    this.named.set(name, [...(this.named.get(name) ?? []), fn]);
  }
  close() {
    this.closed = true;
  }
  // Test drivers
  open() {
    this.onopen?.();
  }
  message(payload: unknown, lastEventId = "") {
    this.onmessage?.({ data: JSON.stringify(payload), lastEventId });
  }
  fail() {
    this.onerror?.();
  }
  fire(name: string) {
    for (const fn of this.named.get(name) ?? []) fn();
  }
}

function v2(eventId: string) {
  return {
    eventId,
    correlationId: "corr",
    at: "2026-09-26T05:00:00.000Z",
    type: "appointment.statusChanged",
    payload: { appointmentId: "apt_1", doctorId: "doc_1", status: "WAITING" },
    actor: {
      role: "RECEPTIONIST",
      userId: "u_r",
      patientId: null,
      onBehalfOfPatientId: null,
      label: "user:u_r",
    },
    surface: "CRM",
    tenantScope: { clinicId: "c1" },
  };
}

function v1() {
  return {
    type: "queue.updated",
    clinicId: "c1",
    at: "2026-09-26T05:00:00.000Z",
    payload: { appointmentId: "apt_1", doctorId: "doc_1", queueStatus: "WAITING" },
  };
}

describe("useLiveEvents — resume and resync after a gap (client)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
    __setLiveEventsTransportForTests(
      FakeEventSource as unknown as Parameters<
        typeof __setLiveEventsTransportForTests
      >[0],
    );
  });
  afterEach(() => {
    __resetLiveEventsForTests();
    __setLiveEventsTransportForTests(null);
    vi.useRealTimers();
  });

  it("builds the resume URL", () => {
    expect(liveEventsUrl(null)).toBe("/api/events");
    expect(liveEventsUrl("ev 1")).toBe("/api/events?since=ev%201");
  });

  it("first connect: no since, no resync (the queries have just fetched)", () => {
    const onResync = vi.fn();
    subscribeLiveEvents(() => {}, onResync);
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe("/api/events");
    es.open();
    expect(onResync).not.toHaveBeenCalled();
  });

  it("after a drop it reconnects with ?since=<last eventId> and tells subscribers to refetch", async () => {
    const onEvent = vi.fn();
    const onResync = vi.fn();
    subscribeLiveEvents(onEvent, onResync);
    const first = FakeEventSource.instances[0];
    first.open();
    first.message(v2("ev-41"), "ev-41");
    // A v1 frame carries no id; the resume point stays at the last v2 one.
    first.message(v1(), "ev-41");
    expect(onEvent).toHaveBeenCalledTimes(2);

    // Deploy: the socket drops, the backoff timer reconnects.
    first.fail();
    await vi.advanceTimersByTimeAsync(1_000);
    const second = FakeEventSource.instances[1];
    expect(second.url).toBe("/api/events?since=ev-41");

    second.open();
    expect(onResync).toHaveBeenCalledTimes(1);
  });

  it("falls back to the envelope's own eventId when the frame has no id line", async () => {
    subscribeLiveEvents(() => {});
    const first = FakeEventSource.instances[0];
    first.open();
    first.message(v2("ev-7"));
    first.fail();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(FakeEventSource.instances[1].url).toBe("/api/events?since=ev-7");
  });

  it("cursor-too-old: resync now, and never offer that cursor again", async () => {
    const onResync = vi.fn();
    subscribeLiveEvents(() => {}, onResync);
    const first = FakeEventSource.instances[0];
    first.open();
    first.message(v2("ev-old"), "ev-old");
    first.fail();
    await vi.advanceTimersByTimeAsync(1_000);
    const second = FakeEventSource.instances[1];
    second.open();
    onResync.mockClear();

    second.fire("cursor-too-old");
    expect(onResync).toHaveBeenCalledTimes(1);

    second.fail();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(FakeEventSource.instances[2].url).toBe("/api/events");
  });

  it("replay-truncated and replay-failed also resync", () => {
    const onResync = vi.fn();
    subscribeLiveEvents(() => {}, onResync);
    const es = FakeEventSource.instances[0];
    es.open();
    es.fire("replay-truncated");
    es.fire("replay-failed");
    expect(onResync).toHaveBeenCalledTimes(2);
    expect(SSE_RESYNC_EVENTS).toEqual([
      "cursor-too-old",
      "replay-truncated",
      "replay-failed",
    ]);
  });

  it("an unsubscribed listener is not called on resync", async () => {
    const onResync = vi.fn();
    const keep = vi.fn();
    const unsubscribe = subscribeLiveEvents(() => {}, onResync);
    subscribeLiveEvents(() => {}, keep);
    const first = FakeEventSource.instances[0];
    first.open();
    unsubscribe();
    first.fail();
    await vi.advanceTimersByTimeAsync(1_000);
    FakeEventSource.instances[1].open();
    expect(onResync).not.toHaveBeenCalled();
    expect(keep).toHaveBeenCalledTimes(1);
  });
});

// ----- server -----------------------------------------------------------------

async function readAll(res: Response): Promise<string> {
  const reader = res.body!.getReader();
  let out = "";
  // The stream stays open for live events; the replay frames arrive first.
  for (let i = 0; i < 1000; i++) {
    const { value, done } = await Promise.race([
      reader.read(),
      new Promise<{ value: undefined; done: true }>((r) =>
        setTimeout(() => r({ value: undefined, done: true }), 50),
      ),
    ]);
    if (done || !value) break;
    out += new TextDecoder().decode(value);
  }
  await reader.cancel().catch(() => {});
  return out;
}

describe("/api/events — resync signals JS can see (server)", () => {
  beforeEach(() => {
    srv.cursor = null;
    srv.missed = [];
    srv.replayThrows = false;
  });

  async function open(since: string): Promise<string> {
    const { GET } = await import("@/app/api/events/route");
    // Closing the "tab" afterwards runs the route's cleanup, which clears
    // its heartbeat and session-check intervals (they would keep the test
    // worker alive).
    const tab = new AbortController();
    const res = await GET(
      new NextRequest(`https://neurofax.uz/api/events?since=${since}`, {
        signal: tab.signal,
      }),
    );
    expect(res.status).toBe(200);
    try {
      return await readAll(res);
    } finally {
      tab.abort();
    }
  }

  it("a cursor the outbox no longer has is a named cursor-too-old event", async () => {
    const text = await open("ev-gone");
    expect(text).toContain("event: cursor-too-old\ndata: {}\n\n");
  });

  it("a cursor from another clinic is treated the same way", async () => {
    srv.cursor = { createdAt: new Date(), clinicId: "c_other" };
    const text = await open("ev-foreign");
    expect(text).toContain("event: cursor-too-old");
  });

  it("replays what was missed, with ids, and flags a full page as truncated", async () => {
    srv.cursor = { createdAt: new Date(Date.now() - 60_000), clinicId: "c1" };
    srv.missed = Array.from({ length: 200 }, (_, i) => ({
      envelope: v2(`ev-${i}`),
    }));
    const text = await open("ev-start");
    expect(text).toContain("id: ev-0\n");
    expect(text).toContain("event: replay-truncated");
  });

  it("a short replay is not flagged", async () => {
    srv.cursor = { createdAt: new Date(Date.now() - 60_000), clinicId: "c1" };
    srv.missed = [{ envelope: v2("ev-1") }];
    const text = await open("ev-start");
    expect(text).toContain("id: ev-1\n");
    expect(text).not.toContain("replay-truncated");
    expect(text).not.toContain("cursor-too-old");
  });

  it("a failed replay is a named replay-failed event", async () => {
    srv.replayThrows = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const text = await open("ev-x");
    expect(text).toContain("event: replay-failed");
    warn.mockRestore();
  });
});
