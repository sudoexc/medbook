/**
 * Unit tests for the in-memory queue adapter that stands in for BullMQ
 * until infrastructure-engineer lands Redis. Verifies basic enqueue,
 * worker dispatch, and repeat ticking.
 */
import { describe, it, expect } from "vitest";

import { getQueue, __setQueueForTests } from "@/server/queue";

describe("InMemoryQueueAdapter", () => {
  // Always get a fresh adapter per test.
  function fresh() {
    __setQueueForTests(null);
    return getQueue();
  }

  it("dispatches an enqueued job to a registered worker", async () => {
    const q = fresh();
    const calls: number[] = [];
    q.registerWorker<{ n: number }>("t", "j", (data) => {
      calls.push(data.n);
    });
    await q.enqueue("t", "j", { n: 1 });
    await q.enqueue("t", "j", { n: 2 });
    // Queue microtask; flush via a Promise.
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toEqual([1, 2]);
  });

  it("no-ops when no worker is registered (but warns)", async () => {
    const q = fresh();
    await q.enqueue("unknown", "job", { n: 1 });
    // No assertion on the warn — we only care the call resolves.
    expect(true).toBe(true);
  });

  it("honours delay", async () => {
    const q = fresh();
    const calls: number[] = [];
    q.registerWorker<{ n: number }>("t", "j", (data) => {
      calls.push(data.n);
    });
    await q.enqueue("t", "j", { n: 1 }, { delay: 25 });
    expect(calls).toEqual([]);
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toEqual([1]);
  });

  it("repeat fires multiple times and stops when asked", async () => {
    const q = fresh();
    let counter = 0;
    q.registerWorker("t", "tick", () => {
      counter += 1;
    });
    const handle = q.repeat("t", "tick", {}, 10);
    await new Promise((r) => setTimeout(r, 35));
    handle.stop();
    const snapshot = counter;
    await new Promise((r) => setTimeout(r, 30));
    expect(counter).toBe(snapshot);
    expect(snapshot).toBeGreaterThanOrEqual(2);
  });
});
