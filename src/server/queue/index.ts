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

export type JobHandler<T = unknown> = (data: T) => Promise<void> | void;

export type EnqueueOptions = {
  delay?: number; // ms
  jobId?: string;
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
    const delay = Math.max(0, opts?.delay ?? 0);
    const run = async () => {
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
    const timer = setInterval(() => {
      const handler = this.handlers.get(key);
      if (!handler) return;
      void (async () => {
        try {
          await handler(data);
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
  }
}

let singleton: QueueAdapter | null = null;

/**
 * Lazy-create the process-wide queue adapter.
 *
 * Today always returns in-memory. Once BullMQ is installed, branch on
 * `process.env.REDIS_URL` and return `new BullmqQueueAdapter(...)`.
 */
export function getQueue(): QueueAdapter {
  if (!singleton) {
    singleton = new InMemoryQueueAdapter();
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
