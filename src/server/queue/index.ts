/**
 * Minimal BullMQ-compatible queue abstraction.
 *
 * ## Why
 *
 * Phase 3a needs a queue for notification delivery (`notifications:send`)
 * and a cron-like poller (`notifications-scheduler`). BullMQ + Redis land
 * in Phase 6 via `infrastructure-engineer`, but notifications must work
 * **today** without Redis. So we expose a tiny interface that both an
 * in-memory `setTimeout`-based runner and the future BullMQ backend can
 * implement.
 *
 * ## Contract
 *
 *  - `enqueue(queue, jobName, data, opts?)` — schedule a job. Runs in-process
 *    after `opts.delay` ms (default 0).
 *  - `registerWorker(queue, jobName, handler, opts?)` — attach a consumer.
 *    Multiple workers can listen to the same queue; the dispatcher picks
 *    the first matching handler.
 *  - `repeat(queue, jobName, data, intervalMs)` — cron-like: fire the job
 *    every `intervalMs`. Used by `notifications-scheduler`.
 *
 * ## Swap to BullMQ
 *
 * When `REDIS_URL` is set and BullMQ is installed, replace the impl
 * here with a `BullmqQueueAdapter` that forwards to `new Queue(name)`,
 * `new Worker(name, handler)`, and `queue.add(..., { repeat })`. The
 * route handlers and triggers call only the exports of this module,
 * so they don't need any changes. See `docs/progress/LOG.md` Phase 3a
 * "TODO for infrastructure-engineer".
 *
 * ## Not a goal
 *
 * This implementation is intentionally dumb:
 *  - no cross-process coordination (single-Node only)
 *  - no persistence across process restarts (DB is the persistence layer)
 *  - retries are the worker's responsibility (see `notifications-send.ts`)
 */

import { recordHeartbeat } from "@/server/observability/worker-heartbeat";

import { BullmqQueueAdapter } from "./bullmq-adapter";

export type JobHandler<T = unknown> = (data: T) => Promise<void> | void;

export type EnqueueOptions = {
  delay?: number; // ms
  jobId?: string;
  /**
   * While a job enqueued under this key waits or runs, enqueuing another one
   * under it does nothing (BullMQ `deduplication`). Unlike `jobId`, the key
   * is free again once the job has finished, failed included.
   */
  dedupeId?: string;
};

export interface QueueAdapter {
  enqueue<T>(
    queueName: string,
    jobName: string,
    data: T,
    opts?: EnqueueOptions,
  ): Promise<void>;
  registerWorker<T>(
    queueName: string,
    jobName: string,
    handler: JobHandler<T>,
  ): void;
  repeat<T>(
    queueName: string,
    jobName: string,
    data: T,
    intervalMs: number,
  ): { stop: () => void };
  shutdown(): Promise<void>;
}

type HandlerKey = `${string}:${string}`;

class InMemoryQueueAdapter implements QueueAdapter {
  private handlers = new Map<HandlerKey, JobHandler<unknown>>();
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private intervals = new Set<ReturnType<typeof setInterval>>();
  /** Dedupe keys of jobs waiting to run: a second enqueue under one is a no-op. */
  private pendingDedupe = new Set<string>();

  async enqueue<T>(
    queueName: string,
    jobName: string,
    data: T,
    opts?: EnqueueOptions,
  ): Promise<void> {
    const key = `${queueName}:${jobName}` as HandlerKey;
    const handler = this.handlers.get(key);
    if (!handler) {
      // No handler registered yet — log and move on. The scheduler will
      // pick pending rows from DB on the next tick anyway.
      console.warn(
        `[queue] enqueue(${queueName}:${jobName}) but no worker registered`,
      );
      return;
    }
    const dedupeKey = opts?.dedupeId ? `${queueName}:${opts.dedupeId}` : null;
    if (dedupeKey) {
      if (this.pendingDedupe.has(dedupeKey)) return;
      this.pendingDedupe.add(dedupeKey);
    }
    const delay = Math.max(0, opts?.delay ?? 0);
    const run = async () => {
      if (dedupeKey) this.pendingDedupe.delete(dedupeKey);
      try {
        await handler(data);
      } catch (e) {
        console.error(`[queue] ${queueName}:${jobName} failed`, e);
      }
    };
    if (delay === 0) {
      // Fire on next microtask so the caller can continue synchronously.
      queueMicrotask(run);
      return;
    }
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void run();
    }, delay);
    this.timers.add(timer);
  }

  registerWorker<T>(
    queueName: string,
    jobName: string,
    handler: JobHandler<T>,
  ): void {
    const key = `${queueName}:${jobName}` as HandlerKey;
    this.handlers.set(key, handler as JobHandler<unknown>);
  }

  repeat<T>(
    queueName: string,
    jobName: string,
    data: T,
    intervalMs: number,
  ): { stop: () => void } {
    const key = `${queueName}:${jobName}` as HandlerKey;
    // Liveness (audit INF-01): the loop beats once on registration and after
    // every tick that returns, so /api/health sees a loop that stopped.
    recordHeartbeat(key, intervalMs);
    const timer = setInterval(() => {
      const handler = this.handlers.get(key);
      if (!handler) return;
      void (async () => {
        try {
          await handler(data);
          recordHeartbeat(key, intervalMs);
        } catch (e) {
          console.error(`[queue] repeat ${queueName}:${jobName} failed`, e);
        }
      })();
    }, intervalMs);
    // `unref` so we don't block Node shutdown in dev.
    if (typeof (timer as { unref?: () => void }).unref === "function") {
      (timer as { unref?: () => void }).unref?.();
    }
    this.intervals.add(timer);
    return {
      stop: () => {
        clearInterval(timer);
        this.intervals.delete(timer);
      },
    };
  }

  async shutdown(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    for (const i of this.intervals) clearInterval(i);
    this.timers.clear();
    this.intervals.clear();
    this.handlers.clear();
    this.pendingDedupe.clear();
  }
}

let singleton: QueueAdapter | null = null;

/**
 * Lazy-create the process-wide queue adapter.
 *
 * With `REDIS_URL` set we get the durable BullMQ backend (at-least-once,
 * survives restarts); without it we fall back to the in-memory runner for
 * dev + tests. Importing `bullmq` is side-effect-free (no connection opens
 * until the adapter is constructed), so a static import is safe even on the
 * in-memory path.
 */
export function getQueue(): QueueAdapter {
  if (!singleton) {
    singleton = process.env.REDIS_URL
      ? new BullmqQueueAdapter()
      : new InMemoryQueueAdapter();
  }
  return singleton;
}

/** Convenience: enqueue a job on the default queue adapter. */
export function enqueue<T>(
  queueName: string,
  jobName: string,
  data: T,
  opts?: EnqueueOptions,
): Promise<void> {
  return getQueue().enqueue(queueName, jobName, data, opts);
}

/** Test-only: inject a mock. */
export function __setQueueForTests(q: QueueAdapter | null) {
  singleton = q;
}
