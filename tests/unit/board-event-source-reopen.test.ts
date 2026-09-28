/**
 * P3 final review: the doctor's own TV (`/tv/d/<token>`) went silent for good
 * after any refused open of its event stream.
 *
 * A network drop is retried by the browser (readyState CONNECTING). A non-200
 * answer is not: the nginx 502 while the app restarts on a deploy, or a 429
 * from the per-address stream cap, leaves the EventSource CLOSED. Only the
 * lobby board reopened it; the doctor TV kept polling its lists (so it looked
 * alive) but never got `queue.called` again: no call screen, no chime, no
 * voice until someone reloaded it.
 *
 * Both screens now share `openBoardEventSource`, driven here through a fake
 * EventSource.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  EVENT_SOURCE_CLOSED,
  openBoardEventSource,
  type BoardEventSourceCtor,
} from "@/lib/board-event-source";
import {
  DOCTOR_TV_SSE_REOPEN_MS,
  doctorTvEventsUrl,
} from "@/hooks/use-doctor-board";

const CONNECTING = 0;
const OPEN = 1;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readyState = CONNECTING;
  onopen: ((ev: Event) => unknown) | null = null;
  onerror: ((ev: Event) => unknown) | null = null;
  onmessage: ((ev: MessageEvent) => unknown) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  close() {
    this.closed = true;
    this.readyState = EVENT_SOURCE_CLOSED;
  }
  // Test drivers
  open() {
    this.readyState = OPEN;
    this.onopen?.({} as Event);
  }
  /** A dropped connection: the browser retries on its own. */
  drop() {
    this.readyState = CONNECTING;
    this.onerror?.({} as Event);
  }
  /** A non-200 answer (502, 429): the browser gives up for good. */
  refuse() {
    this.readyState = EVENT_SOURCE_CLOSED;
    this.onerror?.({} as Event);
  }
  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) } as MessageEvent);
  }
}

const Impl = FakeEventSource as unknown as BoardEventSourceCtor;
const URL_ = "/api/c/neurofax/queue/events?screen=tv_token_1";

function handlers() {
  return { onOpen: vi.fn(), onError: vi.fn(), onMessage: vi.fn() };
}

describe("openBoardEventSource", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeEventSource.instances = [];
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the stream and relays open and messages", () => {
    const h = handlers();
    openBoardEventSource(URL_, h, 5_000, Impl);
    expect(FakeEventSource.instances).toHaveLength(1);
    const es = FakeEventSource.instances[0];
    expect(es.url).toBe(URL_);
    es.open();
    es.message({ type: "queue.called" });
    expect(h.onOpen).toHaveBeenCalledTimes(1);
    expect(h.onMessage).toHaveBeenCalledTimes(1);
  });

  it("leaves a network drop to the browser's own retry", async () => {
    const h = handlers();
    openBoardEventSource(URL_, h, 5_000, Impl);
    const es = FakeEventSource.instances[0];
    es.open();
    es.drop();
    expect(h.onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(es.closed).toBe(false);
  });

  it("reopens the same URL after a refused open (the 502 mid-deploy)", async () => {
    const h = handlers();
    openBoardEventSource(URL_, h, 5_000, Impl);
    const first = FakeEventSource.instances[0];
    first.open();
    first.refuse();
    expect(h.onError).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4_999);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    const second = FakeEventSource.instances[1];
    expect(second.url).toBe(URL_);
    second.open();
    second.message({ type: "queue.called" });
    expect(h.onOpen).toHaveBeenCalledTimes(2);
    expect(h.onMessage).toHaveBeenCalledTimes(1);
  });

  it("keeps trying while the app is still down, one reopen per refusal", async () => {
    const h = handlers();
    openBoardEventSource(URL_, h, 5_000, Impl);
    FakeEventSource.instances[0].refuse();
    // A stray second error on the same closed source must not stack a timer.
    FakeEventSource.instances[0].refuse();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeEventSource.instances).toHaveLength(2);

    FakeEventSource.instances[1].refuse();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeEventSource.instances).toHaveLength(3);

    FakeEventSource.instances[2].open();
    expect(h.onOpen).toHaveBeenCalledTimes(1);
  });

  it("ignores a replaced source's late events", async () => {
    const h = handlers();
    openBoardEventSource(URL_, h, 5_000, Impl);
    const first = FakeEventSource.instances[0];
    first.refuse();
    await vi.advanceTimersByTimeAsync(5_000);
    h.onMessage.mockClear();
    first.message({ type: "queue.called" });
    expect(h.onMessage).not.toHaveBeenCalled();
  });

  it("dispose closes the live source and cancels a pending reopen", async () => {
    const h = handlers();
    const dispose = openBoardEventSource(URL_, h, 5_000, Impl);
    const first = FakeEventSource.instances[0];
    first.open();
    dispose();
    expect(first.closed).toBe(true);

    const h2 = handlers();
    const dispose2 = openBoardEventSource(URL_, h2, 5_000, Impl);
    FakeEventSource.instances[1].refuse();
    dispose2();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(h2.onOpen).not.toHaveBeenCalled();
  });
});

describe("doctor TV stream", () => {
  it("keeps its own token as `screen`, so the reopened stream stays exempt from the address cap", () => {
    expect(doctorTvEventsUrl("neurofax", "tv token/1")).toBe(
      "/api/c/neurofax/queue/events?screen=tv%20token%2F1",
    );
  });

  it("retries within seconds, not the lobby's half minute", () => {
    expect(DOCTOR_TV_SSE_REOPEN_MS).toBeGreaterThan(0);
    expect(DOCTOR_TV_SSE_REOPEN_MS).toBeLessThanOrEqual(10_000);
  });

  it("both board hooks go through the reopening helper, never a bare EventSource", () => {
    for (const file of ["use-doctor-board.ts", "use-queue-board.ts"]) {
      const src = readFileSync(
        path.join(__dirname, "../../src/hooks", file),
        "utf8",
      );
      expect(src, file).toContain("openBoardEventSource(");
      expect(src, file).not.toMatch(/new EventSource\(/);
    }
  });
});
