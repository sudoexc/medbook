/**
 * BullMQ-backed implementation of the `QueueAdapter` interface.
 *
 * Activated by `getQueue()` only when `process.env.REDIS_URL` is set;
 * otherwise the in-memory adapter stays in charge (dev + tests). The route
 * handlers, triggers and schedulers all talk to the `QueueAdapter` interface,
 * so swapping the backend here is invisible to callers.
 *
 * ## Connection
 *
 * Queues share one ioredis connection (their commands are non-blocking).
 * Each `Worker` gets its own dedicated connection because a worker holds a
 * blocking `BRPOPLPUSH` — sharing one connection across many workers would
 * serialise them. All connections set `maxRetriesPerRequest: null`, which
 * BullMQ requires for workers.
 *
 * ## Topology
 *
 *  - `enqueue` lazily creates one `Queue` per `queueName` and `add`s the job.
 *  - `registerWorker` records the handler keyed `${queueName}:${jobName}` and
 *    lazily spins up exactly one `Worker` per `queueName` that dispatches each
 *    job to the handler matching `job.name`. (One queue can carry several job
 *    names — e.g. `notifications:scheduler` runs both `tick` and `dispatch`.)
 *  - `repeat` upserts a BullMQ job scheduler. The schedule lives in Redis and
 *    survives process restarts, so `stop()` is a deliberate no-op — re-running
 *    `repeat()` after a restart is an idempotent upsert, and processing is
 *    halted by closing the worker in `shutdown()`, not by deleting the
 *    schedule.
 *
 * Retries stay the worker's responsibility (matching the in-memory adapter),
 * so jobs run with `attempts: 1` — BullMQ does not add a second retry layer.
 */

import Redis from "ioredis";
import type { Redis as RedisClient } from "ioredis";
import { Queue, Worker, type Job } from "bullmq";

import type { EnqueueOptions, JobHandler, QueueAdapter } from "./index";

// Bound Redis growth: keep the last N terminal jobs for debugging, drop the
// rest. These are counts, not flags — BullMQ trims older entries past them.
const DEFAULT_JOB_OPTS = {
  attempts: 1,
  removeOnComplete: 1000,
  removeOnFail: 5000,
} as const;

// BullMQ reserves `:` as its Redis key separator and throws "Queue name cannot
// contain :" if a queue name includes one. Our logical queue names do (e.g.
// "notifications:send"), so map them to a BullMQ-safe physical name. Applied
// identically for the Queue (producer) and Worker (consumer) so both bind to
// the same Redis keys; internal Maps stay keyed by the logical name.
function bullQueueName(queueName: string): string {
  return queueName.replaceAll(":", "-");
}

type HandlerKey = `${string}:${string}`;

export class BullmqQueueAdapter implements QueueAdapter {
  private readonly queueConnection: RedisClient;
  private readonly workerConnections: RedisClient[] = [];
  private readonly queues = new Map<string, Queue>();
  private readonly workers = new Map<string, Worker>();
  private readonly handlers = new Map<HandlerKey, JobHandler<unknown>>();

  constructor() {
    this.queueConnection = this.makeConnection();
  }

  private makeConnection(): RedisClient {
    const conn = new Redis(process.env.REDIS_URL!, {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
    });
    conn.on("error", (err) => {
      console.warn("[queue:bullmq] connection error", err?.message ?? err);
    });
    return conn;
  }

  private getQueueFor(queueName: string): Queue {
    let queue = this.queues.get(queueName);
    if (!queue) {
      queue = new Queue(bullQueueName(queueName), {
        connection: this.queueConnection,
        defaultJobOptions: DEFAULT_JOB_OPTS,
      });
      this.queues.set(queueName, queue);
    }
    return queue;
  }

  async enqueue<T>(
    queueName: string,
    jobName: string,
    data: T,
    opts?: EnqueueOptions,
  ): Promise<void> {
    await this.getQueueFor(queueName).add(jobName, data, {
      delay: opts?.delay,
      jobId: opts?.jobId,
    });
  }

  registerWorker<T>(
    queueName: string,
    jobName: string,
    handler: JobHandler<T>,
  ): void {
    const key = `${queueName}:${jobName}` as HandlerKey;
    this.handlers.set(key, handler as JobHandler<unknown>);

    if (this.workers.has(queueName)) return;
    const connection = this.makeConnection();
    this.workerConnections.push(connection);
    const worker = new Worker(
      bullQueueName(queueName),
      async (job: Job) => {
        const h = this.handlers.get(`${queueName}:${job.name}` as HandlerKey);
        if (!h) {
          console.warn(
            `[queue:bullmq] ${queueName}:${job.name} fired but no handler`,
          );
          return;
        }
        await h(job.data);
      },
      { connection },
    );
    worker.on("failed", (job, err) => {
      console.error(
        `[queue:bullmq] ${queueName}:${job?.name} failed`,
        err?.message ?? err,
      );
    });
    this.workers.set(queueName, worker);
  }

  repeat<T>(
    queueName: string,
    jobName: string,
    data: T,
    intervalMs: number,
  ): { stop: () => void } {
    void this.getQueueFor(queueName)
      .upsertJobScheduler(
        jobName,
        { every: intervalMs },
        { name: jobName, data },
      )
      .catch((err) => {
        console.error(
          `[queue:bullmq] upsertJobScheduler ${queueName}:${jobName} failed`,
          err?.message ?? err,
        );
      });
    // The schedule is persisted in Redis and is meant to outlive this process,
    // so a per-process SIGTERM must NOT delete it. Processing is stopped by
    // closing the worker in `shutdown()`.
    return { stop: () => {} };
  }

  async shutdown(): Promise<void> {
    // Close workers first (drains in-flight jobs), then their connections,
    // then the queues and the shared queue connection.
    await Promise.all(
      [...this.workers.values()].map((w) => w.close().catch(() => {})),
    );
    await Promise.all(
      this.workerConnections.map((c) => c.quit().catch(() => {})),
    );
    await Promise.all(
      [...this.queues.values()].map((q) => q.close().catch(() => {})),
    );
    await this.queueConnection.quit().catch(() => {});
    this.workers.clear();
    this.queues.clear();
    this.handlers.clear();
    this.workerConnections.length = 0;
  }
}
